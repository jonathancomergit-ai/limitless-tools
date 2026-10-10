/* ============================================================
   Tilemap Painter - the map and its rules (pure, unit tested)

   No DOM here: plain data in, plain data out, so node --test
   can check it. main.js is the page.

   A cell holds a "gid", the same number Tiled uses:
     0      = empty
     1..N   = tile (gid - 1) of the tileset, counted left to
              right, top to bottom
   So the Tiled export is the data as it is (firstgid = 1).

   Sections:
     1. limits + small helpers
     2. tileset grid       tile size, spacing, margin -> tiles
     3. the map            create, clone, resize, layers
     4. tools              line, box, flood fill, eyedropper
     5. history            undo / redo, capped
     6. Tiled JSON (.tmj)  export + import
     7. CSV                one layer, Tiled's CSV shape
     8. save format        run-length text
   ============================================================ */

/* ============================================================
   1. LIMITS + SMALL HELPERS
   ============================================================ */
export const MAX_LAYERS = 8;
export const MAX_MAP = 256;            // tiles a side
export const MAX_MAP_PX = 4096;        // map picture a side (iOS canvas limit)
export const MAX_TILES = 4096;         // tiles in one tileset
export const MAX_TILE = 256;           // tile size a side
export const MIN_TILE = 4;
export const MAX_GAP = 64;             // spacing / margin
export const MAX_IMAGE = 4096;         // tileset picture a side
export const HISTORY_LIMIT = 200;
const FLIP_BITS = 0xE0000000;          // Tiled keeps flip flags in the top 3 bits

export function clampInt(v, lo, hi, def) {
  const n = Number(v);
  if (v === "" || v === null || v === undefined || !Number.isFinite(n)) { return def; }
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/* "My Level 2.png" -> "my-level-2" (for file names). */
export function baseName(name, fallback = "tilemap") {
  const b = String(name || "").replace(/\.[a-z0-9]{1,5}$/i, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return b || fallback;
}

/* A file name without folders: "../art/tiles.png" -> "tiles.png". */
export function fileOnly(path) {
  return String(path || "").split(/[\\/]/).pop() || "";
}

/* ============================================================
   2. TILESET GRID
   margin = border round the picture, spacing = gap between
   tiles (Tiled's words). Tiles that don't fit fully are left out.
   ============================================================ */
export const TILESET_DEFAULTS = Object.freeze({ tileW: 16, tileH: 16, spacing: 0, margin: 0 });

export function normalizeTileset(s = {}) {
  const d = TILESET_DEFAULTS;
  return {
    tileW: clampInt(s.tileW, MIN_TILE, MAX_TILE, d.tileW),
    tileH: clampInt(s.tileH, MIN_TILE, MAX_TILE, d.tileH),
    spacing: clampInt(s.spacing, 0, MAX_GAP, d.spacing),
    margin: clampInt(s.margin, 0, MAX_GAP, d.margin)
  };
}

export function tilesetGrid(imageW, imageH, settings) {
  const { tileW, tileH, spacing, margin } = normalizeTileset(settings);
  const fit = (size, tile) => Math.max(0, Math.floor((size - 2 * margin + spacing) / (tile + spacing)));
  let columns = fit(imageW, tileW);
  let rows = fit(imageH, tileH);
  let error = "";
  if (!columns || !rows) {
    error = `The picture (${imageW} × ${imageH}) is smaller than one ${tileW} × ${tileH} tile.`;
    columns = 0;
    rows = 0;
  } else if (columns * rows > MAX_TILES) {
    rows = Math.max(1, Math.floor(MAX_TILES / columns));
    error = `Only the first ${columns * rows} tiles are used (up to ${MAX_TILES}).`;
  }
  const usedW = columns ? 2 * margin + columns * tileW + (columns - 1) * spacing : 0;
  const usedH = rows ? 2 * margin + rows * tileH + (rows - 1) * spacing : 0;
  return { columns, rows, count: columns * rows, leftX: columns ? imageW - usedW : 0, leftY: rows ? imageH - usedH : 0, error };
}

/* Where tile `index` (0-based) sits in the picture. */
export function tileRect(index, columns, settings) {
  const { tileW, tileH, spacing, margin } = normalizeTileset(settings);
  const col = index % columns;
  const row = Math.floor(index / columns);
  return { x: margin + col * (tileW + spacing), y: margin + row * (tileH + spacing), w: tileW, h: tileH };
}

/* The biggest map (in tiles) whose picture stays drawable. */
export function maxMapSize(tileW, tileH) {
  return {
    w: Math.max(1, Math.min(MAX_MAP, Math.floor(MAX_MAP_PX / tileW))),
    h: Math.max(1, Math.min(MAX_MAP, Math.floor(MAX_MAP_PX / tileH)))
  };
}

/* ============================================================
   3. THE MAP
   { w, h, layers: [{ name, visible, data: Uint16Array(w*h) }] }
   layers[0] is the bottom one (Tiled's order too).
   ============================================================ */
export function createMap(w, h, { layers = 1, names = null } = {}) {
  const map = { w, h, layers: [] };
  for (let i = 0; i < layers; i++) {
    map.layers.push({ name: names?.[i] || `Layer ${i + 1}`, visible: true, data: new Uint16Array(w * h) });
  }
  return map;
}

export function cloneMap(map) {
  return { w: map.w, h: map.h, layers: map.layers.map((l) => ({ name: l.name, visible: l.visible, data: l.data.slice() })) };
}

/* New size, keeping the tiles at the top-left. Smaller crops. */
export function resizeMap(map, w, h) {
  if (w === map.w && h === map.h) { return map; }
  const out = { w, h, layers: [] };
  for (const l of map.layers) {
    const data = new Uint16Array(w * h);
    const cw = Math.min(w, map.w);
    for (let y = 0; y < Math.min(h, map.h); y++) {
      data.set(l.data.subarray(y * map.w, y * map.w + cw), y * w);
    }
    out.layers.push({ name: l.name, visible: l.visible, data });
  }
  return out;
}

function freshName(map) {
  const used = new Set(map.layers.map((l) => l.name));
  let n = map.layers.length + 1;
  while (used.has(`Layer ${n}`)) { n++; }
  return `Layer ${n}`;
}

export function addLayer(map, at = map.layers.length) {
  if (map.layers.length >= MAX_LAYERS) { return map; }
  const m = cloneMap(map);
  m.layers.splice(at, 0, { name: freshName(map), visible: true, data: new Uint16Array(m.w * m.h) });
  return m;
}

export function deleteLayer(map, i) {
  if (map.layers.length <= 1 || i < 0 || i >= map.layers.length) { return map; }
  const m = cloneMap(map);
  m.layers.splice(i, 1);
  return m;
}

/* dir +1 = up (drawn later, on top), -1 = down. */
export function moveLayer(map, i, dir) {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= map.layers.length || j >= map.layers.length) { return map; }
  const m = cloneMap(map);
  [m.layers[i], m.layers[j]] = [m.layers[j], m.layers[i]];
  return m;
}

/* ============================================================
   4. TOOLS
   Each one writes into one layer's data and returns how many
   cells changed. Out-of-map points are skipped.
   ============================================================ */
export function linePoints(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    pts.push([x, y]);
    if (x === x1 && y === y1) { break; }
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return pts;
}

/* A filled box, corner to corner (either way round). */
export function rectPoints(x0, y0, x1, y1) {
  const pts = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { pts.push([x, y]); }
  }
  return pts;
}

export function plot(data, w, h, points, gid) {
  let n = 0;
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= w || y >= h) { continue; }
    const i = y * w + x;
    if (data[i] !== gid) { data[i] = gid; n++; }
  }
  return n;
}

/* 4-way flood fill: every touching cell with the same tile. */
export function floodFill(data, w, h, x, y, gid) {
  if (x < 0 || y < 0 || x >= w || y >= h) { return 0; }
  const target = data[y * w + x];
  if (target === gid) { return 0; }
  const stack = [y * w + x];
  let n = 0;
  while (stack.length) {
    const i = stack.pop();
    if (data[i] !== target) { continue; }
    data[i] = gid;
    n++;
    const cx = i % w;
    if (cx > 0) { stack.push(i - 1); }
    if (cx < w - 1) { stack.push(i + 1); }
    if (i >= w) { stack.push(i - w); }
    if (i < w * (h - 1)) { stack.push(i + w); }
  }
  return n;
}

/* The tile you see at (x, y): the top-most shown layer that has one. */
export function eyedropper(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) { return 0; }
  for (let i = map.layers.length - 1; i >= 0; i--) {
    const l = map.layers[i];
    if (l.visible && l.data[y * map.w + x]) { return l.data[y * map.w + x]; }
  }
  return 0;
}

/* ============================================================
   5. HISTORY
   A paint stroke stores only the cells it changed. Layer and
   size changes store whole maps. Capped by steps.
   ============================================================ */
export function diffCells(before, after) {
  const idx = [];
  for (let i = 0; i < after.length; i++) { if (before[i] !== after[i]) { idx.push(i); } }
  if (!idx.length) { return null; }
  return {
    idx: Uint32Array.from(idx),
    from: Uint16Array.from(idx, (i) => before[i]),
    to: Uint16Array.from(idx, (i) => after[i])
  };
}

export function createHistory({ limit = HISTORY_LIMIT } = {}) {
  let undos = [];
  let redos = [];

  function apply(map, step, dir) {
    if (step.type === "map") { return cloneMap(dir < 0 ? step.before : step.after); }
    const l = map.layers[step.layer];
    if (!l) { return map; }
    const vals = dir < 0 ? step.from : step.to;
    for (let k = 0; k < step.idx.length; k++) { l.data[step.idx[k]] = vals[k]; }
    return map;
  }

  return {
    get canUndo() { return undos.length > 0; },
    get canRedo() { return redos.length > 0; },
    get size() { return undos.length; },
    get limit() { return limit; },
    /* A stroke on one layer: pass its data as it was before. */
    cells(layer, before, after) {
      const d = diffCells(before, after);
      if (!d) { return false; }
      return this.push({ type: "cells", layer, ...d });
    },
    /* A bigger change: whole maps before and after. */
    snapshot(before, after, meta = null) {
      return this.push({ type: "map", before: cloneMap(before), after: cloneMap(after), meta });
    },
    push(step) {
      undos.push(step);
      redos = [];
      while (undos.length > limit) { undos.shift(); }
      return true;
    },
    /* Both hand back the map to use next (it may be a new one). */
    undo(map) {
      const step = undos.pop();
      if (!step) { return { map, step: null, dir: -1 }; }
      redos.push(step);
      return { map: apply(map, step, -1), step, dir: -1 };
    },
    redo(map) {
      const step = redos.pop();
      if (!step) { return { map, step: null, dir: 1 }; }
      undos.push(step);
      return { map: apply(map, step, 1), step, dir: 1 };
    },
    clear() { undos = []; redos = []; }
  };
}

/* ============================================================
   6. TILED JSON (.tmj)
   An orthogonal, finite map with one embedded tileset that
   points at its picture by file name. Opens in Tiled 1.x.
   ============================================================ */
export const TILED_VERSION = "1.10";

/* tileset: { image, imageW, imageH, tileW, tileH, spacing, margin }
   A cell whose tile the tileset doesn't have (it shrank) is
   written as empty: Tiled would call it an invalid tile. */
export function toTmj(map, tileset) {
  const t = normalizeTileset(tileset);
  const grid = tilesetGrid(tileset.imageW, tileset.imageH, t);
  const gids = (data) => Array.from(data, (g) => (g <= grid.count ? g : 0));
  return {
    compressionlevel: -1,
    height: map.h,
    infinite: false,
    layers: map.layers.map((l, i) => ({
      data: gids(l.data),
      height: map.h,
      id: i + 1,
      name: l.name,
      opacity: 1,
      type: "tilelayer",
      visible: l.visible,
      width: map.w,
      x: 0,
      y: 0
    })),
    nextlayerid: map.layers.length + 1,
    nextobjectid: 1,
    orientation: "orthogonal",
    renderorder: "right-down",
    tiledversion: "1.10.2",
    tileheight: t.tileH,
    tilesets: [{
      columns: grid.columns,
      firstgid: 1,
      image: fileOnly(tileset.image) || "tileset.png",
      imageheight: tileset.imageH,
      imagewidth: tileset.imageW,
      margin: t.margin,
      name: baseName(tileset.image, "tileset"),
      spacing: t.spacing,
      tilecount: grid.count,
      tileheight: t.tileH,
      tilewidth: t.tileW
    }],
    tilewidth: t.tileW,
    type: "map",
    version: TILED_VERSION,
    width: map.w
  };
}

/* "AAAA..." -> little-endian uint32s (Tiled's uncompressed base64). */
function base64Gids(text, count) {
  let bin;
  try { bin = atob(String(text).trim()); } catch { throw new Error("A layer's base64 data is broken."); }
  if (bin.length !== count * 4) { throw new Error("A layer's base64 data is the wrong length."); }
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    out[i] = (bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8) | (bin.charCodeAt(o + 2) << 16) | (bin.charCodeAt(o + 3) << 24)) >>> 0;
  }
  return out;
}

/* Read a .tmj (an object from JSON.parse). Throws an Error with a
   plain message when it can't. Returns
   { map, tileset: { image, imageW, imageH, tileW, tileH, spacing, margin }, notes } */
export function fromTmj(json) {
  const j = json;
  if (!j || typeof j !== "object" || Array.isArray(j)) { throw new Error("That isn't a Tiled map."); }
  if (j.type !== undefined && j.type !== "map") { throw new Error("That isn't a Tiled map (it may be a tileset)."); }
  if ((j.orientation || "orthogonal") !== "orthogonal") { throw new Error(`Only square-grid (orthogonal) maps can be opened, not ${j.orientation}.`); }
  if (j.infinite) { throw new Error("Infinite maps can't be opened here. In Tiled, untick Map > Map Properties > Infinite first."); }
  const w = Number(j.width);
  const h = Number(j.height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) { throw new Error("The map has no proper width and height."); }
  if (w > MAX_MAP || h > MAX_MAP) { throw new Error(`The map is ${w} × ${h} tiles; up to ${MAX_MAP} a side fits here.`); }
  const notes = [];

  const sets = Array.isArray(j.tilesets) ? j.tilesets : [];
  if (!sets.length) { throw new Error("The map has no tileset."); }
  const ts = sets[0];
  if (ts.source && !ts.image) { throw new Error("Its tileset is in a separate file. In Tiled, embed it first (Tilesets panel, Embed Tileset)."); }
  if (!ts.image) { throw new Error("Its tileset isn't one picture (an image-collection tileset can't be used here)."); }
  if (sets.length > 1) { notes.push("Only the first tileset is used."); }
  const firstgid = Number.isInteger(ts.firstgid) && ts.firstgid > 0 ? ts.firstgid : 1;
  const tileW = Number(ts.tilewidth ?? j.tilewidth);
  const tileH = Number(ts.tileheight ?? j.tileheight);
  if (!(tileW >= MIN_TILE && tileW <= MAX_TILE && tileH >= MIN_TILE && tileH <= MAX_TILE)) {
    throw new Error(`Tiles must be ${MIN_TILE} to ${MAX_TILE} px a side.`);
  }
  const tileset = {
    image: fileOnly(ts.image),
    imageW: clampInt(ts.imagewidth, 1, MAX_IMAGE, 0),
    imageH: clampInt(ts.imageheight, 1, MAX_IMAGE, 0),
    ...normalizeTileset({ tileW, tileH, spacing: ts.spacing ?? 0, margin: ts.margin ?? 0 })
  };
  const count = Number.isInteger(ts.tilecount) && ts.tilecount > 0
    ? ts.tilecount
    : tilesetGrid(tileset.imageW, tileset.imageH, tileset).count;

  /* tile layers, bottom first; groups are opened up */
  const flat = [];
  const walk = (list) => {
    for (const l of Array.isArray(list) ? list : []) {
      if (l && l.type === "group") { walk(l.layers); } else { flat.push(l); }
    }
  };
  walk(j.layers);
  const tileLayers = flat.filter((l) => l && l.type === "tilelayer");
  if (flat.length > tileLayers.length) { notes.push("Object and image layers were left out."); }
  if (!tileLayers.length) { throw new Error("The map has no tile layers."); }
  if (tileLayers.length > MAX_LAYERS) { notes.push(`Only the first ${MAX_LAYERS} layers were kept.`); }

  let flipped = false;
  let foreign = false;
  const map = { w, h, layers: [] };
  for (const l of tileLayers.slice(0, MAX_LAYERS)) {
    if (l.chunks) { throw new Error("Chunked (infinite) layers can't be opened here."); }
    if (l.compression) { throw new Error(`Compressed layers (${l.compression}) can't be opened. In Tiled, set the layer format to CSV first.`); }
    let gids = l.data;
    if (l.encoding === "base64") { gids = base64Gids(l.data, w * h); }
    if (!Array.isArray(gids) || gids.length !== w * h) { throw new Error(`Layer "${l.name || "?"}" doesn't have ${w * h} cells.`); }
    const data = new Uint16Array(w * h);
    for (let i = 0; i < data.length; i++) {
      let g = Number(gids[i]);
      if (!Number.isFinite(g) || g < 0) { throw new Error(`Layer "${l.name || "?"}" has a broken cell.`); }
      if (g & FLIP_BITS) { flipped = true; g = (g & ~FLIP_BITS) >>> 0; }
      if (!g) { continue; }
      const local = g - firstgid;
      if (local < 0 || local >= count) { foreign = true; continue; }
      data[i] = local + 1;
    }
    map.layers.push({ name: String(l.name || `Layer ${map.layers.length + 1}`).slice(0, 40), visible: l.visible !== false, data });
  }
  if (flipped) { notes.push("Flipped and turned tiles came in the normal way round."); }
  if (foreign) { notes.push("Tiles from other tilesets were left out."); }
  return { map, tileset, notes };
}

/* ============================================================
   7. CSV - one layer, the way Tiled's own CSV export writes it:
   the tile number counted from 0, and -1 for empty. One row
   per map row. Handy for Godot scripts and spreadsheets.
   ============================================================ */
export function layerCsv(data, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) { row.push(data[y * w + x] - 1); }
    rows.push(row.join(","));
  }
  return rows.join("\n") + "\n";
}

export function parseCsv(text) {
  const rows = String(text).trim().split(/\r?\n/).filter((r) => r.trim() !== "");
  if (!rows.length) { throw new Error("The CSV is empty."); }
  const cells = rows.map((r) => r.split(",").map((v) => v.trim()));
  const w = cells[0].length;
  const h = cells.length;
  if (cells.some((r) => r.length !== w)) { throw new Error("Every CSV row needs the same number of cells."); }
  const data = new Uint16Array(w * h);
  cells.forEach((r, y) => r.forEach((v, x) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < -1 || n >= MAX_TILES) { throw new Error(`Cell ${x + 1}, ${y + 1} isn't a tile number.`); }
    data[y * w + x] = n + 1;
  }));
  return { w, h, data };
}

/* ============================================================
   8. SAVE FORMAT
   Each layer as run-length text: "0*120,5,5,7*3" = 120 empties,
   two 5s, three 7s. A level is mostly runs, so it stays small.
   ============================================================ */
export function encodeLayer(data) {
  const parts = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === v) { n++; }
    parts.push(n > 1 ? `${v}*${n}` : String(v));
    i += n;
  }
  return parts.join(",");
}

export function decodeLayer(text, size) {
  const data = new Uint16Array(size);
  let at = 0;
  if (typeof text !== "string") { throw new Error("a layer isn't text"); }
  for (const part of text ? text.split(",") : []) {
    const m = /^(\d+)(?:\*(\d+))?$/.exec(part);
    if (!m) { throw new Error("a layer has a broken run"); }
    const v = Number(m[1]);
    const n = m[2] === undefined ? 1 : Number(m[2]);
    if (v > MAX_TILES || n < 1 || at + n > size) { throw new Error("a layer doesn't fit the map"); }
    data.fill(v, at, at + n);
    at += n;
  }
  if (at !== size) { throw new Error("a layer is the wrong size"); }
  return data;
}

export function encodeMap(map) {
  return {
    w: map.w,
    h: map.h,
    layers: map.layers.map((l) => ({ name: l.name, visible: l.visible, data: encodeLayer(l.data) }))
  };
}

export function decodeMap(s) {
  if (!s || typeof s !== "object") { throw new Error("no map"); }
  const { w, h } = s;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_MAP || h > MAX_MAP) { throw new Error("the map size is wrong"); }
  if (!Array.isArray(s.layers) || !s.layers.length || s.layers.length > MAX_LAYERS) { throw new Error("the layers are wrong"); }
  return {
    w,
    h,
    layers: s.layers.map((l, i) => ({
      name: typeof l.name === "string" && l.name ? l.name.slice(0, 40) : `Layer ${i + 1}`,
      visible: l.visible !== false,
      data: decodeLayer(l.data, w * h)
    }))
  };
}
