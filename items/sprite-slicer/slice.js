/* ============================================================
   Sprite Sheet Slicer - the pure maths

   No DOM in here, so it's all unit tested
   (tests/unit/sprite-slicer.test.js).

     normalizeSettings   tidy saved / typed settings
     gridFrames          cut a sheet into a grid of cells
     autoDetect          find sprites by the empty gaps between them
     isEmptyRect         is a cell fully see-through (or background)?
     playOrder / frameAt animation order, with ping-pong
     phaserMap/godotMap  the JSON frame maps

   A frame is { x, y, w, h } in sheet pixels, top-left origin.
   ============================================================ */

export const MAX_SIDE = 8192;          // biggest sheet we open
export const MAX_PIXELS = 16_777_216;  // 4096 x 4096: we read every pixel
export const MAX_FRAMES = 2048;
export const MODES = ["size", "count", "auto"];
export const MAP_FORMATS = ["phaser", "godot"];

export const DEFAULTS = Object.freeze({
  mode: "size",       // size = cell width/height, count = columns x rows, auto = find gaps
  cellW: 32,
  cellH: 32,
  cols: 4,
  rows: 4,
  margin: 0,          // border round the whole sheet
  spacing: 0,         // gap between cells
  skipEmpty: true,    // leave out cells with nothing in them
  fps: 10,
  pingpong: false,
  zoom: 0,            // 0 = fit, else a whole-number zoom (pixel perfect)
  mapFormat: "phaser"
});

/* A whole number in [lo, hi], or the fallback. */
export function int(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) { return fallback; }
  return Math.min(hi, Math.max(lo, n));
}

export function normalizeSettings(d = {}) {
  const s = d && typeof d === "object" ? d : {};
  return {
    mode: MODES.includes(s.mode) ? s.mode : DEFAULTS.mode,
    cellW: int(s.cellW, 1, MAX_SIDE, DEFAULTS.cellW),
    cellH: int(s.cellH, 1, MAX_SIDE, DEFAULTS.cellH),
    cols: int(s.cols, 1, 256, DEFAULTS.cols),
    rows: int(s.rows, 1, 256, DEFAULTS.rows),
    margin: int(s.margin, 0, 1024, DEFAULTS.margin),
    spacing: int(s.spacing, 0, 1024, DEFAULTS.spacing),
    skipEmpty: typeof s.skipEmpty === "boolean" ? s.skipEmpty : DEFAULTS.skipEmpty,
    fps: int(s.fps, 1, 60, DEFAULTS.fps),
    pingpong: typeof s.pingpong === "boolean" ? s.pingpong : DEFAULTS.pingpong,
    zoom: int(s.zoom, 0, 16, DEFAULTS.zoom),
    mapFormat: MAP_FORMATS.includes(s.mapFormat) ? s.mapFormat : DEFAULTS.mapFormat
  };
}

/* ============================================================
   GRID
   One axis at a time. A sheet laid out like this:

     margin | cell | spacing | cell | spacing | cell | margin

   size mode:  cell size known  -> how many fit?
   count mode: how many known   -> how big is each cell?
   ============================================================ */
function axis(total, margin, spacing, cell, count, mode) {
  const room = total - 2 * margin;
  if (mode === "count") {
    const size = Math.floor((room - (count - 1) * spacing) / count);
    return { count, size, left: room - count * size - (count - 1) * spacing };
  }
  const n = Math.floor((room + spacing) / (cell + spacing));
  return { count: Math.max(0, n), size: cell, left: n > 0 ? room - n * cell - (n - 1) * spacing : room };
}

/* -> { cols, rows, cellW, cellH, leftX, leftY, frames, error }
   leftX / leftY = pixels left over at the right / bottom. */
export function gridFrames(imgW, imgH, settings) {
  const s = normalizeSettings(settings);
  const mode = s.mode === "count" ? "count" : "size";
  const x = axis(imgW, s.margin, s.spacing, s.cellW, s.cols, mode);
  const y = axis(imgH, s.margin, s.spacing, s.cellH, s.rows, mode);
  const out = { cols: x.count, rows: y.count, cellW: x.size, cellH: y.size, leftX: x.left, leftY: y.left, frames: [], error: "" };

  if (2 * s.margin >= imgW || 2 * s.margin >= imgH) {
    out.error = "The margin is bigger than the picture.";
  } else if (mode === "count" && (x.size < 1 || y.size < 1)) {
    out.error = "Too many columns or rows for this picture.";
  } else if (mode === "size" && (x.count < 1 || y.count < 1)) {
    out.error = "The cells are bigger than the picture.";
  } else if (x.count * y.count > MAX_FRAMES) {
    out.error = `That's ${x.count * y.count} cells. The most is ${MAX_FRAMES}: try bigger cells.`;
  }
  if (out.error) { return out; }

  for (let r = 0; r < y.count; r++) {
    for (let c = 0; c < x.count; c++) {
      out.frames.push({
        x: s.margin + c * (x.size + s.spacing),
        y: s.margin + r * (y.size + s.spacing),
        w: x.size,
        h: y.size,
        col: c,
        row: r
      });
    }
  }
  return out;
}

/* ============================================================
   EMPTY PIXELS
   Most sheets have a see-through background. Old ones often
   use a flat colour (magic pink) instead. So: if the top-left
   pixel is see-through, "empty" means see-through; otherwise
   "empty" means "the same colour as the top-left pixel".
   rgba = ImageData.data (4 bytes a pixel).
   ============================================================ */
export function emptyTest(rgba, cut = 8) {
  const keyed = rgba[3] > cut;
  const [r, g, b] = [rgba[0], rgba[1], rgba[2]];
  return keyed
    ? (i) => rgba[i + 3] <= cut || (rgba[i] === r && rgba[i + 1] === g && rgba[i + 2] === b)
    : (i) => rgba[i + 3] <= cut;
}

export function isEmptyRect(rgba, imgW, rect, empty = emptyTest(rgba)) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    let i = (y * imgW + rect.x) * 4;
    for (let x = 0; x < rect.w; x++, i += 4) {
      if (!empty(i)) { return false; }
    }
  }
  return true;
}

/* ============================================================
   AUTO-DETECT
   1. Rows with nothing in them split the sheet into bands.
   2. In each band, columns with nothing in them split it into
      sprites.
   3. Each sprite is trimmed top and bottom to fit tightly.
   Reading order: top band first, left to right.
   ============================================================ */
function runs(flags) {
  /* [true, true, false, true] -> [[0, 2], [3, 4]]  (start, end-exclusive) */
  const out = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (start < 0) { start = i; }
    } else if (start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

export function autoDetect(rgba, imgW, imgH, { cut = 8, minSize = 1 } = {}) {
  const empty = emptyTest(rgba, cut);

  const rowFull = new Array(imgH).fill(false);
  for (let y = 0; y < imgH; y++) {
    let i = y * imgW * 4;
    for (let x = 0; x < imgW; x++, i += 4) {
      if (!empty(i)) { rowFull[y] = true; break; }
    }
  }

  const frames = [];
  for (const [y0, y1] of runs(rowFull)) {
    const colFull = new Array(imgW).fill(false);
    for (let x = 0; x < imgW; x++) {
      for (let y = y0; y < y1; y++) {
        if (!empty((y * imgW + x) * 4)) { colFull[x] = true; break; }
      }
    }
    for (const [x0, x1] of runs(colFull)) {
      /* trim top and bottom to this sprite alone */
      let top = y0;
      let bottom = y1;
      while (top < bottom && isEmptyRect(rgba, imgW, { x: x0, y: top, w: x1 - x0, h: 1 }, empty)) { top++; }
      while (bottom > top && isEmptyRect(rgba, imgW, { x: x0, y: bottom - 1, w: x1 - x0, h: 1 }, empty)) { bottom--; }
      if (x1 - x0 >= minSize && bottom - top >= minSize) {
        frames.push({ x: x0, y: top, w: x1 - x0, h: bottom - top });
        if (frames.length > MAX_FRAMES) { return frames.slice(0, MAX_FRAMES); }
      }
    }
  }
  return frames;
}

/* ============================================================
   ANIMATION
   ============================================================ */

/* 4 frames: [0,1,2,3]. Ping-pong: [0,1,2,3,2,1] (no doubled ends). */
export function playOrder(count, pingpong = false) {
  const fwd = Array.from({ length: Math.max(0, count) }, (_, i) => i);
  if (!pingpong || count < 3) { return fwd; }
  return fwd.concat(fwd.slice(1, -1).reverse());
}

/* Which frame shows at time t (seconds)? */
export function frameAt(order, t, fps) {
  if (!order.length) { return -1; }
  const step = Math.floor(Math.max(0, t) * fps);
  return order[step % order.length];
}

/* Move one item in a list. Returns a new list. */
export function moveItem(list, from, to) {
  const out = list.slice();
  if (from < 0 || from >= out.length) { return out; }
  const dest = Math.min(out.length - 1, Math.max(0, to));
  const [item] = out.splice(from, 1);
  out.splice(dest, 0, item);
  return out;
}

/* ============================================================
   NAMES + MAPS
   ============================================================ */

/* "My Hero (run).png" -> "my-hero-run" */
export function baseName(fileName) {
  const stem = String(fileName || "").replace(/\.[a-z0-9]{1,5}$/i, "");
  const clean = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return clean || "sprite";
}

/* frameName("hero", 3, 12) -> "hero_03.png" (always at least 2 digits) */
export function frameName(prefix, i, total) {
  const digits = Math.max(2, String(Math.max(1, total) - 1).length);
  return `${prefix}_${String(i).padStart(digits, "0")}.png`;
}

/* Phaser 3 "JSON Hash" (the TexturePacker shape):
   this.load.atlas("hero", "hero.png", "hero.json") */
export function phaserMap(frames, { image, width, height, prefix }) {
  const out = { frames: {}, meta: {} };
  frames.forEach((f, i) => {
    out.frames[frameName(prefix, i, frames.length)] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
      sourceSize: { w: f.w, h: f.h }
    };
  });
  out.meta = {
    app: "Limitless Workshop: Sprite Sheet Slicer",
    version: "1.0",
    image,
    format: "RGBA8888",
    size: { w: width, h: height },
    scale: "1"
  };
  return out;
}

/* Godot: a plain map to build AtlasTextures / SpriteFrames from.
   Each region is [x, y, w, h], the same order as Rect2. */
export function godotMap(frames, { image, width, height, prefix, fps, pingpong }) {
  return {
    texture: image,
    size: [width, height],
    animation: { name: prefix, speed: fps, loop: true, pingpong: Boolean(pingpong) },
    frames: frames.map((f, i) => ({ name: frameName(prefix, i, frames.length).replace(/\.png$/, ""), region: [f.x, f.y, f.w, f.h] }))
  };
}

/* Does a sheet this size fit in memory? "" = yes, else a message. */
export function sizeProblem(w, h) {
  if (!w || !h) { return "This picture has no size."; }
  if (w > MAX_SIDE || h > MAX_SIDE) { return `Too big: the most is ${MAX_SIDE} pixels a side.`; }
  if (w * h > MAX_PIXELS) { return "Too big for a phone to hold. Try a smaller sheet."; }
  return "";
}
