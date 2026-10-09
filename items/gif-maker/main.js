/* ============================================================
   GIF Maker - main script

   Photos or a camera clip -> frames in order -> settings with a
   live preview -> one looping .gif, packed in a Web Worker.
   All in this tab: no upload, no server, no library.

   Sections:
     1. save       the settings (never the photos)
     2. state      the frames and what is going on
     3. add        files, drop, paste, the sample
     4. camera     a 1-5 s clip, started by a button
     5. frames     the strip: tap, drag, Earlier / Later, remove
     6. preview    the animated canvas (kit/loop.js)
     7. workers    the size estimate and Make GIF
     8. settings   the form
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { startLoop } from "../../kit/loop.js";
import { reducedMotion } from "../../kit/motion.js";
import {
  DEFAULTS, MAX_FRAMES, MAX_SOURCE, normalizeSettings, targetAspect, cropRect, outputSize, fitWithin,
  moveItem, loopValue, playCount, frameAtTime, clipPlan, estimateBytes, formatBytes, gifFileName
} from "./frames.js";

bootItem();

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const PAL = { bg2: color("--bg-2"), surface2: color("--surface-2"), faint: color("--text-faint") };

/* ============================================================
   1. SAVE - settings only. Photos and clips are never stored.
   ============================================================ */
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { ...DEFAULTS },
  validate: (d) => {
    const n = normalizeSettings(d);
    return (n.size === d.size && n.delay === d.delay && n.crop === d.crop && n.colors === d.colors) ||
      "That file doesn't hold GIF Maker settings.";
  }
});
mountSavePanel($("save-panel"), save, {
  title: "Your settings",
  intro: "Only your GIF settings are saved, on this device. Your photos and clips are never stored.",
  exportLabel: "Export settings",
  importLabel: "Import settings",
  onImport: () => { fillForm(); changed(true); },
  onDelete: () => { fillForm(); changed(true); }
});

/* ============================================================
   2. STATE
   ============================================================ */
const state = exposeForTests({
  settings: normalizeSettings(save.get()),
  frames: [],        // { id, src: canvas, w, h }
  name: "",          // base for the file name (first photo, "sample", "clip")
  chip: -1,          // the frame chosen in the strip
  playing: !reducedMotion(),
  steps: 0,          // how often the preview changed frame (smoke test)
  estimate: 0,       // bytes, "about"
  busy: false,       // Make GIF is running
  result: null,      // { bytes, frames, width, height, name }
  recording: false
});

let nextId = 1;

function say(text) { $("status").textContent = text; }
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* The GIF's shape and size, from the first frame and the settings. */
function aspect() {
  const f = state.frames[0];
  return targetAspect(state.settings.crop, f ? f.w : 4, f ? f.h : 3);
}
function outSize() { return outputSize(aspect(), state.settings.size); }

/* Draw frame f, cropped to the GIF's shape, filling w x h. */
function paint(ctx, f, w, h) {
  const r = cropRect(f.w, f.h, aspect());
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(f.src, r.x, r.y, r.w, r.h, 0, 0, w, h);
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

/* ============================================================
   3. ADD - files, drop, paste, the sample
   ============================================================ */
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

/* Any picture -> a canvas no bigger than MAX_SOURCE a side. */
function toSource(pic, w, h) {
  const size = fitWithin(w, h, MAX_SOURCE);
  const c = document.createElement("canvas");
  c.width = size.width;
  c.height = size.height;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(pic, 0, 0, size.width, size.height);
  return { id: nextId++, src: c, w: size.width, h: size.height };
}

function addFrames(list, name) {
  const room = MAX_FRAMES - state.frames.length;
  const take = list.slice(0, Math.max(0, room));
  if (!state.frames.length && take.length) { state.name = name; }
  state.frames.push(...take);
  framesChanged();
  return list.length - take.length;      // how many didn't fit
}

async function addFiles(files) {
  const pics = [...files].filter((f) => !f.type || /^image\//.test(f.type));
  let skipped = files.length - pics.length;
  if (!pics.length) { say(skipped ? "Those aren't pictures. Choose PNG, JPG, WebP or GIF photos." : ""); return; }
  if (state.frames.length >= MAX_FRAMES) { say(`That's the most a GIF here can hold (${MAX_FRAMES} frames). Remove some first.`); return; }
  say(`Adding ${plural(pics.length, "photo")}…`);
  const made = [];
  for (const file of pics) {
    if (state.frames.length + made.length >= MAX_FRAMES) { skipped++; continue; }
    try {
      const pic = await decode(file);
      const w = pic.width || pic.naturalWidth;
      const h = pic.height || pic.naturalHeight;
      if (!w || !h) { throw new Error("empty"); }
      made.push(toSource(pic, w, h));
      if (pic.close) { pic.close(); }
    } catch {
      skipped++;
    }
  }
  const over = addFrames(made, pics[0].name || "photos");
  skipped += over;
  let text = made.length ? `Added ${plural(made.length - over, "photo")}.` : "Couldn't open those.";
  if (skipped) { text += ` Skipped ${skipped}: not a picture, damaged, or over ${MAX_FRAMES} frames.`; }
  say(text);
}

/* The sample: a ball bouncing across a sky that shifts colour.
   Six frames, drawn in code. */
function sampleFrames() {
  const W = 320;
  const H = 240;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    const t = i / 6;
    const hue = 200 + 140 * t;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `hsl(${hue} 70% 22%)`);
    sky.addColorStop(1, `hsl(${hue + 40} 80% 55%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    /* sun */
    ctx.fillStyle = "hsl(45 100% 70%)";
    ctx.beginPath();
    ctx.arc(250, 62 + i * 3, 26, 0, Math.PI * 2);
    ctx.fill();
    /* ground */
    ctx.fillStyle = "hsl(150 40% 18%)";
    ctx.fillRect(0, 196, W, H - 196);
    ctx.fillStyle = "hsl(150 45% 28%)";
    ctx.fillRect(0, 196, W, 6);
    /* ball: up and down, squashed on the ground */
    const lift = Math.sin(t * Math.PI) * 120;
    const squash = i === 0 ? 0.72 : 1;
    const r = 24;
    const x = 60 + i * 34;
    const y = 196 - r * squash - lift;
    ctx.fillStyle = "rgba(0, 0, 0, .35)";
    ctx.beginPath();
    ctx.ellipse(x, 199, r * (1.1 - lift / 300), 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FF2D78";
    ctx.beginPath();
    ctx.ellipse(x, y, r / squash, r * squash, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, .8)";
    ctx.beginPath();
    ctx.arc(x - 8, y - 8, 6, 0, Math.PI * 2);
    ctx.fill();
    out.push({ id: nextId++, src: c, w: W, h: H });
  }
  return out;
}

$("sample").addEventListener("click", () => {
  const over = addFrames(sampleFrames(), "sample");
  say(over ? `Added the sample, but only ${6 - over} frames fitted.` : "Added the sample: 6 frames of a bouncing ball.");
});

const picker = $("file");
picker.addEventListener("change", () => {
  if (picker.files && picker.files.length) { addFiles(picker.files); }
  picker.value = "";      // so choosing the same files again still works
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
  const files = e.dataTransfer?.files;
  if (files && files.length) { addFiles(files); } else { say("That wasn't a file. Drop photos from your device."); }
});
window.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); addFiles(files); }
});

/* ============================================================
   4. CAMERA - only after a button press; tracks stop when done
   ============================================================ */
const video = $("video");
let stream = null;

function cameraProblem(err) {
  switch (err && err.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera blocked. Allow the camera for this site in your browser settings, or add photos instead.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera found on this device. Add photos instead, or try the sample.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is busy (another app may be using it). Close that and try again.";
    default:
      return "Couldn't start the camera. Add photos instead, or try the sample.";
  }
}

async function openCamera() {
  if (stream) { return; }
  if (!window.isSecureContext) { say("The camera only works on a secure (https) page."); return; }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    say("This browser can't use a camera here. Add photos instead, or try the sample.");
    return;
  }
  say("Asking for the camera…");
  $("cam-open").disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
  } catch (err) {
    stream = null;
    $("cam-open").disabled = false;
    say(cameraProblem(err));
    return;
  }
  say("");
  $("cam-card").hidden = false;
  video.srcObject = stream;
  try { await video.play(); } catch { /* muted + playsinline usually plays */ }
  $("rec").disabled = false;
  camPlan();
  $("cam-card").scrollIntoView({ block: "nearest" });
}

function closeCamera() {
  if (stream) { for (const t of stream.getTracks()) { t.stop(); } }
  stream = null;
  video.srcObject = null;
  $("cam-card").hidden = true;
  $("cam-open").disabled = false;
  $("rec").disabled = true;
}

function camPlan() {
  const p = clipPlan(state.settings.clipSeconds, state.settings.delay, MAX_FRAMES - state.frames.length);
  $("cam-plan").textContent = p.count ? `${plural(p.count, "frame")}, one every ${p.interval} ms` : "No room for more frames";
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

async function record() {
  if (!stream || state.recording) { return; }
  const plan = clipPlan(state.settings.clipSeconds, state.settings.delay, MAX_FRAMES - state.frames.length);
  if (!plan.count) { say(`That's the most a GIF here can hold (${MAX_FRAMES} frames).`); return; }
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) { say("The camera isn't ready yet. Try again in a moment."); return; }

  state.recording = true;
  const btn = $("rec");
  btn.disabled = true;
  btn.textContent = "Recording…";
  $("rec-box").hidden = false;
  const bar = $("rec-progress");
  bar.value = 0;
  const shots = [];
  const start = performance.now();
  for (let i = 0; i < plan.count; i++) {
    await wait(start + i * plan.interval - performance.now());
    if (!stream) { break; }               // tab hidden or closed mid-clip
    shots.push(toSource(video, vw, vh));
    bar.value = (i + 1) / plan.count;
  }
  state.recording = false;
  btn.textContent = "Record";
  $("rec-box").hidden = true;
  closeCamera();
  if (shots.length) {
    addFrames(shots, "clip");
    say(`Recorded ${plural(shots.length, "frame")}. The camera is off.`);
  }
}

$("cam-open").addEventListener("click", openCamera);
$("cam-close").addEventListener("click", () => { closeCamera(); say("Camera off."); });
$("rec").addEventListener("click", record);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && stream) { closeCamera(); say("Camera turned off because the tab was hidden."); }
});

/* ============================================================
   5. FRAMES - the strip
   ============================================================ */
const strip = $("strip");
const THUMB = 56;

function thumb(c, f) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.round(THUMB * dpr);
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  checker(g, size, size, Math.round(7 * dpr));
  const a = aspect();
  const w = a >= 1 ? size : Math.round(size * a);
  const h = a >= 1 ? Math.round(size / a) : size;
  const r = cropRect(f.w, f.h, a);
  g.imageSmoothingQuality = "high";
  g.drawImage(f.src, r.x, r.y, r.w, r.h, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
}

function renderStrip() {
  const items = state.frames.map((f, i) => {
    const li = document.createElement("li");
    li.dataset.id = String(f.id);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gm-chip";
    b.dataset.pos = String(i);
    b.setAttribute("aria-pressed", String(state.chip === i));
    b.setAttribute("aria-label", `Frame ${i + 1} of ${state.frames.length}`);
    const c = document.createElement("canvas");
    c.setAttribute("aria-hidden", "true");
    thumb(c, f);
    const n = document.createElement("span");
    n.textContent = String(i + 1);
    b.append(c, n);
    li.append(b);
    return li;
  });
  strip.replaceChildren(...items);
  orderTools();
}

function orderTools() {
  const n = state.frames.length;
  const has = state.chip >= 0 && state.chip < n;
  $("move-left").disabled = !has || state.chip === 0;
  $("move-right").disabled = !has || state.chip === n - 1;
  $("remove").disabled = !has;
  $("clear").disabled = !n;
}

function chipAt(i) { return strip.querySelector(`.gm-chip[data-pos="${i}"]`); }

function chooseChip(i) {
  state.chip = i;
  for (const b of strip.querySelectorAll(".gm-chip")) { b.setAttribute("aria-pressed", String(Number(b.dataset.pos) === i)); }
  orderTools();
}

function moveChip(d) {
  const from = state.chip;
  const to = from + d;
  if (from < 0 || to < 0 || to >= state.frames.length) { return; }
  state.frames = moveItem(state.frames, from, to);
  state.chip = to;
  framesChanged(false);
  chipAt(to)?.focus();
}

function removeChip() {
  if (state.chip < 0) { return; }
  state.frames.splice(state.chip, 1);
  state.chip = Math.min(state.chip, state.frames.length - 1);
  framesChanged(false);
  if (state.chip >= 0) { chipAt(state.chip)?.focus(); } else { $("sample").focus(); }
}

strip.addEventListener("click", (e) => {
  const b = e.target.closest(".gm-chip");
  if (!b || Date.now() < noClickUntil) { return; }
  const i = Number(b.dataset.pos);
  chooseChip(state.chip === i ? -1 : i);
});
strip.addEventListener("keydown", (e) => {
  const b = e.target.closest(".gm-chip");
  if (!b) { return; }
  const i = Number(b.dataset.pos);
  if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    state.chip = i;
    moveChip(e.key === "ArrowLeft" ? -1 : 1);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const j = Math.max(0, Math.min(state.frames.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)));
    chipAt(j)?.focus();
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
$("clear").addEventListener("click", () => {
  state.frames = [];
  state.chip = -1;
  framesChanged();
  say("All frames removed.");
  $("sample").focus();
});

/* ---- drag to reorder (pointer events: touch, pen and mouse) ----
   The chip follows the finger; crossing another chip moves it
   there in the DOM. Let go and the new order is kept. On touch,
   chips allow vertical page scrolling (touch-action: pan-y), so
   a drag starts with a sideways move. */
let drag = null;
let noClickUntil = 0;

strip.addEventListener("pointerdown", (e) => {
  const b = e.target.closest(".gm-chip");
  if (!b || e.button > 0 || state.busy) { return; }
  const r = b.getBoundingClientRect();
  drag = { b, li: b.parentElement, pid: e.pointerId, x0: e.clientX, y0: e.clientY, gx: e.clientX - r.left, gy: e.clientY - r.top, on: false };
});

strip.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pid) { return; }
  const dx = e.clientX - drag.x0;
  const dy = e.clientY - drag.y0;
  if (!drag.on) {
    if (Math.hypot(dx, dy) < 8) { return; }
    if (e.pointerType === "touch" && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }   // a scroll
    drag.on = true;
    try { drag.b.setPointerCapture(drag.pid); } catch { /* fine without */ }
    drag.b.classList.add("is-dragging");
    strip.classList.add("is-sorting");
  }
  e.preventDefault();

  /* Which chip is under the finger? */
  const lis = [...strip.children];
  const over = lis.find((li) => {
    if (li === drag.li) { return false; }
    const r = li.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  /* Move the OTHER chips past it: moving the dragged one itself
     would take it out of the page for a moment and drop the
     pointer capture. */
  if (over) {
    const from = lis.indexOf(drag.li);
    const to = lis.indexOf(over);
    if (from < to) {
      for (const li of lis.slice(from + 1, to + 1)) { strip.insertBefore(li, drag.li); }
    } else {
      const after = drag.li.nextSibling;
      for (const li of lis.slice(to, from)) { strip.insertBefore(li, after); }
    }
  }
  /* Keep the chip under the finger wherever its slot now is. */
  drag.b.style.transform = "";
  const home = drag.b.getBoundingClientRect();
  drag.b.style.transform = `translate(${e.clientX - drag.gx - home.left}px, ${e.clientY - drag.gy - home.top}px)`;
});

function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.pid)) { return; }
  const d = drag;
  drag = null;
  if (!d.on) { return; }
  d.b.style.transform = "";
  d.b.classList.remove("is-dragging");
  strip.classList.remove("is-sorting");
  noClickUntil = Date.now() + 300;          // the click after a drag isn't a tap
  const ids = [...strip.children].map((li) => Number(li.dataset.id));
  const byId = new Map(state.frames.map((f) => [f.id, f]));
  const moved = Number(d.li.dataset.id);
  state.frames = ids.map((id) => byId.get(id)).filter(Boolean);
  state.chip = state.frames.findIndex((f) => f.id === moved);
  framesChanged(false);
  chipAt(state.chip)?.focus({ preventScroll: true });
}
strip.addEventListener("pointerup", endDrag);
strip.addEventListener("pointercancel", (e) => {
  if (drag && drag.on) { endDrag(e); } else { drag = null; }
});
strip.addEventListener("lostpointercapture", (e) => { if (drag && drag.on) { endDrag(e); } });

/* After any change to the list of frames. */
function framesChanged(resetChip = true) {
  const n = state.frames.length;
  if (resetChip) { state.chip = -1; }
  if (state.chip >= n) { state.chip = n - 1; }
  const has = n > 0;
  for (const id of ["frames-card", "preview-card", "make-card"]) { $(id).hidden = !has; }
  $("drop").classList.toggle("is-loaded", has);
  $("drop-title").textContent = has ? "Add more" : "Drop photos here";
  $("drop-sub").textContent = has ? `${plural(n, "frame")} so far. Up to ${MAX_FRAMES}.` : "A few photos in a row make the best GIFs.";
  document.querySelector(".gm-pick").textContent = has ? "Add photos" : "Choose photos";
  $("count").textContent = plural(n, "frame");
  renderStrip();
  camPlan();
  changed();
}

/* ============================================================
   6. PREVIEW - the frames as they will play, before packing
   ============================================================ */
const anim = $("anim");
const actx = anim.getContext("2d");
let t = 0;
let shown = -1;

function sizePreview() {
  const { width, height } = outSize();
  if (anim.width !== width || anim.height !== height) {
    anim.width = width;
    anim.height = height;
  }
  /* The box keeps the GIF's shape, never taller than 420 px. */
  const stage = $("stage");
  stage.style.aspectRatio = `${width} / ${height}`;
  stage.style.maxWidth = `${Math.round((420 * width) / height)}px`;
  const n = state.frames.length;
  const secs = (n * state.settings.delay) / 1000;
  $("dims").textContent = `${width} × ${height} px · ${secs.toFixed(secs < 10 ? 1 : 0)} s`;
  shown = -1;
}

function restart() { t = 0; shown = -1; }

function drawPreview() {
  if ($("preview-card").hidden) { return; }
  const n = state.frames.length;
  const plays = playCount(state.settings);
  const i = frameAtTime(t, n, state.settings.delay, plays);
  /* "Once" / "Times": stop after the last play, like the GIF will. */
  if (state.playing && n && plays !== Infinity && t * 1000 >= n * plays * state.settings.delay) {
    state.playing = false;
    loop.pause();
    playUi(true);
  }
  if (i < 0 || i === shown) { return; }
  shown = i;
  state.steps += 1;
  const { width, height } = anim;
  checker(actx, width, height, 10);
  paint(actx, state.frames[i], width, height);
  $("frame-label").textContent = `frame ${i + 1} of ${n}`;
}

const loop = startLoop({
  update(dt) { t += dt; },
  draw: drawPreview,
  startPaused: !state.playing
});

function playUi(ended = false) {
  const btn = $("play");
  btn.textContent = state.playing ? "Pause" : ended ? "Play again" : "Play";
  btn.setAttribute("aria-pressed", String(state.playing));
}
$("play").addEventListener("click", () => {
  const n = state.frames.length;
  const plays = playCount(state.settings);
  if (!state.playing && plays !== Infinity && t * 1000 >= n * plays * state.settings.delay) { restart(); }
  state.playing = !state.playing;
  if (state.playing) { loop.resume(); } else { loop.pause(); }
  playUi();
});

/* ============================================================
   7. WORKERS
   One for the quick size estimate, one for Make GIF, so a long
   encode never holds up the estimate (and Cancel can just stop
   the Make worker).
   ============================================================ */
const newWorker = () => new Worker(new URL("./gif-worker.js", import.meta.url), { type: "module" });

/* All frames at w x h as RGBA buffers, ready to transfer. */
const grab = document.createElement("canvas");
const gctx = grab.getContext("2d", { willReadFrequently: true });
function rgbaFrames(w, h) {
  grab.width = w;
  grab.height = h;
  return state.frames.map((f) => {
    paint(gctx, f, w, h);
    return { data: gctx.getImageData(0, 0, w, h).data.buffer, delay: state.settings.delay };
  });
}

function job(w, h, frames) {
  const s = state.settings;
  return { width: w, height: h, frames, colors: s.colors, dither: s.dither, loop: loopValue(s) };
}

/* ---- the estimate: encode a small copy, scale the answer up ---- */
const SAMPLE = 128;
let estWorker = null;
let estId = 0;
let estBusy = false;
let estAgain = false;
let estTimer = 0;
let estPending = null;

function scheduleEstimate() {
  clearTimeout(estTimer);
  if (!state.frames.length) { $("estimate").textContent = ""; return; }
  $("estimate").textContent = "about …";
  estTimer = setTimeout(runEstimate, 250);
}

function runEstimate() {
  if (!state.frames.length) { return; }
  if (estBusy) { estAgain = true; return; }
  const full = outSize();
  const small = fitWithin(full.width, full.height, SAMPLE);
  const frames = rgbaFrames(small.width, small.height);
  if (!estWorker) {
    estWorker = newWorker();
    estWorker.addEventListener("message", onEstimate);
    estWorker.addEventListener("error", () => { estBusy = false; $("estimate").textContent = ""; });
  }
  estBusy = true;
  estPending = { id: ++estId, small, full, count: frames.length };
  estWorker.postMessage({ id: estId, ...job(small.width, small.height, frames) }, frames.map((f) => f.data));
}

function onEstimate(e) {
  const m = e.data;
  const p = estPending;
  if (m.type === "progress" || !p || m.id !== p.id) { return; }
  estBusy = false;
  if (m.type === "done") {
    const head = new Uint8Array(m.bytes, 0, 11);
    state.estimate = estimateBytes({
      sampleBytes: m.bytes.byteLength,
      sampleW: p.small.width,
      sampleH: p.small.height,
      width: p.full.width,
      height: p.full.height,
      frames: p.count,
      tableBits: (head[10] & 7) + 1
    });
    $("estimate").textContent = `about ${formatBytes(state.estimate)}`;
  }
  if (estAgain) { estAgain = false; runEstimate(); }
}

/* ---- Make GIF ---- */
let makeWorker = null;
let makeId = 0;
let resultUrl = "";
let made = "";       // what the shown result was made from (to spot changes)

function signature() {
  return JSON.stringify([{ ...state.settings, clipSeconds: 0 }, state.frames.map((f) => f.id)]);
}

function setBusy(on) {
  state.busy = on;
  $("make").disabled = on;
  $("make").textContent = on ? "Making…" : "Make GIF";
  $("cancel").hidden = !on;
  $("progress-box").hidden = !on;
  for (const id of ["move-left", "move-right", "remove", "clear"]) { if (on) { $(id).disabled = true; } }
  if (!on) { orderTools(); }
}

async function makeGif() {
  if (state.busy || !state.frames.length) { return; }
  const { width, height } = outSize();
  setBusy(true);
  $("progress").value = 0;
  $("make-status").textContent = "Getting the frames ready…";
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));   // let the button repaint
  const sig = signature();
  const name = gifFileName(state.name);
  let frames;
  try {
    frames = rgbaFrames(width, height);
  } catch {
    setBusy(false);
    $("make-status").textContent = "This browser ran out of room. Try a smaller size or fewer frames.";
    return;
  }
  if (!makeWorker) {
    makeWorker = newWorker();
    makeWorker.addEventListener("error", (e) => {
      e.preventDefault();
      stopMaker();
      $("make-status").textContent = "Couldn't make the GIF in this browser.";
    });
  }
  const id = ++makeId;
  makeWorker.onmessage = (e) => {
    const m = e.data;
    if (m.id !== id) { return; }
    if (m.type === "progress") {
      $("progress").value = m.total ? m.done / m.total : 0;
      $("make-status").textContent = m.done ? `Packing frame ${m.done} of ${m.total}…` : "Picking the colours…";
    } else if (m.type === "done") {
      setBusy(false);
      showResult(new Uint8Array(m.bytes), { name, width, height, frames: frames.length, sig });
    } else {
      setBusy(false);
      $("make-status").textContent = m.message || "Couldn't make the GIF.";
    }
  };
  makeWorker.postMessage({ id, ...job(width, height, frames) }, frames.map((f) => f.data));
}

function stopMaker() {
  if (makeWorker) { makeWorker.terminate(); makeWorker = null; }
  setBusy(false);
}

function showResult(bytes, info) {
  if (resultUrl) { URL.revokeObjectURL(resultUrl); }
  resultUrl = URL.createObjectURL(new Blob([bytes], { type: "image/gif" }));
  made = info.sig;
  state.result = { bytes: bytes.length, frames: info.frames, width: info.width, height: info.height, name: info.name };
  $("result").hidden = false;
  $("result-img").src = resultUrl;
  $("result-info").textContent = `${formatBytes(bytes.length)} · ${info.width} × ${info.height} px · ${plural(info.frames, "frame")}`;
  const a = $("download");
  a.href = resultUrl;
  a.download = info.name;
  a.textContent = `Download ${info.name}`;
  a.hidden = false;
  $("stale").hidden = true;
  $("make-status").textContent = `Done: ${formatBytes(bytes.length)}.`;
}

$("make").addEventListener("click", makeGif);
$("cancel").addEventListener("click", () => {
  stopMaker();
  $("make-status").textContent = "Stopped.";
});

/* ============================================================
   8. SETTINGS
   ============================================================ */
const radios = (name) => [...document.querySelectorAll(`input[name="${name}"]`)];
const groups = { size: radios("size"), crop: radios("crop"), loop: radios("loop"), clipSeconds: radios("secs") };

function delayText(ms) {
  const fps = 1000 / ms;
  return `${ms} ms · ${fps >= 10 ? Math.round(fps) : fps.toFixed(1)} fps`;
}

function fillForm() {
  const s = normalizeSettings(save.get());
  state.settings = s;
  for (const [key, list] of Object.entries(groups)) {
    for (const r of list) { r.checked = r.value === String(s[key]); }
  }
  $("delay").value = String(s.delay);
  $("delay-out").textContent = delayText(s.delay);
  $("colors").value = String(s.colors);
  $("colors-out").textContent = String(s.colors);
  $("loop-count").value = String(s.loopCount);
  $("times-row").hidden = s.loop !== "times";
  $("dither").checked = s.dither;
}

function readForm() {
  const pick = (list) => list.find((r) => r.checked)?.value;
  const before = state.settings;
  save.set(normalizeSettings({
    ...save.get(),
    size: Number(pick(groups.size)),
    crop: pick(groups.crop),
    loop: pick(groups.loop),
    clipSeconds: Number(pick(groups.clipSeconds)),
    delay: Number($("delay").value),
    colors: Number($("colors").value),
    loopCount: $("loop-count").value === "" ? before.loopCount : Number($("loop-count").value),
    dither: $("dither").checked
  }));
  const s = normalizeSettings(save.get());
  state.settings = s;
  $("delay-out").textContent = delayText(s.delay);
  $("colors-out").textContent = String(s.colors);
  $("times-row").hidden = s.loop !== "times";
  if (s.loop !== before.loop || s.loopCount !== before.loopCount) { restart(); }
  changed(s.crop !== before.crop);
}

/* Something that affects the GIF changed. reshape: the crop
   changed, so the thumbnails need drawing again. */
function changed(reshape = false) {
  if (reshape && state.frames.length) { renderStrip(); }
  sizePreview();
  drawPreview();
  camPlan();
  scheduleEstimate();
  if (state.result) { $("stale").hidden = signature() === made; }
}

for (const list of Object.values(groups)) { for (const r of list) { r.addEventListener("change", readForm); } }
$("delay").addEventListener("input", readForm);
$("colors").addEventListener("input", readForm);
$("dither").addEventListener("change", readForm);
$("loop-count").addEventListener("change", () => { readForm(); fillForm(); });

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.frames.length) { renderStrip(); } }, 150);
});

fillForm();
playUi();
orderTools();
drop.dataset.ready = "true";
