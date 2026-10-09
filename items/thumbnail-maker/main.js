/* ============================================================
   Thumbnail Maker - main script

   One full-size canvas (1280 x 720, 1080 x 1920 or 1080 x 1080),
   shown shrunk to fit the screen by CSS. Layers on top of a
   background: your picture, big outlined text, stickers.
   Export draws the same thing again, without the editor bits.

   Sections:
     1. save       the layout (never your picture)
     2. state      layout, selection, the picture in memory
     3. drawing    redraw on the next frame, previews
     4. pointer    drag, two-finger size + tilt
     5. keys       nudge, size, tilt, order, delete
     6. layers     list + Forward / Back / Hide / Delete
     7. edit form  the selected layer's settings
     8. add        text, stickers, templates
     9. picture    file / drop / paste
    10. background, size, guides
    11. export     PNG / JPG
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import {
  SIZES, sizeOf, FONTS, STICKERS, MAX_LAYERS, clamp, wrapAngle, fitScale, coverScale, pinch,
  hitTest, moveItem, keepOnCanvas, resizeLayout, cleanLayout, newText, newSticker, newPhoto,
  layerName, sizeRange, sizeValue, scaleLayer
} from "./layout.js";
import { TEMPLATES } from "./templates.js";
import { render, boxOf, clearMeasures } from "./render.js";
import { drawSticker } from "./stickers.js";

bootItem();

const $ = (id) => document.getElementById(id);

/* ============================================================
   1. SAVE - the layout and the guide switch. Your picture is
   never stored: only where it sits (a "photo" layer).
   ============================================================ */
function templateLayout(t, size = "youtube") {
  const base = cleanLayout(structuredClone(t.layout));
  return size === base.size ? base : resizeLayout(base, size);
}

const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { layout: templateLayout(TEMPLATES[0]), guides: false },
  validate: (d) => (cleanLayout(d.layout) ? true : "That file doesn't hold a Thumbnail Maker layout.")
});

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save.set({ layout: state.layout, guides: state.guides }), 250);
}

/* ============================================================
   2. STATE
   ============================================================ */
const state = exposeForTests({
  layout: cleanLayout(save.get().layout) || templateLayout(TEMPLATES[0]),
  guides: save.get().guides === true,
  selected: -1,
  photo: null,          // ImageBitmap / <img> of your picture: memory only
  draws: 0,
  exported: null,
  /* for the smoke test: a fingerprint of the clean picture */
  hash: () => fingerprint(),
  /* a layer's centre in page (client) pixels */
  centreOf: (i) => {
    const l = state.layout.layers[i];
    const r = canvas.getBoundingClientRect();
    const { w: W, h: H } = sizeOf(state.layout.size);
    return { x: r.left + (l.x / W) * r.width, y: r.top + (l.y / H) * r.height };
  }
});

const layers = () => state.layout.layers;
const dims = () => sizeOf(state.layout.size);
const current = () => layers()[state.selected] || null;

/* Change one layer; redraw and save. */
function patch(i, change, { list = false } = {}) {
  const l = layers()[i];
  if (!l) { return; }
  layers()[i] = { ...l, ...change };
  if (list) { renderList(); } else { relabel(i); }
  changed();
}

function changed() {
  requestDraw();
  scheduleSave();
}

function select(i) {
  state.selected = i >= 0 && i < layers().length ? i : -1;
  renderList();
  fillEdit();
  requestDraw();
}

/* ============================================================
   3. DRAWING - at most once a frame
   ============================================================ */
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
let drawQueued = false;

function requestDraw() {
  if (drawQueued) { return; }
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

function draw() {
  const { w: W, h: H } = dims();
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
    $("frame").dataset.size = state.layout.size;
  }
  render(ctx, state.layout, { photo: state.photo, editor: { selected: state.selected, guides: state.guides } });
  state.draws += 1;
  const words = layers().filter((l) => l.kind === "text" && !l.hidden).map((l) => l.text.replace(/\n/g, " ")).join(" / ");
  canvas.setAttribute("aria-label", `Your thumbnail, ${W} × ${H}${words ? `: ${words}` : ""}. Drag a layer to move it.`);
}

/* The clean picture, as a fresh full-size canvas. */
function cleanCanvas() {
  const { w: W, h: H } = dims();
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  render(c.getContext("2d"), state.layout, { photo: state.photo });
  return c;
}

function fingerprint() {
  const c = cleanCanvas();
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 4 * 7) { h = Math.imul(h ^ (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16)), 16777619) >>> 0; }
  return h.toString(16);
}

/* ============================================================
   4. POINTER - drag to move; two fingers resize + tilt.
   Hit-testing uses each layer's rotated box.
   ============================================================ */
const pts = new Map();       // pointerId -> { x, y } in canvas pixels
let drag = null;             // { id, i, x0, y0, lx, ly }
let pinchState = null;       // { a, b, a0, b0, layer }

function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  const { w: W, h: H } = dims();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, k: W / r.width };
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) { return; }
  const p = toCanvas(e);
  pts.set(e.pointerId, p);
  try { canvas.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
  e.preventDefault();
  canvas.focus({ preventScroll: true });

  if (pts.size === 2 && current()) {
    const [a, b] = [...pts.keys()];
    pinchState = { a, b, a0: pts.get(a), b0: pts.get(b), layer: { ...current() } };
    drag = null;
    return;
  }
  if (pts.size > 1) { return; }
  /* fingers are fat: forgive ~10 screen pixels */
  const slop = (e.pointerType === "mouse" ? 2 : 10) * p.k;
  let i = hitTest(layers(), p.x, p.y, boxOf, slop);
  /* already-selected layer under the finger wins (e.g. text over a sticker edge) */
  const sel = current();
  if (sel && !sel.hidden && i !== state.selected && hitTest([sel], p.x, p.y, boxOf, slop) === 0) { i = state.selected; }
  if (i !== state.selected) { select(i); }
  if (i >= 0) {
    const l = layers()[i];
    drag = { id: e.pointerId, i, x0: p.x, y0: p.y, lx: l.x, ly: l.y, moved: false };
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!pts.has(e.pointerId)) { return; }
  const p = toCanvas(e);
  pts.set(e.pointerId, p);
  const { w: W, h: H } = dims();

  if (pinchState && pts.has(pinchState.a) && pts.has(pinchState.b)) {
    const g = pinch(pinchState.a0, pinchState.b0, pts.get(pinchState.a), pts.get(pinchState.b));
    const base = pinchState.layer;
    const next = scaleLayer(base, g.scale, W, H);
    next.rot = Math.round(wrapAngle(base.rot + g.turn));
    layers()[state.selected] = next;
    fillEdit();
    requestDraw();
    return;
  }
  if (drag && drag.id === e.pointerId) {
    const l = layers()[drag.i];
    if (!l) { return; }
    drag.moved = true;
    layers()[drag.i] = keepOnCanvas({ ...l, x: Math.round(drag.lx + p.x - drag.x0), y: Math.round(drag.ly + p.y - drag.y0) }, W, H);
    requestDraw();
  }
});

function pointerEnd(e) {
  if (!pts.has(e.pointerId)) { return; }
  pts.delete(e.pointerId);
  if (pinchState && (e.pointerId === pinchState.a || e.pointerId === pinchState.b)) {
    pinchState = null;
    scheduleSave();
  }
  if (drag && drag.id === e.pointerId) {
    if (drag.moved) { scheduleSave(); }
    drag = null;
  }
}
canvas.addEventListener("pointerup", pointerEnd);
canvas.addEventListener("pointercancel", pointerEnd);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/* ============================================================
   5. KEYS - on the canvas and in the layer list
   ============================================================ */
function onKey(e) {
  const l = current();
  const step = e.shiftKey ? 10 : 1;
  const { w: W, h: H } = dims();
  const nudge = (dx, dy) => patch(state.selected, keepOnCanvas({ ...l, x: l.x + dx, y: l.y + dy }, W, H));
  if (e.key === "Escape") { select(-1); e.preventDefault(); return; }
  if (!l) { return; }
  switch (e.key) {
    case "ArrowLeft": nudge(-step, 0); break;
    case "ArrowRight": nudge(step, 0); break;
    case "ArrowUp": nudge(0, -step); break;
    case "ArrowDown": nudge(0, step); break;
    case "+":
    case "=": patch(state.selected, scaleLayer(l, 1.05, W, H)); fillEdit(); break;
    case "-":
    case "_": patch(state.selected, scaleLayer(l, 1 / 1.05, W, H)); fillEdit(); break;
    case ",":
    case "<": patch(state.selected, { rot: wrapAngle(l.rot - (e.shiftKey ? 15 : 5)) }); fillEdit(); break;
    case ".":
    case ">": patch(state.selected, { rot: wrapAngle(l.rot + (e.shiftKey ? 15 : 5)) }); fillEdit(); break;
    case "]": reorder(1); break;
    case "[": reorder(-1); break;
    case "Delete":
    case "Backspace": removeLayer(); break;
    default: return;
  }
  e.preventDefault();
}
canvas.addEventListener("keydown", onKey);

/* ============================================================
   6. LAYERS - shown front first (the end of the array).
   ============================================================ */
const listEl = $("layers");

function renderList() {
  const items = [];
  for (let i = layers().length - 1; i >= 0; i--) {
    const l = layers()[i];
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tm-layer";
    b.dataset.i = String(i);
    b.setAttribute("aria-pressed", String(i === state.selected));
    const tag = document.createElement("span");
    tag.className = `tm-layer-kind tm-k-${l.kind}`;
    tag.textContent = l.kind === "photo" ? "Pic" : l.kind === "text" ? "Aa" : "★";
    tag.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "tm-layer-name";
    name.textContent = layerName(l) + (l.kind === "photo" && !state.photo ? " (not added)" : "");
    b.append(tag, name);
    if (l.hidden) {
      const h = document.createElement("span");
      h.className = "tm-layer-hidden";
      h.textContent = "hidden";
      b.append(h);
    }
    li.append(b);
    items.push(li);
  }
  listEl.replaceChildren(...items);
  $("layer-count").textContent = `${layers().length} / ${MAX_LAYERS}`;
  layerTools();
}

function relabel(i) {
  const name = listEl.querySelector(`.tm-layer[data-i="${i}"] .tm-layer-name`);
  const l = layers()[i];
  if (name && l) { name.textContent = layerName(l) + (l.kind === "photo" && !state.photo ? " (not added)" : ""); }
}

function layerTools() {
  const l = current();
  const i = state.selected;
  $("l-up").disabled = !l || i >= layers().length - 1;
  $("l-down").disabled = !l || i <= 0;
  $("l-hide").disabled = !l;
  $("l-delete").disabled = !l;
  $("l-hide").textContent = l && l.hidden ? "Show" : "Hide";
  $("l-hide").setAttribute("aria-pressed", String(Boolean(l && l.hidden)));
}

function focusRow(i) { listEl.querySelector(`.tm-layer[data-i="${i}"]`)?.focus(); }

function reorder(d) {
  const from = state.selected;
  const to = from + d;
  if (from < 0 || to < 0 || to >= layers().length) { return; }
  const inList = listEl.contains(document.activeElement);
  state.layout.layers = moveItem(layers(), from, to);
  state.selected = to;
  renderList();
  changed();
  if (inList) { focusRow(to); }
}

function removeLayer() {
  const i = state.selected;
  const l = current();
  if (!l) { return; }
  const inList = listEl.contains(document.activeElement);
  layers().splice(i, 1);
  if (l.kind === "photo") { dropPhoto(); }
  state.selected = -1;
  renderList();
  fillEdit();
  changed();
  $("layer-status").textContent = `${layerName(l)} deleted.`;
  if (inList) { (listEl.querySelector(".tm-layer") || $("add-text")).focus(); }
}

listEl.addEventListener("click", (e) => {
  const b = e.target.closest(".tm-layer");
  if (!b) { return; }
  const i = Number(b.dataset.i);
  select(i);
  focusRow(i);
});
listEl.addEventListener("keydown", (e) => {
  /* arrows in the list: move between rows; everything else as on the canvas */
  const b = e.target.closest(".tm-layer");
  if (b && (e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey) {
    const rows = [...listEl.querySelectorAll(".tm-layer")];
    const at = rows.indexOf(b) + (e.key === "ArrowUp" ? -1 : 1);
    rows[Math.max(0, Math.min(rows.length - 1, at))]?.focus();
    e.preventDefault();
    return;
  }
  if (e.key === "Escape") { return; }
  onKey(e);
});
$("l-up").addEventListener("click", () => reorder(1));
$("l-down").addEventListener("click", () => reorder(-1));
$("l-hide").addEventListener("click", () => {
  const l = current();
  if (l) { patch(state.selected, { hidden: !l.hidden }, { list: true }); }
});
$("l-delete").addEventListener("click", removeLayer);

/* ============================================================
   7. EDIT FORM - the selected layer
   ============================================================ */
const fonts = [...document.querySelectorAll('input[name="font"]')];

function fillEdit() {
  const l = current();
  $("edit-empty").hidden = Boolean(l);
  $("edit-fields").hidden = !l;
  $("edit-kind").textContent = l ? layerName(l) : "";
  layerTools();
  if (!l) { return; }
  $("ed-text").hidden = l.kind !== "text";
  $("ed-sticker").hidden = l.kind !== "sticker";
  $("ed-photo").hidden = l.kind !== "photo";
  if (l.kind === "text") {
    if ($("t-text").value !== l.text) { $("t-text").value = l.text; }
    for (const r of fonts) { r.checked = r.value === l.font; }
    $("t-fill").value = l.fill.toLowerCase();
    $("t-outline-color").value = l.outlineColor.toLowerCase();
    $("t-outline").value = String(Math.round(l.outline));
    $("t-outline-out").textContent = `${Math.round(l.outline)} px`;
  }
  if (l.kind === "sticker") { $("s-color").value = l.color.toLowerCase(); }
  const { w: W, h: H } = dims();
  const r = sizeRange(l.kind, W, H);
  const size = $("l-size");
  size.min = String(r.min);
  size.max = String(r.max);
  size.step = String(r.step);
  size.value = String(sizeValue(l));
  $("l-size-out").textContent = `${sizeValue(l)} ${r.unit}`;
  $("l-rot").value = String(Math.round(l.rot));
  $("l-rot-out").textContent = `${Math.round(l.rot)}°`;
  $("l-shadow").checked = l.shadow;
  $("l-glow").checked = l.glow;
  $("l-glow-color").value = l.glowColor.toLowerCase();
}

const edit = (change) => { if (current()) { patch(state.selected, change); } };
const upper = (v) => v.toUpperCase();

$("t-text").addEventListener("input", () => {
  edit({ text: $("t-text").value.replace(/\r/g, "").slice(0, 120) });
  $("edit-kind").textContent = layerName(current());
});
for (const r of fonts) { r.addEventListener("change", () => edit({ font: r.value })); }
$("t-fill").addEventListener("input", () => edit({ fill: upper($("t-fill").value) }));
$("t-outline-color").addEventListener("input", () => edit({ outlineColor: upper($("t-outline-color").value) }));
$("t-outline").addEventListener("input", () => {
  const v = Number($("t-outline").value);
  $("t-outline-out").textContent = `${v} px`;
  edit({ outline: v });
});
$("s-color").addEventListener("input", () => edit({ color: upper($("s-color").value) }));
$("l-size").addEventListener("input", () => {
  const l = current();
  if (!l) { return; }
  const v = Number($("l-size").value);
  const { w: W, h: H } = dims();
  const k = v / sizeValue(l);
  patch(state.selected, l.kind === "photo" ? { scale: v / 100 } : scaleLayer(l, k, W, H));
  $("l-size-out").textContent = `${v} ${sizeRange(l.kind, W, H).unit}`;
  if (l.kind === "text") { $("t-outline").value = String(Math.round(current().outline)); $("t-outline-out").textContent = `${Math.round(current().outline)} px`; }
});
$("l-rot").addEventListener("input", () => {
  const v = Number($("l-rot").value);
  $("l-rot-out").textContent = `${v}°`;
  edit({ rot: v });
});
$("l-shadow").addEventListener("change", () => edit({ shadow: $("l-shadow").checked }));
$("l-glow").addEventListener("change", () => edit({ glow: $("l-glow").checked }));
$("l-glow-color").addEventListener("input", () => edit({ glowColor: upper($("l-glow-color").value), glow: true }));
$("l-glow-color").addEventListener("change", fillEdit);

function photoTo(mode) {
  const l = current();
  if (!l || l.kind !== "photo") { return; }
  const { w: W, h: H } = dims();
  const scale = mode === "fit" ? fitScale(l.pw, l.ph, W, H) : coverScale(l.pw, l.ph, W, H);
  patch(state.selected, { scale, x: W / 2, y: H / 2, rot: 0 });
  fillEdit();
}
$("p-fit").addEventListener("click", () => photoTo("fit"));
$("p-cover").addEventListener("click", () => photoTo("cover"));

/* ============================================================
   8. ADD - text, stickers, templates
   ============================================================ */
function addLayer(layer) {
  if (layers().length >= MAX_LAYERS) { $("layer-status").textContent = `That's the most layers (${MAX_LAYERS}). Delete one first.`; return false; }
  layers().push(layer);
  select(layers().length - 1);
  changed();
  return true;
}

$("add-text").addEventListener("click", () => {
  const { w: W, h: H } = dims();
  if (addLayer(newText(W, H))) { $("t-text").focus(); $("t-text").select(); }
});

/* Sticker buttons, each with its own little drawing. */
const stickerBox = $("stickers");
for (const [shape, info] of Object.entries(STICKERS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tm-sticker";
  b.dataset.shape = shape;
  b.setAttribute("aria-label", `Add sticker: ${info.label}`);
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 96;
  c.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = info.label;
  b.append(c, label);
  b.addEventListener("click", () => {
    const { w: W, h: H } = dims();
    addLayer(newSticker(shape, W, H));
  });
  stickerBox.append(b);
}

function drawStickerIcons() {
  for (const c of stickerBox.querySelectorAll("canvas")) {
    const shape = c.parentElement.dataset.shape;
    const g = c.getContext("2d");
    const a = STICKERS[shape].aspect;
    const s = 80;
    const w = a >= 1 ? s : s * a;
    const h = a >= 1 ? s / a : s;
    g.clearRect(0, 0, 96, 96);
    g.save();
    g.translate(48, 48);
    drawSticker(g, shape, w, h, STICKERS[shape].color);
    g.restore();
  }
}

/* Template buttons, each with a live preview. */
const tplBox = $("templates");
let undoLayout = null;
for (const t of TEMPLATES) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tm-tpl";
  b.dataset.id = t.id;
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 180;
  c.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = t.name;
  b.append(c, label);
  b.addEventListener("click", () => useTemplate(t));
  tplBox.append(b);
}

function drawTemplatePreviews() {
  for (const b of tplBox.querySelectorAll(".tm-tpl")) {
    const t = TEMPLATES.find((x) => x.id === b.dataset.id);
    const c = b.querySelector("canvas");
    const g = c.getContext("2d");
    const k = c.width / 1280;
    g.save();
    g.setTransform(k, 0, 0, k, 0, 0);
    render(g, templateLayout(t), { fx: k });
    g.restore();
  }
}

function useTemplate(t) {
  undoLayout = structuredClone(state.layout);
  const next = templateLayout(t, state.layout.size);
  /* keep your picture (its spot too), at the bottom */
  const photo = layers().find((l) => l.kind === "photo");
  if (photo) { next.layers.unshift(photo); }
  state.layout = next;
  const firstText = next.layers.findIndex((l) => l.kind === "text");
  state.template = t.id;
  $("undo").hidden = false;
  select(firstText);
  changed();
  $("tpl-status").textContent = `${t.name} is on. Undo brings your last layout back.`;
}

$("undo").addEventListener("click", () => {
  if (!undoLayout) { return; }
  state.layout = undoLayout;
  undoLayout = null;
  $("undo").hidden = true;
  syncForms();
  select(-1);
  changed();
  $("tpl-status").textContent = "Back to your last layout.";
});

/* ============================================================
   9. YOUR PICTURE - in memory only
   ============================================================ */
function say(text) { $("status").textContent = text; }

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* try <img> */ }
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

function dropPhoto() {
  if (state.photo && state.photo.close) { state.photo.close(); }
  state.photo = null;
  $("drop-sub").textContent = "Drop a photo here, choose one, or paste it.";
  document.querySelector(".tm-pick").textContent = "Choose a picture";
}

async function loadFile(file) {
  if (!file) { return; }
  if (file.type && !/^image\//.test(file.type)) { say("That isn't a picture. Try a JPG, PNG or WebP."); return; }
  say("Opening…");
  let bmp;
  try { bmp = await decode(file); } catch {
    say("Couldn't open that one. It may be damaged, or a type browsers can't read.");
    return;
  }
  const pw = bmp.width || bmp.naturalWidth;
  const ph = bmp.height || bmp.naturalHeight;
  if (!pw || !ph) { say("That picture is empty."); return; }
  if (state.photo && state.photo.close && state.photo !== bmp) { state.photo.close(); }
  state.photo = bmp;
  const { w: W, h: H } = dims();
  const at = layers().findIndex((l) => l.kind === "photo");
  if (at >= 0) {
    /* a saved spot: keep it, and keep the same shown width */
    const old = layers()[at];
    const scale = old.pw === pw && old.ph === ph ? old.scale : clamp((old.pw * old.scale) / pw, 0.01, 4);
    layers()[at] = { ...old, pw, ph, scale, hidden: false };
    select(at);
  } else {
    if (layers().length >= MAX_LAYERS) { layers().shift(); }
    layers().unshift(newPhoto(pw, ph, W, H));
    select(0);
  }
  $("drop-sub").textContent = `${file.name || "Pasted picture"} · ${pw} × ${ph}`;
  document.querySelector(".tm-pick").textContent = "Choose another";
  say("");
  changed();
}

const picker = $("file");
picker.addEventListener("change", () => {
  loadFile(picker.files && picker.files[0]);
  picker.value = "";
});

const drop = $("drop");
const frame = $("frame");
let depth = 0;
const over = (on) => { drop.classList.toggle("is-over", on); frame.classList.toggle("is-over", on); };
window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; over(true); });
window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) { over(false); } });
window.addEventListener("dragover", (e) => { e.preventDefault(); });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  depth = 0;
  over(false);
  const file = [...(e.dataTransfer?.files || [])].find((f) => /^image\//.test(f.type)) || e.dataTransfer?.files?.[0];
  if (file) { loadFile(file); } else { say("That wasn't a picture file."); }
});
window.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => /^image\//.test(f.type));
  if (file) { e.preventDefault(); loadFile(file); }
});

/* ============================================================
   10. BACKGROUND, SIZE, GUIDES
   ============================================================ */
const sizes = [...document.querySelectorAll('input[name="size"]')];
const bgTypes = [...document.querySelectorAll('input[name="bg"]')];

function syncForms() {
  const L = state.layout;
  const { w: W, h: H } = dims();
  for (const r of sizes) { r.checked = r.value === L.size; }
  for (const r of bgTypes) { r.checked = r.value === L.bg.type; }
  $("size-label").textContent = `${W} × ${H}`;
  $("bg-c1").value = L.bg.c1.toLowerCase();
  $("bg-c2").value = L.bg.c2.toLowerCase();
  $("bg-angle").value = String(L.bg.angle);
  $("bg-angle-out").textContent = `${L.bg.angle}°`;
  const grad = L.bg.type === "gradient";
  $("bg-c2-row").hidden = !grad;
  $("bg-angle-row").hidden = !grad;
  $("bg-c1-label").textContent = grad ? "Colour 1" : "Colour";
  $("guides").checked = state.guides;
  $("guide-hint").textContent = state.guides
    ? (L.size === "youtube" ? "Red = covered by the video length." : L.size === "shorts" ? "Red = covered by the app's buttons and text." : "Square pictures have nothing covered.")
    : "";
  frame.dataset.size = L.size;
}

for (const r of sizes) {
  r.addEventListener("change", () => {
    if (!r.checked || r.value === state.layout.size) { return; }
    /* a picture that filled the old size fills the new one too */
    const old = dims();
    const covering = layers().map((l) => l.kind === "photo" && l.scale >= coverScale(l.pw, l.ph, old.w, old.h) - 1e-3);
    state.layout = resizeLayout(state.layout, r.value);
    const { w: W, h: H } = dims();
    layers().forEach((l, i) => {
      if (covering[i]) { layers()[i] = { ...l, scale: coverScale(l.pw, l.ph, W, H), x: W / 2, y: H / 2 }; }
    });
    syncForms();
    fillEdit();
    changed();
  });
}
for (const r of bgTypes) {
  r.addEventListener("change", () => { state.layout.bg.type = r.value; syncForms(); changed(); });
}
$("bg-c1").addEventListener("input", () => { state.layout.bg.c1 = upper($("bg-c1").value); changed(); });
$("bg-c2").addEventListener("input", () => { state.layout.bg.c2 = upper($("bg-c2").value); changed(); });
$("bg-angle").addEventListener("input", () => {
  state.layout.bg.angle = Number($("bg-angle").value);
  $("bg-angle-out").textContent = `${state.layout.bg.angle}°`;
  changed();
});
$("guides").addEventListener("change", () => { state.guides = $("guides").checked; syncForms(); changed(); });

/* ============================================================
   11. EXPORT - the same render, full size, no editor bits
   ============================================================ */
function download(type) {
  const c = cleanCanvas();
  const ext = type === "image/png" ? "png" : "jpg";
  const { w: W, h: H } = dims();
  const name = `thumbnail-${state.layout.size}-${W}x${H}.${ext}`;
  c.toBlob((blob) => {
    if (!blob) { $("export-note").textContent = "This browser couldn't make the file."; return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    state.exported = { type, name, bytes: blob.size, w: W, h: H };
    $("export-note").textContent = `${name} · ${Math.max(1, Math.round(blob.size / 1024))} KB`;
  }, type, 0.92);
}
$("png").addEventListener("click", () => download("image/png"));
$("jpg").addEventListener("click", () => download("image/jpeg"));

/* ============================================================
   START
   ============================================================ */
mountSavePanel($("save-panel"), save, {
  title: "Your layout",
  intro: "Your layout (sizes, words, stickers, colours) is saved on this device. Your picture is never stored: add it again next time.",
  exportLabel: "Export layout",
  importLabel: "Import layout",
  onImport: reload,
  onDelete: reload
});

function reload() {
  state.layout = cleanLayout(save.get().layout) || templateLayout(TEMPLATES[0]);
  state.guides = save.get().guides === true;
  if (!layers().some((l) => l.kind === "photo")) { dropPhoto(); }
  undoLayout = null;
  $("undo").hidden = true;
  syncForms();
  select(-1);
}

function drawAll() {
  clearMeasures();
  draw();
  drawStickerIcons();
  drawTemplatePreviews();
}

syncForms();
renderList();
fillEdit();
drawAll();

/* The kit fonts arrive a moment later; draw again with them. */
const want = Object.values(FONTS).map((f) => document.fonts.load(`${f.weight} 100px "${f.family}"`));
Promise.all(want).catch(() => {}).then(() => {
  drawAll();
  canvas.dataset.ready = "true";
});
