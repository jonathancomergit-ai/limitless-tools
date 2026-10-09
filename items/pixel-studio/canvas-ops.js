/* ============================================================
   Pixel Studio - pure drawing logic (no DOM)

   Everything here works on plain typed arrays, so it runs in
   the page, in the GIF worker and in Node (unit tests in
   tests/unit/pixel-studio.test.js).

   Pixels
     One colour = one 32-bit number, laid out like ImageData on
     every little-endian machine:  R | G << 8 | B << 16 | A << 24.
     0 means "see-through". A cel (one layer of one frame) is a
     Uint32Array of w * h colours, row by row.

   A document
     { w, h,
       layers: [{ name, visible }],        bottom first
       frames: [[cel, cel, ...], ...] }    frames[f][layer]

   Sections:
     1. colours        hex <-> number
     2. documents      new, clone, resize / crop
     3. tools          setPixel, flood fill, line, rectangle,
                       mirror, eyedropper
     4. compositing    visible layers, bottom to top
     5. history        undo / redo (pixel diffs + snapshots)
     6. layers/frames  add, delete, move, duplicate
     7. export         nearest-neighbour scale, sprite sheet
     8. save format    compact text for kit/save.js
   ============================================================ */

export const MIN_SIZE = 8;
export const MAX_SIZE = 128;
export const MAX_LAYERS = 4;
export const MAX_FRAMES = 24;
export const SIZES = [8, 16, 24, 32, 48, 64, 96, 128];
export const TRANSPARENT = 0;

/* ============================================================
   1. COLOURS
   ============================================================ */

/* "#rgb", "#rrggbb" or "#rrggbbaa" -> packed colour. Bad -> null. */
export function hexToColor(hex) {
  let s = String(hex || "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) { s = s.split("").map((c) => c + c).join(""); }
  if (/^[0-9a-f]{6}$/.test(s)) { s += "ff"; }
  if (!/^[0-9a-f]{8}$/.test(s)) { return null; }
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = parseInt(s.slice(6, 8), 16);
  return a === 0 ? TRANSPARENT : (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

/* Packed colour -> "#rrggbb" (or "#rrggbbaa" if not solid). */
export function colorToHex(c) {
  c >>>= 0;
  const a = c >>> 24;
  const h = (v) => v.toString(16).padStart(2, "0");
  const rgb = `#${h(c & 255)}${h((c >>> 8) & 255)}${h((c >>> 16) & 255)}`;
  return a === 255 ? rgb : `${rgb}${h(a)}`;
}

export function rgbaOf(c) {
  c >>>= 0;
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24];
}

/* ============================================================
   2. DOCUMENTS
   ============================================================ */

export function clampSize(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, v)) : 16;
}

export function createDoc(w = 16, h = 16, { layers = 1, frames = 1 } = {}) {
  w = clampSize(w);
  h = clampSize(h);
  const nl = Math.max(1, Math.min(MAX_LAYERS, layers));
  const nf = Math.max(1, Math.min(MAX_FRAMES, frames));
  return {
    w,
    h,
    layers: Array.from({ length: nl }, (_, i) => ({ name: `Layer ${i + 1}`, visible: true })),
    frames: Array.from({ length: nf }, () => Array.from({ length: nl }, () => new Uint32Array(w * h)))
  };
}

export function cloneDoc(doc) {
  return {
    w: doc.w,
    h: doc.h,
    layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((cels) => cels.map((c) => c.slice()))
  };
}

/* Bytes a document holds (for capping the undo stack). */
export function docBytes(doc) {
  return doc.w * doc.h * 4 * doc.layers.length * doc.frames.length;
}

/* Where the old picture lands when the canvas changes size.
   anchor: { x: 0 | 0.5 | 1, y: 0 | 0.5 | 1 } (0 = left / top). */
export function resizeOffset(oldW, oldH, newW, newH, anchor = { x: 0.5, y: 0.5 }) {
  return {
    dx: Math.round((newW - oldW) * (anchor.x ?? 0.5)),
    dy: Math.round((newH - oldH) * (anchor.y ?? 0.5))
  };
}

export function resizeCel(cel, w, h, newW, newH, dx, dy) {
  const out = new Uint32Array(newW * newH);
  for (let y = 0; y < h; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= newH) { continue; }
    for (let x = 0; x < w; x++) {
      const nx = x + dx;
      if (nx < 0 || nx >= newW) { continue; }
      out[ny * newW + nx] = cel[y * w + x];
    }
  }
  return out;
}

/* Bigger: the art keeps its pixels, with room round it.
   Smaller: the art is cropped. Returns a new document. */
export function resizeDoc(doc, newW, newH, anchor = { x: 0.5, y: 0.5 }) {
  newW = clampSize(newW);
  newH = clampSize(newH);
  const { dx, dy } = resizeOffset(doc.w, doc.h, newW, newH, anchor);
  return {
    w: newW,
    h: newH,
    layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((cels) => cels.map((c) => resizeCel(c, doc.w, doc.h, newW, newH, dx, dy)))
  };
}

/* ============================================================
   3. TOOLS
   ============================================================ */

export function inside(w, h, x, y) {
  return x >= 0 && y >= 0 && x < w && y < h && Number.isInteger(x) && Number.isInteger(y);
}

export function getPixel(cel, w, h, x, y) {
  return inside(w, h, x, y) ? cel[y * w + x] : TRANSPARENT;
}

/* Returns true if the pixel changed. */
export function setPixel(cel, w, h, x, y, c) {
  if (!inside(w, h, x, y)) { return false; }
  const i = y * w + x;
  if (cel[i] === c >>> 0) { return false; }
  cel[i] = c >>> 0;
  return true;
}

/* Paint a list of [x, y] points. Returns how many changed. */
export function plot(cel, w, h, points, c) {
  let n = 0;
  for (const [x, y] of points) { if (setPixel(cel, w, h, x, y, c)) { n++; } }
  return n;
}

/* 4-way flood fill: spreads up/down/left/right only, so a
   diagonal gap in an outline still holds it. Filling with the
   colour that's already there does nothing. Returns how many
   pixels changed. */
export function floodFill(cel, w, h, x, y, c) {
  if (!inside(w, h, x, y)) { return 0; }
  c >>>= 0;
  const target = cel[y * w + x];
  if (target === c) { return 0; }
  let n = 0;
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop();
    let px = stack.pop();
    /* scanline: run left, then paint right, queueing rows above and below */
    while (px > 0 && cel[py * w + px - 1] === target) { px--; }
    let up = false;
    let down = false;
    for (; px < w && cel[py * w + px] === target; px++) {
      cel[py * w + px] = c;
      n++;
      if (py > 0) {
        const t = cel[(py - 1) * w + px] === target;
        if (t && !up) { stack.push(px, py - 1); }
        up = t;
      }
      if (py < h - 1) {
        const t = cel[(py + 1) * w + px] === target;
        if (t && !down) { stack.push(px, py + 1); }
        down = t;
      }
    }
  }
  return n;
}

/* Bresenham: every pixel of a 1-pixel line from (x0, y0) to
   (x1, y1), both ends included, no gaps, no doubles. Always
   worked out left to right, so dragging either way gives the
   very same pixels (ties don't flip). */
export function linePoints(x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  if (x0 > x1 || (x0 === x1 && y0 > y1)) { return linePoints(x1, y1, x0, y0).reverse(); }
  const pts = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) { break; }
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

/* A rectangle between two corners (any order). */
export function rectPoints(x0, y0, x1, y1, filled = false) {
  const l = Math.min(x0, x1);
  const r = Math.max(x0, x1);
  const t = Math.min(y0, y1);
  const b = Math.max(y0, y1);
  const pts = [];
  for (let y = t; y <= b; y++) {
    for (let x = l; x <= r; x++) {
      if (filled || y === t || y === b || x === l || x === r) { pts.push([x, y]); }
    }
  }
  return pts;
}

/* The same points, mirrored across the middle of the canvas:
   mx = left <-> right, my = top <-> bottom, both = 4 copies.
   No duplicates in the result. */
export function mirrorPoints(points, w, h, { x: mx = false, y: my = false } = {}) {
  if (!mx && !my) { return points; }
  const seen = new Set();
  const out = [];
  const add = (x, y) => {
    const k = y * 65536 + x;
    if (!seen.has(k)) { seen.add(k); out.push([x, y]); }
  };
  for (const [x, y] of points) {
    add(x, y);
    if (mx) { add(w - 1 - x, y); }
    if (my) { add(x, h - 1 - y); }
    if (mx && my) { add(w - 1 - x, h - 1 - y); }
  }
  return out;
}

/* The colour you see at (x, y): the top visible layer that
   isn't see-through there. 0 if every layer is empty. */
export function eyedropper(doc, frame, x, y) {
  if (!inside(doc.w, doc.h, x, y)) { return TRANSPARENT; }
  const cels = doc.frames[frame];
  const i = y * doc.w + x;
  for (let l = doc.layers.length - 1; l >= 0; l--) {
    if (!doc.layers[l].visible) { continue; }
    const c = cels[l][i];
    if (c >>> 24) { return c >>> 0; }
  }
  return TRANSPARENT;
}

/* ============================================================
   4. COMPOSITING
   ============================================================ */

/* "Source over" for one pixel. Solid colours just replace. */
export function over(dst, src) {
  const sa = src >>> 24;
  if (sa === 255) { return src >>> 0; }
  if (sa === 0) { return dst >>> 0; }
  const da = dst >>> 24;
  if (da === 0) { return src >>> 0; }
  const a = sa + (da * (255 - sa)) / 255;
  const mix = (shift) => {
    const s = (src >>> shift) & 255;
    const d = (dst >>> shift) & 255;
    return Math.round((s * sa + (d * da * (255 - sa)) / 255) / a);
  };
  return (mix(0) | (mix(8) << 8) | (mix(16) << 16) | (Math.round(a) << 24)) >>> 0;
}

/* Every visible layer of one frame, bottom first, flattened. */
export function composite(doc, frame, { onlyVisible = true, out = null } = {}) {
  const n = doc.w * doc.h;
  const res = out && out.length === n ? out : new Uint32Array(n);
  res.fill(0);
  const cels = doc.frames[frame];
  for (let l = 0; l < doc.layers.length; l++) {
    if (onlyVisible && !doc.layers[l].visible) { continue; }
    const cel = cels[l];
    for (let i = 0; i < n; i++) {
      const c = cel[i];
      if (c) { res[i] = (c >>> 24) === 255 ? c : over(res[i], c); }
    }
  }
  return res;
}

/* ============================================================
   5. HISTORY - undo / redo
   Two kinds of step:
     pixels   { type: "pixels", frame, layer, idx, from, to }
              only the pixels a stroke changed (small)
     doc      { type: "doc", before, after }
              whole snapshots, for layer / frame / size changes
   Capped by step count AND by bytes, oldest dropped first.
   ============================================================ */

/* What changed between two copies of one cel. null if nothing. */
export function diffCels(before, after) {
  const idx = [];
  for (let i = 0; i < after.length; i++) { if (before[i] !== after[i]) { idx.push(i); } }
  if (!idx.length) { return null; }
  const from = new Uint32Array(idx.length);
  const to = new Uint32Array(idx.length);
  idx.forEach((p, k) => { from[k] = before[p]; to[k] = after[p]; });
  return { idx: Uint32Array.from(idx), from, to };
}

function stepBytes(step) {
  if (step.type === "pixels") { return step.idx.length * 12 + 64; }
  return docBytes(step.before) + docBytes(step.after) + 64;
}

export function createHistory({ limit = 100, maxBytes = 48_000_000 } = {}) {
  let undos = [];
  let redos = [];
  let bytes = 0;

  function trim() {
    while (undos.length > limit || (bytes > maxBytes && undos.length > 1)) {
      bytes -= stepBytes(undos.shift());
    }
  }
  function apply(doc, step, dir) {
    if (step.type === "doc") { return cloneDoc(dir < 0 ? step.before : step.after); }
    const cel = doc.frames[step.frame]?.[step.layer];
    if (!cel) { return doc; }
    const vals = dir < 0 ? step.from : step.to;
    for (let k = 0; k < step.idx.length; k++) { cel[step.idx[k]] = vals[k]; }
    return doc;
  }

  return {
    get canUndo() { return undos.length > 0; },
    get canRedo() { return redos.length > 0; },
    get size() { return undos.length; },
    get bytes() { return bytes; },

    /* A stroke on one cel: pass the cel as it was before. */
    pixels(frame, layer, before, after) {
      const d = diffCels(before, after);
      if (!d) { return false; }
      return this.push({ type: "pixels", frame, layer, ...d });
    },
    /* A bigger change: whole documents before and after.
       meta (optional) rides along, e.g. which frame was chosen. */
    snapshot(before, after, meta = null) {
      return this.push({ type: "doc", before: cloneDoc(before), after: cloneDoc(after), meta });
    },
    push(step) {
      undos.push(step);
      bytes += stepBytes(step);
      for (const r of redos) { bytes -= stepBytes(r); }
      redos = [];
      trim();
      return true;
    },
    /* Both return the document to use next (it may be a new one),
       plus the step (and which way it went) so the page can jump
       to its frame / layer. */
    undo(doc) {
      const step = undos.pop();
      if (!step) { return { doc, step: null, dir: -1 }; }
      redos.push(step);
      return { doc: apply(doc, step, -1), step, dir: -1 };
    },
    redo(doc) {
      const step = redos.pop();
      if (!step) { return { doc, step: null, dir: 1 }; }
      undos.push(step);
      return { doc: apply(doc, step, 1), step, dir: 1 };
    },
    clear() { undos = []; redos = []; bytes = 0; }
  };
}

/* ============================================================
   6. LAYERS + FRAMES (each returns a NEW document)
   ============================================================ */

export function addLayer(doc, at = doc.layers.length) {
  if (doc.layers.length >= MAX_LAYERS) { return doc; }
  const d = cloneDoc(doc);
  const used = new Set(d.layers.map((l) => l.name));
  let n = d.layers.length + 1;
  while (used.has(`Layer ${n}`)) { n++; }
  d.layers.splice(at, 0, { name: `Layer ${n}`, visible: true });
  for (const cels of d.frames) { cels.splice(at, 0, new Uint32Array(d.w * d.h)); }
  return d;
}

export function deleteLayer(doc, i) {
  if (doc.layers.length <= 1 || i < 0 || i >= doc.layers.length) { return doc; }
  const d = cloneDoc(doc);
  d.layers.splice(i, 1);
  for (const cels of d.frames) { cels.splice(i, 1); }
  return d;
}

/* Swap layer i with i + dir (dir = +1 up, -1 down). */
export function moveLayer(doc, i, dir) {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= doc.layers.length || j >= doc.layers.length) { return doc; }
  const d = cloneDoc(doc);
  [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
  for (const cels of d.frames) { [cels[i], cels[j]] = [cels[j], cels[i]]; }
  return d;
}

export function addFrame(doc, at = doc.frames.length) {
  if (doc.frames.length >= MAX_FRAMES) { return doc; }
  const d = cloneDoc(doc);
  d.frames.splice(at, 0, d.layers.map(() => new Uint32Array(d.w * d.h)));
  return d;
}

export function duplicateFrame(doc, i) {
  if (doc.frames.length >= MAX_FRAMES || !doc.frames[i]) { return doc; }
  const d = cloneDoc(doc);
  d.frames.splice(i + 1, 0, d.frames[i].map((c) => c.slice()));
  return d;
}

export function deleteFrame(doc, i) {
  if (doc.frames.length <= 1 || !doc.frames[i]) { return doc; }
  const d = cloneDoc(doc);
  d.frames.splice(i, 1);
  return d;
}

export function moveFrame(doc, i, dir) {
  const j = i + dir;
  if (!doc.frames[i] || !doc.frames[j]) { return doc; }
  const d = cloneDoc(doc);
  [d.frames[i], d.frames[j]] = [d.frames[j], d.frames[i]];
  return d;
}

/* ============================================================
   7. EXPORT
   ============================================================ */

/* Nearest-neighbour scale: every pixel becomes a k x k block. */
export function scaleUp(px, w, h, k) {
  k = Math.max(1, Math.round(k));
  if (k === 1) { return px.slice(); }
  const W = w * k;
  const out = new Uint32Array(W * h * k);
  for (let y = 0; y < h; y++) {
    const row = new Uint32Array(W);
    for (let x = 0; x < w; x++) { row.fill(px[y * w + x], x * k, x * k + k); }
    for (let r = 0; r < k; r++) { out.set(row, (y * k + r) * W); }
  }
  return out;
}

/* The biggest whole scale <= want that keeps a picture inside
   limits (a side and a total pixel count). At least 1. */
export function fitScale(w, h, want, { maxSide = 8192, maxPixels = 40_000_000 } = {}) {
  let k = Math.max(1, Math.round(want));
  while (k > 1 && (w * k > maxSide || h * k > maxSide || w * h * k * k > maxPixels)) { k--; }
  return k;
}

/* Frames in a grid, as square as it gets: n frames of fw x fh. */
export function sheetLayout(n, fw, fh, { cols = 0, scale = 1 } = {}) {
  n = Math.max(1, n);
  const c = cols > 0 ? Math.min(cols, n) : Math.ceil(Math.sqrt(n));
  const r = Math.ceil(n / c);
  const w = fw * scale;
  const h = fh * scale;
  const rects = Array.from({ length: n }, (_, i) => ({ x: (i % c) * w, y: Math.floor(i / c) * h, w, h }));
  return { cols: c, rows: r, width: c * w, height: r * h, rects };
}

/* The JSON next to the sheet: one rect a frame, plus the speed.
   Shaped like a TexturePacker / Aseprite "array" export, so most
   engines (and a few lines of your own code) can read it. */
export function sheetJson(layout, { image = "sprite.png", fps = 8, frameW, frameH, scale = 1, name = "sprite" } = {}) {
  const duration = Math.round(1000 / Math.max(1, fps));
  return {
    frames: layout.rects.map((r, i) => ({
      filename: `${name}_${String(i).padStart(2, "0")}`,
      frame: { x: r.x, y: r.y, w: r.w, h: r.h },
      duration
    })),
    meta: {
      app: "Pixel Studio",
      image,
      format: "RGBA8888",
      size: { w: layout.width, h: layout.height },
      frameSize: { w: frameW * scale, h: frameH * scale },
      scale,
      fps,
      cols: layout.cols,
      rows: layout.rows,
      frameCount: layout.rects.length
    }
  };
}

/* ============================================================
   8. SAVE FORMAT
   A whole project as small JSON-safe text:
     colors   every colour used, "#rrggbb"; index 0 = see-through
     cels     each cel as a run-length string (see below)
     frames   frames[f][layer] = which string in cels
   Identical cels (duplicated frames, empty layers) are stored
   once. A cel can also be stored as "what changed since the
   same layer one frame back" - animation frames are mostly the
   same, so that's much smaller.

   Cel string: "r" (raw) or "d" (delta) then tokens.
     a token is the colour index in `width` letters of ALPHA
     ("~" in a delta = same as last frame), optionally followed
     by "*<run length in base 36>." when it repeats 3+ times.
   ============================================================ */

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SAME = -1;

function idxToken(v, width) {
  if (v === SAME) { return "~"; }
  if (width === 1) { return ALPHA[v]; }
  return ALPHA[v >> 6] + ALPHA[v & 63];
}

function encodeRuns(values, width, kind) {
  let s = kind;
  for (let i = 0; i < values.length;) {
    const v = values[i];
    let j = i + 1;
    while (j < values.length && values[j] === v) { j++; }
    const run = j - i;
    const t = idxToken(v, width);
    s += run >= 3 ? `${t}*${run.toString(36)}.` : t.repeat(run);
    i = j;
  }
  return s;
}

function decodeRuns(text, n, width, prev) {
  const kind = text[0];
  if (kind !== "r" && kind !== "d") { throw new Error("bad cel"); }
  if (kind === "d" && !prev) { throw new Error("delta without a frame before it"); }
  const out = new Int32Array(n);
  let o = 0;
  let p = 1;
  while (p < text.length) {
    let v;
    if (text[p] === "~") {
      if (kind !== "d") { throw new Error("bad cel"); }
      v = SAME;
      p += 1;
    } else {
      v = 0;
      for (let k = 0; k < width; k++) {
        const d = ALPHA.indexOf(text[p + k]);
        if (d < 0) { throw new Error("bad cel"); }
        v = v * 64 + d;
      }
      p += width;
    }
    let run = 1;
    if (text[p] === "*") {
      const end = text.indexOf(".", p);
      if (end < 0) { throw new Error("bad cel"); }
      run = parseInt(text.slice(p + 1, end), 36);
      if (!(run > 0)) { throw new Error("bad cel"); }
      p = end + 1;
    }
    if (o + run > n) { throw new Error("cel too long"); }
    for (let k = 0; k < run; k++, o++) { out[o] = v === SAME ? prev[o] : v; }
  }
  if (o !== n) { throw new Error("cel too short"); }
  return out;
}

/* Document -> plain object for kit/save.js. */
export function encodeDoc(doc) {
  const colorIndex = new Map([[0, 0]]);
  const colors = [];
  for (const cels of doc.frames) {
    for (const cel of cels) {
      for (let i = 0; i < cel.length; i++) {
        const c = cel[i] >>> 0;
        if (!colorIndex.has(c)) { colorIndex.set(c, colors.length + 1); colors.push(colorToHex(c)); }
      }
    }
  }
  const total = colors.length + 1;
  if (total > 64 * 64) { throw new Error("Too many colours to save (4096 max)."); }
  const width = total <= 64 ? 1 : 2;

  const strings = [];
  const seen = new Map();
  const frames = doc.frames.map((cels, f) => cels.map((cel, l) => {
    const idx = Array.from(cel, (c) => colorIndex.get(c >>> 0));
    let text = encodeRuns(idx, width, "r");
    if (f > 0) {
      const prev = doc.frames[f - 1][l];
      const delta = idx.map((v, i) => (cel[i] === prev[i] ? SAME : v));
      const d = encodeRuns(delta, width, "d");
      if (d.length < text.length) { text = d; }
    }
    /* A delta only means the same thing in the same place. */
    const key = text[0] === "d" ? `${f}:${l}:${text}` : text;
    if (!seen.has(key)) { seen.set(key, strings.length); strings.push(text); }
    return seen.get(key);
  }));

  return {
    w: doc.w,
    h: doc.h,
    layers: doc.layers.map((l) => ({ name: String(l.name), visible: Boolean(l.visible) })),
    colors,
    cels: strings,
    frames
  };
}

/* Plain object (maybe from an imported file) -> document.
   Throws a short message if anything is off. */
export function decodeDoc(data) {
  if (!data || typeof data !== "object") { throw new Error("No project in it."); }
  const { w, h } = data;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < MIN_SIZE || h < MIN_SIZE || w > MAX_SIZE || h > MAX_SIZE) {
    throw new Error("The canvas size is out of range.");
  }
  if (!Array.isArray(data.layers) || !data.layers.length || data.layers.length > MAX_LAYERS) { throw new Error("Bad layers."); }
  if (!Array.isArray(data.frames) || !data.frames.length || data.frames.length > MAX_FRAMES) { throw new Error("Bad frames."); }
  if (!Array.isArray(data.colors) || !Array.isArray(data.cels)) { throw new Error("Bad pixel data."); }

  const palette = [0];
  for (const hex of data.colors) {
    const c = hexToColor(hex);
    if (c === null) { throw new Error("Bad colour in the save."); }
    palette.push(c);
  }
  const width = palette.length <= 64 ? 1 : 2;
  const n = w * h;
  const layers = data.layers.map((l, i) => ({
    name: typeof l?.name === "string" && l.name.trim() ? l.name.slice(0, 24) : `Layer ${i + 1}`,
    visible: l?.visible !== false
  }));

  const frames = [];
  let lastIdx = null;     // the colour indexes of the frame before
  data.frames.forEach((refs) => {
    if (!Array.isArray(refs) || refs.length !== layers.length) { throw new Error("Bad frame."); }
    const idxs = [];
    frames.push(refs.map((ref, l) => {
      const text = data.cels[ref];
      if (typeof text !== "string") { throw new Error("Missing cel."); }
      const idx = decodeRuns(text, n, width, lastIdx ? lastIdx[l] : null);
      idxs.push(idx);
      const cel = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        const c = palette[idx[i]];
        if (c === undefined) { throw new Error("Bad colour index."); }
        cel[i] = c;
      }
      return cel;
    }));
    lastIdx = idxs;
  });
  return { w, h, layers, frames };
}
