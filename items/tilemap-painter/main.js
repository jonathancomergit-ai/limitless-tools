/* ============================================================
   Tilemap Painter - main script

   Load a tileset, paint a level on a grid with layers, and
   export it for Tiled (.tmj), as CSV per layer, or as a PNG.
   All in this tab: nothing is uploaded, nothing is fetched.

   The map and its rules live in tilemap.js (pure, unit tested);
   the sample tiles in sample.js. This file is the page.

   Sections:
     1. save               what's remembered, and how
     2. state              map, tileset, view, history
     3. the map picture    a 1:1 cache of the visible layers
     4. the stage          drawing the view
     5. view               zoom + pan
     6. painting           strokes, tools, keyboard cursor
     7. pointer input      paint, pinch, pan, wheel
     8. keys
     9. history            undo / redo, bigger changes
    10. tiles              the tile picker
    11. layers
    12. tileset            picture, tile size, spacing, margin
    13. map size
    14. export + import    .tmj, CSV, PNG; open a .tmj
    15. start
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { reducedMotion } from "../../kit/motion.js";
import {
  MAX_LAYERS, MAX_IMAGE, clampInt, baseName, fileOnly, normalizeTileset, tilesetGrid, tileRect,
  maxMapSize, createMap, resizeMap, addLayer, deleteLayer, moveLayer, linePoints, rectPoints,
  plot, floodFill, eyedropper, createHistory, toTmj, fromTmj, layerCsv, encodeMap, decodeMap
} from "./tilemap.js";
import { SAMPLE, SAMPLE_NAME, SAMPLE_TILES, sampleCanvas, starterMap } from "./sample.js";

bootItem();

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const cssColor = (name) => css.getPropertyValue(name).trim();
const PAL = {
  accent: cssColor("--accent"),
  cyan: cssColor("--cyan"),
  text: cssColor("--text"),
  bg: cssColor("--bg"),
  bg2: cssColor("--bg-2"),
  line: cssColor("--line-bright")
};
const MAP_BG = "#1a1c29";                 // empty cells
const TOOLS = ["brush", "rect", "fill", "eraser", "picker"];
const TOOL_KEYS = { b: "brush", r: "rect", f: "fill", e: "eraser", i: "picker" };
const ZOOMS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const MIN_ZOOM = 0.125;
const MAX_ZOOM = 16;
const PICTURE_LIMIT = 300_000;            // a tileset picture is saved only if its PNG text is this small
const SAVE_LIMIT = 900_000;               // kit/save.js refuses imports over 1 MB
const NAME = "tilemap";

/* ============================================================
   1. SAVE
   The map (run-length text), the tileset settings and your
   tool. The tileset picture only when it's small; otherwise
   just its name, and you're asked to add it again.
   ============================================================ */
const DEFAULT_SETTINGS = { tool: "brush", tile: 1, grid: true };
const DEFAULT_TILESET = { name: SAMPLE_NAME, sample: true, picture: null, ...SAMPLE };

function normalizeSettings(s = {}) {
  return {
    tool: TOOLS.includes(s.tool) ? s.tool : DEFAULT_SETTINGS.tool,
    tile: clampInt(s.tile, 1, 4096, 1),
    grid: s.grid !== false
  };
}

function normalizeTilesetSave(t = {}) {
  const picture = typeof t.picture === "string" && /^data:image\/png;base64,/.test(t.picture) ? t.picture : null;
  const name = typeof t.name === "string" && t.name ? fileOnly(t.name).slice(0, 80) : SAMPLE_NAME;
  return {
    name,
    sample: !picture && (t.sample === true || (t.sample === undefined && name === SAMPLE_NAME)),
    picture,
    imageW: clampInt(t.imageW, 1, MAX_IMAGE, SAMPLE.imageW),
    imageH: clampInt(t.imageH, 1, MAX_IMAGE, SAMPLE.imageH),
    ...normalizeTileset(t)
  };
}

const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { settings: { ...DEFAULT_SETTINGS }, tileset: { ...DEFAULT_TILESET }, map: null },
  validate: (d) => {
    if (d.tileset !== undefined && (typeof d.tileset !== "object" || d.tileset === null)) { return "That file doesn't hold Tilemap Painter settings."; }
    if (d.map === null || d.map === undefined) { return true; }
    try { decodeMap(d.map); return true; } catch (err) {
      return `That file doesn't hold a Tilemap Painter map (${err.message})`;
    }
  }
});
mountSavePanel($("save-panel"), save, {
  title: "Your map",
  intro: "Your map (every layer), the tileset settings and your tool are saved on this device. A small tileset picture is kept too; a big one you add again next time.",
  exportLabel: "Export map save",
  importLabel: "Import map save",
  onImport: () => { loadFromSave(); },
  onDelete: () => { loadFromSave(); }
});

/* ============================================================
   2. STATE
   ============================================================ */
let settings = normalizeSettings(save.get().settings);
let map = starterMap();
let ts = normalizeTilesetSave(DEFAULT_TILESET);   // tileset settings
let picture = null;                               // canvas of the tileset picture, or null
let grid = tilesetGrid(ts.imageW, ts.imageH, ts);
const history = createHistory();

const view = { zoom: 1, panX: 0, panY: 0, fitted: true, sw: 300, sh: 225 };

const state = exposeForTests({
  get w() { return map.w; },
  get h() { return map.h; },
  get layers() { return map.layers.length; },
  get tool() { return settings.tool; },
  get tile() { return settings.tile; },
  get zoom() { return view.zoom; },
  get canUndo() { return history.canUndo; },
  get tiles() { return grid.count; },
  get hasPicture() { return Boolean(picture); },
  get tileset() { return { ...ts, picture: ts.picture ? "(png)" : null }; },
  layer: 0,
  cursor: { x: 0, y: 0 },
  saves: 0,
  lastExport: null,
  /* For smoke.js: the tile number in a cell of a layer (0 = empty),
     and where a cell's middle is on screen (CSS px from the
     stage's top-left). */
  cellAt(x, y, layer = state.layer) { return map.layers[layer]?.data[y * map.w + x] ?? 0; },
  screenOf(x, y) {
    return { x: view.panX + (x + 0.5) * ts.tileW * view.zoom, y: view.panY + (y + 0.5) * ts.tileH * view.zoom };
  },
  tileScreenOf(gid) {
    const r = paletteRect(gid - 1);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
});

function say(text) { $("status").textContent = text; }
function layerData() { return map.layers[state.layer].data; }

/* ============================================================
   3. THE MAP PICTURE
   A canvas the map's full size in pixels (tile size x cells)
   holding the visible layers, drawn once and then patched cell
   by cell as you paint. The stage scales it; Map PNG saves it.
   ============================================================ */
let cache = null;
let cacheCtx = null;

/* A tile with no picture to come from (the tileset wasn't added
   back yet): a colour from its number, so the map still reads. */
function placeholder(g, gid, x, y, w, h) {
  g.fillStyle = `hsl(${(gid * 47) % 360} 55% 42%)`;
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(0, 0, 0, .35)";
  g.fillRect(x, y + h - Math.max(1, h >> 3), w, Math.max(1, h >> 3));
}

function drawTile(g, gid, x, y, w = ts.tileW, h = ts.tileH) {
  if (!gid) { return; }
  if (picture && gid <= grid.count) {
    const r = tileRect(gid - 1, grid.columns, ts);
    g.drawImage(picture, r.x, r.y, r.w, r.h, x, y, w, h);
  } else {
    placeholder(g, gid, x, y, w, h);
  }
}

function rebuildCache() {
  const W = map.w * ts.tileW;
  const H = map.h * ts.tileH;
  if (!cache || cache.width !== W || cache.height !== H) {
    cache = document.createElement("canvas");
    cache.width = W;
    cache.height = H;
    cacheCtx = cache.getContext("2d");
  }
  cacheCtx.imageSmoothingEnabled = false;
  cacheCtx.clearRect(0, 0, W, H);
  for (const l of map.layers) {
    if (!l.visible) { continue; }
    for (let i = 0; i < l.data.length; i++) {
      if (l.data[i]) { drawTile(cacheCtx, l.data[i], (i % map.w) * ts.tileW, Math.floor(i / map.w) * ts.tileH); }
    }
  }
  requestRender();
}

/* Redraw just these cells (indexes), every visible layer. */
function redrawCells(cells) {
  if (!cache) { rebuildCache(); return; }
  if (cells.length > map.w * map.h / 3) { rebuildCache(); return; }
  for (const i of cells) {
    const x = (i % map.w) * ts.tileW;
    const y = Math.floor(i / map.w) * ts.tileH;
    cacheCtx.clearRect(x, y, ts.tileW, ts.tileH);
    for (const l of map.layers) { if (l.visible && l.data[i]) { drawTile(cacheCtx, l.data[i], x, y); } }
  }
  requestRender();
}

/* ============================================================
   4. THE STAGE
   ============================================================ */
const stage = $("stage");
const viewCanvas = $("view");
const ctx = viewCanvas.getContext("2d");

let renderQueued = false;
function requestRender() {
  if (renderQueued) { return; }
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function render() {
  if (!cache) { rebuildCache(); }
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(view.sw * dpr));
  const H = Math.max(1, Math.round(view.sh * dpr));
  if (viewCanvas.width !== W || viewCanvas.height !== H) { viewCanvas.width = W; viewCanvas.height = H; }

  const k = view.zoom * dpr;                  // device px per map px
  const ox = view.panX * dpr;
  const oy = view.panY * dpr;
  const aw = cache.width * k;
  const ah = cache.height * k;
  const cw = ts.tileW * k;                    // one cell, device px
  const ch = ts.tileH * k;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PAL.bg2;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = MAP_BG;
  ctx.fillRect(ox, oy, aw, ah);
  ctx.drawImage(cache, ox, oy, aw, ah);

  /* the tile grid, once cells are big enough to see */
  if (settings.grid && Math.min(cw, ch) >= 6 * dpr) {
    ctx.strokeStyle = "rgba(236, 238, 246, .16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.max(1, Math.floor(-ox / cw));
    const x1 = Math.min(map.w, Math.ceil((W - ox) / cw));
    const y0 = Math.max(1, Math.floor(-oy / ch));
    const y1 = Math.min(map.h, Math.ceil((H - oy) / ch));
    for (let x = x0; x < x1; x++) {
      const px = Math.round(ox + x * cw) + 0.5;
      ctx.moveTo(px, Math.max(0, oy)); ctx.lineTo(px, Math.min(H, oy + ah));
    }
    for (let y = y0; y < y1; y++) {
      const py = Math.round(oy + y * ch) + 0.5;
      ctx.moveTo(Math.max(0, ox), py); ctx.lineTo(Math.min(W, ox + aw), py);
    }
    ctx.stroke();
  }

  /* a border round the map */
  ctx.strokeStyle = PAL.line;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeRect(Math.round(ox) - 0.5 * dpr, Math.round(oy) - 0.5 * dpr, Math.round(aw) + dpr, Math.round(ah) + dpr);

  /* the mouse's cell, with a see-through preview of the tile */
  if (hover && !gesture) {
    const paints = settings.tool === "brush" || settings.tool === "rect";
    if (paints && !stroke) {
      ctx.globalAlpha = 0.55;
      drawTile(ctx, settings.tile, ox + hover.x * cw, oy + hover.y * ch, cw, ch);
      ctx.globalAlpha = 1;
    }
    outlineCell(hover.x, hover.y, PAL.text, 0.85, dpr, cw, ch, ox, oy, false);
  }
  /* the start of a keyboard box */
  if (anchor) { outlineCell(anchor.x, anchor.y, PAL.cyan, 1, dpr, cw, ch, ox, oy, false); }
  /* the keyboard cursor */
  if (cursorShown && document.activeElement === stage) {
    outlineCell(state.cursor.x, state.cursor.y, PAL.accent, 1, dpr, cw, ch, ox, oy, true);
  }
}

function outlineCell(x, y, color, alpha, dpr, cw, ch, ox, oy, thick) {
  const lw = Math.max(1, (thick ? 2 : 1) * dpr);
  const sw = Math.max(cw, 4 * dpr);
  const sh = Math.max(ch, 4 * dpr);
  const px = ox + x * cw + (cw - sw) / 2;
  const py = oy + y * ch + (ch - sh) / 2;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(px - lw / 2, py - lw / 2, sw + lw, sh + lw);
  if (thick) {
    ctx.strokeStyle = PAL.bg;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeRect(px - lw - dpr / 2, py - lw - dpr / 2, sw + 2 * lw + dpr, sh + 2 * lw + dpr);
  }
  ctx.globalAlpha = 1;
}

/* ============================================================
   5. VIEW - zoom + pan
   view.zoom = CSS px per map pixel; panX / panY = where the
   map's top-left corner sits, in CSS px inside the stage.
   ============================================================ */
function mapPx() { return { w: map.w * ts.tileW, h: map.h * ts.tileH }; }

function fit() {
  const { w, h } = mapPx();
  let z = Math.min(view.sw / w, view.sh / h) * 0.94;
  /* whole device pixels per map pixel keep tiles even; tiny fits may be in between */
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  z = z * dpr >= 1 ? Math.floor(z * dpr) / dpr : Math.max(MIN_ZOOM, z);
  view.zoom = Math.min(MAX_ZOOM, z);
  view.panX = Math.round((view.sw - w * view.zoom) / 2);
  view.panY = Math.round((view.sh - h * view.zoom) / 2);
  view.fitted = true;
  zoomUi();
  requestRender();
}

/* Keep at least a corner of the map on screen. */
function clampPan() {
  const m = 24;
  const { w, h } = mapPx();
  view.panX = Math.min(view.sw - m, Math.max(m - w * view.zoom, view.panX));
  view.panY = Math.min(view.sh - m, Math.max(m - h * view.zoom, view.panY));
}

/* Zoom so the map point under (cx, cy) stays put. */
function zoomAt(z, cx = view.sw / 2, cy = view.sh / 2) {
  z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const ax = (cx - view.panX) / view.zoom;
  const ay = (cy - view.panY) / view.zoom;
  view.zoom = z;
  view.panX = cx - ax * z;
  view.panY = cy - ay * z;
  view.fitted = false;
  clampPan();
  zoomUi();
  requestRender();
}

function zoomStep(dir) {
  const z = view.zoom;
  const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.01) : [...ZOOMS].reverse().find((v) => v < z - 0.01);
  /* keyboard users zoom round their cursor */
  const c = cursorShown && document.activeElement === stage ? state.screenOf(state.cursor.x, state.cursor.y) : null;
  zoomAt(next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM), c ? c.x : undefined, c ? c.y : undefined);
}

function zoomUi() {
  const z = view.zoom;
  $("zoom-label").textContent = z >= 1 ? `${Math.round(z * 10) / 10}×` : `${Math.round(z * 100)}%`;
  $("zoom-in").disabled = z >= MAX_ZOOM;
  $("zoom-out").disabled = z <= MIN_ZOOM;
}

$("zoom-in").addEventListener("click", () => zoomStep(1));
$("zoom-out").addEventListener("click", () => zoomStep(-1));
$("zoom-fit").addEventListener("click", fit);

new ResizeObserver(() => {
  const r = stage.getBoundingClientRect();
  const sw = Math.max(1, Math.round(stage.clientWidth || r.width));
  const sh = Math.max(1, Math.round(stage.clientHeight || r.height));
  if (sw === view.sw && sh === view.sh) { return; }
  view.panX += (sw - view.sw) / 2;
  view.panY += (sh - view.sh) / 2;
  view.sw = sw;
  view.sh = sh;
  if (view.fitted) { fit(); } else { clampPan(); requestRender(); }
}).observe(stage);

/* ============================================================
   6. PAINTING
   A stroke remembers its layer as it was, paints straight into
   it, and on release hands "before" + "after" to the history,
   which keeps only the cells that changed.
   ============================================================ */
let stroke = null;      // { layer, before, start, last, tool, box: [] }
let anchor = null;      // keyboard box start
let hover = null;       // mouse cell
let cursorShown = false;

function paintTile() { return settings.tool === "eraser" ? 0 : settings.tile; }

function beginStroke(x, y) {
  const tool = settings.tool;
  if (tool === "picker") { pickAt(x, y); return; }
  const l = map.layers[state.layer];
  if (!l.visible) { say(`${l.name} is hidden. Show it to see what you paint.`); }
  stroke = { layer: state.layer, before: l.data.slice(), start: { x, y }, last: { x, y }, tool, box: [] };
  applyStroke(x, y, true);
}

function cellsOf(points) {
  const out = [];
  for (const [x, y] of points) { if (x >= 0 && y >= 0 && x < map.w && y < map.h) { out.push(y * map.w + x); } }
  return out;
}

function applyStroke(x, y, first = false) {
  if (!stroke) { return; }
  const data = map.layers[stroke.layer].data;
  const gid = paintTile();
  const { w, h } = map;
  switch (stroke.tool) {
    case "brush":
    case "eraser": {
      const pts = linePoints(stroke.last.x, stroke.last.y, x, y);
      if (plot(data, w, h, pts, gid)) { redrawCells(cellsOf(pts)); }
      break;
    }
    case "fill":
      if (first && floodFill(data, w, h, x, y, gid)) { rebuildCache(); }
      break;
    case "rect": {
      /* put back the last preview, then draw the new box */
      const old = stroke.box;
      for (const i of old) { data[i] = stroke.before[i]; }
      const pts = rectPoints(stroke.start.x, stroke.start.y, x, y);
      plot(data, w, h, pts, gid);
      stroke.box = cellsOf(pts);
      redrawCells([...new Set([...old, ...stroke.box])]);
      break;
    }
    default:
  }
  stroke.last = { x, y };
}

function endStroke() {
  if (!stroke) { return; }
  const s = stroke;
  stroke = null;
  if (history.cells(s.layer, s.before, map.layers[s.layer].data)) { edited(); }
  requestRender();
}

/* Two fingers landed, or Esc: that wasn't a stroke after all. */
function cancelStroke() {
  if (!stroke) { return; }
  map.layers[stroke.layer].data.set(stroke.before);
  stroke = null;
  rebuildCache();
}

function pickAt(x, y) {
  const gid = eyedropper(map, x, y);
  if (!gid) { say("Nothing to pick there (empty)."); return; }
  setTile(gid);
  setTool(toolBeforePick === "picker" ? "brush" : toolBeforePick);
  say(`Picked ${tileLabel(gid)}.`);
}

function edited() {
  historyUi();
  scheduleSave();
}

/* ---- the keyboard cursor: arrows move it, and the view pans so
   it stays in the middle (the map slides under the cursor) ---- */
function moveCursor(dx, dy) {
  const from = { ...state.cursor };
  state.cursor.x = Math.min(map.w - 1, Math.max(0, state.cursor.x + dx));
  state.cursor.y = Math.min(map.h - 1, Math.max(0, state.cursor.y + dy));
  cursorShown = true;
  const { x, y } = state.cursor;
  if (spaceHeld && (settings.tool === "brush" || settings.tool === "eraser")) {
    spaceUsed = true;
    if (!stroke) { beginStroke(from.x, from.y); }
    applyStroke(x, y);
  } else if (stroke && anchor) {
    applyStroke(x, y);   // box preview
  }
  centreOnCursor();
  announce();
  requestRender();
}

function centreOnCursor() {
  view.panX = Math.round(view.sw / 2 - (state.cursor.x + 0.5) * ts.tileW * view.zoom);
  view.panY = Math.round(view.sh / 2 - (state.cursor.y + 0.5) * ts.tileH * view.zoom);
  view.fitted = false;
  clampPan();
}

/* Space / Enter on the map. */
function keyPaint() {
  const { x, y } = state.cursor;
  cursorShown = true;
  if (settings.tool === "rect") {
    if (!anchor) {
      anchor = { x, y };
      beginStroke(x, y);
      say("Corner set. Move, then press Space again to finish the box.");
    } else {
      applyStroke(x, y);
      endStroke();
      anchor = null;
      say("");
    }
  } else if (settings.tool === "picker") {
    pickAt(x, y);
  } else {
    beginStroke(x, y);
    endStroke();
  }
  announce();
  requestRender();
}

let announceTimer = 0;
function announce() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const { x, y } = state.cursor;
    const gid = layerData()[y * map.w + x];
    $("cursor-out").textContent = `${x + 1}, ${y + 1}: ${gid ? tileLabel(gid) : "empty"}`;
  }, 250);
}

/* ============================================================
   7. POINTER INPUT
   One pointer paints. Two pointers pinch-zoom and pan (and undo
   the stroke the first finger had started). Space + drag or the
   middle button pans. Wheel zooms.
   ============================================================ */
const pointers = new Map();
let gesture = null;           // { kind: "draw" | "pan" | "pinch" | "done", ... }
let spaceHeld = false;
let spaceUsed = false;
let overStage = false;

function local(e) {
  const r = viewCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function toCell(p) {
  return { x: Math.floor((p.x - view.panX) / (view.zoom * ts.tileW)), y: Math.floor((p.y - view.panY) / (view.zoom * ts.tileH)) };
}
function inMap(c) { return c.x >= 0 && c.y >= 0 && c.x < map.w && c.y < map.h; }

function startPinch() {
  const [a, b] = [...pointers.values()];
  gesture = {
    kind: "pinch",
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    zoom: view.zoom,
    at: { x: ((a.x + b.x) / 2 - view.panX) / view.zoom, y: ((a.y + b.y) / 2 - view.panY) / view.zoom }
  };
}

stage.addEventListener("pointerdown", (e) => {
  const p = local(e);
  pointers.set(e.pointerId, p);
  try { stage.setPointerCapture(e.pointerId); } catch { /* already gone */ }
  if (e.pointerType !== "mouse") { hover = null; }
  cursorShown = false;
  e.preventDefault();
  if (document.activeElement !== stage) { stage.focus({ preventScroll: true }); }

  if (pointers.size === 2) {
    if (gesture && gesture.kind === "draw") { cancelStroke(); }
    startPinch();
    return;
  }
  if (pointers.size > 2 || gesture) { return; }

  if (e.button === 1 || spaceHeld) {
    gesture = { kind: "pan", last: p };
    if (spaceHeld) { spaceUsed = true; }
    stage.classList.add("is-panning");
    return;
  }
  if (e.button !== 0) { return; }
  const c = toCell(p);
  if (stroke) { cancelStroke(); say(""); }      // a keyboard box in progress
  anchor = null;
  if (!inMap(c) && settings.tool !== "rect") { gesture = { kind: "done" }; return; }
  state.cursor = { x: Math.min(map.w - 1, Math.max(0, c.x)), y: Math.min(map.h - 1, Math.max(0, c.y)) };
  gesture = { kind: "draw", id: e.pointerId };
  beginStroke(c.x, c.y);
  if (!stroke) { gesture = { kind: "done" }; }
});

stage.addEventListener("pointermove", (e) => {
  const p = local(e);
  if (e.pointerType === "mouse") {
    const c = toCell(p);
    const next = inMap(c) ? c : null;
    if ((next?.x !== hover?.x) || (next?.y !== hover?.y)) { hover = next; requestRender(); }
  }
  if (!pointers.has(e.pointerId)) { return; }
  pointers.set(e.pointerId, p);
  if (!gesture) { return; }

  if (gesture.kind === "pinch" && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.zoom * dist / gesture.dist));
    view.zoom = z;
    view.panX = (a.x + b.x) / 2 - gesture.at.x * z;
    view.panY = (a.y + b.y) / 2 - gesture.at.y * z;
    view.fitted = false;
    clampPan();
    zoomUi();
    requestRender();
  } else if (gesture.kind === "pan") {
    view.panX += p.x - gesture.last.x;
    view.panY += p.y - gesture.last.y;
    gesture.last = p;
    view.fitted = false;
    clampPan();
    requestRender();
  } else if (gesture.kind === "draw" && e.pointerId === gesture.id && stroke) {
    const c = toCell(p);
    if (c.x !== stroke.last.x || c.y !== stroke.last.y) {
      if (stroke.tool === "brush" || stroke.tool === "eraser" || stroke.tool === "rect") { applyStroke(c.x, c.y); }
    }
  }
});

function pointerEnd(e) {
  if (!pointers.has(e.pointerId)) { return; }
  pointers.delete(e.pointerId);
  if (gesture && gesture.kind === "draw" && e.pointerId === gesture.id) {
    if (e.type === "pointercancel") { cancelStroke(); } else { endStroke(); }
    gesture = null;
  } else if (gesture && gesture.kind === "pinch") {
    /* the other finger lifting must not start painting */
    gesture = pointers.size ? { kind: "done" } : null;
  }
  if (!pointers.size) {
    gesture = null;
    stage.classList.remove("is-panning");
  }
  requestRender();
}
stage.addEventListener("pointerup", pointerEnd);
stage.addEventListener("pointercancel", pointerEnd);
stage.addEventListener("pointerenter", () => { overStage = true; });
stage.addEventListener("pointerleave", () => { overStage = false; if (hover) { hover = null; requestRender(); } });
stage.addEventListener("contextmenu", (e) => e.preventDefault());

stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  const p = local(e);
  /* trackpad pinch arrives as ctrl + wheel, with small deltas */
  const speed = e.ctrlKey ? 0.012 : 0.0018;
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomAt(view.zoom * Math.exp(-dy * speed), p.x, p.y);
}, { passive: false });

stage.addEventListener("focus", () => requestRender());
stage.addEventListener("blur", () => {
  spaceHeld = false;
  if (stroke && anchor) { cancelStroke(); anchor = null; }
  requestRender();
});

/* ============================================================
   8. KEYS
   ============================================================ */
function isTyping(el) {
  if (!el || !el.closest) { return false; }
  if (el.closest("textarea, select, [contenteditable='true']")) { return true; }
  return el.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "file"].includes(el.type);
}

document.addEventListener("keydown", (e) => {
  if (isTyping(e.target)) { return; }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.ctrlKey || e.metaKey;

  if (mod && !e.altKey) {
    if (key === "z") { e.preventDefault(); if (e.shiftKey) { redo(); } else { undo(); } return; }
    if (key === "y") { e.preventDefault(); redo(); return; }
    return;
  }
  if (e.altKey) { return; }

  if (e.target === stage) {
    const step = e.shiftKey ? 4 : 1;
    let handled = true;
    switch (e.key) {
      case "ArrowLeft": moveCursor(-step, 0); break;
      case "ArrowRight": moveCursor(step, 0); break;
      case "ArrowUp": moveCursor(0, -step); break;
      case "ArrowDown": moveCursor(0, step); break;
      case "Enter": keyPaint(); break;
      case " ":
        if (!e.repeat && !spaceHeld) { spaceHeld = true; spaceUsed = false; }
        break;
      case "Escape":
        if (anchor) { cancelStroke(); anchor = null; say("Cancelled."); requestRender(); } else { handled = false; }
        break;
      case "+": case "=": zoomStep(1); break;
      case "-": case "_": zoomStep(-1); break;
      case "0": fit(); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); return; }
  } else if (e.target === palette && paletteKey(e)) {
    e.preventDefault();
    return;
  } else if (e.key === " " && overStage && (e.target === document.body || e.target === document.documentElement)) {
    /* hovering the map: Space + drag pans, and doesn't scroll */
    e.preventDefault();
    spaceHeld = true;
    spaceUsed = true;
    return;
  }

  if (e.shiftKey) { return; }
  if (TOOL_KEYS[key]) { setTool(TOOL_KEYS[key]); e.preventDefault(); return; }
  switch (key) {
    case "g": toggleGrid(); break;
    case "[": setTile(stepTile(-1)); break;
    case "]": setTile(stepTile(1)); break;
    default: return;
  }
  e.preventDefault();
});

document.addEventListener("keyup", (e) => {
  if (e.key !== " ") { return; }
  const wasHeld = spaceHeld;
  spaceHeld = false;
  if (!wasHeld) { return; }
  if (e.target === stage) {
    e.preventDefault();
    if (stroke && !anchor) { endStroke(); }           // a Space + arrows stroke
    else if (!spaceUsed) { keyPaint(); }             // a plain press
  }
});

/* ---- tools ---- */
const toolBtns = [...document.querySelectorAll(".tp-tool")];
let toolBeforePick = "brush";

function setTool(tool) {
  if (!TOOLS.includes(tool)) { return; }
  if (tool === "picker" && settings.tool !== "picker") { toolBeforePick = settings.tool; }
  if (anchor) { cancelStroke(); anchor = null; }
  settings.tool = tool;
  toolUi();
  scheduleSave();
  requestRender();
}
function toolUi() {
  for (const b of toolBtns) { b.setAttribute("aria-pressed", String(b.dataset.tool === settings.tool)); }
  stage.dataset.tool = settings.tool;
}
for (const b of toolBtns) { b.addEventListener("click", () => setTool(b.dataset.tool)); }

function toggleGrid() {
  settings.grid = !settings.grid;
  gridUi();
  scheduleSave();
  requestRender();
}
function gridUi() { $("grid").setAttribute("aria-pressed", String(settings.grid)); }
$("grid").addEventListener("click", toggleGrid);

/* ============================================================
   9. HISTORY
   ============================================================ */
function undo() {
  if (stroke) { cancelStroke(); anchor = null; }
  const r = history.undo(map);
  if (!r.step) { say("Nothing to undo."); return; }
  afterHistory(r);
}
function redo() {
  if (stroke) { cancelStroke(); anchor = null; }
  const r = history.redo(map);
  if (!r.step) { say("Nothing to redo."); return; }
  afterHistory(r);
}
function afterHistory({ map: next, step, dir }) {
  const sizeChanged = next.w !== map.w || next.h !== map.h;
  map = next;
  if (step.type === "cells") {
    state.layer = step.layer;
    redrawCells(Array.from(step.idx));
    renderLayers();
    historyUi();
  } else {
    if (step.meta) { state.layer = dir < 0 ? step.meta.before : step.meta.after; }
    refreshAll(sizeChanged);
  }
  say("");
  scheduleSave();
}
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);

function historyUi() {
  $("undo").disabled = !history.canUndo;
  $("redo").disabled = !history.canRedo;
}

/* A bigger change (layers, size, a new map): snapshot it. */
function change(next, layer = state.layer) {
  if (next === map) { return false; }
  if (stroke) { cancelStroke(); anchor = null; }
  history.snapshot(map, next, { before: state.layer, after: layer });
  const sizeChanged = next.w !== map.w || next.h !== map.h;
  map = next;
  state.layer = layer;
  refreshAll(sizeChanged);
  scheduleSave();
  return true;
}

function clampSelection() {
  state.layer = Math.min(map.layers.length - 1, Math.max(0, state.layer));
  state.cursor.x = Math.min(map.w - 1, state.cursor.x);
  state.cursor.y = Math.min(map.h - 1, state.cursor.y);
}

function refreshAll(refit = false) {
  clampSelection();
  rebuildCache();
  if (refit) { fit(); }
  sizeUi();
  renderLayers();
  historyUi();
  requestRender();
}

/* ============================================================
   10. TILES - the picker
   The tileset laid out on its own grid, each tile at least
   32 CSS px so a finger can hit it, with a small gap.
   ============================================================ */
const palette = $("palette");
const paletteBox = $("palette-box");
const pctx = palette.getContext("2d");
const GAP = 2;
let pal = { k: 2, cw: 32, ch: 32 };

function tileLabel(gid) {
  const name = ts.sample && SAMPLE_TILES[gid - 1] ? ` · ${SAMPLE_TILES[gid - 1]}` : "";
  return `Tile ${gid - 1}${name}`;
}

function paletteRect(index) {
  const col = index % Math.max(1, grid.columns);
  const row = Math.floor(index / Math.max(1, grid.columns));
  return { x: GAP + col * (pal.cw + GAP), y: GAP + row * (pal.ch + GAP), w: pal.cw, h: pal.ch };
}

function renderPalette() {
  const cols = Math.max(1, grid.columns);
  const rows = Math.max(1, grid.rows);
  const room = Math.max(120, paletteBox.clientWidth - 8);
  /* fit the width if that leaves tiles >= 32 px, but no bigger than 64 */
  const fitK = (room - GAP * (cols + 1)) / (cols * ts.tileW);
  const minK = 32 / Math.min(ts.tileW, ts.tileH);
  const maxK = Math.max(minK, 64 / Math.max(ts.tileW, ts.tileH));
  pal.k = Math.min(maxK, Math.max(minK, fitK));
  pal.cw = Math.floor(ts.tileW * pal.k);
  pal.ch = Math.floor(ts.tileH * pal.k);
  const W = GAP + cols * (pal.cw + GAP);
  const H = GAP + rows * (pal.ch + GAP);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  palette.width = Math.round(W * dpr);
  palette.height = Math.round(H * dpr);
  palette.style.width = `${W}px`;
  palette.style.height = `${H}px`;
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, W, H);
  for (let i = 0; i < grid.count; i++) {
    const r = paletteRect(i);
    pctx.fillStyle = MAP_BG;
    pctx.fillRect(r.x, r.y, r.w, r.h);
    drawTile(pctx, i + 1, r.x, r.y, r.w, r.h);
  }
  if (!grid.count) {
    pctx.fillStyle = PAL.text;
    pctx.font = "600 13px 'JetBrains Mono', monospace";
    pctx.fillText("No tiles", 8, 20);
  }
  const sel = settings.tile - 1;
  if (sel < grid.count) {
    const r = paletteRect(sel);
    pctx.strokeStyle = PAL.bg;
    pctx.lineWidth = 4;
    pctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    pctx.strokeStyle = PAL.accent;
    pctx.lineWidth = 2;
    pctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
  }
  $("tile-count").textContent = `${grid.count} ${grid.count === 1 ? "tile" : "tiles"}`;
  currentUi();
}

function currentUi() {
  const chip = $("current-chip");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const s = Math.round(32 * dpr);
  if (chip.width !== s) { chip.width = s; chip.height = s; }
  const g = chip.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = MAP_BG;
  g.fillRect(0, 0, s, s);
  drawTile(g, settings.tile, 0, 0, s, s);
  $("current-name").textContent = tileLabel(settings.tile);
}

function setTile(gid) {
  if (!grid.count) { return; }
  settings.tile = Math.min(grid.count, Math.max(1, gid));
  if (settings.tool === "eraser" || settings.tool === "picker") { setTool("brush"); }
  renderPalette();
  scheduleSave();
  requestRender();
}

function stepTile(dir) {
  const n = Math.max(1, grid.count);
  return ((settings.tile - 1 + dir + n) % n) + 1;
}

/* Arrows on the focused picker. Returns true if it used the key. */
function paletteKey(e) {
  const cols = Math.max(1, grid.columns);
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
  if (!(e.key in moves)) { return false; }
  const next = settings.tile + moves[e.key];
  if (next >= 1 && next <= grid.count) {
    setTile(next);
    const r = paletteRect(next - 1);
    /* keep the chosen tile in view inside the scroll box */
    if (r.y < paletteBox.scrollTop) { paletteBox.scrollTop = r.y - GAP; }
    if (r.y + r.h > paletteBox.scrollTop + paletteBox.clientHeight) { paletteBox.scrollTop = r.y + r.h - paletteBox.clientHeight + GAP * 4; }
    if (r.x < paletteBox.scrollLeft) { paletteBox.scrollLeft = r.x - GAP; }
    if (r.x + r.w > paletteBox.scrollLeft + paletteBox.clientWidth) { paletteBox.scrollLeft = r.x + r.w - paletteBox.clientWidth + GAP * 4; }
  }
  return true;
}

palette.addEventListener("click", (e) => {
  const r = palette.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const col = Math.floor((x - GAP / 2) / (pal.cw + GAP));
  const row = Math.floor((y - GAP / 2) / (pal.ch + GAP));
  if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) { return; }
  setTile(row * grid.columns + col + 1);
});

$("current").addEventListener("click", () => {
  $("tiles-card").scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  palette.focus({ preventScroll: true });
});

/* ============================================================
   11. LAYERS (shown top first, stored bottom first)
   ============================================================ */
const layerList = $("layer-list");
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z M4 20L20 4"/></svg>';

function renderLayers() {
  const rows = [];
  for (let i = map.layers.length - 1; i >= 0; i--) {
    const l = map.layers[i];
    const li = document.createElement("li");
    li.className = "tp-layer";
    li.classList.toggle("is-active", i === state.layer);
    li.classList.toggle("is-hidden", !l.visible);
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "tp-layer-name";
    pick.dataset.i = String(i);
    pick.setAttribute("aria-pressed", String(i === state.layer));
    pick.textContent = l.name;
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "tp-eye";
    eye.dataset.eye = String(i);
    eye.setAttribute("aria-pressed", String(l.visible));
    eye.setAttribute("aria-label", `Show ${l.name}`);
    eye.innerHTML = l.visible ? EYE : EYE_OFF;
    li.append(pick, eye);
    rows.push(li);
  }
  layerList.replaceChildren(...rows);
  const n = map.layers.length;
  $("layer-count").textContent = `${n} / ${MAX_LAYERS}`;
  $("layer-add").disabled = n >= MAX_LAYERS;
  $("layer-del").disabled = n <= 1;
  $("layer-up").disabled = state.layer >= n - 1;
  $("layer-down").disabled = state.layer <= 0;
}

layerList.addEventListener("click", (e) => {
  const pick = e.target.closest(".tp-layer-name");
  const eye = e.target.closest(".tp-eye");
  if (pick) {
    if (stroke) { endStroke(); anchor = null; }
    state.layer = Number(pick.dataset.i);
    renderLayers();
    layerList.querySelector(`.tp-layer-name[data-i="${state.layer}"]`)?.focus();
  } else if (eye) {
    const i = Number(eye.dataset.eye);
    map.layers[i].visible = !map.layers[i].visible;
    renderLayers();
    layerList.querySelector(`.tp-eye[data-eye="${i}"]`)?.focus();
    rebuildCache();
    scheduleSave();
  }
});
$("layer-add").addEventListener("click", () => change(addLayer(map, state.layer + 1), state.layer + 1));
$("layer-del").addEventListener("click", () => change(deleteLayer(map, state.layer), Math.max(0, state.layer - 1)));
$("layer-up").addEventListener("click", () => change(moveLayer(map, state.layer, 1), state.layer + 1));
$("layer-down").addEventListener("click", () => change(moveLayer(map, state.layer, -1), state.layer - 1));

/* ============================================================
   12. TILESET
   ============================================================ */
const TILE_FIELDS = { "tile-w": "tileW", "tile-h": "tileH", spacing: "spacing", margin: "margin" };

function tilesetUi() {
  $("tileset-name").textContent = ts.sample ? `${SAMPLE_NAME} (drawn in code)` : ts.name;
  $("tileset-size").textContent = `${ts.imageW} × ${ts.imageH}`;
  for (const [id, key] of Object.entries(TILE_FIELDS)) {
    if (document.activeElement !== $(id)) { $(id).value = String(ts[key]); }
  }
  document.querySelector(".tp-pick").textContent = ts.sample ? "Choose a tileset" : "Choose another";
  $("export-tiles").disabled = !picture;
  const notes = [];
  if (!picture && !ts.picture) { notes.push(`Add ${ts.name} (Choose a tileset) to see its tiles. Until then each tile shows as a colour.`); }
  if (grid.error) { notes.push(grid.error); } else {
    const left = [];
    if (grid.leftX > 0) { left.push(`${grid.leftX} px on the right`); }
    if (grid.leftY > 0) { left.push(`${grid.leftY} px at the bottom`); }
    if (left.length) { notes.push(`Left over: ${left.join(", ")}. Check the tile size, spacing and margin.`); }
  }
  $("tileset-note").textContent = notes.join(" ");
}

/* After the picture or the tile settings change. */
function tilesetChanged() {
  grid = tilesetGrid(ts.imageW, ts.imageH, ts);
  if (settings.tile > grid.count) { settings.tile = 1; }
  tilesetUi();
  renderPalette();
  rebuildCache();
  sizeUi();
  if (view.fitted) { fit(); } else { clampPan(); }
  scheduleSave();
}

for (const [id, key] of Object.entries(TILE_FIELDS)) {
  $(id).addEventListener("change", () => {
    const next = normalizeTileset({ ...ts, [key]: $(id).value });
    const max = maxMapSize(next.tileW, next.tileH);
    if (map.w > max.w || map.h > max.h) {
      $(id).value = String(ts[key]);
      say(`At ${next.tileW} × ${next.tileH} px tiles the map would be too big a picture. Make the map smaller first (up to ${max.w} × ${max.h} tiles).`);
      return;
    }
    Object.assign(ts, next);
    $(id).value = String(ts[key]);
    tilesetChanged();
  });
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch { /* try <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Turn any picture into a canvas we can cut tiles from. */
function toCanvas(src, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
}

/* The picture as PNG text for the save, if it's small enough. */
function pictureText(c) {
  if (c.width * c.height > 1024 * 1024) { return null; }
  try {
    const url = c.toDataURL("image/png");
    return url.length <= PICTURE_LIMIT ? url : null;
  } catch { return null; }
}

let loads = 0;          // only the newest picture chosen wins
async function loadTileset(file) {
  if (!file) { return; }
  if (file.type && !/^image\//.test(file.type)) { say("That isn't a picture. Choose a PNG tileset."); return; }
  const ticket = ++loads;
  say("Opening…");
  let bmp;
  try { bmp = await decode(file); } catch {
    if (ticket === loads) { say("Couldn't open that one. It may be damaged, or a type browsers can't read."); }
    return;
  }
  if (ticket !== loads) { if (bmp.close) { bmp.close(); } return; }
  const w = bmp.width || bmp.naturalWidth;
  const h = bmp.height || bmp.naturalHeight;
  if (!w || !h) { say("That picture is empty."); return; }
  if (w > MAX_IMAGE || h > MAX_IMAGE) { if (bmp.close) { bmp.close(); } say(`That picture is ${w} × ${h}; up to ${MAX_IMAGE} px a side works here.`); return; }
  picture = toCanvas(bmp, w, h);
  if (bmp.close) { bmp.close(); }
  const name = fileOnly(file.name) || "tileset.png";
  const text = pictureText(picture);
  Object.assign(ts, { name, sample: false, imageW: w, imageH: h, picture: text });
  say(text ? `Loaded ${name}.` : `Loaded ${name}. It's too big to keep on this device, so next time you'll be asked to add it again.`);
  tilesetChanged();
}

function useSample() {
  loads++;
  picture = sampleCanvas();
  Object.assign(ts, { name: SAMPLE_NAME, sample: true, picture: null, ...SAMPLE });
  say("");
  tilesetChanged();
}

$("sample").addEventListener("click", useSample);
const picker = $("file");
picker.addEventListener("change", () => {
  loadTileset(picker.files && picker.files[0]);
  picker.value = "";
});

/* Drop a picture (tileset) or a .tmj (map) anywhere on the page. */
const drop = $("drop");
let depth = 0;
const isMapFile = (f) => /\.(tmj|json)$/i.test(f.name || "") || f.type === "application/json";
window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; drop.classList.add("is-over"); });
window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) { drop.classList.remove("is-over"); } });
window.addEventListener("dragover", (e) => { e.preventDefault(); });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  depth = 0;
  drop.classList.remove("is-over");
  const files = [...(e.dataTransfer?.files || [])];
  const mapFile = files.find(isMapFile);
  const pic = files.find((f) => /^image\//.test(f.type));
  if (mapFile) { importTmj(mapFile); }
  if (pic) { loadTileset(pic); }
  if (!mapFile && !pic) { say("Drop a tileset picture or a .tmj map."); }
});
window.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => /^image\//.test(f.type));
  if (file) { e.preventDefault(); loadTileset(file); }
});

/* ============================================================
   13. MAP SIZE
   ============================================================ */
function sizeUi() {
  $("size-label").textContent = `${map.w} × ${map.h} tiles`;
  const max = maxMapSize(ts.tileW, ts.tileH);
  for (const [id, v, m] of [["map-w", map.w, max.w], ["map-h", map.h, max.h]]) {
    $(id).max = String(m);
    if (document.activeElement !== $(id)) { $(id).value = String(v); }
  }
  $("size-hint").textContent = `Up to ${max.w} × ${max.h} tiles at this tile size. Resizing keeps the tiles at the top-left. Both can be undone.`;
}

function wantedSize() {
  const max = maxMapSize(ts.tileW, ts.tileH);
  return { w: clampInt($("map-w").value, 1, max.w, map.w), h: clampInt($("map-h").value, 1, max.h, map.h) };
}

$("resize").addEventListener("click", () => {
  const { w, h } = wantedSize();
  if (w === map.w && h === map.h) { sizeUi(); return; }
  change(resizeMap(map, w, h));
  say(`Resized to ${w} × ${h} tiles.`);
});
$("clear-map").addEventListener("click", () => {
  const { w, h } = wantedSize();
  change(createMap(w, h), 0);
  state.cursor = { x: 0, y: 0 };
  say(`New empty ${w} × ${h} map. Undo brings the old one back.`);
});

/* ============================================================
   14. EXPORT + IMPORT
   ============================================================ */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function exportSay(text) { $("export-status").textContent = text; }
function toPng(c) { return new Promise((resolve) => c.toBlob(resolve, "image/png")); }

/* The name the .tmj gives the tileset picture. */
function imageName() {
  return /\.png$/i.test(ts.name) || !picture ? ts.name : `${baseName(ts.name, "tileset")}.png`;
}

$("export-tmj").addEventListener("click", () => {
  const json = toTmj(map, { ...ts, image: imageName() });
  const text = JSON.stringify(json, null, 1);
  const name = `${NAME}.tmj`;
  downloadBlob(new Blob([text], { type: "application/json" }), name);
  state.lastExport = { kind: "tmj", name };
  exportSay(`Saved ${name}. It uses ${json.tilesets[0].image}: keep that picture next to it${ts.sample ? " (Tileset PNG saves it)" : ""}.`);
});

$("export-csv").addEventListener("click", () => {
  const l = map.layers[state.layer];
  const name = `${NAME}-${baseName(l.name, `layer-${state.layer + 1}`)}.csv`;
  downloadBlob(new Blob([layerCsv(l.data, map.w, map.h)], { type: "text/csv" }), name);
  state.lastExport = { kind: "csv", name };
  exportSay(`Saved ${name}: ${map.w} × ${map.h} tile numbers from 0, -1 = empty.`);
});

$("export-png").addEventListener("click", async () => {
  if (!cache) { rebuildCache(); }
  const blob = await toPng(cache);
  if (!blob) { exportSay("This browser couldn't make a PNG that big."); return; }
  const name = `${NAME}.png`;
  downloadBlob(blob, name);
  state.lastExport = { kind: "png", name, bytes: blob.size };
  exportSay(`Saved ${name} (${cache.width} × ${cache.height}, the layers you can see).`);
});

$("export-tiles").addEventListener("click", async () => {
  if (!picture) { return; }
  const blob = await toPng(picture);
  if (!blob) { exportSay("This browser couldn't make the PNG."); return; }
  const name = imageName();
  downloadBlob(blob, name);
  state.lastExport = { kind: "tileset", name, bytes: blob.size };
  exportSay(`Saved ${name}. Keep it in the same folder as the .tmj.`);
});

/* ---- open a .tmj ---- */
async function importTmj(file) {
  if (!file) { return; }
  if (file.size > 8_000_000) { exportSay("That file is too big to be a map from here."); return; }
  let result;
  try {
    result = fromTmj(JSON.parse(await file.text()));
  } catch (err) {
    exportSay(err instanceof SyntaxError ? "That file isn't JSON, so it can't be a .tmj map." : err.message);
    return;
  }
  const t = result.tileset;
  const max = maxMapSize(t.tileW, t.tileH);
  if (result.map.w > max.w || result.map.h > max.h) {
    exportSay(`That map is too big a picture at ${t.tileW} × ${t.tileH} px tiles (up to ${max.w} × ${max.h} tiles).`);
    return;
  }
  /* the tileset picture: ours if it's the same file, else ask for it */
  const same = t.image === ts.name && t.imageW === ts.imageW && t.imageH === ts.imageH && picture;
  if (t.image === SAMPLE_NAME) {
    picture = sampleCanvas();
    Object.assign(ts, { name: SAMPLE_NAME, sample: true, picture: null, ...SAMPLE, ...normalizeTileset(t) });
  } else if (same) {
    Object.assign(ts, normalizeTileset(t));
  } else {
    picture = null;
    Object.assign(ts, { name: t.image, sample: false, picture: null, imageW: t.imageW || ts.imageW, imageH: t.imageH || ts.imageH, ...normalizeTileset(t) });
  }
  change(result.map, result.map.layers.length - 1);
  tilesetChanged();
  fit();
  const notes = [`Opened ${file.name || "the map"}: ${result.map.w} × ${result.map.h} tiles, ${result.map.layers.length} ${result.map.layers.length === 1 ? "layer" : "layers"}.`, ...result.notes];
  if (!picture) { notes.push(`Now add ${t.image} under Tileset to see the tiles.`); }
  exportSay(notes.join(" "));
}
const tmjPicker = $("tmj-file");
tmjPicker.addEventListener("change", () => {
  importTmj(tmjPicker.files && tmjPicker.files[0]);
  tmjPicker.value = "";
});

/* ============================================================
   SAVING (waits for a pause)
   ============================================================ */
let saveTimer = 0;
function scheduleSave(delay = 600) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, delay);
}
let tooBigSaid = false;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const data = { settings: { ...settings }, tileset: { ...ts }, map: encodeMap(map) };
  const bytes = JSON.stringify(data).length;
  if (bytes > SAVE_LIMIT && data.tileset.picture) {
    /* the picture goes first: you can always add it again */
    data.tileset.picture = null;
  }
  if (JSON.stringify(data).length > SAVE_LIMIT) {
    /* keep the last save that fitted; just save the settings */
    save.set({ settings: { ...settings } });
    if (!tooBigSaid) {
      say(`This map is too big to keep on this device (${Math.round(bytes / 1000)} KB, the limit is ${SAVE_LIMIT / 1000} KB). Export it as a .tmj to keep it.`);
      tooBigSaid = true;
    }
    return;
  }
  tooBigSaid = false;
  save.set(data);
  state.saves += 1;
}
document.addEventListener("visibilitychange", () => { if (document.hidden && saveTimer) { saveNow(); } });
window.addEventListener("pagehide", () => { if (saveTimer) { saveNow(); } });

/* ============================================================
   15. START
   ============================================================ */
async function pictureFromText(text) {
  const img = new Image();
  img.src = text;
  await img.decode();
  return toCanvas(img, img.naturalWidth, img.naturalHeight);
}

function loadFromSave() {
  const d = save.get();
  settings = normalizeSettings(d.settings);
  ts = normalizeTilesetSave(d.tileset || DEFAULT_TILESET);
  let loaded = null;
  if (d.map) {
    try { loaded = decodeMap(d.map); } catch { say("The saved map couldn't be read, so here's the sample level."); }
  }
  map = loaded || starterMap();
  stroke = null;
  anchor = null;
  history.clear();
  state.layer = map.layers.length - 1;
  state.cursor = { x: Math.floor(map.w / 2), y: Math.floor(map.h / 2) };
  const ticket = ++loads;
  picture = ts.sample ? sampleCanvas() : null;
  if (!ts.sample && ts.picture) {
    pictureFromText(ts.picture).then((c) => {
      if (ticket !== loads) { return; }
      picture = c;
      tilesetChanged();
    }).catch(() => { say(`The saved copy of ${ts.name} couldn't be read. Add it again.`); });
  }
  grid = tilesetGrid(ts.imageW, ts.imageH, ts);
  toolUi();
  gridUi();
  tilesetUi();
  renderPalette();
  refreshAll(true);
}

const r0 = stage.getBoundingClientRect();
view.sw = Math.max(1, Math.round(stage.clientWidth || r0.width));
view.sh = Math.max(1, Math.round(stage.clientHeight || r0.height));
loadFromSave();
render();
window.addEventListener("resize", () => renderPalette());
stage.dataset.ready = "true";
