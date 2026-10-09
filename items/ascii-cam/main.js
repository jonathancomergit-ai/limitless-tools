/* ============================================================
   ASCII Cam - main script

   Camera (or the sample) -> a tiny picture of cols x rows ->
   one character a cell (ascii.js) -> drawn on a canvas.
   All in this tab: no upload, no recording, no library.

   Sections:
     1. save       the look (never a picture)
     2. state
     3. sources    the sample picture and the "no picture" title
     4. render     source -> text -> canvas
     5. camera     start / stop / switch, and the tab-hidden rule
     6. snap       PNG, copy as text, the 3-2-1 timer
     7. form       sliders, pills, checkboxes
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { startLoop } from "../../kit/loop.js";
import { reducedMotion } from "../../kit/motion.js";
import { hasTouch } from "../../kit/input.js";
import {
  DEFAULTS, LOOKS, normalizeSettings, cleanCustom, charsFor, gridRows, toAscii,
  asText, hasInk, fileStamp, cameraError
} from "./ascii.js";

bootItem();

const $ = (id) => document.getElementById(id);

/* ============================================================
   1. SAVE - the look only. Pictures are never stored.
   ============================================================ */
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { ...DEFAULTS },
  validate: (d) => ["cols", "charset", "colour", "contrast"].some((k) => k in d) || "That file doesn't hold ASCII Cam settings."
});
mountSavePanel($("save-panel"), save, {
  title: "Your settings",
  intro: "Only the look is saved (detail, contrast, brightness, characters, colours, timer), on this device. Pictures are never stored.",
  exportLabel: "Export settings",
  importLabel: "Import settings",
  onImport: () => { fillForm(); render(); },
  onDelete: () => { fillForm(); render(); }
});

/* ============================================================
   2. STATE
   ============================================================ */
const state = exposeForTests({
  settings: normalizeSettings(save.get()),
  source: "none",      // "none" | "sample" | "camera"
  live: false,         // camera stream running
  facing: "user",      // "user" (front) | "environment" (back)
  cameras: 0,          // video inputs seen after permission
  lines: [],           // the last real picture, one string a row
  text: "",            // ...as copyable text
  inked: false,        // any non-space character in it?
  cols: 0,
  rows: 0,
  frames: 0,           // how many times it has been drawn
  counting: false,     // 3-2-1 running
  copied: "",          // "clipboard" | "fallback"
  png: null            // { name, bytes, width, height } of the last PNG
});

const video = $("video");
const screen = $("ascii");
const sctx = screen.getContext("2d");
const view = $("view");
let stream = null;
let current = null;        // the toAscii result on screen
let charRatio = 0.6;       // glyph width / font size, measured once the font is in

function say(text) { $("status").textContent = text; }
function note(text) { $("snap-note").textContent = text; }

/* ============================================================
   3. SOURCES
   ============================================================ */

/* The sample: a smiling face with soft gradients (they look
   good as text), a few stars and a grey ramp along the bottom
   that shows off every character in the set. */
function makeSample() {
  const W = 480;
  const H = 360;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");

  const sky = g.createLinearGradient(0, 0, W, H);
  sky.addColorStop(0, "#081433");
  sky.addColorStop(1, "#4A1660");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  /* a glow behind the head */
  const glow = g.createRadialGradient(240, 165, 40, 240, 165, 230);
  glow.addColorStop(0, "rgba(53, 214, 245, .55)");
  glow.addColorStop(1, "rgba(53, 214, 245, 0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  /* stars */
  g.fillStyle = "#FFFFFF";
  for (const [x, y, r] of [[40, 40, 5], [92, 96, 3], [400, 52, 6], [446, 128, 3], [60, 220, 4], [430, 230, 4], [150, 30, 3]]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  /* the face, lit from the top left */
  const face = g.createRadialGradient(200, 120, 10, 240, 165, 135);
  face.addColorStop(0, "#FFF8C8");
  face.addColorStop(0.55, "#FFC93C");
  face.addColorStop(1, "#B8620F");
  g.fillStyle = face;
  g.beginPath();
  g.arc(240, 165, 130, 0, Math.PI * 2);
  g.fill();

  /* cheeks */
  for (const x of [168, 312]) {
    const cheek = g.createRadialGradient(x, 200, 2, x, 200, 30);
    cheek.addColorStop(0, "rgba(255, 45, 120, .75)");
    cheek.addColorStop(1, "rgba(255, 45, 120, 0)");
    g.fillStyle = cheek;
    g.fillRect(x - 32, 168, 64, 64);
  }

  /* eyes */
  g.fillStyle = "#1A0E05";
  for (const x of [195, 285]) {
    g.beginPath();
    g.ellipse(x, 135, 16, 24, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#FFFFFF";
  for (const x of [189, 279]) {
    g.beginPath();
    g.arc(x, 126, 6, 0, Math.PI * 2);
    g.fill();
  }

  /* the smile */
  g.strokeStyle = "#1A0E05";
  g.lineWidth = 16;
  g.lineCap = "round";
  g.beginPath();
  g.arc(240, 175, 72, Math.PI * 0.18, Math.PI * 0.82);
  g.stroke();

  /* a ramp, black to white */
  const ramp = g.createLinearGradient(20, 0, W - 20, 0);
  ramp.addColorStop(0, "#000000");
  ramp.addColorStop(1, "#FFFFFF");
  g.fillStyle = ramp;
  g.fillRect(20, 316, W - 40, 28);
  return c;
}

/* Before any picture: the name, big, drawn through the same
   mapping so it shows off the current look. */
function makeTitle() {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 300;
  const g = c.getContext("2d");
  g.fillStyle = "#000000";
  g.fillRect(0, 0, c.width, c.height);
  const shade = g.createLinearGradient(0, 30, 0, 270);
  shade.addColorStop(0, "#FFFFFF");
  shade.addColorStop(1, "#9A9A9A");
  g.fillStyle = shade;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "700 150px 'Space Grotesk', 'Segoe UI', sans-serif";
  g.fillText("ASCII", 240, 92);
  g.font = "700 120px 'Space Grotesk', 'Segoe UI', sans-serif";
  g.fillText("CAM", 240, 222);
  return c;
}

let sample = null;
let title = makeTitle();

/* ============================================================
   4. RENDER
   ============================================================ */
const SUPER = 3;     // read 3 x 3 pixels a cell, then average: smoother than 1
const work = document.createElement("canvas");
const wctx = work.getContext("2d", { willReadFrequently: true });

function pickSource() {
  if (state.source === "camera" && video.videoWidth) {
    return { el: video, w: video.videoWidth, h: video.videoHeight, mirror: state.facing === "user", real: true };
  }
  if (state.source === "sample") {
    sample = sample || makeSample();
    return { el: sample, w: sample.width, h: sample.height, mirror: false, real: true };
  }
  return { el: title, w: title.width, h: title.height, mirror: false, real: false };
}

function render() {
  const s = state.settings;
  const src = pickSource();
  const cols = s.cols;
  const rows = gridRows(src.w, src.h, cols);
  const ww = cols * SUPER;
  const wh = rows * SUPER;
  if (work.width !== ww || work.height !== wh) { work.width = ww; work.height = wh; }
  wctx.setTransform(1, 0, 0, 1, 0, 0);
  if (src.mirror) { wctx.setTransform(-1, 0, 0, 1, ww, 0); }
  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = "high";
  wctx.drawImage(src.el, 0, 0, ww, wh);
  const data = wctx.getImageData(0, 0, ww, wh).data;
  const out = toAscii(data, ww, wh, { ...s, cols, rows });
  current = out;

  if (src.real) {
    state.lines = out.lines;
    state.text = asText(out.lines);
    state.inked = hasInk(out.lines);
    state.cols = cols;
    state.rows = rows;
    state.frames += 1;
    $("size-label").textContent = `${cols} × ${rows} characters`;
  } else {
    $("size-label").textContent = "No picture yet";
  }
  layoutScreen(out);
  paint(sctx, out, screen.width, screen.height);
  snapUi();
}

/* Fit the canvas: full card width, but never taller than ~72%
   of the window. Each cell is twice as tall as it is wide. */
function layoutScreen(out) {
  const room = Math.max(120, view.clientWidth - 2);
  const maxH = Math.max(220, window.innerHeight * 0.72);
  const cssW = Math.floor(Math.min(room, (maxH * out.cols) / (2 * out.rows)));
  const cssH = Math.round((cssW * 2 * out.rows) / out.cols);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (screen.width !== bw || screen.height !== bh) {
    screen.width = bw;
    screen.height = bh;
    /* style="" in the HTML is blocked by the privacy lock;
       setting it through the CSSOM is fine. */
    screen.style.width = `${cssW}px`;
    screen.style.height = `${cssH}px`;
  }
}

/* Draw a toAscii result into a W x H canvas, one cell at a
   time (so blocks and emoji from fallback fonts still line up). */
function paint(ctx, out, W, H) {
  const look = LOOKS[state.settings.colour];
  const cw = W / out.cols;
  const lh = H / out.rows;
  ctx.fillStyle = look.bg;
  ctx.fillRect(0, 0, W, H);
  const size = Math.min(cw / charRatio, lh / 1.12);
  ctx.font = `500 ${size.toFixed(2)}px 'JetBrains Mono', 'Cascadia Code', Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = look.fg || "#FFFFFF";
  const colors = out.colors;
  for (let r = 0; r < out.rows; r++) {
    const chars = Array.from(out.lines[r]);
    const y = r * lh + lh / 2;
    for (let c = 0; c < chars.length; c++) {
      const ch = chars[c];
      if (ch === " ") { continue; }
      if (colors) {
        const o = (r * out.cols + c) * 3;
        ctx.fillStyle = `rgb(${colors[o]},${colors[o + 1]},${colors[o + 2]})`;
      }
      ctx.fillText(ch, c * cw + cw / 2, y);
    }
  }
}

function measureFont() {
  const c = document.createElement("canvas").getContext("2d");
  c.font = "500 100px 'JetBrains Mono', monospace";
  const w = c.measureText("M").width / 100;
  if (w > 0.3 && w < 1) { charRatio = w; }
}

/* The live loop: ~30 frames a second while the camera runs.
   kit/loop.js stops it when the tab is hidden. */
let since = 0;
const loop = startLoop({
  update(dt) {
    since += dt;
    if (!state.live) { loop.pause(); }
  },
  draw() {
    if (!state.live || since < 1 / 30 || video.readyState < 2) { return; }
    since = 0;
    render();
  },
  startPaused: true
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 100);
});

/* ============================================================
   5. CAMERA - only ever started by the button
   ============================================================ */
let resumeOnShow = false;
let starting = false;

function stopTracks() {
  if (stream) { for (const t of stream.getTracks()) { t.stop(); } }
  stream = null;
  video.srcObject = null;
}

function stopCamera() {
  stopTracks();
  state.live = false;
  loop.pause();
  heroUi();
}

async function startCamera() {
  const md = navigator.mediaDevices;
  const secure = window.isSecureContext !== false;
  if (!secure || !md || typeof md.getUserMedia !== "function") {
    say(cameraError(null, { secure, supported: Boolean(md && md.getUserMedia) }));
    return;
  }
  if (starting) { return; }
  starting = true;
  heroUi();
  say("Asking for the camera…");
  stopTracks();
  try {
    stream = await md.getUserMedia({
      video: { facingMode: { ideal: state.facing }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    if (document.hidden) { stopTracks(); resumeOnShow = true; say(""); return; }
    video.srcObject = stream;
    await video.play();
    state.live = true;
    state.source = "camera";
    say("");
    loop.resume();
    countCameras();
  } catch (err) {
    stopTracks();
    state.live = false;
    say(cameraError(err));
  } finally {
    starting = false;
    heroUi();
  }
}

/* Show "Switch camera" if there may be more than one: always on
   touch screens, or when the browser lists two or more. */
async function countCameras() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    state.cameras = list.filter((d) => d.kind === "videoinput").length;
  } catch {
    state.cameras = 0;
  }
  heroUi();
}

function heroUi() {
  const start = $("start");
  start.textContent = state.live ? "Stop camera" : starting ? "Starting…" : "Start camera";
  start.disabled = starting;
  $("flip").hidden = !state.live || !(state.cameras > 1 || hasTouch());
  $("hero").classList.toggle("is-live", state.live);
  $("hero-title").textContent = state.live ? "Camera on" : state.source === "sample" ? "The sample" : "Your camera, as text";
  $("hero-sub").textContent = state.live
    ? `Live, ${state.facing === "user" ? "front (mirrored)" : "back"} camera. Nothing is recorded.`
    : state.source === "sample"
      ? "Change the look and it redraws as you go."
      : "Every frame redrawn with letters and symbols, live.";
}

$("start").addEventListener("click", () => {
  if (state.live) { stopCamera(); say("Camera off."); } else { startCamera(); }
});
$("flip").addEventListener("click", () => {
  state.facing = state.facing === "user" ? "environment" : "user";
  startCamera();
});
$("sample").addEventListener("click", () => {
  if (state.live) { stopCamera(); }
  state.source = "sample";
  say("");
  heroUi();
  render();
});

/* Hidden tab: the camera light goes off. Back again: it comes
   back on by itself (permission was already given). */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (state.live) { stopCamera(); resumeOnShow = true; }
  } else if (resumeOnShow) {
    resumeOnShow = false;
    startCamera();
  }
});
window.addEventListener("pagehide", stopTracks);

/* ============================================================
   6. SNAP
   ============================================================ */
function snapUi() {
  const ready = state.lines.length > 0 && !state.counting;
  $("png").disabled = !ready;
  $("copy").disabled = !ready;
}

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

/* A big, sharp PNG: 12 px a column, 24 px a row. */
async function savePng() {
  const out = { lines: state.lines, cols: state.cols, rows: state.rows, colors: current && current.colors };
  if (!out.lines.length) { return; }
  const W = out.cols * 12;
  const H = out.rows * 24;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  paint(c.getContext("2d"), out, W, H);
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) { note("This browser couldn't make a PNG."); return; }
  const name = `${fileStamp()}.png`;
  downloadBlob(blob, name);
  state.png = { name, bytes: blob.size, width: W, height: H };
  note(`Saved ${name} (${W} × ${H}).`);
}

async function copyText() {
  const text = state.text;
  if (!text) { return; }
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) { throw new Error("no clipboard"); }
    await navigator.clipboard.writeText(text);
    state.copied = "clipboard";
    $("fallback").hidden = true;
    note(`Copied ${state.rows} rows of text. Paste it somewhere with a monospace font.`);
  } catch {
    state.copied = "fallback";
    const ta = $("fallback-text");
    ta.value = text;
    $("fallback").hidden = false;
    ta.focus();
    ta.select();
    note("");
  }
}

$("txt").addEventListener("click", () => {
  downloadBlob(new Blob([$("fallback-text").value], { type: "text/plain" }), `${fileStamp()}.txt`);
});

/* ---- the 3-2-1 timer ---- */
let countTimer = 0;
const countdownEl = $("countdown");

function showNumber(n) {
  $("countdown-n").textContent = String(n);
  countdownEl.setAttribute("aria-label", `${n}. Press to cancel.`);
  if (!reducedMotion()) {
    countdownEl.classList.remove("is-pulsing");
    void countdownEl.offsetWidth;          // restart the animation
    countdownEl.classList.add("is-pulsing");
  }
}

function cancelCountdown(message = "Timer cancelled.") {
  if (!state.counting) { return; }
  clearTimeout(countTimer);
  state.counting = false;
  countdownEl.hidden = true;
  countdownEl.classList.remove("is-pulsing");
  note(message);
  snapUi();
}

function countdown(then) {
  state.counting = true;
  snapUi();
  note("");
  let n = 3;
  countdownEl.hidden = false;
  showNumber(n);
  const tick = () => {
    n -= 1;
    if (n > 0) {
      showNumber(n);
      countTimer = setTimeout(tick, 1000);
      return;
    }
    state.counting = false;
    countdownEl.hidden = true;
    countdownEl.classList.remove("is-pulsing");
    snapUi();
    then();
  };
  countTimer = setTimeout(tick, 1000);
}

function snap(action) {
  if (!state.lines.length || state.counting) { return; }
  if (state.settings.timer) { countdown(action); } else { action(); }
}

$("png").addEventListener("click", () => snap(savePng));
$("copy").addEventListener("click", () => snap(copyText));
countdownEl.addEventListener("click", () => cancelCountdown());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.counting) { e.preventDefault(); cancelCountdown(); }
});

/* ============================================================
   7. FORM
   ============================================================ */
const charsets = [...document.querySelectorAll('input[name="charset"]')];
const colours = [...document.querySelectorAll('input[name="colour"]')];

function outputs(s) {
  $("cols-out").textContent = `${s.cols} columns`;
  $("contrast-out").textContent = s.contrast > 0 ? `+${s.contrast}` : String(s.contrast);
  $("brightness-out").textContent = s.brightness > 0 ? `+${s.brightness}` : String(s.brightness);
  $("custom-row").hidden = s.charset !== "custom";
  const set = charsFor(s.charset, s.custom).map((ch) => (ch === " " ? "space" : ch)).join(" ");
  const empty = s.charset === "custom" && !Array.from(s.custom).length;
  $("charset-hint").textContent = empty
    ? "Type some characters. Until then, Classic is used."
    : `Light ink to heavy: ${set}`;
}

function fillForm() {
  const s = normalizeSettings(save.get());
  state.settings = s;
  $("cols").value = String(s.cols);
  $("contrast").value = String(s.contrast);
  $("brightness").value = String(s.brightness);
  $("custom").value = s.custom;
  $("invert").checked = s.invert;
  $("timer").checked = s.timer;
  for (const r of charsets) { r.checked = r.value === s.charset; }
  for (const r of colours) { r.checked = r.value === s.colour; }
  outputs(s);
}

function change(patch) {
  save.set(patch);
  state.settings = normalizeSettings(save.get());
  outputs(state.settings);
  if (!state.live) { render(); }     // live: the next frame picks it up
}

for (const id of ["cols", "contrast", "brightness"]) {
  $(id).addEventListener("input", () => change({ [id]: Number($(id).value) }));
}
for (const r of charsets) { r.addEventListener("change", () => change({ charset: r.value })); }
for (const r of colours) { r.addEventListener("change", () => change({ colour: r.value })); }
$("custom").addEventListener("input", () => change({ custom: cleanCustom($("custom").value) }));
$("invert").addEventListener("change", () => change({ invert: $("invert").checked }));
$("timer").addEventListener("change", () => change({ timer: $("timer").checked }));
$("reset").addEventListener("click", () => {
  save.set({ ...DEFAULTS, timer: state.settings.timer, custom: state.settings.custom });
  fillForm();
  render();
});

/* ---- go ---- */
fillForm();
heroUi();
render();
/* Redraw once the fonts are in: the title uses Space Grotesk,
   the characters JetBrains Mono. */
Promise.all([
  document.fonts.load("500 20px 'JetBrains Mono'"),
  document.fonts.load("700 40px 'Space Grotesk'")
]).catch(() => {}).then(() => {
  measureFont();
  title = makeTitle();
  render();
  $("hero").dataset.ready = "true";
});
