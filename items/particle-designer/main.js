/* ============================================================
   Particle Designer - main script

   The particles live in particles.js (pure, unit tested). This
   file is the page: the live preview, presets, sliders, the
   colour stops, saving, and the exports (JSON, Godot scene,
   sprite sheet, GIF). Everything happens in this tab: nothing
   is uploaded, nothing is fetched.

   Sections:
     1. save          the effect, emitter spot, background, sheet options
     2. state
     3. preview       the canvas, the loop, moving the emitter
     4. controls      presets, sliders, shape, blend, colours
     5. export        JSON, import, Godot, sprite sheet, GIF
     6. keys + start
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createCanvas } from "../../kit/canvas.js";
import { startLoop } from "../../kit/loop.js";
import { pointer, createKeys } from "../../kit/input.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { reducedMotion, onMotionChange } from "../../kit/motion.js";
import {
  RANGES, MAX_STOPS, PRESETS, PRESET_KEYS, preset, normalize, parseHex, toHex, colorAt, cssGradient,
  createSystem, drawParticles, simulateFrames, fitBox, sheetGrid, jsonText, fromJsonText, toGodot, fileBase
} from "./particles.js";

bootItem();

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const SIZES = [64, 128, 256];
const SHEET_DEFAULTS = { size: 128, frames: 24, fps: 24, transparent: true };
const DEFAULT_BG = "#0b0c13";

/* ============================================================
   1. SAVE
   ============================================================ */
function normalizeSheet(o = {}) {
  const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), lo, hi) : d);
  return {
    size: SIZES.includes(Number(o.size)) ? Number(o.size) : SHEET_DEFAULTS.size,
    frames: n(o.frames, 4, 48, SHEET_DEFAULTS.frames),
    fps: n(o.fps, 6, 30, SHEET_DEFAULTS.fps),
    transparent: o.transparent === undefined ? SHEET_DEFAULTS.transparent : Boolean(o.transparent)
  };
}
const normalizeAt = (a) => (Array.isArray(a) && a.length === 2 && a.every((v) => Number.isFinite(Number(v)))
  ? a.map((v) => clamp(Number(v), 0, 1)) : [...PRESETS.fire.at]);
const normalizeBg = (v) => (parseHex(v) ? toHex(parseHex(v)) : DEFAULT_BG);

const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { effect: preset("fire"), at: [...PRESETS.fire.at], bg: DEFAULT_BG, sheet: { ...SHEET_DEFAULTS } },
  validate: (d) => (d.effect && typeof d.effect === "object" && !Array.isArray(d.effect)) || "That file doesn't hold a particle effect."
});
mountSavePanel($("save-panel"), save, {
  title: "Your effect",
  intro: "The effect you're working on is saved on this device only. Export the save to back it up, or use Export JSON for your game.",
  onImport: () => loadFromSave(),
  onDelete: () => loadFromSave()
});

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  save.set({ effect: state.settings, at: state.at, bg: state.bg, sheet: state.sheet });
  state.saves++;
}
document.addEventListener("visibilitychange", () => { if (document.hidden && saveTimer) { saveNow(); } });
window.addEventListener("pagehide", () => { if (saveTimer) { saveNow(); } });

/* ============================================================
   2. STATE - window.__item for smoke.js
   ============================================================ */
const saved = save.get();
const state = exposeForTests({
  settings: normalize(saved.effect),
  at: normalizeAt(saved.at),          // emitter spot, 0-1 of the preview
  bg: normalizeBg(saved.bg),
  sheet: normalizeSheet(saved.sheet),
  preset: null,
  particles: 0,                       // alive right now
  emitted: 0,
  frames: 0,                          // preview frames drawn
  saves: 0,
  lastExport: null
});

let calm = reducedMotion();

/* ============================================================
   3. PREVIEW
   ============================================================ */
const stage = $("stage");
const view = createCanvas(stage, { onResize: () => { placeEmitter(); draw(); } });
const sys = createSystem(state.settings, { seed: (Math.random() * 2 ** 31) >>> 0 });

function placeEmitter() {
  sys.x = state.at[0] * view.width;
  sys.y = state.at[1] * view.height;
}

function draw() {
  const ctx = view.ctx;
  const w = view.width;
  const h = view.height;
  ctx.fillStyle = state.bg;
  ctx.fillRect(0, 0, w, h);
  drawParticles(ctx, sys);

  /* The emitter: a ring, and the emit box if it has one. */
  const s = state.settings;
  const [r, g, b] = parseHex(state.bg);
  const light = r * 0.3 + g * 0.59 + b * 0.11 > 140;
  ctx.save();
  ctx.strokeStyle = light ? "rgba(7, 7, 12, .55)" : "rgba(236, 238, 246, .55)";
  ctx.lineWidth = 1.5;
  if (s.areaWidth > 0 || s.areaHeight > 0) {
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(sys.x - s.areaWidth / 2, sys.y - s.areaHeight / 2, Math.max(1, s.areaWidth), Math.max(1, s.areaHeight));
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.arc(sys.x, sys.y, 9, 0, Math.PI * 2);
  ctx.moveTo(sys.x - 14, sys.y);
  ctx.lineTo(sys.x + 14, sys.y);
  ctx.moveTo(sys.x, sys.y - 14);
  ctx.lineTo(sys.x, sys.y + 14);
  ctx.stroke();
  ctx.restore();

  state.particles = sys.particles.length;
  state.emitted = sys.emitted;
  state.frames++;
  $("count").textContent = `${sys.particles.length} particle${sys.particles.length === 1 ? "" : "s"}`;
}

/* While paused, show a still of the effect in full flow, so a
   change is still visible without anything moving. */
function still() {
  sys.restart();
  const s = sys.settings;
  const until = s.rate > 0 ? s.lifetime : Math.min(0.35, s.lifetime * 0.4);
  for (let t = 0; t < until; t += 1 / 30) { sys.step(1 / 30); }
  draw();
}

const loop = startLoop({
  update(dt) { sys.step(dt); },
  draw,
  startPaused: calm,
  onPauseChange(paused) {
    $("pause").firstChild.textContent = paused ? "Play " : "Pause ";
    $("pause").setAttribute("aria-pressed", String(paused));
    $("paused-msg").hidden = !paused;
  }
});
if (loop.paused) { $("pause").firstChild.textContent = "Play "; $("pause").setAttribute("aria-pressed", "true"); $("paused-msg").hidden = false; }
onMotionChange((v) => { calm = v; if (v) { loop.pause(); still(); } });

$("pause").addEventListener("click", () => loop.toggle());
function burst() {
  sys.burst();
  if (loop.paused) { sys.step(0.12); draw(); }
}
$("burst").addEventListener("click", burst);

$("bg").addEventListener("input", () => {
  state.bg = normalizeBg($("bg").value);
  draw();
  scheduleSave();
});

/* ---- move the emitter: drag or tap (touch + mouse) ---- */
function moveTo(x, y) {
  state.at = [clamp(x / view.width, 0, 1), clamp(y / view.height, 0, 1)];
  placeEmitter();
  if (loop.paused) { still(); } else { draw(); }
  scheduleSave();
}
pointer(stage, {
  down(p) { stage.focus({ preventScroll: true }); moveTo(p.x, p.y); },
  move(p, held) { if (held) { moveTo(p.x, p.y); } }
});

/* ---- keyboard on the preview: arrows move, Space bursts ---- */
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
stage.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) { return; }
  if (ARROWS[e.code]) {
    e.preventDefault();
    const step = e.shiftKey ? 40 : 8;
    const [dx, dy] = ARROWS[e.code];
    moveTo(sys.x + dx * step, sys.y + dy * step);
  } else if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    if (!e.repeat) { burst(); }
  }
});

/* ============================================================
   4. CONTROLS
   ============================================================ */

/* Every change to the effect goes through here. */
function setSettings(next, { restart = false, controls = true } = {}) {
  state.settings = normalize(next);
  sys.settings = state.settings;
  if (restart) { sys.restart(); }
  if (loop.paused) { still(); }
  if (controls) { syncControls(); } else { syncReadouts(); }
  refreshGodot();
  scheduleSave();
}

/* ---- presets ---- */
const PRESET_LABELS = { fire: "Fire", smoke: "Smoke", sparks: "Sparks", magic: "Magic", rain: "Rain", explosion: "Explosion" };
function usePreset(name) {
  state.preset = name;
  state.at = [...PRESETS[name].at];
  placeEmitter();
  setSettings(preset(name), { restart: true });
  for (const b of $("presets").children) { b.setAttribute("aria-pressed", String(b.dataset.preset === name)); }
}
PRESET_KEYS.forEach((name, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn pd-preset";
  b.dataset.preset = name;
  b.setAttribute("aria-pressed", "false");
  b.append(`${PRESET_LABELS[name]} `);
  const k = document.createElement("kbd");
  k.textContent = String(i + 1);
  b.append(k);
  b.addEventListener("click", () => usePreset(name));
  $("presets").append(b);
});

/* ---- sliders ---- */
const deg = (v) => `${Math.round(v)}°`;
const px = (v) => `${Math.round(v)} px`;
const pct = (v) => `${Math.round(v * 100)}%`;
const pxs2 = (v) => `${Math.round(v)} px/s²`;
const dirName = (v) => {
  const names = { "-180": "left", "-90": "up", 0: "right", 90: "down", 180: "left" };
  return names[Math.round(v)] ? `${deg(v)} ${names[Math.round(v)]}` : deg(v);
};

const EFFECT_SLIDERS = [
  { box: "emit", key: "rate", label: "Rate", step: 1, show: (v) => `${v} / s` },
  { box: "emit", key: "burst", label: "Burst", step: 1, show: (v) => (v ? `${v} at once` : "off") },
  { box: "emit", key: "burstEvery", label: "Burst every", step: 0.1, show: (v) => (v ? `${v.toFixed(1)} s` : "once") },
  { box: "emit", key: "lifetime", label: "Lifetime", step: 0.05, show: (v) => `${v.toFixed(2)} s` },
  { box: "emit", key: "lifetimeRandom", label: "Lifetime random", step: 0.05, show: pct },
  { box: "emit", key: "areaWidth", label: "Emit area width", step: 1, show: px },
  { box: "emit", key: "areaHeight", label: "Emit area height", step: 1, show: px },
  { box: "motion", key: "speedMin", label: "Speed min", step: 5, show: (v) => `${Math.round(v)} px/s` },
  { box: "motion", key: "speedMax", label: "Speed max", step: 5, show: (v) => `${Math.round(v)} px/s` },
  { box: "motion", key: "direction", label: "Direction", step: 1, show: dirName },
  { box: "motion", key: "spread", label: "Spread", step: 1, show: (v) => `± ${deg(v)}` },
  { box: "motion", key: "gravity", label: "Gravity", step: 10, show: (v) => `${pxs2(v)}${v < 0 ? " up" : ""}` },
  { box: "motion", key: "wind", label: "Wind", step: 5, show: pxs2 },
  { box: "motion", key: "drag", label: "Drag", step: 5, show: pxs2 },
  { box: "look", key: "sizeStart", label: "Size at birth", step: 1, show: px },
  { box: "look", key: "sizeEnd", label: "Size at end", step: 1, show: px },
  { box: "look", key: "sizeRandom", label: "Size random", step: 0.05, show: pct }
];
const SHEET_SLIDERS = [
  { box: "sheet", key: "frames", label: "Frames", min: 4, max: 48, step: 1, show: (v) => String(v) },
  { box: "sheet", key: "fps", label: "Speed", min: 6, max: 30, step: 1, show: (v) => `${v} fps` }
];

function makeSlider(def, onInput) {
  const [lo, hi] = def.min !== undefined ? [def.min, def.max] : RANGES[def.key];
  const wrap = document.createElement("div");
  wrap.className = "field pd-slider";
  const label = document.createElement("label");
  label.htmlFor = `s-${def.key}`;
  label.textContent = `${def.label} `;
  const out = document.createElement("output");
  out.htmlFor = `s-${def.key}`;
  label.append(out);
  const input = Object.assign(document.createElement("input"), { type: "range", id: `s-${def.key}`, min: lo, max: hi, step: def.step });
  input.addEventListener("input", () => onInput(Number(input.value)));
  wrap.append(label, input);
  $(`sliders-${def.box}`).append(wrap);
  def.input = input;
  def.out = out;
}

for (const def of EFFECT_SLIDERS) {
  makeSlider(def, (v) => {
    const next = { ...state.settings, [def.key]: v };
    /* Keep min <= max by pushing the other one along. */
    if (def.key === "speedMin" && v > next.speedMax) { next.speedMax = v; }
    if (def.key === "speedMax" && v < next.speedMin) { next.speedMin = v; }
    setSettings(next, { controls: false });
  });
}
for (const def of SHEET_SLIDERS) {
  makeSlider(def, (v) => {
    state.sheet = normalizeSheet({ ...state.sheet, [def.key]: v });
    syncReadouts();
    scheduleSave();
  });
}

/* ---- shape, blend, frame size ---- */
for (const r of document.querySelectorAll('input[name="shape"], input[name="blend"]')) {
  r.addEventListener("change", () => { if (r.checked) { setSettings({ ...state.settings, [r.name]: r.value }); } });
}
for (const r of document.querySelectorAll('input[name="frame-size"]')) {
  r.addEventListener("change", () => {
    if (r.checked) { state.sheet = normalizeSheet({ ...state.sheet, size: Number(r.value) }); scheduleSave(); }
  });
}
$("transparent").addEventListener("change", () => {
  state.sheet = normalizeSheet({ ...state.sheet, transparent: $("transparent").checked });
  scheduleSave();
});

/* ---- name ---- */
$("name").addEventListener("input", () => {
  const raw = $("name").value;
  state.settings = normalize({ ...state.settings, name: raw });
  sys.settings = state.settings;
  refreshGodot();
  scheduleSave();
});

/* ---- colour stops ---- */
function renderStops() {
  const stops = state.settings.colors;
  $("grad-bar").style.setProperty("--grad", cssGradient(stops));
  $("stops").replaceChildren(...stops.map((st, i) => {
    const li = document.createElement("li");
    li.className = "pd-stop";

    const pick = Object.assign(document.createElement("input"), { type: "color", value: st.color, id: `stop-color-${i}` });
    pick.setAttribute("aria-label", `Colour ${i + 1}`);
    pick.addEventListener("input", () => editStop(i, { color: pick.value }));

    const fields = document.createElement("div");
    fields.className = "pd-stop-fields";
    const at = stopSlider(`At ${Math.round(st.at * 100)}% of life`, `stop-at-${i}`, Math.round(st.at * 100), (v) => editStop(i, { at: v / 100 }));
    const alpha = stopSlider(`Opacity ${Math.round(st.alpha * 100)}%`, `stop-alpha-${i}`, Math.round(st.alpha * 100), (v) => editStop(i, { alpha: v / 100 }));
    fields.append(at, alpha);

    const del = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm btn-ghost pd-stop-del", textContent: "✕" });
    del.setAttribute("aria-label", `Remove colour ${i + 1}`);
    del.disabled = stops.length <= 2;
    del.addEventListener("click", () => {
      const next = stops.filter((_, j) => j !== i);
      setSettings({ ...state.settings, colors: next });
      ($("stops").querySelector(".pd-stop-del:not([disabled])") || $("add-stop")).focus();
    });
    li.append(pick, fields, del);
    return li;
  }));
  $("add-stop").disabled = stops.length >= MAX_STOPS;
}

function stopSlider(text, id, value, onInput) {
  const wrap = document.createElement("div");
  wrap.className = "pd-stop-field";
  const label = Object.assign(document.createElement("label"), { htmlFor: id, textContent: text });
  const input = Object.assign(document.createElement("input"), { type: "range", id, min: 0, max: 100, step: 1, value });
  input.addEventListener("input", () => {
    label.textContent = text.replace(/\d+%/, `${input.value}%`);
    onInput(Number(input.value));
  });
  wrap.append(label, input);
  return wrap;
}

/* While a stop is being changed (dragged, or the colour picker is
   open) its row stays put: the list is only sorted and rebuilt
   when it's let go (the "change" event). */
function editStop(i, patch) {
  const colors = state.settings.colors.map((st, j) => (j === i ? { ...st, ...patch } : st));
  state.settings = { ...state.settings, colors };
  sys.settings = normalize(state.settings);
  $("grad-bar").style.setProperty("--grad", cssGradient(sys.settings.colors));
  if (loop.paused) { still(); }
  refreshGodot();
  scheduleSave();
}
$("stops").addEventListener("change", (e) => {
  const focusId = e.target.id;
  setSettings(state.settings);
  const again = focusId && $(focusId);
  if (again && e.target.type === "range") { again.focus(); }
});

$("add-stop").addEventListener("click", () => {
  const stops = [...state.settings.colors].sort((a, b) => a.at - b.at);
  if (stops.length >= MAX_STOPS) { return; }
  /* Put it in the middle of the widest gap, in the colour that's there. */
  let best = 0;
  for (let i = 1; i < stops.length; i++) { if (stops[i].at - stops[i - 1].at > stops[best + 1].at - stops[best].at) { best = i - 1; } }
  const at = (stops[best].at + stops[best + 1].at) / 2;
  const [r, g, b, a] = colorAt(stops, at);
  setSettings({ ...state.settings, colors: [...stops, { at, color: toHex([r, g, b]), alpha: a }] });
});

/* ---- put the settings into the controls ---- */
function syncReadouts() {
  const s = state.settings;
  for (const def of EFFECT_SLIDERS) {
    if (document.activeElement !== def.input) { def.input.value = String(s[def.key]); }
    def.out.textContent = def.show(s[def.key]);
  }
  for (const def of SHEET_SLIDERS) {
    if (document.activeElement !== def.input) { def.input.value = String(state.sheet[def.key]); }
    def.out.textContent = def.show(state.sheet[def.key]);
  }
  const burstOn = s.burst > 0;
  const every = EFFECT_SLIDERS.find((d) => d.key === "burstEvery");
  every.input.closest(".pd-slider").classList.toggle("is-off", !burstOn);
}

function syncControls() {
  const s = state.settings;
  for (const r of document.querySelectorAll('input[name="shape"]')) { r.checked = r.value === s.shape; }
  for (const r of document.querySelectorAll('input[name="blend"]')) { r.checked = r.value === s.blend; }
  for (const r of document.querySelectorAll('input[name="frame-size"]')) { r.checked = Number(r.value) === state.sheet.size; }
  $("transparent").checked = state.sheet.transparent;
  if (document.activeElement !== $("name")) { $("name").value = s.name; }
  $("bg").value = state.bg;
  syncReadouts();
  renderStops();
}

/* ============================================================
   5. EXPORT
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
const base = () => fileBase(state.settings.name);

/* ---- JSON ---- */
$("export-json").addEventListener("click", () => {
  const name = `${base()}.particles.json`;
  downloadBlob(new Blob([jsonText(state.settings)], { type: "application/json" }), name);
  state.lastExport = { kind: "json", name };
  exportSay(`Saved ${name}.`);
});

$("import-json").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files && $("import-file").files[0];
  $("import-file").value = "";
  if (!file) { return; }
  let text;
  try { text = await file.text(); } catch { exportSay("Couldn't read that file."); return; }
  const result = fromJsonText(text);
  if (!result.ok) { exportSay(result.error); return; }
  state.preset = null;
  for (const b of $("presets").children) { b.setAttribute("aria-pressed", "false"); }
  setSettings(result.settings, { restart: true });
  exportSay(`Loaded ${result.settings.name}.`);
});

/* ---- Godot ---- */
function refreshGodot() { $("godot-text").value = toGodot(state.settings); }

$("export-godot").addEventListener("click", () => {
  const name = `${base()}.tscn`;
  downloadBlob(new Blob([toGodot(state.settings)], { type: "text/plain" }), name);
  state.lastExport = { kind: "godot", name };
  exportSay(`Saved ${name}. Put it in your Godot project and drag it into a scene.`);
});
$("copy-godot").addEventListener("click", async () => {
  const text = toGodot(state.settings);
  try {
    await navigator.clipboard.writeText(text);
    exportSay("Copied the Godot scene. Paste it into a new .tscn file.");
  } catch {
    $("godot-text").closest("details").open = true;
    $("godot-text").select();
    exportSay("Couldn't copy here. The scene is selected below: copy it yourself.");
  }
});

/* ---- pictures: the same clip for the sheet and the GIF ---- */
function clip() {
  const { size, frames, fps } = state.sheet;
  const sim = simulateFrames(state.settings, { frames, fps, seed: 1 });
  return { sim, fit: fitBox(sim.box, size), size, frames, fps };
}
function drawFrame(ctx, snap, fit, settings, bg) {
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); }
  drawParticles(ctx, { settings, particles: snap }, fit);
}

$("export-sheet").addEventListener("click", async () => {
  const { sim, fit, size, frames } = clip();
  const { cols, rows } = sheetGrid(frames);
  const c = document.createElement("canvas");
  c.width = cols * size;
  c.height = rows * size;
  const g = c.getContext("2d");
  if (!g) { exportSay("This browser couldn't make the sheet."); return; }
  const bg = state.sheet.transparent ? null : state.bg;
  sim.frames.forEach((snap, f) => {
    g.save();
    g.translate((f % cols) * size, Math.floor(f / cols) * size);
    g.beginPath();
    g.rect(0, 0, size, size);
    g.clip();
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, size, size); }
    drawParticles(g, { settings: sim.settings, particles: snap }, fit);
    g.restore();
  });
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) { exportSay("This browser couldn't make the sheet PNG."); return; }
  const name = `${base()}-sheet-${size}px-${cols}x${rows}.png`;
  downloadBlob(blob, name);
  state.lastExport = { kind: "sheet", name, width: c.width, height: c.height, cols, rows };
  exportSay(`Saved ${name}: ${frames} frames of ${size} × ${size} px, ${cols} across and ${rows} down.`);
});

/* ---- GIF: made in a worker (gif-worker.js, copied from GIF Maker) ---- */
let worker = null;
let gifJob = 0;
$("export-gif").addEventListener("click", () => {
  if ($("export-gif").disabled) { return; }
  const { sim, fit, size, frames, fps } = clip();
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) { exportSay("This browser couldn't make the GIF."); return; }
  const list = sim.frames.map((snap) => {
    drawFrame(g, snap, fit, sim.settings, state.bg);
    return { data: g.getImageData(0, 0, size, size).data.buffer, delay: 1000 / fps };
  });
  try {
    worker = worker || new Worker(new URL("./gif-worker.js", import.meta.url), { type: "module" });
  } catch {
    exportSay("This browser can't make GIFs here (no module workers).");
    return;
  }
  const id = ++gifJob;
  $("export-gif").disabled = true;
  exportSay("Making the GIF…");
  const done = () => { $("export-gif").disabled = false; };
  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.id !== id) { return; }
    if (m.type === "progress") { exportSay(`Making the GIF… frame ${m.done} of ${m.total}`); return; }
    done();
    if (m.type === "done") {
      const name = `${base()}-${size}px.gif`;
      downloadBlob(new Blob([m.bytes], { type: "image/gif" }), name);
      state.lastExport = { kind: "gif", name, bytes: m.bytes.byteLength };
      exportSay(`Saved ${name}: ${frames} frames at ${fps} fps, on your background colour.`);
    } else {
      exportSay(m.message || "Couldn't make the GIF.");
    }
  };
  worker.onerror = () => { done(); worker = null; exportSay("Couldn't make the GIF in this browser."); };
  worker.postMessage({ id, width: size, height: size, colors: 256, dither: false, loop: 0, frames: list }, list.map((f) => f.data));
});

/* ============================================================
   6. KEYS + START
   ============================================================ */
const keyMap = { pause: ["KeyP"], burst: ["KeyB"] };
PRESET_KEYS.forEach((name, i) => { keyMap[name] = [`Digit${i + 1}`, `Numpad${i + 1}`]; });
const keys = createKeys(keyMap);
keys.on("pause", () => loop.toggle());
keys.on("burst", burst);
for (const name of PRESET_KEYS) { keys.on(name, () => usePreset(name)); }

/* After Import save or Delete my data. */
function loadFromSave() {
  const d = save.get();
  state.at = normalizeAt(d.at);
  state.bg = normalizeBg(d.bg);
  state.sheet = normalizeSheet(d.sheet);
  state.preset = null;
  for (const b of $("presets").children) { b.setAttribute("aria-pressed", "false"); }
  placeEmitter();
  setSettings(d.effect, { restart: true });
}

placeEmitter();
syncControls();
refreshGodot();
if (loop.paused) { still(); } else { draw(); }
stage.dataset.ready = "true";
