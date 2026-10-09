/* ============================================================
   Pixel Studio - main script

   Draw pixel art with layers, animate it frame by frame,
   export a PNG, a sprite sheet + JSON, or a GIF. All in this
   tab: nothing is uploaded, nothing is fetched.

   The pixels and the rules live in canvas-ops.js (pure, unit
   tested). This file is the page: input, drawing the view,
   the panels, saving and exporting.

   Sections:
     1. settings + save     what's remembered, and how
     2. state               the document, view, history
     3. the stage           drawing the canvas view
     4. view                zoom + pan
     5. drawing             strokes, tools, keyboard cursor
     6. pointer input       draw, pinch, pan, wheel
     7. keys                hotkeys, cursor, undo / redo
     8. history             undo / redo, bigger changes
     9. palette
    10. frames + preview
    11. layers
    12. canvas size dialog
    13. export             PNG, sprite sheet, JSON, GIF
    14. start
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { startLoop } from "../../kit/loop.js";
import { reducedMotion } from "../../kit/motion.js";
import {
  hexToColor, colorToHex, createDoc, resizeDoc, getPixel, plot, floodFill,
  linePoints, rectPoints, mirrorPoints, eyedropper, composite, createHistory,
  addLayer, deleteLayer, moveLayer, addFrame, duplicateFrame, deleteFrame, moveFrame,
  fitScale, sheetLayout, sheetJson, encodeDoc, decodeDoc, clampSize,
  MAX_LAYERS, MAX_FRAMES
} from "./canvas-ops.js";
import { PRESETS, PRESET_KEYS, MAX_CUSTOM } from "./palettes.js";

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
  surface: cssColor("--surface"),
  surface2: cssColor("--surface-2"),
  line: cssColor("--line-bright")
};
/* The faint see-through checkerboard behind the art. */
const CHECK_A = "#2b2e3f";
const CHECK_B = "#363a4e";

const TOOLS = ["pencil", "eraser", "fill", "line", "rect", "picker"];
const TOOL_KEYS = { b: "pencil", e: "eraser", g: "fill", l: "line", r: "rect", i: "picker" };
const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 64;
const SAVE_LIMIT = 900_000;    // kit/save.js refuses imports over 1 MB
const NAME = "pixel-art";

/* ============================================================
   1. SETTINGS + SAVE
   The whole project is saved (pixels, layers, frames), in the
   compact text format from canvas-ops.js, plus the settings.
   Saving waits for a pause (after a stroke, not during it).
   ============================================================ */
const DEFAULT_SETTINGS = {
  tool: "pencil",
  color: "#ff004d",
  preset: "pico8",
  custom: [],
  mirrorX: false,
  mirrorY: false,
  rectFill: false,
  onion: false,
  fps: 6,
  scale: 8
};

function normalizeSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  const int = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : def);
  const hex = (v) => (hexToColor(v) ? colorToHex(hexToColor(v)) : null);
  return {
    tool: TOOLS.includes(s.tool) ? s.tool : d.tool,
    color: hex(s.color) || d.color,
    preset: PRESET_KEYS.includes(s.preset) ? s.preset : d.preset,
    custom: [...new Set((Array.isArray(s.custom) ? s.custom : []).map(hex).filter(Boolean))].slice(0, MAX_CUSTOM),
    mirrorX: Boolean(s.mirrorX),
    mirrorY: Boolean(s.mirrorY),
    rectFill: Boolean(s.rectFill),
    onion: Boolean(s.onion),
    fps: int(s.fps, 1, 24, d.fps),
    scale: int(s.scale, 1, 32, d.scale)
  };
}

const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { settings: { ...DEFAULT_SETTINGS }, project: null },
  validate: (d) => {
    if (d.project === null || d.project === undefined) { return true; }
    try { decodeDoc(d.project); return true; } catch (err) {
      return `That file doesn't hold a Pixel Studio project (${err.message})`;
    }
  }
});
mountSavePanel($("save-panel"), save, {
  title: "Your project",
  intro: "Your drawing (every layer and frame), your colours and settings are saved on this device. Export to keep a copy or move it to another browser.",
  exportLabel: "Export project",
  importLabel: "Import project",
  onImport: () => { loadFromSave(); },
  onDelete: () => { loadFromSave(); }
});

/* A tiny beating heart, so the canvas is never empty. */
function starterDoc() {
  const colors = { K: "#1d2b53", R: "#ff004d", W: "#fff1e8", D: "#7e2553" };
  const big = [
    "................", "................", "..KKKK....KKKK..", ".KRRRRK..KRRRRK.",
    "KRWWRRRKKRRRRRRK", "KRWRRRRRRRRRRRRK", "KRRRRRRRRRRRRRRK", "KRRRRRRRRRRRRDRK",
    ".KRRRRRRRRRRRDK.", "..KRRRRRRRRRDK..", "...KRRRRRRRDK...", "....KRRRRRDK....",
    ".....KRRRDK.....", "......KRDK......", ".......KK.......", "................"
  ];
  const small = [
    "................", "................", "................", "...KKK....KKK...",
    "..KRRRK..KRRRK..", ".KRWWRRKKRRRRRK.", ".KRWRRRRRRRRRRK.", ".KRRRRRRRRRRDRK.",
    "..KRRRRRRRRRDK..", "...KRRRRRRRDK...", "....KRRRRRDK....", ".....KRRRDK.....",
    "......KRDK......", ".......KK.......", "................", "................"
  ];
  const doc = createDoc(16, 16, { frames: 2 });
  [big, small].forEach((rows, f) => {
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ".") { doc.frames[f][0][y * 16 + x] = hexToColor(colors[ch]); }
    }));
  });
  return doc;
}

/* ============================================================
   2. STATE
   ============================================================ */
let settings = normalizeSettings(save.get().settings);
let doc = starterDoc();
const history = createHistory({ limit: 200 });

const view = { zoom: 8, panX: 0, panY: 0, fitted: true, sw: 300, sh: 300 };

const state = exposeForTests({
  get w() { return doc.w; },
  get h() { return doc.h; },
  get frames() { return doc.frames.length; },
  get layers() { return doc.layers.length; },
  get tool() { return settings.tool; },
  get color() { return settings.color; },
  get zoom() { return view.zoom; },
  get canUndo() { return history.canUndo; },
  frame: 0,
  layer: 0,
  cursor: { x: 8, y: 8 },
  gridAlpha: 0,
  previewFrame: -1,
  steps: 0,             // times the preview changed frame
  playing: !reducedMotion(),
  saves: 0,             // completed saves
  saveBytes: 0,
  lastExport: null,
  /* For smoke.js: the colour on the chosen layer, and where a
     pixel is on screen (CSS px from the canvas's top-left). */
  pixelAt(x, y) { const c = getPixel(cel(), doc.w, doc.h, x, y); return c ? colorToHex(c) : "transparent"; },
  screenOf(x, y) { return { x: view.panX + (x + 0.5) * view.zoom, y: view.panY + (y + 0.5) * view.zoom }; }
});

function cel() { return doc.frames[state.frame][state.layer]; }

function say(text) { $("status").textContent = text; }

/* ============================================================
   3. THE STAGE
   One canvas the size of the stage box. The art is drawn into
   a small offscreen canvas (1 px per pixel), then scaled up
   with smoothing off, so pixels stay sharp squares.
   ============================================================ */
const stage = $("stage");
const art = $("art");
const ctx = art.getContext("2d");

let flat = null;          // { canvas, ctx, buf: Uint32Array, img: ImageData } at w x h
let onion = null;
let checker = null;       // { canvas, group }

function offscreen(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  const buf = new Uint32Array(w * h);
  const img = new ImageData(new Uint8ClampedArray(buf.buffer), w, h);
  return { canvas, ctx: g, buf, img, w, h };
}

/* Flatten one frame into an offscreen canvas. */
function paintFrame(target, f) {
  composite(doc, f, { out: target.buf });
  target.ctx.putImageData(target.img, 0, 0);
  return target.canvas;
}

function ensureBuffers() {
  if (!flat || flat.w !== doc.w || flat.h !== doc.h) {
    flat = offscreen(doc.w, doc.h);
    onion = offscreen(doc.w, doc.h);
    checker = null;
  }
}

/* Checks are one art pixel each when zoomed in, bigger groups
   when zoomed out, so they never turn into noise. */
function checkerFor(z) {
  const group = Math.max(1, Math.ceil(8 / z));
  if (checker && checker.group === group) { return checker; }
  const cw = Math.ceil(doc.w / group);
  const ch = Math.ceil(doc.h / group);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext("2d");
  g.fillStyle = CHECK_A;
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = CHECK_B;
  for (let y = 0; y < ch; y++) { for (let x = (y % 2); x < cw; x += 2) { g.fillRect(x, y, 1, 1); } }
  checker = { canvas, group, cw, ch };
  return checker;
}

/* Grid lines: none when zoomed out, fading in from 4x to 12x. */
function gridAlpha(z) {
  return Math.max(0, Math.min(1, (z - 4) / 8)) * 0.22;
}

let renderQueued = false;
function requestRender() {
  if (renderQueued) { return; }
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function render() {
  ensureBuffers();
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(view.sw * dpr));
  const H = Math.max(1, Math.round(view.sh * dpr));
  if (art.width !== W || art.height !== H) { art.width = W; art.height = H; }

  const z = view.zoom;
  const k = z * dpr;
  const ox = view.panX * dpr;
  const oy = view.panY * dpr;
  const aw = doc.w * k;
  const ah = doc.h * k;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PAL.bg2;
  ctx.fillRect(0, 0, W, H);

  /* see-through checks, clipped to the art */
  const ck = checkerFor(z);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, aw, ah);
  ctx.clip();
  ctx.drawImage(ck.canvas, ox, oy, ck.cw * ck.group * k, ck.ch * ck.group * k);
  ctx.restore();

  /* onion skin: the frame before, faint */
  if (settings.onion && doc.frames.length > 1) {
    const prev = (state.frame - 1 + doc.frames.length) % doc.frames.length;
    ctx.globalAlpha = 0.3;
    ctx.drawImage(paintFrame(onion, prev), ox, oy, aw, ah);
    ctx.globalAlpha = 1;
  }

  ctx.drawImage(paintFrame(flat, state.frame), ox, oy, aw, ah);

  /* the pixel grid, 1 device pixel wide */
  const ga = gridAlpha(z);
  state.gridAlpha = ga;
  if (ga > 0) {
    ctx.strokeStyle = `rgba(236, 238, 246, ${ga})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.max(0, Math.floor(-ox / k));
    const x1 = Math.min(doc.w, Math.ceil((W - ox) / k));
    const y0 = Math.max(0, Math.floor(-oy / k));
    const y1 = Math.min(doc.h, Math.ceil((H - oy) / k));
    for (let x = x0 + 1; x < x1; x++) {
      const px = Math.round(ox + x * k) + 0.5;
      ctx.moveTo(px, Math.max(0, oy)); ctx.lineTo(px, Math.min(H, oy + ah));
    }
    for (let y = y0 + 1; y < y1; y++) {
      const py = Math.round(oy + y * k) + 0.5;
      ctx.moveTo(Math.max(0, ox), py); ctx.lineTo(Math.min(W, ox + aw), py);
    }
    ctx.stroke();
  }

  /* a border round the art */
  ctx.strokeStyle = PAL.line;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeRect(Math.round(ox) - 0.5 * dpr, Math.round(oy) - 0.5 * dpr, Math.round(aw) + dpr, Math.round(ah) + dpr);

  /* mirror lines */
  if (settings.mirrorX || settings.mirrorY) {
    ctx.strokeStyle = PAL.cyan;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    if (settings.mirrorX) { const mx = Math.round(ox + aw / 2) + 0.5; ctx.moveTo(mx, oy); ctx.lineTo(mx, oy + ah); }
    if (settings.mirrorY) { const my = Math.round(oy + ah / 2) + 0.5; ctx.moveTo(ox, my); ctx.lineTo(ox + aw, my); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /* the mouse's pixel */
  if (hover && !gesture) { outlinePixel(hover.x, hover.y, PAL.text, 0.8, dpr, k, ox, oy, false); }
  /* the start of a keyboard line / box */
  if (anchor) { outlinePixel(anchor.x, anchor.y, PAL.cyan, 1, dpr, k, ox, oy, false); }
  /* the keyboard cursor */
  if (cursorShown && document.activeElement === stage) {
    outlinePixel(state.cursor.x, state.cursor.y, PAL.accent, 1, dpr, k, ox, oy, true);
  }
}

function outlinePixel(x, y, color, alpha, dpr, k, ox, oy, thick) {
  const lw = Math.max(1, (thick ? 2 : 1) * dpr);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  const s = Math.max(k, 3 * dpr);
  const px = ox + x * k + (k - s) / 2;
  const py = oy + y * k + (k - s) / 2;
  ctx.strokeRect(px - lw / 2, py - lw / 2, s + lw, s + lw);
  if (thick) {
    ctx.strokeStyle = PAL.bg;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeRect(px - lw - dpr / 2, py - lw - dpr / 2, s + 2 * lw + dpr, s + 2 * lw + dpr);
  }
  ctx.globalAlpha = 1;
}

/* ============================================================
   4. VIEW - zoom + pan
   view.zoom = CSS px per art pixel; panX / panY = where the
   art's top-left corner sits, in CSS px inside the stage.
   ============================================================ */
function fit() {
  const room = Math.min(view.sw, view.sh) * 0.9;
  let z = room / Math.max(doc.w, doc.h);
  z = z >= 1 ? Math.floor(z) : Math.max(MIN_ZOOM, z);
  view.zoom = Math.min(MAX_ZOOM, z);
  view.panX = Math.round((view.sw - doc.w * view.zoom) / 2);
  view.panY = Math.round((view.sh - doc.h * view.zoom) / 2);
  view.fitted = true;
  zoomUi();
  requestRender();
}

/* Keep at least a corner of the art on screen. */
function clampPan() {
  const m = 24;
  const aw = doc.w * view.zoom;
  const ah = doc.h * view.zoom;
  view.panX = Math.min(view.sw - m, Math.max(m - aw, view.panX));
  view.panY = Math.min(view.sh - m, Math.max(m - ah, view.panY));
}

/* Zoom so the art point under (cx, cy) stays put. */
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

/* Keep the canvas the size of its box. */
new ResizeObserver(() => {
  const r = stage.getBoundingClientRect();
  const sw = Math.max(1, Math.round(stage.clientWidth || r.width));
  const sh = Math.max(1, Math.round(stage.clientHeight || r.height));
  if (sw === view.sw && sh === view.sh) { return; }
  /* keep the middle of the view in the middle */
  view.panX += (sw - view.sw) / 2;
  view.panY += (sh - view.sh) / 2;
  view.sw = sw;
  view.sh = sh;
  if (view.fitted) { fit(); } else { clampPan(); requestRender(); }
}).observe(stage);

/* ============================================================
   5. DRAWING
   A stroke remembers its cel as it was, draws straight into
   it, and on release hands "before" + "after" to the history,
   which keeps only the pixels that changed.
   ============================================================ */
let stroke = null;      // { frame, layer, before, start, last, tool }
let anchor = null;      // keyboard line / box start
let hover = null;       // mouse pixel
let cursorShown = false;

function drawColor() {
  return settings.tool === "eraser" ? 0 : hexToColor(settings.color);
}

function mirrored(points) {
  return mirrorPoints(points, doc.w, doc.h, { x: settings.mirrorX, y: settings.mirrorY });
}

function beginStroke(x, y) {
  const tool = settings.tool;
  if (tool === "picker") { pickAt(x, y); return; }
  if (!doc.layers[state.layer].visible) { say(`${doc.layers[state.layer].name} is hidden. Show it to see what you draw.`); }
  stroke = { frame: state.frame, layer: state.layer, before: cel().slice(), start: { x, y }, last: { x, y }, tool };
  applyStroke(x, y);
}

function applyStroke(x, y) {
  if (!stroke) { return; }
  const c = cel();
  const color = drawColor();
  const { w, h } = doc;
  switch (stroke.tool) {
    case "pencil":
    case "eraser":
      plot(c, w, h, mirrored(linePoints(stroke.last.x, stroke.last.y, x, y)), color);
      break;
    case "fill":
      if (x === stroke.start.x && y === stroke.start.y) {
        for (const [px, py] of mirrored([[x, y]])) { floodFill(c, w, h, px, py, color); }
      }
      break;
    case "line":
      c.set(stroke.before);
      plot(c, w, h, mirrored(linePoints(stroke.start.x, stroke.start.y, x, y)), color);
      break;
    case "rect":
      c.set(stroke.before);
      plot(c, w, h, mirrored(rectPoints(stroke.start.x, stroke.start.y, x, y, settings.rectFill)), color);
      break;
    default:
  }
  stroke.last = { x, y };
  requestRender();
}

function endStroke() {
  if (!stroke) { return; }
  const s = stroke;
  stroke = null;
  const changed = history.pixels(s.frame, s.layer, s.before, doc.frames[s.frame][s.layer]);
  if (changed) { edited(); }
}

/* Two fingers landed: that wasn't a stroke after all. */
function cancelStroke() {
  if (!stroke) { return; }
  doc.frames[stroke.frame][stroke.layer].set(stroke.before);
  stroke = null;
  requestRender();
}

function pickAt(x, y) {
  const c = eyedropper(doc, state.frame, x, y);
  if (!c) { say("Nothing to pick there (see-through)."); return; }
  setColor(colorToHex(c), false);
  say(`Picked ${colorToHex(c)}.`);
}

/* After any change to the pixels. */
function edited() {
  drawThumb(state.frame);
  drawPreview(true);
  historyUi();
  scheduleSave();
  requestRender();
}

/* ---- the keyboard cursor ---- */
function moveCursor(dx, dy) {
  const from = { ...state.cursor };
  state.cursor.x = Math.min(doc.w - 1, Math.max(0, state.cursor.x + dx));
  state.cursor.y = Math.min(doc.h - 1, Math.max(0, state.cursor.y + dy));
  cursorShown = true;
  const { x, y } = state.cursor;
  if (spaceHeld && (settings.tool === "pencil" || settings.tool === "eraser")) {
    /* holding Space: paint along the way */
    spaceUsed = true;
    if (!stroke) { beginStroke(from.x, from.y); }
    applyStroke(x, y);
  } else if (stroke && anchor) {
    applyStroke(x, y);   // line / box preview
  }
  keepCursorInView();
  announce();
  requestRender();
}

/* Pressing Space / Enter on the canvas. */
function keyPaint() {
  const { x, y } = state.cursor;
  cursorShown = true;
  const tool = settings.tool;
  if (tool === "line" || tool === "rect") {
    if (!anchor) {
      anchor = { x, y };
      beginStroke(x, y);
      say(`Start set. Move, then press Space again to finish the ${tool === "line" ? "line" : "box"}.`);
    } else {
      applyStroke(x, y);
      endStroke();
      anchor = null;
      say("");
    }
  } else if (tool === "picker") {
    pickAt(x, y);
  } else {
    beginStroke(x, y);
    endStroke();
  }
  requestRender();
}

function keepCursorInView() {
  const p = state.screenOf(state.cursor.x, state.cursor.y);
  const m = view.zoom + 8;
  let moved = false;
  if (p.x < m) { view.panX += m - p.x; moved = true; }
  if (p.x > view.sw - m) { view.panX -= p.x - (view.sw - m); moved = true; }
  if (p.y < m) { view.panY += m - p.y; moved = true; }
  if (p.y > view.sh - m) { view.panY -= p.y - (view.sh - m); moved = true; }
  if (moved) { view.fitted = false; }
}

let announceTimer = 0;
function announce() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const { x, y } = state.cursor;
    const c = eyedropper(doc, state.frame, x, y);
    $("cursor-out").textContent = `${x + 1}, ${y + 1}: ${c ? colorToHex(c) : "empty"}`;
  }, 250);
}

/* ============================================================
   6. POINTER INPUT
   One pointer draws. Two pointers pinch-zoom and pan (and undo
   the stroke the first finger had started). Space + drag or the
   middle button pans. Wheel zooms.
   ============================================================ */
const pointers = new Map();   // pointerId -> { x, y }
let gesture = null;           // { kind: "draw" | "pan" | "pinch" | "done", ... }
let spaceHeld = false;
let spaceUsed = false;
let overStage = false;

function local(e) {
  const r = art.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function toPixel(p) {
  return { x: Math.floor((p.x - view.panX) / view.zoom), y: Math.floor((p.y - view.panY) / view.zoom) };
}

function startPinch() {
  const [a, b] = [...pointers.values()];
  gesture = {
    kind: "pinch",
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    zoom: view.zoom,
    art: { x: ((a.x + b.x) / 2 - view.panX) / view.zoom, y: ((a.y + b.y) / 2 - view.panY) / view.zoom }
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
  const px = toPixel(p);
  state.cursor = { x: Math.min(doc.w - 1, Math.max(0, px.x)), y: Math.min(doc.h - 1, Math.max(0, px.y)) };
  anchor = null;
  gesture = { kind: "draw", id: e.pointerId };
  beginStroke(px.x, px.y);
  if (!stroke) { gesture = { kind: "done" }; }
});

stage.addEventListener("pointermove", (e) => {
  const p = local(e);
  if (e.pointerType === "mouse") {
    const px = toPixel(p);
    const inArt = px.x >= 0 && px.y >= 0 && px.x < doc.w && px.y < doc.h;
    const next = inArt ? px : null;
    if ((next?.x !== hover?.x) || (next?.y !== hover?.y)) { hover = next; requestRender(); }
  }
  if (!pointers.has(e.pointerId)) { return; }
  pointers.set(e.pointerId, p);
  if (!gesture) { return; }

  if (gesture.kind === "pinch" && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.zoom * dist / gesture.dist));
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    view.zoom = z;
    view.panX = mx - gesture.art.x * z;
    view.panY = my - gesture.art.y * z;
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
    /* coalesced events give every point a fast stroke passed through */
    const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    for (const ev of list.length ? list : [e]) {
      const px = toPixel(local(ev));
      if (stroke.tool === "pencil" || stroke.tool === "eraser") {
        if (px.x !== stroke.last.x || px.y !== stroke.last.y) { applyStroke(px.x, px.y); }
      }
    }
    const px = toPixel(p);
    if (stroke.tool === "line" || stroke.tool === "rect") { applyStroke(px.x, px.y); }
  }
});

function pointerEnd(e) {
  if (!pointers.has(e.pointerId)) { return; }
  pointers.delete(e.pointerId);
  if (gesture && gesture.kind === "draw" && e.pointerId === gesture.id) {
    if (e.type === "pointercancel") { cancelStroke(); } else { endStroke(); }
    gesture = null;
  } else if (gesture && gesture.kind === "pinch") {
    /* the other finger lifting must not start drawing */
    gesture = pointers.size ? { kind: "done" } : null;
  } else if (!pointers.size) {
    gesture = null;
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
   7. KEYS
   ============================================================ */
function isTyping(el) {
  if (!el || !el.closest) { return false; }
  if (el.closest("textarea, select, [contenteditable='true']")) { return true; }
  return el.tagName === "INPUT" && !["range", "checkbox", "radio", "button"].includes(el.type);
}

document.addEventListener("keydown", (e) => {
  if ($("size-dialog").open || isTyping(e.target)) { return; }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.ctrlKey || e.metaKey;

  if (mod && !e.altKey) {
    if (key === "z") { e.preventDefault(); if (e.shiftKey) { redo(); } else { undo(); } return; }
    if (key === "y") { e.preventDefault(); redo(); return; }
    return;
  }
  if (e.altKey) { return; }

  const onStage = e.target === stage;
  if (onStage) {
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
  } else if (e.key === " " && overStage && (e.target === document.body || e.target === document.documentElement)) {
    /* hovering the canvas: Space + drag pans, and doesn't scroll */
    e.preventDefault();
    spaceHeld = true;
    spaceUsed = true;
    return;
  }

  if (e.shiftKey && key !== "?") { return; }
  if (TOOL_KEYS[key]) { setTool(TOOL_KEYS[key]); e.preventDefault(); return; }
  switch (key) {
    case "m": cycleMirror(); break;
    case "[": stepColor(-1); break;
    case "]": stepColor(1); break;
    case ",": selectFrame(state.frame - 1); break;
    case ".": selectFrame(state.frame + 1); break;
    default: return;
  }
  e.preventDefault();
});

document.addEventListener("keyup", (e) => {
  if (e.key !== " ") { return; }
  const wasHeld = spaceHeld;
  spaceHeld = false;
  if (!wasHeld) { return; }
  if (e.target === stage && !$("size-dialog").open) {
    e.preventDefault();
    if (stroke && !anchor) { endStroke(); }           // a Space + arrows stroke
    else if (!spaceUsed) { keyPaint(); }             // a plain press
  }
});

/* ---- tools ---- */
const toolBtns = [...document.querySelectorAll(".ps-tool")];
let toolBeforePick = "pencil";

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
  $("fill-shape-row").hidden = settings.tool !== "rect";
  stage.dataset.tool = settings.tool;
}
for (const b of toolBtns) { b.addEventListener("click", () => setTool(b.dataset.tool)); }

$("fill-shape").addEventListener("change", () => { settings.rectFill = $("fill-shape").checked; scheduleSave(); });

/* Mirror: off -> left/right -> top/bottom -> both -> off */
function cycleMirror() {
  const order = [[false, false], [true, false], [false, true], [true, true]];
  const at = order.findIndex(([x, y]) => x === settings.mirrorX && y === settings.mirrorY);
  [settings.mirrorX, settings.mirrorY] = order[(at + 1) % order.length];
  mirrorUi();
  scheduleSave();
  requestRender();
}
function mirrorUi() {
  const { mirrorX: x, mirrorY: y } = settings;
  const label = x && y ? "Mirror both" : x ? "Mirror ↔" : y ? "Mirror ↕" : "Mirror off";
  $("mirror-label").textContent = label;
  $("mirror").setAttribute("aria-pressed", String(x || y));
  $("mirror").setAttribute("aria-label", x && y
    ? "Mirror: left-right and top-bottom" : x ? "Mirror: left-right" : y ? "Mirror: top-bottom" : "Mirror: off");
}
$("mirror").addEventListener("click", cycleMirror);

/* ============================================================
   8. HISTORY
   ============================================================ */
function undo() {
  if (stroke) { cancelStroke(); anchor = null; }
  const r = history.undo(doc);
  if (!r.step) { say("Nothing to undo."); return; }
  afterHistory(r);
}
function redo() {
  if (stroke) { cancelStroke(); anchor = null; }
  const r = history.redo(doc);
  if (!r.step) { say("Nothing to redo."); return; }
  afterHistory(r);
}
function afterHistory({ doc: next, step, dir }) {
  const sizeChanged = next.w !== doc.w || next.h !== doc.h;
  doc = next;
  if (step.type === "pixels") {
    state.frame = step.frame;
    state.layer = step.layer;
  } else if (step.meta) {
    const sel = dir < 0 ? step.meta.before : step.meta.after;
    state.frame = sel.frame;
    state.layer = sel.layer;
  }
  clampSelection();
  say("");
  refreshAll(sizeChanged);
  scheduleSave();
}
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);

function historyUi() {
  $("undo").disabled = !history.canUndo;
  $("redo").disabled = !history.canRedo;
}

/* A bigger change (layers, frames, size): snapshot it. */
function change(next, { frame = state.frame, layer = state.layer } = {}) {
  if (next === doc) { return false; }
  history.snapshot(doc, next, {
    before: { frame: state.frame, layer: state.layer },
    after: { frame, layer }
  });
  const sizeChanged = next.w !== doc.w || next.h !== doc.h;
  doc = next;
  state.frame = frame;
  state.layer = layer;
  clampSelection();
  refreshAll(sizeChanged);
  scheduleSave();
  return true;
}

function clampSelection() {
  state.frame = Math.min(doc.frames.length - 1, Math.max(0, state.frame));
  state.layer = Math.min(doc.layers.length - 1, Math.max(0, state.layer));
  state.cursor.x = Math.min(doc.w - 1, state.cursor.x);
  state.cursor.y = Math.min(doc.h - 1, state.cursor.y);
}

function refreshAll(refit = false) {
  ensureBuffers();
  if (refit) { checker = null; fit(); }
  $("size-label").textContent = `${doc.w} × ${doc.h}`;
  renderStrip();
  renderLayers();
  historyUi();
  exportHint();
  drawPreview(true);
  requestRender();
}

/* ============================================================
   9. PALETTE
   ============================================================ */
const swatches = $("swatches");
const customSwatches = $("custom-swatches");
const presetRadios = [...document.querySelectorAll('input[name="preset"]')];

function swatch(hex, custom) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ps-swatch";
  b.dataset.color = hex;
  if (custom) { b.dataset.custom = "true"; }
  b.setAttribute("aria-label", hex);
  b.title = hex;
  b.style.backgroundColor = hex;
  return b;
}

function renderPalette() {
  for (const r of presetRadios) { r.checked = r.value === settings.preset; }
  swatches.classList.toggle("is-long", PRESETS[settings.preset].colors.length > 24);
  swatches.replaceChildren(...PRESETS[settings.preset].colors.map((c) => swatch(c, false)));
  customSwatches.replaceChildren(...settings.custom.map((c) => swatch(c, true)));
  $("custom-empty").hidden = settings.custom.length > 0;
  paletteUi();
}

function paletteUi() {
  for (const b of document.querySelectorAll(".ps-swatch")) {
    b.setAttribute("aria-pressed", String(b.dataset.color === settings.color));
  }
  $("current-chip").style.backgroundColor = settings.color;
  $("current-hex").textContent = settings.color;
  $("remove-color").disabled = !settings.custom.includes(settings.color);
  $("add-color").disabled = settings.custom.length >= MAX_CUSTOM;
}

function setColor(hex, toPencil = true) {
  settings.color = hex;
  if (settings.tool === "picker") { setTool(toolBeforePick === "picker" ? "pencil" : toolBeforePick); }
  else if (toPencil && settings.tool === "eraser") { setTool("pencil"); }
  paletteUi();
  scheduleSave();
}

/* [ and ] walk through the colours on show. */
function stepColor(dir) {
  const all = [...PRESETS[settings.preset].colors, ...settings.custom];
  const at = all.indexOf(settings.color);
  setColor(all[(at + dir + all.length) % all.length]);
}

function onSwatch(e) {
  const b = e.target.closest(".ps-swatch");
  if (b) { setColor(b.dataset.color); }
}
swatches.addEventListener("click", onSwatch);
customSwatches.addEventListener("click", onSwatch);
for (const r of presetRadios) {
  r.addEventListener("change", () => { settings.preset = r.value; renderPalette(); scheduleSave(); });
}
$("add-color").addEventListener("click", () => {
  const hex = colorToHex(hexToColor($("custom-color").value) || hexToColor("#000000"));
  if (!settings.custom.includes(hex)) {
    if (settings.custom.length >= MAX_CUSTOM) { say(`Up to ${MAX_CUSTOM} of your own colours.`); return; }
    settings.custom.push(hex);
  }
  settings.color = hex;
  renderPalette();
  setColor(hex);
});
$("remove-color").addEventListener("click", () => {
  settings.custom = settings.custom.filter((c) => c !== settings.color);
  renderPalette();
  scheduleSave();
});
$("current").addEventListener("click", () => {
  $("palette-card").scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  const on = document.querySelector('.ps-swatch[aria-pressed="true"]') || document.querySelector(".ps-swatch");
  if (on) { on.focus({ preventScroll: true }); }
});

/* ============================================================
   10. FRAMES + PREVIEW
   ============================================================ */
const strip = $("strip");
const THUMB = 44;

function checkerFill(g, w, h, size) {
  g.fillStyle = CHECK_A;
  g.fillRect(0, 0, w, h);
  g.fillStyle = CHECK_B;
  for (let y = 0; y < h; y += size) {
    for (let x = (y / size) % 2 ? size : 0; x < w; x += size * 2) { g.fillRect(x, y, size, size); }
  }
}

/* Draw frame f into canvas c, as big as fits, centred. */
function drawFrameInto(c, f) {
  const g = c.getContext("2d");
  const W = c.width;
  const H = c.height;
  checkerFill(g, W, H, Math.max(2, Math.round(W / 12)));
  ensureBuffers();
  const k0 = Math.min(W / doc.w, H / doc.h);
  const k = k0 >= 1 ? Math.floor(k0) : k0;
  const dw = doc.w * k;
  const dh = doc.h * k;
  g.imageSmoothingEnabled = false;
  g.drawImage(paintFrame(onion, f), Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
}

function renderStrip() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const items = doc.frames.map((_, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ps-frame";
    b.dataset.i = String(i);
    b.setAttribute("aria-pressed", String(i === state.frame));
    b.setAttribute("aria-label", `Frame ${i + 1}`);
    const c = document.createElement("canvas");
    c.width = c.height = Math.round(THUMB * dpr);
    c.setAttribute("aria-hidden", "true");
    drawFrameInto(c, i);
    const n = document.createElement("span");
    n.textContent = String(i + 1);
    b.append(c, n);
    li.append(b);
    return li;
  });
  strip.replaceChildren(...items);
  framesUi();
}

function drawThumb(i) {
  const c = strip.querySelector(`.ps-frame[data-i="${i}"] canvas`);
  if (c) { drawFrameInto(c, i); }
}

function framesUi() {
  const n = doc.frames.length;
  $("frame-count").textContent = `${state.frame + 1} / ${n}`;
  for (const b of strip.querySelectorAll(".ps-frame")) { b.setAttribute("aria-pressed", String(Number(b.dataset.i) === state.frame)); }
  $("frame-add").disabled = n >= MAX_FRAMES;
  $("frame-dup").disabled = n >= MAX_FRAMES;
  $("frame-del").disabled = n <= 1;
  $("frame-left").disabled = state.frame === 0;
  $("frame-right").disabled = state.frame >= n - 1;
}

function selectFrame(i) {
  if (i < 0 || i >= doc.frames.length || i === state.frame) { return; }
  if (stroke) { endStroke(); anchor = null; }
  state.frame = i;
  framesUi();
  strip.querySelector(`.ps-frame[data-i="${i}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  requestRender();
}

strip.addEventListener("click", (e) => {
  const b = e.target.closest(".ps-frame");
  if (b) { selectFrame(Number(b.dataset.i)); }
});
$("frame-add").addEventListener("click", () => change(addFrame(doc, state.frame + 1), { frame: state.frame + 1 }));
$("frame-dup").addEventListener("click", () => change(duplicateFrame(doc, state.frame), { frame: state.frame + 1 }));
$("frame-del").addEventListener("click", () => change(deleteFrame(doc, state.frame), { frame: Math.max(0, state.frame - 1) }));
$("frame-left").addEventListener("click", () => change(moveFrame(doc, state.frame, -1), { frame: state.frame - 1 }));
$("frame-right").addEventListener("click", () => change(moveFrame(doc, state.frame, 1), { frame: state.frame + 1 }));

$("onion").addEventListener("change", () => { settings.onion = $("onion").checked; scheduleSave(); requestRender(); });

/* ---- the preview (kit/loop.js pauses it when the tab is hidden) ---- */
const anim = $("anim");
let t = 0;

function drawPreview(force = false) {
  const n = doc.frames.length;
  const i = Math.floor(t * settings.fps) % n;
  if (i === state.previewFrame && !force) { return; }
  if (i !== state.previewFrame) { state.steps += 1; state.previewFrame = i; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.round((anim.clientWidth || 128) * dpr);
  if (anim.width !== size) { anim.width = size; anim.height = size; }
  drawFrameInto(anim, i);
}

const loop = startLoop({
  update(dt) { t += dt; if (t > 3600) { t = 0; } },
  draw: () => drawPreview(false),
  startPaused: !state.playing
});

function playUi() {
  $("play").textContent = state.playing ? "Pause" : "Play";
  $("play").setAttribute("aria-pressed", String(state.playing));
}
$("play").addEventListener("click", () => {
  state.playing = !state.playing;
  if (state.playing) { loop.resume(); } else { loop.pause(); }
  playUi();
});
$("fps").addEventListener("input", () => {
  settings.fps = Number($("fps").value);
  $("fps-out").textContent = `${settings.fps} fps`;
  exportHint();
  scheduleSave();
});

/* ============================================================
   11. LAYERS (shown top first, stored bottom first)
   ============================================================ */
const layerList = $("layer-list");
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z M4 20L20 4"/></svg>';

function renderLayers() {
  const rows = [];
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    const li = document.createElement("li");
    li.className = "ps-layer";
    li.classList.toggle("is-active", i === state.layer);
    li.classList.toggle("is-hidden", !l.visible);
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "ps-layer-name";
    pick.dataset.i = String(i);
    pick.setAttribute("aria-pressed", String(i === state.layer));
    pick.textContent = l.name;
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "ps-eye";
    eye.dataset.eye = String(i);
    eye.setAttribute("aria-pressed", String(l.visible));
    eye.setAttribute("aria-label", `Show ${l.name}`);
    eye.innerHTML = l.visible ? EYE : EYE_OFF;
    li.append(pick, eye);
    rows.push(li);
  }
  layerList.replaceChildren(...rows);
  const n = doc.layers.length;
  $("layer-count").textContent = `${n} / ${MAX_LAYERS}`;
  $("layer-add").disabled = n >= MAX_LAYERS;
  $("layer-del").disabled = n <= 1;
  $("layer-up").disabled = state.layer >= n - 1;
  $("layer-down").disabled = state.layer <= 0;
}

layerList.addEventListener("click", (e) => {
  const pick = e.target.closest(".ps-layer-name");
  const eye = e.target.closest(".ps-eye");
  if (pick) {
    if (stroke) { endStroke(); anchor = null; }
    state.layer = Number(pick.dataset.i);
    renderLayers();
    layerList.querySelector(`.ps-layer-name[data-i="${state.layer}"]`)?.focus();
  } else if (eye) {
    const i = Number(eye.dataset.eye);
    doc.layers[i].visible = !doc.layers[i].visible;
    renderLayers();
    layerList.querySelector(`.ps-eye[data-eye="${i}"]`)?.focus();
    for (let f = 0; f < doc.frames.length; f++) { drawThumb(f); }
    drawPreview(true);
    scheduleSave();
    requestRender();
  }
});
$("layer-add").addEventListener("click", () => change(addLayer(doc, state.layer + 1), { layer: state.layer + 1 }));
$("layer-del").addEventListener("click", () => change(deleteLayer(doc, state.layer), { layer: Math.max(0, state.layer - 1) }));
$("layer-up").addEventListener("click", () => change(moveLayer(doc, state.layer, 1), { layer: state.layer + 1 }));
$("layer-down").addEventListener("click", () => change(moveLayer(doc, state.layer, -1), { layer: state.layer - 1 }));

/* ============================================================
   12. CANVAS SIZE DIALOG
   ============================================================ */
const dlg = $("size-dialog");
const sizeRadios = [...document.querySelectorAll('input[name="size"]')];

function syncPills() {
  const w = Number($("new-w").value);
  const h = Number($("new-h").value);
  for (const r of sizeRadios) { r.checked = w === h && Number(r.value) === w; }
}
$("open-size").addEventListener("click", () => {
  $("new-w").value = String(doc.w);
  $("new-h").value = String(doc.h);
  syncPills();
  dlg.showModal();
});
for (const r of sizeRadios) {
  r.addEventListener("change", () => { $("new-w").value = r.value; $("new-h").value = r.value; });
}
$("new-w").addEventListener("input", syncPills);
$("new-h").addEventListener("input", syncPills);
$("dlg-cancel").addEventListener("click", () => dlg.close());

function wantedSize() {
  return { w: clampSize($("new-w").value), h: clampSize($("new-h").value) };
}
$("do-new").addEventListener("click", () => {
  const { w, h } = wantedSize();
  dlg.close();
  change(createDoc(w, h), { frame: 0, layer: 0 });
  state.cursor = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  say(`New ${w} × ${h} canvas. Undo brings the old one back.`);
});
$("do-resize").addEventListener("click", () => {
  const { w, h } = wantedSize();
  const tl = document.querySelector('input[name="anchor"]:checked')?.value === "tl";
  dlg.close();
  if (w === doc.w && h === doc.h) { return; }
  change(resizeDoc(doc, w, h, tl ? { x: 0, y: 0 } : { x: 0.5, y: 0.5 }));
  say(`Resized to ${w} × ${h}.`);
});

/* ============================================================
   13. EXPORT
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

function toBlob(c) {
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

/* Sizes, kept inside what browsers can make. */
function pngScale() { return fitScale(doc.w, doc.h, settings.scale); }
function sheetPlan() {
  const one = sheetLayout(doc.frames.length, doc.w, doc.h);
  const k = fitScale(one.width, one.height, settings.scale);
  return { k, layout: sheetLayout(doc.frames.length, doc.w, doc.h, { scale: k }) };
}
function gifScale() {
  /* GIFs are slow to make when huge: up to 1024 px a side, and
     about 12 million pixels over all the frames. */
  return fitScale(doc.w, doc.h, settings.scale, { maxSide: 1024, maxPixels: Math.floor(12_000_000 / doc.frames.length) });
}

function exportHint() {
  $("scale").value = String(settings.scale);
  $("scale-out").textContent = `${settings.scale}×`;
  const p = pngScale();
  const { k, layout } = sheetPlan();
  const g = gifScale();
  const notes = [`PNG ${doc.w * p} × ${doc.h * p}`, `sheet ${layout.width} × ${layout.height}`, `GIF ${doc.w * g} × ${doc.h * g}`];
  let text = notes.join(" · ");
  if (p < settings.scale || k < settings.scale || g < settings.scale) { text += ". Scaled down where it would be too big."; }
  $("scale-hint").textContent = text;
}
$("scale").addEventListener("input", () => {
  settings.scale = Number($("scale").value);
  exportHint();
  scheduleSave();
});

function frameCanvas(f, k) {
  ensureBuffers();
  const c = document.createElement("canvas");
  c.width = doc.w * k;
  c.height = doc.h * k;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(paintFrame(onion, f), 0, 0, c.width, c.height);
  return c;
}

$("export-png").addEventListener("click", async () => {
  const k = pngScale();
  const blob = await toBlob(frameCanvas(state.frame, k));
  if (!blob) { exportSay("This browser couldn't make a PNG."); return; }
  const name = `${NAME}-${doc.w}x${doc.h}${doc.frames.length > 1 ? `-frame${state.frame + 1}` : ""}@${k}x.png`;
  downloadBlob(blob, name);
  state.lastExport = { kind: "png", name, bytes: blob.size };
  exportSay(`Saved ${name}.`);
});

$("export-sheet").addEventListener("click", async () => {
  const { k, layout } = sheetPlan();
  const c = document.createElement("canvas");
  c.width = layout.width;
  c.height = layout.height;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  layout.rects.forEach((r, f) => g.drawImage(paintFrame(onion, f), r.x, r.y, r.w, r.h));
  const blob = await toBlob(c);
  if (!blob) { exportSay("This browser couldn't make the sheet. Try a smaller scale."); return; }
  downloadBlob(blob, `${NAME}-sheet.png`);
  state.lastExport = { kind: "sheet", name: `${NAME}-sheet.png`, bytes: blob.size, scale: k };
  exportSay(`Saved ${NAME}-sheet.png: ${layout.cols} × ${layout.rows} frames of ${doc.w * k} px. Grab the JSON too.`);
});

$("export-json").addEventListener("click", () => {
  const { k, layout } = sheetPlan();
  const json = sheetJson(layout, { image: `${NAME}-sheet.png`, fps: settings.fps, frameW: doc.w, frameH: doc.h, scale: k, name: NAME });
  downloadBlob(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }), `${NAME}-sheet.json`);
  state.lastExport = { kind: "json", name: `${NAME}-sheet.json` };
  exportSay(`Saved ${NAME}-sheet.json (${layout.rects.length} frame rects, ${settings.fps} fps).`);
});

/* ---- GIF: made in a worker (gif-worker.js) ---- */
let worker = null;
let gifBusy = false;
$("export-gif").addEventListener("click", () => {
  if (gifBusy) { return; }
  const k = gifScale();
  const frames = doc.frames.map((_, f) => composite(doc, f).buffer);
  try {
    worker = worker || new Worker(new URL("./gif-worker.js", import.meta.url), { type: "module" });
  } catch {
    exportSay("This browser can't make GIFs here (no module workers).");
    return;
  }
  gifBusy = true;
  $("export-gif").disabled = true;
  exportSay("Making the GIF…");
  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "progress") { exportSay(`Making the GIF… frame ${m.done} of ${m.total}`); return; }
    gifBusy = false;
    $("export-gif").disabled = false;
    if (m.type === "done") {
      const name = `${NAME}@${k}x.gif`;
      downloadBlob(new Blob([m.bytes], { type: "image/gif" }), name);
      state.lastExport = { kind: "gif", name, bytes: m.bytes.length };
      exportSay(`Saved ${name}: ${doc.frames.length} ${doc.frames.length === 1 ? "frame" : "frames"} at ${settings.fps} fps.`);
    } else {
      exportSay(m.message || "Couldn't make the GIF.");
    }
  };
  worker.onerror = () => {
    gifBusy = false;
    $("export-gif").disabled = false;
    exportSay("Couldn't make the GIF in this browser.");
    worker = null;
  };
  worker.postMessage({ width: doc.w, height: doc.h, scale: k, delay: 1000 / settings.fps, frames }, frames);
});

/* ============================================================
   SAVING (debounced)
   ============================================================ */
let saveTimer = 0;
let tooBigSaid = false;

function scheduleSave(delay = 600) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, delay);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  let project = null;
  try { project = encodeDoc(doc); } catch (err) {
    say(`${err.message} Your drawing is still here, but won't be kept.`);
    save.set({ settings: { ...settings } });
    return;
  }
  const bytes = JSON.stringify(project).length;
  state.saveBytes = bytes;
  if (bytes > SAVE_LIMIT) {
    /* keep the last save that fitted; just save the settings */
    save.set({ settings: { ...settings } });
    if (!tooBigSaid) {
      say(`This project is too big to keep on this device (${Math.round(bytes / 1000)} KB, the limit is ${SAVE_LIMIT / 1000} KB). Export it, or use fewer frames, layers or colours.`);
      tooBigSaid = true;
    }
    return;
  }
  tooBigSaid = false;
  save.set({ settings: { ...settings }, project });
  state.saves += 1;
}
/* Leaving the page: save anything still waiting. */
document.addEventListener("visibilitychange", () => { if (document.hidden && saveTimer) { saveNow(); } });
window.addEventListener("pagehide", () => { if (saveTimer) { saveNow(); } });

/* ============================================================
   14. START
   ============================================================ */
function loadFromSave() {
  const d = save.get();
  settings = normalizeSettings(d.settings);
  let loaded = null;
  if (d.project) {
    try { loaded = decodeDoc(d.project); } catch { say("The saved project couldn't be read, so here's a fresh one."); }
  }
  doc = loaded || starterDoc();
  if (stroke) { stroke = null; }
  anchor = null;
  history.clear();
  state.frame = 0;
  state.layer = doc.layers.length - 1;
  state.cursor = { x: Math.floor(doc.w / 2), y: Math.floor(doc.h / 2) };
  state.previewFrame = -1;
  checker = null;
  fillControls();
  refreshAll(true);
}

function fillControls() {
  toolUi();
  mirrorUi();
  renderPalette();
  $("fill-shape").checked = settings.rectFill;
  $("onion").checked = settings.onion;
  $("fps").value = String(settings.fps);
  $("fps-out").textContent = `${settings.fps} fps`;
  exportHint();
}

const r0 = stage.getBoundingClientRect();
view.sw = Math.max(1, Math.round(stage.clientWidth || r0.width));
view.sh = Math.max(1, Math.round(stage.clientHeight || r0.height));
loadFromSave();
playUi();
render();
window.addEventListener("resize", () => { renderStrip(); drawPreview(true); });
stage.dataset.ready = "true";
