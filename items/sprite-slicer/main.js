/* ============================================================
   Sprite Sheet Slicer - main script

   Load a sheet -> cut it into frames -> pick and order them ->
   watch the animation -> download the frames or a JSON map.
   All in this tab: no upload, no server, no library.

   Sections:
     1. save       the settings (never the sheet)
     2. state      the sheet, its frames and your picks
     3. load       file -> pixels, with friendly errors
     4. slice      settings -> frames
     5. sheet      the zoomable sheet canvas + grid overlay
     6. preview    the animation + frame order strip
     7. export     .zip of PNGs, JSON map
     8. input      settings form, drop, paste
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { startLoop } from "../../kit/loop.js";
import { reducedMotion } from "../../kit/motion.js";
import { makeZip } from "./zip.js";
import {
  DEFAULTS, normalizeSettings, gridFrames, autoDetect, emptyTest, isEmptyRect,
  playOrder, frameAt, moveItem, baseName, frameName, phaserMap, godotMap, sizeProblem
} from "./slice.js";

bootItem();

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const PAL = {
  accent: color("--accent"),
  cyan: color("--cyan"),
  text: color("--text"),
  bg: color("--bg"),
  bg2: color("--bg-2"),
  surface: color("--surface"),
  surface2: color("--surface-2"),
  line: color("--line-bright"),
  faint: color("--text-faint")
};

/* ============================================================
   1. SAVE - settings only. The sheet is never stored.
   ============================================================ */
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { ...DEFAULTS },
  validate: (d) => {
    const n = normalizeSettings(d);
    return (n.mode === d.mode && n.cellW === d.cellW && n.fps === d.fps) || "That file doesn't hold Sprite Sheet Slicer settings.";
  }
});
mountSavePanel($("save-panel"), save, {
  title: "Your settings",
  intro: "Only your slice settings are saved, on this device. Your sprite sheets are never stored.",
  exportLabel: "Export settings",
  importLabel: "Import settings",
  onImport: () => { fillForm(); reslice(); },
  onDelete: () => { fillForm(); reslice(); }
});

/* ============================================================
   2. STATE
   ============================================================ */
const state = exposeForTests({
  settings: normalizeSettings(save.get()),
  file: null,        // the original File (kept in memory for the .zip)
  name: "",          // its file name
  width: 0,
  height: 0,
  frames: [],        // every cell / sprite found: { x, y, w, h }
  order: [],         // picked frame indexes, in play order
  chip: -1,          // position in order[] chosen for moving
  cursor: 0,         // keyboard cursor on the sheet (frame index)
  zoom: 1,           // the zoom actually used (fit or chosen)
  shown: -1,         // frame index the preview is showing
  steps: 0,          // how many times the preview changed frame
  playing: !reducedMotion(),
  grid: null,        // last gridFrames() result (cols, rows, left over)
  zipped: null
});

let sheet = null;    // a canvas holding the sheet
let pixels = null;   // its ImageData.data

/* ============================================================
   3. LOAD
   ============================================================ */
function say(text) { $("status").textContent = text; }

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

async function loadFile(file) {
  if (!file) { return; }
  if (!file.size) { say("That file is empty."); return; }
  if (file.type && !/^image\//.test(file.type)) { say("That isn't a picture. Choose a PNG sprite sheet."); return; }
  say("Opening…");

  let bmp;
  try { bmp = await decode(file); } catch {
    say("Couldn't open that one. It may be damaged, or a type browsers can't read.");
    return;
  }
  const w = bmp.width || bmp.naturalWidth;
  const h = bmp.height || bmp.naturalHeight;
  const problem = sizeProblem(w, h);
  if (problem) { if (bmp.close) { bmp.close(); } say(problem); return; }

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  if (bmp.close) { bmp.close(); }
  let data;
  try { data = ctx.getImageData(0, 0, w, h).data; } catch {
    say("This browser ran out of room reading that sheet. Try a smaller one.");
    return;
  }

  sheet = c;
  pixels = data;
  Object.assign(state, { file, name: file.name || "sheet.png", width: w, height: h, cursor: 0, chip: -1 });
  $("prefix").value = baseName(state.name);
  $("drop").classList.add("is-loaded");
  $("drop-title").textContent = "Sheet loaded";
  $("drop-sub").textContent = `${state.name} · ${w} × ${h} px`;
  document.querySelector(".ss-pick").textContent = "Choose another";
  for (const id of ["sheet-card", "preview-card", "export-card"]) { $(id).hidden = false; }
  const jpeg = /jpe?g$/i.test(file.type || state.name);
  say(jpeg ? "JPEG has no see-through parts, so empty means “the corner colour”." : "");
  reslice();
}

/* A made-up sheet: 8 frames of a bouncing, squashing ball. */
function sampleSheet() {
  const cell = 32;
  const c = document.createElement("canvas");
  c.width = cell * 4;
  c.height = cell * 2;
  const ctx = c.getContext("2d");
  for (let i = 0; i < 8; i++) {
    const ox = (i % 4) * cell;
    const oy = Math.floor(i / 4) * cell;
    const t = i / 8;
    const lift = Math.abs(Math.sin(t * Math.PI)) * 14;
    const squash = i === 0 ? 0.7 : 1;
    const r = 7;
    const cx = ox + cell / 2;
    const cy = oy + cell - 5 - r * squash - lift;
    ctx.fillStyle = PAL.accent;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r / squash, r * squash, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.text;
    ctx.fillRect(Math.round(cx - 3), Math.round(cy - 3), 2, 2);              // shine
  }
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

$("sample").addEventListener("click", async () => {
  const blob = await sampleSheet();
  if (!blob) { say("Couldn't make the sample in this browser."); return; }
  const s = normalizeSettings({ ...save.get(), mode: "size", cellW: 32, cellH: 32, margin: 0, spacing: 0 });
  save.set(s);
  fillForm();
  loadFile(new File([blob], "bouncing-ball.png", { type: "image/png" }));
});

/* ============================================================
   4. SLICE
   ============================================================ */
function reslice() {
  state.settings = normalizeSettings(save.get());
  modeUi();
  if (!sheet) { return; }
  const s = state.settings;
  const note = $("grid-note");
  let frames = [];
  state.grid = null;

  if (s.mode === "auto") {
    frames = autoDetect(pixels, state.width, state.height);
    note.textContent = frames.length
      ? ""
      : "Couldn't find any gaps. Auto needs a see-through (or flat colour) background between sprites.";
  } else {
    const g = gridFrames(state.width, state.height, s);
    state.grid = g;
    note.textContent = g.error;
    frames = g.frames;
    if (s.skipEmpty && frames.length) {
      const empty = emptyTest(pixels);
      frames = frames.filter((f) => !isEmptyRect(pixels, state.width, f, empty));
    }
    if (!g.error) {
      const left = [];
      if (g.leftX > 0) { left.push(`${g.leftX} px on the right`); }
      if (g.leftY > 0) { left.push(`${g.leftY} px at the bottom`); }
      if (left.length) { note.textContent = `Left over: ${left.join(", ")}. Check the cell size, margin and spacing.`; }
      if (!frames.length && g.frames.length) { note.textContent = "Every cell is empty. Try other settings, or untick “Leave out empty cells”."; }
    }
  }

  state.frames = frames;
  state.order = frames.map((_, i) => i);   // a new cut picks every frame
  state.chip = -1;
  state.cursor = Math.min(state.cursor, Math.max(0, frames.length - 1));
  restart();
  drawSheet();
  renderOrder();
  counts();
}

function counts() {
  const g = state.grid;
  const s = state.settings;
  let text = `${state.frames.length} ${state.frames.length === 1 ? "frame" : "frames"}`;
  if (g && !g.error) { text += ` · ${g.cols} × ${g.rows}`; }
  if (g && !g.error && s.mode === "count") { text += ` · ${g.cellW}×${g.cellH} px`; }
  $("count").textContent = text;
  const picked = state.order.length;
  $("zip").disabled = !picked;
  $("json").disabled = !picked;
  $("pick-none").disabled = !picked;
  $("pick-all").disabled = !state.frames.length || picked === state.frames.length;
}

/* ============================================================
   5. SHEET CANVAS
   Drawn at a whole-number zoom with smoothing off, so pixels
   stay sharp squares. Too big for the box? It shrinks to fit.
   ============================================================ */
const sheetCanvas = $("sheet");
const sctx = sheetCanvas.getContext("2d");
const view = $("view");

function fitZoom() {
  const room = Math.max(80, view.clientWidth - 2);
  const z = room / state.width;
  return z >= 1 ? Math.min(16, Math.floor(z)) : z;
}

function drawSheet() {
  if (!sheet) { return; }
  const z = state.settings.zoom || fitZoom();
  state.zoom = z;
  $("zoom-label").textContent = state.settings.zoom ? `${z}×` : z >= 1 ? `Fit ${z}×` : "Fit";
  $("zoom-out").disabled = state.settings.zoom === 0 && z <= 1;   // already as small as Fit gets
  $("zoom-in").disabled = z >= 16;

  const cw = Math.max(1, Math.round(state.width * z));
  const ch = Math.max(1, Math.round(state.height * z));
  /* Backing pixels: sharper on retina, but capped for memory. */
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  while (dpr > 1 && cw * ch * dpr * dpr > 16_000_000) { dpr -= 0.5; }
  const k = z * dpr;
  sheetCanvas.width = Math.max(1, Math.round(state.width * k));
  sheetCanvas.height = Math.max(1, Math.round(state.height * k));
  sheetCanvas.classList.toggle("is-shrunk", z < 1);
  sheetCanvas.dataset.w = String(cw);
  sheetCanvas.dataset.h = String(ch);
  sizeSheet(cw, ch);

  const ctx = sctx;
  ctx.imageSmoothingEnabled = z < 1;
  checker(ctx, sheetCanvas.width, sheetCanvas.height, Math.max(8, Math.round(8 * dpr)));
  ctx.drawImage(sheet, 0, 0, sheetCanvas.width, sheetCanvas.height);

  /* every frame: a thin outline */
  const px = (v) => Math.round(v * k);
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeStyle = PAL.cyan;
  ctx.globalAlpha = 0.55;
  for (const f of state.frames) {
    ctx.strokeRect(px(f.x) + 0.5, px(f.y) + 0.5, px(f.x + f.w) - px(f.x) - 1, px(f.y + f.h) - px(f.y) - 1);
  }
  ctx.globalAlpha = 1;

  /* picked frames: accent wash + border + their order number */
  const pos = new Map(state.order.map((fi, i) => [fi, i]));
  const font = Math.round(11 * dpr);
  ctx.font = `700 ${font}px 'JetBrains Mono', monospace`;
  ctx.textBaseline = "top";
  for (const [fi, i] of pos) {
    const f = state.frames[fi];
    const x = px(f.x);
    const y = px(f.y);
    const w = px(f.x + f.w) - x;
    const h = px(f.y + f.h) - y;
    ctx.fillStyle = PAL.accent;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PAL.accent;
    ctx.lineWidth = Math.max(2, 2 * dpr);
    ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    if (w >= font * 2.2 && h >= font * 1.6) {
      const label = String(i + 1);
      const tw = ctx.measureText(label).width + 6 * dpr;
      ctx.fillStyle = PAL.accent;
      ctx.fillRect(x, y, tw, font + 4 * dpr);
      ctx.fillStyle = PAL.bg;
      ctx.fillText(label, x + 3 * dpr, y + 2 * dpr);
    }
  }

  /* keyboard cursor, only while the canvas has focus */
  const f = state.frames[state.cursor];
  if (f && document.activeElement === sheetCanvas) {
    ctx.strokeStyle = PAL.text;
    ctx.lineWidth = Math.max(2, 2 * dpr);
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeRect(px(f.x) - 1, px(f.y) - 1, px(f.x + f.w) - px(f.x) + 2, px(f.y + f.h) - px(f.y) + 2);
    ctx.setLineDash([]);
  }
}

/* CSS size. style="" in the HTML is blocked by the privacy lock;
   setting it through the CSSOM is allowed (palette-lab does too). */
function sizeSheet(w, h) {
  sheetCanvas.style.width = `${w}px`;
  sheetCanvas.style.height = `${h}px`;
}

/* A see-through checkerboard, in the page's own colours. */
function checker(ctx, w, h, size) {
  ctx.fillStyle = PAL.bg2;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PAL.surface2;
  for (let y = 0; y < h; y += size) {
    for (let x = (y / size) % 2 ? size : 0; x < w; x += size * 2) { ctx.fillRect(x, y, size, size); }
  }
}

/* Which frame is under this point (canvas CSS pixels)? */
function frameAtPoint(cx, cy) {
  const x = cx / state.zoom;
  const y = cy / state.zoom;
  return state.frames.findIndex((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
}

function togglePick(fi) {
  if (fi < 0) { return; }
  const at = state.order.indexOf(fi);
  if (at >= 0) { state.order.splice(at, 1); } else { state.order.push(fi); }
  state.cursor = fi;
  state.chip = -1;
  restart();
  drawSheet();
  renderOrder();
  counts();
}

sheetCanvas.addEventListener("click", (e) => {
  const r = sheetCanvas.getBoundingClientRect();
  togglePick(frameAtPoint(e.clientX - r.left, e.clientY - r.top));
});

/* Arrow keys: left/right step through frames, up/down jump to the
   nearest frame above or below. Works for grids and Auto alike. */
function nearest(dir) {
  const cur = state.frames[state.cursor];
  if (!cur) { return 0; }
  const cx = cur.x + cur.w / 2;
  const cy = cur.y + cur.h / 2;
  let best = state.cursor;
  let bestD = Infinity;
  state.frames.forEach((f, i) => {
    const fy = f.y + f.h / 2;
    if (dir < 0 ? fy >= cy - 0.5 : fy <= cy + 0.5) { return; }
    const d = Math.abs(fy - cy) * 4 + Math.abs(f.x + f.w / 2 - cx);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

sheetCanvas.addEventListener("keydown", (e) => {
  const n = state.frames.length;
  let handled = true;
  switch (e.key) {
    case "ArrowRight": state.cursor = Math.min(n - 1, state.cursor + 1); break;
    case "ArrowLeft": state.cursor = Math.max(0, state.cursor - 1); break;
    case "ArrowDown": state.cursor = nearest(1); break;
    case "ArrowUp": state.cursor = nearest(-1); break;
    case " ":
    case "Enter": togglePick(state.cursor); break;
    case "+":
    case "=": zoomBy(1); break;
    case "-":
    case "_": zoomBy(-1); break;
    case "0": setZoom(0); break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); drawSheet(); scrollToCursor(); }
});
sheetCanvas.addEventListener("focus", drawSheet);
sheetCanvas.addEventListener("blur", drawSheet);

function scrollToCursor() {
  const f = state.frames[state.cursor];
  if (!f) { return; }
  const x = f.x * state.zoom;
  const y = f.y * state.zoom;
  if (x < view.scrollLeft || x + f.w * state.zoom > view.scrollLeft + view.clientWidth) { view.scrollLeft = x - 16; }
  if (y < view.scrollTop || y + f.h * state.zoom > view.scrollTop + view.clientHeight) { view.scrollTop = y - 16; }
}

function setZoom(z) {
  save.set({ zoom: z });
  state.settings = normalizeSettings(save.get());
  drawSheet();
}
function zoomBy(d) {
  const cur = state.settings.zoom || Math.max(1, Math.floor(state.zoom));
  if (d < 0 && cur <= 1) { setZoom(0); return; }
  setZoom(Math.min(16, Math.max(1, cur + d)));
}
$("zoom-in").addEventListener("click", () => zoomBy(1));
$("zoom-out").addEventListener("click", () => zoomBy(-1));
$("zoom-fit").addEventListener("click", () => setZoom(0));
$("pick-all").addEventListener("click", () => { state.order = state.frames.map((_, i) => i); state.chip = -1; restart(); drawSheet(); renderOrder(); counts(); });
$("pick-none").addEventListener("click", () => { state.order = []; state.chip = -1; restart(); drawSheet(); renderOrder(); counts(); });

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { drawSheet(); drawPreview(); }, 100);
});

/* ============================================================
   6. PREVIEW + ORDER
   ============================================================ */
const anim = $("anim");
const actx = anim.getContext("2d");
let t = 0;

function restart() {
  t = 0;
  state.shown = -1;
}

function currentFrame() {
  const order = playOrder(state.order.length, state.settings.pingpong);
  const pos = frameAt(order, t, state.settings.fps);
  return pos < 0 ? -1 : state.order[pos];
}

function drawPreview() {
  if (!sheet || $("preview-card").hidden) { return; }
  const box = anim.parentElement;
  const size = Math.max(120, Math.round(box.clientWidth));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const want = Math.round(size * dpr);
  if (anim.width !== want) { anim.width = want; anim.height = want; }
  const W = anim.width;
  checker(actx, W, W, Math.round(12 * dpr));

  const fi = currentFrame();
  const f = state.frames[fi];
  if (fi !== state.shown) { state.steps += 1; state.shown = fi; }
  if (!f) {
    actx.fillStyle = PAL.faint;
    actx.font = `600 ${Math.round(14 * dpr)}px 'Inter', sans-serif`;
    actx.textAlign = "center";
    actx.fillText("Pick some frames", W / 2, W / 2);
    actx.textAlign = "start";
    $("frame-label").textContent = "";
    return;
  }
  /* Scale every frame by the same amount (from the biggest
     picked frame) so sprites don't jump in size. Whole numbers
     when it can, so pixels stay crisp. */
  let mw = 1;
  let mh = 1;
  for (const i of state.order) { mw = Math.max(mw, state.frames[i].w); mh = Math.max(mh, state.frames[i].h); }
  const room = W * 0.86;
  let k = Math.min(room / mw, room / mh);
  if (k >= 1) { k = Math.floor(k); }
  const dw = f.w * k;
  const dh = f.h * k;
  const x = Math.round((W - dw) / 2);
  const y = Math.round((W + mh * k) / 2 - dh);          // feet on one line
  actx.imageSmoothingEnabled = k < 1;
  actx.drawImage(sheet, f.x, f.y, f.w, f.h, x, y, Math.round(dw), Math.round(dh));
  $("frame-label").textContent = `frame ${state.order.indexOf(fi) + 1} of ${state.order.length}`;
}

const loop = startLoop({
  update(dt) { t += dt; },
  draw: drawPreview,
  startPaused: !state.playing
});

function playUi() {
  const btn = $("play");
  btn.textContent = state.playing ? "Pause" : "Play";
  btn.setAttribute("aria-pressed", String(state.playing));
}
$("play").addEventListener("click", () => {
  state.playing = !state.playing;
  if (state.playing) { loop.resume(); } else { loop.pause(); }
  playUi();
});

/* The strip of picked frames, each a little thumbnail button. */
const orderEl = $("order");
function renderOrder() {
  $("order-empty").hidden = state.order.length > 0;
  const items = state.order.map((fi, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ss-chip";
    b.dataset.pos = String(i);
    b.setAttribute("aria-pressed", String(state.chip === i));
    b.setAttribute("aria-label", `Frame ${i + 1} (cell ${fi + 1})`);
    const c = document.createElement("canvas");
    c.width = c.height = 40;
    c.setAttribute("aria-hidden", "true");
    thumb(c, state.frames[fi]);
    const n = document.createElement("span");
    n.textContent = String(i + 1);
    b.append(c, n);
    li.append(b);
    return li;
  });
  orderEl.replaceChildren(...items);
  orderTools();
}

function thumb(c, f) {
  const g = c.getContext("2d");
  checker(g, 40, 40, 5);
  const k = Math.min(36 / f.w, 36 / f.h);
  const kk = k >= 1 ? Math.floor(k) : k;
  g.imageSmoothingEnabled = kk < 1;
  const w = f.w * kk;
  const h = f.h * kk;
  g.drawImage(sheet, f.x, f.y, f.w, f.h, Math.round((40 - w) / 2), Math.round((40 - h) / 2), Math.round(w), Math.round(h));
}

function orderTools() {
  const has = state.chip >= 0 && state.chip < state.order.length;
  $("move-left").disabled = !has || state.chip === 0;
  $("move-right").disabled = !has || state.chip === state.order.length - 1;
  $("remove").disabled = !has;
  $("reverse").disabled = state.order.length < 2;
}

function chooseChip(i, focus = false) {
  state.chip = i;
  for (const b of orderEl.querySelectorAll(".ss-chip")) { b.setAttribute("aria-pressed", String(Number(b.dataset.pos) === i)); }
  orderTools();
  if (focus) { orderEl.querySelector(`.ss-chip[data-pos="${i}"]`)?.focus(); }
}

function moveChip(d) {
  const from = state.chip;
  const to = from + d;
  if (from < 0 || to < 0 || to >= state.order.length) { return; }
  state.order = moveItem(state.order, from, to);
  state.chip = to;
  restart();
  renderOrder();
  drawSheet();
  orderEl.querySelector(`.ss-chip[data-pos="${to}"]`)?.focus();
}

function removeChip() {
  if (state.chip < 0) { return; }
  state.order.splice(state.chip, 1);
  const next = Math.min(state.chip, state.order.length - 1);
  state.chip = next;
  restart();
  renderOrder();
  drawSheet();
  counts();
  if (next >= 0) { orderEl.querySelector(`.ss-chip[data-pos="${next}"]`)?.focus(); } else { $("pick-all").focus(); }
}

orderEl.addEventListener("click", (e) => {
  const b = e.target.closest(".ss-chip");
  if (!b) { return; }
  const i = Number(b.dataset.pos);
  chooseChip(state.chip === i ? -1 : i);
});
orderEl.addEventListener("keydown", (e) => {
  const b = e.target.closest(".ss-chip");
  if (!b) { return; }
  const i = Number(b.dataset.pos);
  if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    state.chip = i;
    moveChip(e.key === "ArrowLeft" ? -1 : 1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const j = Math.max(0, Math.min(state.order.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)));
    orderEl.querySelector(`.ss-chip[data-pos="${j}"]`)?.focus();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    state.chip = i;
    removeChip();
  } else {
    return;
  }
  e.preventDefault();
});
$("move-left").addEventListener("click", () => moveChip(-1));
$("move-right").addEventListener("click", () => moveChip(1));
$("remove").addEventListener("click", removeChip);
$("reverse").addEventListener("click", () => {
  state.order.reverse();
  state.chip = -1;
  restart();
  renderOrder();
  drawSheet();
});

/* ============================================================
   7. EXPORT - blob URLs, freed straight after
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

function prefix() { return baseName($("prefix").value || state.name); }

function pickedFrames() { return state.order.map((i) => state.frames[i]); }

function mapText() {
  const opts = {
    image: state.name,
    width: state.width,
    height: state.height,
    prefix: prefix(),
    fps: state.settings.fps,
    pingpong: state.settings.pingpong
  };
  const map = state.settings.mapFormat === "godot" ? godotMap(pickedFrames(), opts) : phaserMap(pickedFrames(), opts);
  return JSON.stringify(map, null, 2);
}

function frameBlob(f) {
  const c = document.createElement("canvas");
  c.width = f.w;
  c.height = f.h;
  c.getContext("2d").drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

$("zip").addEventListener("click", async () => {
  const frames = pickedFrames();
  if (!frames.length) { return; }
  const btn = $("zip");
  btn.disabled = true;
  say("Making the zip…");
  try {
    const p = prefix();
    const entries = [];
    for (let i = 0; i < frames.length; i++) {
      const blob = await frameBlob(frames[i]);
      if (!blob) { throw new Error("This browser couldn't make a PNG. Try fewer frames."); }
      entries.push({ name: `frames/${frameName(p, i, frames.length)}`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    entries.push({ name: `${p}.json`, data: new TextEncoder().encode(mapText()) });
    entries.push({ name: state.name, data: new Uint8Array(await state.file.arrayBuffer()) });
    const zip = makeZip(entries);
    downloadBlob(new Blob([zip], { type: "application/zip" }), `${p}-frames.zip`);
    state.zipped = { files: entries.length, bytes: zip.length };
    say(`Zip ready: ${frames.length} ${frames.length === 1 ? "frame" : "frames"} + the map.`);
  } catch (err) {
    say(err.message || "Couldn't make the zip.");
  } finally {
    btn.disabled = !state.order.length;
  }
});

$("json").addEventListener("click", () => {
  if (!state.order.length) { return; }
  downloadBlob(new Blob([mapText()], { type: "application/json" }), `${prefix()}.json`);
  say("JSON map downloaded.");
});

/* ============================================================
   8. INPUT
   ============================================================ */
const picker = $("file");
picker.addEventListener("change", () => {
  loadFile(picker.files && picker.files[0]);
  picker.value = "";      // so choosing the same file again still works
});

const drop = $("drop");
let depth = 0;
drop.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; drop.classList.add("is-over"); });
drop.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) { drop.classList.remove("is-over"); } });
window.addEventListener("dragover", (e) => { e.preventDefault(); });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  depth = 0;
  drop.classList.remove("is-over");
  const file = e.dataTransfer?.files?.[0];
  if (file) { loadFile(file); } else { say("That wasn't a file. Drop a PNG from your computer."); }
});
window.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => /^image\//.test(f.type));
  if (file) { e.preventDefault(); loadFile(file); }
});

/* ---- the settings form ---- */
const num = {
  cellW: $("cell-w"), cellH: $("cell-h"), cols: $("cols"), rows: $("rows"), margin: $("margin"), spacing: $("spacing")
};
const modes = [...document.querySelectorAll('input[name="mode"]')];
const maps = [...document.querySelectorAll('input[name="map"]')];

function fillForm() {
  const s = normalizeSettings(save.get());
  for (const [k, input] of Object.entries(num)) { input.value = String(s[k]); }
  for (const r of modes) { r.checked = r.value === s.mode; }
  for (const r of maps) { r.checked = r.value === s.mapFormat; }
  $("skip-empty").checked = s.skipEmpty;
  $("pingpong").checked = s.pingpong;
  $("fps").value = String(s.fps);
  $("fps-out").textContent = `${s.fps} fps`;
  state.settings = s;
  modeUi();
}

function modeUi() {
  const m = state.settings.mode;
  $("by-size").hidden = m !== "size";
  $("by-count").hidden = m !== "count";
  $("gaps").hidden = m === "auto";
  $("skip-row").hidden = m === "auto";
  $("mode-hint").textContent = m === "auto"
    ? "Finds each sprite by the empty space round it. Best for sheets with uneven sprites."
    : "Pixels. Margin is the border round the sheet; spacing is the gap between cells.";
  $("map-hint").textContent = state.settings.mapFormat === "godot"
    ? "Regions as [x, y, w, h], plus the speed. Build SpriteFrames from it in a script."
    : "Phaser 3 atlas (JSON Hash): this.load.atlas(key, sheet, map).";
}

/* Typing "12" fires twice ("1", then "12"): wait a beat. */
let sliceTimer = 0;
function readForm(now = false) {
  const patch = {};
  for (const [k, input] of Object.entries(num)) {
    if (input.value !== "" && Number.isFinite(Number(input.value))) { patch[k] = Number(input.value); }
  }
  const mode = modes.find((r) => r.checked);
  const map = maps.find((r) => r.checked);
  save.set(normalizeSettings({
    ...save.get(),
    ...patch,
    mode: mode ? mode.value : DEFAULTS.mode,
    mapFormat: map ? map.value : DEFAULTS.mapFormat,
    skipEmpty: $("skip-empty").checked
  }));
  state.settings = normalizeSettings(save.get());
  modeUi();
  clearTimeout(sliceTimer);
  if (now) { reslice(); } else { sliceTimer = setTimeout(reslice, 250); }
}

for (const input of Object.values(num)) {
  input.addEventListener("input", () => readForm());
  input.addEventListener("change", () => { fillForm(); readForm(true); });
}
for (const r of modes) { r.addEventListener("change", () => readForm(true)); }
for (const r of maps) { r.addEventListener("change", () => readForm(true)); }
$("skip-empty").addEventListener("change", () => readForm(true));

$("fps").addEventListener("input", () => {
  const fps = Number($("fps").value);
  $("fps-out").textContent = `${fps} fps`;
  save.set({ fps });
  state.settings = normalizeSettings(save.get());
});
$("pingpong").addEventListener("change", () => {
  save.set({ pingpong: $("pingpong").checked });
  state.settings = normalizeSettings(save.get());
  restart();
});

fillForm();
playUi();
drop.dataset.ready = "true";
