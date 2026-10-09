/* ============================================================
   SFX Maker - main script

   The sound is made by synth.js (plain maths, no Web Audio).
   This file wires up the page: presets, sliders, the waveform,
   playing through Web Audio after a tap, WAV export and the
   favourites list.

   Sections:
     1. save        current sound + favourites
     2. state
     3. sound       render, draw, play, export
     4. controls    presets, sliders, wave buttons
     5. favourites
     6. keys
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createCanvas } from "../../kit/canvas.js";
import { createKeys } from "../../kit/input.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { reducedMotion, onMotionChange } from "../../kit/motion.js";
import {
  render, pitchAt, encodeWav, preset, randomize, mutate, normalize, peak, wavName,
  PRESETS, WAVES, RANGES, SAMPLE_RATE
} from "./synth.js";

bootItem();

const $ = (id) => document.getElementById(id);
const MAX_FAVS = 100;

/* ============================================================
   1. SAVE
   ============================================================ */
function isFav(f) {
  return f && typeof f.name === "string" && f.name.length <= 60 && f.settings && typeof f.settings === "object";
}
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { current: preset("coin", 1), label: "coin", favourites: [] },
  validate: (d) => (d.current && typeof d.current === "object" && Array.isArray(d.favourites) &&
    d.favourites.length <= 500 && d.favourites.every(isFav)) || "That file doesn't hold SFX Maker sounds."
});
mountSavePanel($("save-panel"), save, {
  title: "Your sounds",
  intro: "Your current sound and favourites are saved on this device only. Export to back them up or move them.",
  onImport: () => { loadFromSave(); },
  onDelete: () => { loadFromSave(); }
});

/* ============================================================
   2. STATE - window.__item for smoke.js
   ============================================================ */
const saved = save.get();
const state = exposeForTests({
  settings: normalize(saved.current),
  label: String(saved.label || "sound"),
  favourites: (saved.favourites || []).filter(isFav).map((f) => ({ name: f.name, settings: normalize(f.settings) })),
  samples: null,
  peak: 0,
  drawn: 0,          // how many times the waveform was drawn
  plays: 0
});

let calm = reducedMotion();
onMotionChange((v) => { calm = v; });

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/* ============================================================
   3. SOUND
   ============================================================ */
const view = createCanvas($("wave"), { onResize: () => draw() });
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

function rebuild() {
  state.samples = render(state.settings);
  state.peak = peak(state.samples);
  const secs = state.samples.length / SAMPLE_RATE;
  $("meta").textContent = `${state.label} · ${state.settings.wave} · ${secs.toFixed(2)} s`;
  draw();
}

/* Waveform: for each pixel column, the lowest and highest sample. */
function draw(playhead = -1) {
  const ctx = view.ctx;
  const w = view.width;
  const h = view.height;
  ctx.fillStyle = color("--bg-2");
  ctx.fillRect(0, 0, w, h);

  const mid = h / 2;
  const pad = 22;
  const amp = mid - pad;

  /* Guide lines: centre and full-volume edges. */
  ctx.fillStyle = color("--line");
  ctx.fillRect(0, Math.round(mid), w, 1);

  const s = state.samples;
  if (s && s.length) {
    /* Volume: the loudest sample in each pixel column, mirrored.
       Filled softly, with a solid edge. */
    const cols = Math.max(1, Math.floor(w));
    const per = s.length / cols;
    const tops = new Float32Array(cols);
    for (let x = 0; x < cols; x++) {
      let hi = 0;
      const a = Math.floor(x * per);
      const b = Math.min(s.length, Math.max(a + 1, Math.floor((x + 1) * per)));
      for (let i = a; i < b; i++) { const v = Math.abs(s[i]); if (v > hi) { hi = v; } }
      tops[x] = hi * amp;
    }
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let x = 0; x < cols; x++) { ctx.lineTo(x, mid - tops[x]); }
    for (let x = cols - 1; x >= 0; x--) { ctx.lineTo(x, mid + tops[x]); }
    ctx.closePath();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color("--accent");
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color("--accent");
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    /* Pitch: a line, low at the bottom, high at the top (log scale). */
    const [flo, fhi] = RANGES.freq;
    const secs = s.length / SAMPLE_RATE;
    ctx.beginPath();
    for (let x = 0; x <= cols; x += 2) {
      const f = pitchAt(state.settings, (x / cols) * secs);
      const k = Math.min(1, Math.max(0, Math.log(f / flo) / Math.log(fhi / flo)));
      const y = h - pad - k * (h - pad * 2);
      if (x === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.strokeStyle = color("--cyan");
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* Legend */
  ctx.font = "500 12px 'JetBrains Mono', monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = color("--accent");
  ctx.fillRect(8, 6, 10, 10);
  ctx.fillStyle = color("--text-dim");
  ctx.fillText("volume", 22, 5);
  ctx.fillStyle = color("--cyan");
  ctx.fillRect(84, 10, 12, 2);
  ctx.fillStyle = color("--text-dim");
  ctx.fillText("pitch", 100, 5);

  if (playhead >= 0) {
    ctx.fillStyle = color("--cyan");
    ctx.fillRect(Math.round(playhead * w), 0, 2, h);
  }

  /* Time labels, so the canvas is never blank. */
  ctx.fillStyle = color("--text-faint");
  ctx.textBaseline = "bottom";
  ctx.fillText("0 s", 8, h - 1);
  const label = `${((s ? s.length : 0) / SAMPLE_RATE).toFixed(2)} s`;
  ctx.fillText(label, w - 8 - ctx.measureText(label).width, h - 1);
  state.drawn++;
}

/* ---- Web Audio: created on the first tap, never before ---- */
let actx = null;
let source = null;
let raf = 0;

function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { return null; }
    actx = new AC();
  }
  if (actx.state === "suspended") { actx.resume().catch(() => {}); }
  return actx;
}

function stop() {
  if (source) { try { source.stop(); } catch { /* already ended */ } source = null; }
  cancelAnimationFrame(raf);
}

function play() {
  const ac = audio();
  if (!ac) { $("audio-note").textContent = "This browser can't play sound, but Export WAV still works."; return; }
  stop();
  const buf = ac.createBuffer(1, state.samples.length, SAMPLE_RATE);
  buf.copyToChannel(state.samples, 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start();
  source = src;
  state.plays++;

  /* A moving playhead. Skipped for reduced motion. */
  const started = ac.currentTime;
  const dur = buf.duration;
  const tick = () => {
    const t = (ac.currentTime - started) / dur;
    if (t >= 1 || source !== src) { draw(); return; }
    draw(t);
    raf = requestAnimationFrame(tick);
  };
  if (!calm) { raf = requestAnimationFrame(tick); }
  src.onended = () => { if (source === src) { source = null; draw(); } };
}

/* Tab hidden: stop the sound and let the audio hardware sleep. */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stop();
    if (actx && actx.state === "running") { actx.suspend().catch(() => {}); }
  }
});

function exportWav() {
  const wav = encodeWav(state.samples);
  const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = wavName(state.label);
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  $("audio-note").textContent = `Downloaded ${wavName(state.label)} (16-bit, mono, 44.1 kHz).`;
}

/* Every change goes through here. */
let saveTimer = 0;
function setSound(settings, label, { andPlay = true } = {}) {
  state.settings = normalize(settings);
  if (label) { state.label = label; }
  rebuild();
  syncControls();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save.set({ current: state.settings, label: state.label }), 200);
  if (andPlay) { play(); }
}

/* ============================================================
   4. CONTROLS
   ============================================================ */
const PRESET_LABELS = {
  coin: "Coin", jump: "Jump", laser: "Laser", explosion: "Boom", powerup: "Power-up", hit: "Hit", blip: "Blip"
};
const counts = {};

function usePreset(name) {
  counts[name] = (counts[name] || 0) + 1;
  setSound(preset(name, newSeed()), counts[name] > 1 ? `${name}-${counts[name]}` : name);
}

PRESETS.forEach((name, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn sfx-btn";
  b.dataset.preset = name;
  b.append(PRESET_LABELS[name] + " ");
  const k = document.createElement("kbd");
  k.textContent = String(i + 1);
  b.append(k);
  b.addEventListener("click", () => usePreset(name));
  $("presets").append(b);
});

$("randomize").addEventListener("click", () => setSound(randomize(newSeed()), "random"));
$("mutate").addEventListener("click", () => setSound(mutate(state.settings, newSeed()), state.label.replace(/(-mutant)?$/, "-mutant")));
$("play").addEventListener("click", play);
$("export").addEventListener("click", exportWav);
$("wave").addEventListener("click", play);

/* ---- wave buttons ---- */
const waveInputs = WAVES.map((w) => {
  const id = `wave-${w}`;
  const input = Object.assign(document.createElement("input"), { type: "radio", name: "wave", id, value: w });
  const label = Object.assign(document.createElement("label"), { htmlFor: id, textContent: w[0].toUpperCase() + w.slice(1) });
  input.addEventListener("change", () => { if (input.checked) { setSound({ ...state.settings, wave: w }); } });
  $("waves").append(input, label);
  return input;
});

/* ---- sliders ----
   Pitch uses a log scale, so each bit of the slider is the same
   musical step whether the sound is high or low. */
const [FLO, FHI] = RANGES.freq;
const SLIDERS = [
  { key: "attack",   label: "Attack",        step: 0.01, show: (v) => `${v.toFixed(2)} s` },
  { key: "sustain",  label: "Sustain",       step: 0.01, show: (v) => `${v.toFixed(2)} s` },
  { key: "decay",    label: "Decay",         step: 0.01, show: (v) => `${v.toFixed(2)} s` },
  { key: "freq",     label: "Start pitch",   log: true,  show: (v) => `${Math.round(v)} Hz` },
  { key: "slide",    label: "Pitch slide",   step: 0.05, show: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} oct/s` },
  { key: "vibDepth", label: "Vibrato depth", step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
  { key: "vibSpeed", label: "Vibrato speed", step: 0.5,  show: (v) => `${v.toFixed(1)} Hz` },
  { key: "duty",     label: "Duty (square)", step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
  { key: "volume",   label: "Volume",        step: 0.01, show: (v) => `${Math.round(v * 100)}%` }
];
const toSlider = (def, v) => (def.log ? Math.round(1000 * Math.log(v / FLO) / Math.log(FHI / FLO)) : v);
const fromSlider = (def, v) => (def.log ? FLO * (FHI / FLO) ** (v / 1000) : v);

for (const def of SLIDERS) {
  const [lo, hi] = RANGES[def.key];
  const wrap = document.createElement("div");
  wrap.className = "field sfx-slider";
  const label = document.createElement("label");
  label.htmlFor = `s-${def.key}`;
  label.textContent = def.label + " ";
  const out = document.createElement("output");
  out.htmlFor = `s-${def.key}`;
  label.append(out);
  const input = Object.assign(document.createElement("input"), {
    type: "range", id: `s-${def.key}`,
    min: def.log ? 0 : lo, max: def.log ? 1000 : hi, step: def.log ? 1 : def.step
  });
  input.addEventListener("input", () => {
    setSound({ ...state.settings, [def.key]: fromSlider(def, Number(input.value)) }, null, { andPlay: false });
  });
  input.addEventListener("change", () => play());
  wrap.append(label, input);
  $("sliders").append(wrap);
  def.input = input;
  def.out = out;
}

function syncControls() {
  const s = state.settings;
  for (const r of waveInputs) { r.checked = r.value === s.wave; }
  for (const def of SLIDERS) {
    if (document.activeElement !== def.input) { def.input.value = String(toSlider(def, s[def.key])); }
    def.out.textContent = def.show(s[def.key]);
  }
  const duty = SLIDERS.find((d) => d.key === "duty");
  duty.input.disabled = s.wave !== "square";
  duty.input.closest(".sfx-slider").classList.toggle("is-off", s.wave !== "square");
}

/* ============================================================
   5. FAVOURITES
   ============================================================ */
function storeFavs() { save.set({ favourites: state.favourites }); }

function renderFavs() {
  const list = $("favs");
  list.replaceChildren(...state.favourites.map((f, i) => {
    const li = document.createElement("li");
    const load = Object.assign(document.createElement("button"), { type: "button", className: "sfx-fav-load" });
    const name = document.createElement("span");
    name.textContent = f.name;
    const meta = document.createElement("small");
    meta.textContent = `${f.settings.wave} · ${Math.round(f.settings.freq)} Hz`;
    load.append(name, meta);
    load.setAttribute("aria-label", `Play ${f.name}`);
    load.addEventListener("click", () => setSound(f.settings, f.name));

    const del = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm btn-ghost sfx-fav-del", textContent: "✕" });
    del.setAttribute("aria-label", `Delete ${f.name}`);
    del.addEventListener("click", () => {
      state.favourites.splice(i, 1);
      storeFavs();
      renderFavs();
      favSay(`Deleted ${f.name}.`);
      ($("favs").querySelector(".sfx-fav-load") || $("fav-name")).focus();
    });
    li.append(load, del);
    return li;
  }));
  $("favs-empty").hidden = state.favourites.length > 0;
}

function favSay(t) { $("fav-status").textContent = t; }

$("fav-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("fav-name");
  const name = input.value.trim().slice(0, 40) || state.label;
  const same = state.favourites.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
  if (same !== -1) {
    state.favourites[same] = { name, settings: state.settings };
    favSay(`Updated ${name}.`);
  } else {
    if (state.favourites.length >= MAX_FAVS) { favSay(`That's ${MAX_FAVS} favourites. Delete one first.`); return; }
    state.favourites.unshift({ name, settings: state.settings });
    favSay(`Saved ${name}.`);
  }
  state.label = name;
  storeFavs();
  save.set({ label: name });
  renderFavs();
  rebuild();
  input.value = "";
});

/* After Import or Delete my data. */
function loadFromSave() {
  const d = save.get();
  state.favourites = (d.favourites || []).filter(isFav).map((f) => ({ name: f.name, settings: normalize(f.settings) }));
  state.settings = normalize(d.current);
  state.label = String(d.label || "sound");
  rebuild();
  syncControls();
  renderFavs();
}

/* ============================================================
   6. KEYS - Space plays, 1-7 presets, R and M
   ============================================================ */
const keyMap = { play: ["Space"], random: ["KeyR"], mutate: ["KeyM"] };
PRESETS.forEach((name, i) => { keyMap[name] = [`Digit${i + 1}`, `Numpad${i + 1}`]; });
const keys = createKeys(keyMap);
keys.on("play", play);
keys.on("random", () => $("randomize").click());
keys.on("mutate", () => $("mutate").click());
for (const name of PRESETS) { keys.on(name, () => usePreset(name)); }

/* ---- go ---- */
rebuild();
syncControls();
renderFavs();
$("wave").dataset.ready = "true";
