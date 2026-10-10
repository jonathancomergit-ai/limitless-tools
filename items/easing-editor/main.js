/* ============================================================
   Easing Curve Editor - main script

   The maths lives in ease.js. This file builds the page: the
   curve editor with two handles, the moving previews, presets,
   pinning a second curve to race, and the "Copy as" code.

   Previews move by setting CSS custom properties from JS
   (el.style.setProperty), which the Content-Security-Policy
   allows. There is no style="" in the HTML.

   Sections:
     1. save
     2. state
     3. the editor (draw + drag + keys)
     4. previews (play / loop / duration)
     5. presets + direction
     6. copy as
     7. pin, keys, go
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createCanvas } from "../../kit/canvas.js";
import { startLoop } from "../../kit/loop.js";
import { pointer, createKeys } from "../../kit/input.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { reducedMotion, onMotionChange } from "../../kit/motion.js";
import {
  Y_MIN, Y_MAX, DIRS, PRESETS, DEFAULT_CURVE, EXPORTS,
  clamp, num, cleanPoints, checkCurve, isCurve, easer, fromPreset, presetIdOf, cssValue, linearPoints, breaksOf
} from "./ease.js";

bootItem();

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text != null) { n.textContent = text; }
  return n;
}

/* ============================================================
   1. SAVE
   ============================================================ */
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { curve: DEFAULT_CURVE, pinned: null, duration: 800, loop: false, format: "css" },
  validate: (d) => (isCurve(d.curve) && (d.pinned == null || isCurve(d.pinned))) ||
    "That file doesn't hold Easing Curve Editor curves."
});
mountSavePanel($("save-panel"), save, {
  title: "Your curves",
  intro: "Your current curve, the pinned one and your settings stay on this device. Export to back them up or move them.",
  onImport: () => { load(); renderAll(); },
  onDelete: () => { load(); renderAll(); }
});

/* ============================================================
   2. STATE - window.__item for smoke.js
   ============================================================ */
const state = exposeForTests({
  curve: checkCurve(DEFAULT_CURVE),
  pinned: null,
  duration: 800,       // ms
  loop: false,
  format: "css",
  playing: false,
  t: 1,                // where the previews are, 0..1 of the time
  plays: 0,
  drags: 0
});

function load() {
  const d = save.get();
  state.curve = checkCurve(d.curve);
  state.pinned = d.pinned ? checkCurve(d.pinned) : null;
  state.duration = clamp(Math.round(Number(d.duration) / 50) * 50 || 800, 100, 3000);
  state.loop = Boolean(d.loop);
  state.format = Object.hasOwn(EXPORTS, d.format) ? d.format : "css";
}

let saveTimer = 0;
function store() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save.set({
    curve: state.curve, pinned: state.pinned, duration: state.duration, loop: state.loop, format: state.format
  }), 150);
}

function say(t) { $("status").textContent = t; }

let calm = reducedMotion();
onMotionChange((v) => { calm = v; });

/* The curve functions, rebuilt when a curve changes. */
let fNow = easer(state.curve);
let fPin = null;
function rebuildFns() {
  fNow = easer(state.curve);
  fPin = state.pinned ? easer(state.pinned) : null;
}

/* ============================================================
   3. THE EDITOR
   x = time (0..1, left to right), y = progress (Y_MIN..Y_MAX).
   ============================================================ */
const editor = $("editor");
const handleBtns = [$("h1"), $("h2")];
const view = createCanvas(editor, { onResize: () => drawEditor() });
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

const PAD = { l: 30, r: 26, t: 22, b: 30 };
const toPx = (x, y) => [
  PAD.l + x * (view.width - PAD.l - PAD.r),
  PAD.t + (Y_MAX - y) / (Y_MAX - Y_MIN) * (view.height - PAD.t - PAD.b)
];
const fromPx = (px, py) => [
  (px - PAD.l) / (view.width - PAD.l - PAD.r),
  Y_MAX - (py - PAD.t) / (view.height - PAD.t - PAD.b) * (Y_MAX - Y_MIN)
];

/* Trace any curve function as a path. */
function tracePath(ctx, f, steps = 240) {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const x = i / steps;
    const [px, py] = toPx(x, f(x));
    if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
  }
}
function curvePath(ctx, c, f) {
  if (c.kind === "bezier") {
    /* The screen mapping is a straight scale, so the canvas's own
       Bezier with mapped handles is exactly the same curve. */
    const [x1, y1, x2, y2] = c.p;
    ctx.beginPath();
    ctx.moveTo(...toPx(0, 0));
    ctx.bezierCurveTo(...toPx(x1, y1), ...toPx(x2, y2), ...toPx(1, 1));
  } else {
    tracePath(ctx, f, 400);
  }
}

function drawEditor() {
  const ctx = view.ctx;
  const w = view.width;
  const h = view.height;
  const [x0, yZero] = toPx(0, 0);
  const [x1, yOne] = toPx(1, 1);

  ctx.fillStyle = color("--bg-2");
  ctx.fillRect(0, 0, w, h);

  /* The 0..1 box is a touch lighter: outside it is overshoot. */
  ctx.fillStyle = color("--surface");
  ctx.fillRect(x0, yOne, x1 - x0, yZero - yOne);

  /* Grid every quarter. */
  ctx.fillStyle = color("--line");
  for (let i = 0; i <= 4; i++) {
    const [gx] = toPx(i / 4, 0);
    const [, gy] = toPx(0, i / 4);
    ctx.fillRect(Math.round(gx), yOne, 1, yZero - yOne);
    ctx.fillRect(x0, Math.round(gy), x1 - x0, 1);
  }
  ctx.fillStyle = color("--line-bright");
  ctx.fillRect(x0, Math.round(yZero), x1 - x0, 1);
  ctx.fillRect(x0, Math.round(yOne), x1 - x0, 1);

  /* Labels. */
  ctx.font = "500 11px 'JetBrains Mono', monospace";
  ctx.fillStyle = color("--text-faint");
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText("0", x0 - 7, yZero);
  ctx.fillText("1", x0 - 7, yOne);
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("time →", x1 - 52, h - 6);
  ctx.textBaseline = "top";
  ctx.fillText("↑ progress", x0 + 2, 6);

  /* While playing: a line at the current time. */
  if (state.playing) {
    const [tx] = toPx(state.t, 0);
    ctx.fillStyle = color("--line-bright");
    ctx.fillRect(Math.round(tx), 0, 1, h);
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  /* The pinned curve: cyan, dashed, underneath. */
  if (state.pinned) {
    curvePath(ctx, state.pinned, fPin);
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = color("--cyan");
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Handle arms. */
  const c = state.curve;
  const isBez = c.kind === "bezier";
  const [hx1, hy1] = toPx(c.p[0], c.p[1]);
  const [hx2, hy2] = toPx(c.p[2], c.p[3]);
  ctx.globalAlpha = isBez ? 1 : 0.35;
  ctx.strokeStyle = color("--text-dim");
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, yZero);
  ctx.lineTo(hx1, hy1);
  ctx.moveTo(x1, yOne);
  ctx.lineTo(hx2, hy2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  /* The curve. */
  curvePath(ctx, c, fNow);
  ctx.strokeStyle = color("--accent");
  ctx.lineWidth = 3.5;
  ctx.stroke();

  /* End points. */
  ctx.fillStyle = color("--text");
  for (const [ex, ey] of [[x0, yZero], [x1, yOne]]) {
    ctx.beginPath();
    ctx.arc(ex, ey, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Handles. Faded for bounce / elastic: grab one to go back to a Bezier. */
  ctx.globalAlpha = isBez ? 1 : 0.45;
  [[hx1, hy1], [hx2, hy2]].forEach(([hx, hy], i) => {
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, Math.PI * 2);
    ctx.fillStyle = color("--bg");
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = color("--accent");
    ctx.stroke();
    ctx.fillStyle = color("--accent");
    ctx.font = "700 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), hx, hy + 0.5);
  });
  ctx.globalAlpha = 1;

  /* While playing: the dot riding each curve. */
  if (state.playing) {
    const dots = [[fNow, "--accent"]];
    if (fPin) { dots.unshift([fPin, "--cyan"]); }
    for (const [f, col] of dots) {
      const [dx, dy] = toPx(state.t, f(state.t));
      ctx.beginPath();
      ctx.arc(dx, dy, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = color(col);
      ctx.fill();
    }
  }

  /* Park the focusable buttons on the handles. */
  handleBtns[0].style.setProperty("--x", `${hx1}px`);
  handleBtns[0].style.setProperty("--y", `${hy1}px`);
  handleBtns[1].style.setProperty("--x", `${hx2}px`);
  handleBtns[1].style.setProperty("--y", `${hy2}px`);
}

/* ---- one place every curve change goes through ---- */
function setCurve(curve, { quiet = false } = {}) {
  state.curve = checkCurve(curve);
  rebuildFns();
  renderCurve();
  store();
  if (!quiet) { autoplay(); }
}

/* Move handle i to (x, y). Bounce / elastic become a Bezier again. */
function moveHandle(i, x, y) {
  const p = [...state.curve.p];
  p[i * 2] = x;
  p[i * 2 + 1] = y;
  const next = { kind: "bezier", p: cleanPoints(p), dir: state.curve.dir, name: "Custom" };
  const id = presetIdOf(next);
  if (id) { next.name = PRESETS.find((x2) => x2.id === id).label; }
  state.curve = checkCurve(next);
  rebuildFns();
  renderCurve();
  store();
}

/* ---- drag (touch + mouse + pen) ---- */
let drag = null;   // { i, dx, dy }
const nearest = (x, y) => {
  let best = null;
  state.curve.p.forEach((_, k) => {
    if (k % 2) { return; }
    const [hx, hy] = toPx(state.curve.p[k], state.curve.p[k + 1]);
    const d = Math.hypot(hx - x, hy - y);
    if (!best || d < best.d) { best = { i: k / 2, d, hx, hy }; }
  });
  return best;
};

pointer(editor, {
  down(p) {
    const hit = nearest(p.x, p.y);
    const reach = p.type === "touch" ? 44 : 28;
    if (!hit || hit.d > reach) { return; }
    /* Keep the finger's offset, so the handle doesn't jump under it. */
    drag = { i: hit.i, dx: hit.hx - p.x, dy: hit.hy - p.y };
    editor.classList.add("is-dragging");
    handleBtns[hit.i].focus({ preventScroll: true });
    if (state.curve.kind !== "bezier") { say("Back to a Bezier curve. Pick Bounce or Elastic again any time."); }
  },
  move(p, held) {
    if (!held || !drag) {
      if (p.type === "mouse") {
        const hit = nearest(p.x, p.y);
        editor.classList.toggle("is-near", Boolean(hit && hit.d <= 28));
      }
      return;
    }
    const [x, y] = fromPx(p.x + drag.dx, p.y + drag.dy);
    moveHandle(drag.i, x, y);
  },
  up() {
    if (!drag) { return; }
    drag = null;
    state.drags++;
    editor.classList.remove("is-dragging");
    autoplay();
  }
});

/* ---- arrow keys on a focused handle ---- */
handleBtns.forEach((btn, i) => {
  btn.addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); togglePlay(); return; }
    const step = e.shiftKey ? 0.1 : 0.01;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!move) { return; }
    e.preventDefault();
    const p = state.curve.p;
    moveHandle(i, clamp(p[i * 2] + move[0], 0, 1), clamp(p[i * 2 + 1] + move[1], Y_MIN, Y_MAX));
  });
  btn.addEventListener("keyup", (e) => { if (e.key.startsWith("Arrow")) { autoplay(); } });
});

/* ---- the four number boxes ---- */
const NUM_LABELS = ["x1", "y1", "x2", "y2"];
const numInputs = NUM_LABELS.map((name, k) => {
  const wrap = el("div", "ee-num");
  const label = el("label", null, name);
  label.htmlFor = `n-${name}`;
  const input = Object.assign(el("input"), {
    id: `n-${name}`, type: "number", step: "0.01",
    min: String(k % 2 ? Y_MIN : 0), max: String(k % 2 ? Y_MAX : 1)
  });
  input.setAttribute("inputmode", "decimal");
  input.addEventListener("input", () => {
    const v = Number(input.value);
    if (input.value === "" || !Number.isFinite(v)) { return; }
    const p = [...state.curve.p];
    p[k] = v;
    const i = k < 2 ? 0 : 1;
    moveHandle(i, p[i * 2], p[i * 2 + 1]);
  });
  input.addEventListener("change", () => { input.value = num(state.curve.p[k], 2); autoplay(); });
  wrap.append(label, input);
  $("nums").append(wrap);
  return input;
});

/* Everything that shows the current curve. */
function renderCurve() {
  const c = state.curve;
  const isBez = c.kind === "bezier";
  $("name").textContent = c.name;
  $("value").textContent = isBez
    ? cssValue(c)
    : `${c.kind} ${c.dir} → CSS linear() with ${linearPoints(fNow, { breaks: breaksOf(c) }).length} stops`;
  numInputs.forEach((input, k) => {
    if (document.activeElement !== input) { input.value = num(c.p[k], 2); }
  });
  handleBtns.forEach((b, i) => {
    b.setAttribute("aria-label",
      `Handle ${i + 1}: time ${num(c.p[i * 2], 2)}, progress ${num(c.p[i * 2 + 1], 2)}. Arrow keys move it, Shift for bigger steps.`);
  });
  renderPresets();
  renderExport();
  buildPreviews();
  drawEditor();
}

/* ============================================================
   4. PREVIEWS
   A lane with a ball, a scaling box and a fade, per curve.
   The pinned curve gets a cyan copy of each, to race.
   ============================================================ */
const LEAD = 0.15;   // seconds at the start position before it moves
const TAIL = 0.6;    // seconds at the end before a loop starts again
let parts = [];      // [{ f, ball, box, fade }]

function buildPreviews() {
  const curves = [[state.curve, fNow, false]];
  if (state.pinned) { curves.push([state.pinned, fPin, true]); }

  const lanes = [];
  const boxes = [];
  const fades = [];
  parts = curves.map(([c, f, pinned]) => {
    const lane = el("div", `ee-lane${pinned ? " is-pinned" : ""}`);
    lane.setAttribute("role", "img");
    lane.setAttribute("aria-label", `${pinned ? "Pinned" : "Current"} curve, ${c.name}: a ball moving left to right`);
    const run = el("div", "ee-run");
    /* Onion-skin dots: the ball at each tenth of the time. */
    for (let i = 0; i <= 10; i++) {
      const dot = el("span", "ee-dot");
      dot.style.setProperty("--x", f(i / 10).toFixed(4));
      run.append(dot);
    }
    const ball = el("span", "ee-ball");
    run.append(ball);
    lane.append(run);
    lanes.push(lane);

    const box = el("div", `ee-box${pinned ? " is-pinned" : ""}`);
    const fade = el("div", `ee-fade${pinned ? " is-pinned" : ""}`);
    box.setAttribute("aria-hidden", "true");
    fade.setAttribute("aria-hidden", "true");
    boxes.push(box);
    fades.push(fade);
    return { f, ball, box, fade };
  });
  $("lanes").replaceChildren(...lanes);
  $("scales").replaceChildren(...boxes);
  $("fades").replaceChildren(...fades);
  paintPreviews();
}

function paintPreviews() {
  for (const { f, ball, box, fade } of parts) {
    const v = f(state.t);
    ball.style.setProperty("--x", clamp(v, -0.9, 1.9).toFixed(4));
    box.style.setProperty("--s", Math.max(0.04, 0.2 + 0.8 * v).toFixed(4));
    fade.style.setProperty("--o", clamp(v, 0, 1).toFixed(4));
  }
}

let clock = 0;   // seconds into this run
const loop = startLoop({
  startPaused: true,
  update(dt) {
    if (!state.playing) { return; }
    clock += dt;
    const run = state.duration / 1000;
    state.t = clamp((clock - LEAD) / run, 0, 1);
    if (clock >= LEAD + run) {
      if (state.loop) {
        if (clock >= LEAD + run + TAIL) { clock = 0; state.t = 0; }
      } else {
        stopPlaying();
      }
    }
  },
  draw() {
    paintPreviews();
    drawEditor();
  }
});

function play() {
  clock = 0;
  state.t = 0;
  state.playing = true;
  state.plays++;
  setPlayLabel();
  loop.resume();
}

function stopPlaying() {
  state.playing = false;
  state.t = 1;
  setPlayLabel();
  loop.pause();
  paintPreviews();
  drawEditor();
}

/* Changes replay the previews once - but never for reduced motion,
   and not while a loop is already showing them. */
function autoplay() {
  if (calm || (state.loop && state.playing)) { return; }
  play();
}

function setPlayLabel() {
  const stopping = state.playing && state.loop;
  $("play").replaceChildren(
    el("span", null, stopping ? "■" : "▶"),
    ` ${stopping ? "Stop" : "Play"} `,
    el("kbd", null, "Space")
  );
  $("play").firstChild.setAttribute("aria-hidden", "true");
}

function togglePlay() {
  if (state.playing && state.loop) { stopPlaying(); } else { play(); }
}
$("play").addEventListener("click", togglePlay);

function toggleLoop() {
  state.loop = !state.loop;
  renderLoop();
  store();
  if (state.loop && !state.playing) { play(); }
  setPlayLabel();
}
function renderLoop() { $("loop").setAttribute("aria-pressed", String(state.loop)); }
$("loop").addEventListener("click", toggleLoop);

$("duration").addEventListener("input", () => {
  state.duration = Number($("duration").value);
  $("duration-out").textContent = `${state.duration} ms`;
  renderExport();
  store();
});
$("duration").addEventListener("change", () => autoplay());

/* ============================================================
   5. PRESETS + DIRECTION
   ============================================================ */
/* A tiny picture of each preset's curve. Built as markup from
   numbers only, so the browser gives it the SVG namespace. */
function icon(f) {
  let d = "";
  for (let i = 0; i <= 48; i++) {
    const x = i / 48;
    /* y: 0 sits at 24, 1 at 6. */
    d += `${i ? "L" : "M"}${(2 + x * 30).toFixed(2)} ${(24 - f(x) * 18).toFixed(2)}`;
  }
  const holder = el("span");
  holder.innerHTML = `<svg viewBox="0 0 34 30" aria-hidden="true" focusable="false"><path d="${d}"></path></svg>`;
  return holder.firstElementChild;
}

const presetBtns = PRESETS.map((pre) => {
  const b = el("button", "btn ee-preset");
  b.type = "button";
  b.dataset.preset = pre.id;
  b.append(icon(easer(fromPreset(pre.id))), el("span", null, pre.label));
  b.addEventListener("click", () => {
    const c = fromPreset(pre.id, state.curve.p);
    /* Bounce / elastic keep the direction you picked last. */
    if (c.kind !== "bezier" && state.curve.kind !== "bezier") {
      c.dir = state.curve.dir;
      c.name = `${pre.label} ${c.dir}`;
    }
    setCurve(c);
    say(`${c.name}.`);
  });
  $("presets").append(b);
  return b;
});

const dirInputs = DIRS.map((d) => {
  const input = Object.assign(el("input"), { type: "radio", name: "dir", id: `dir-${d}`, value: d });
  const label = Object.assign(el("label", null, { in: "In", out: "Out", "in-out": "In-out" }[d]), { htmlFor: `dir-${d}` });
  input.addEventListener("change", () => {
    if (!input.checked || state.curve.kind === "bezier") { return; }
    const kind = state.curve.kind;
    setCurve({ ...state.curve, dir: d, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${d}` });
  });
  $("dirs").append(input, label);
  return input;
});

function renderPresets() {
  const id = presetIdOf(state.curve);
  for (const b of presetBtns) { b.setAttribute("aria-pressed", String(b.dataset.preset === id)); }
  const fn = state.curve.kind !== "bezier";
  $("dirs-box").hidden = !fn;
  for (const r of dirInputs) { r.checked = fn && r.value === state.curve.dir; }
}

/* ============================================================
   6. COPY AS
   ============================================================ */
const FORMAT_HINTS = {
  css: "A CSS custom property. Smooth curves come out as cubic-bezier(), bounce and elastic as linear().",
  gd: "Godot 4 GDScript: the closest built-in Tween easing, plus ease_curve() for the exact curve.",
  js: "A plain JavaScript function: give it progress from 0 to 1, get the eased value back."
};
const formatButtons = Object.entries(EXPORTS).map(([key, f]) => {
  const b = el("button", "ee-fmt", f.label);
  b.type = "button";
  b.dataset.format = key;
  b.setAttribute("role", "radio");
  b.addEventListener("click", () => { state.format = key; renderExport(); store(); });
  $("formats").append(b);
  return [key, b];
});

const exportText = () => EXPORTS[state.format].make(state.curve, state.duration);

function renderExport() {
  for (const [key, b] of formatButtons) {
    b.setAttribute("aria-checked", String(key === state.format));
    b.tabIndex = key === state.format ? 0 : -1;
  }
  $("code").textContent = exportText();
  $("format-hint").textContent = FORMAT_HINTS[state.format];
}

/* Arrow keys move between the format buttons, like radio buttons. */
$("formats").addEventListener("keydown", (e) => {
  const keys = Object.keys(EXPORTS);
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) { return; }
  e.preventDefault();
  state.format = keys[(keys.indexOf(state.format) + step + keys.length) % keys.length];
  renderExport();
  store();
  formatButtons.find(([k]) => k === state.format)[1].focus();
});

$("copy").addEventListener("click", async () => {
  const text = exportText();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    /* No clipboard access: select the text so it can be copied by hand. */
    const range = document.createRange();
    range.selectNodeContents($("code"));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  $("copy").textContent = ok ? "Copied!" : "Selected: copy it";
  setTimeout(() => { $("copy").textContent = "Copy"; }, 1600);
});

/* ============================================================
   7. PIN, KEYS, GO
   ============================================================ */
function togglePin() {
  if (state.pinned) {
    state.pinned = null;
    say("Unpinned.");
  } else {
    state.pinned = { ...state.curve, p: [...state.curve.p] };
    say(`Pinned ${state.curve.name}. Now change the curve to race them.`);
  }
  rebuildFns();
  renderPin();
  renderCurve();
  store();
  autoplay();
}
function renderPin() {
  const on = Boolean(state.pinned);
  $("pin").setAttribute("aria-pressed", String(on));
  $("pin").replaceChildren(on ? "Unpin " : "Pin to race ", el("kbd", null, "P"));
  $("pinned").textContent = on ? `Racing: ${state.pinned.name}` : "";
}
$("pin").addEventListener("click", togglePin);

const keys = createKeys({ play: ["Space"], loop: ["KeyL"], pin: ["KeyP"] });
keys.on("play", togglePlay);
keys.on("loop", toggleLoop);
keys.on("pin", togglePin);

function renderAll() {
  rebuildFns();
  $("duration").value = String(state.duration);
  $("duration-out").textContent = `${state.duration} ms`;
  renderLoop();
  renderPin();
  setPlayLabel();
  renderCurve();
}

load();
renderAll();
editor.dataset.ready = "true";

/* Play once to show what the curve does. Reduced motion: wait for Play. */
if (!calm) {
  if (state.loop) { play(); } else { setTimeout(() => { if (!state.playing) { play(); } }, 400); }
}
