/* ============================================================
   ITEM TITLE - main script

   Copied from items/_template. Works as-is: tap or press Space
   to score, and the best score is saved. Replace the parts
   marked TODO with the real thing.

   Sections:
     1. save       what this item remembers
     2. state      everything that changes while playing
     3. input      pointer, keys, phone buttons
     4. loop       update (rules) + draw (pictures)
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createCanvas } from "../../kit/canvas.js";
import { startLoop } from "../../kit/loop.js";
import { pointer, createKeys, buttonBar } from "../../kit/input.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { reducedMotion, onMotionChange } from "../../kit/motion.js";

bootItem();

const stage = document.getElementById("stage");
const msg = document.getElementById("msg");
const pauseBtn = document.getElementById("pause");

/* ============================================================
   1. SAVE
   itemSlug() is this folder's name, so a copy gets its own save
   with no edits. Bump version if the shape of the data changes,
   and add migrate(data, fromVersion) to upgrade old saves.
   ============================================================ */
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { best: 0 },
  validate: (d) => (Number.isInteger(d.best) && d.best >= 0) || "Best must be a whole number."
});
mountSavePanel(document.getElementById("save-panel"), save);

/* ============================================================
   2. STATE
   exposeForTests lets smoke.js read it: window.__item.score
   ============================================================ */
const state = exposeForTests({
  score: 0,
  best: save.get().best,
  dots: []                                    // TODO: your game state
});
save.onChange((d) => { state.best = d.best; hud(); });

let calm = reducedMotion();                   // true = no shake/flash/trails
onMotionChange((v) => { calm = v; });

const view = createCanvas(stage, { onResize: () => draw() });
const ctx = view.ctx;

function score(x, y) {
  msg.hidden = true;
  state.score += 1;
  state.dots.push({ x, y, age: calm ? 1 : 0 });
  if (state.score > state.best) {
    state.best = state.score;
    save.set({ best: state.best });
  }
  hud();
}

/* ============================================================
   3. INPUT
   ============================================================ */
const keys = createKeys();

pointer(stage, {
  down(p) { score(p.x, p.y); }
});

buttonBar(document.getElementById("pad-slot"), [
  { action: "action", label: "●", name: "Score", wide: true }
], keys);

keys.on("pause", () => loop.toggle());
pauseBtn.addEventListener("click", () => loop.toggle());

/* ============================================================
   4. LOOP
   ============================================================ */
function update(dt) {
  if (keys.wasPressed("action")) {
    score(Math.random() * view.width, Math.random() * view.height);
  }
  for (const d of state.dots) { d.age = Math.min(1, d.age + dt * 4); }
  if (state.dots.length > 40) { state.dots.shift(); }
}

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

function draw() {
  ctx.fillStyle = color("--bg-2");
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.fillStyle = color("--accent");
  for (const d of state.dots) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, 6 + 10 * d.age, 0, Math.PI * 2);
    ctx.fill();
  }
  /* A label, so the canvas is never blank (the test checks). */
  ctx.fillStyle = color("--text-faint");
  ctx.font = "600 14px 'JetBrains Mono', monospace";
  ctx.fillText(`${state.dots.length} dots`, 12, view.height - 14);
}

function hud() {
  document.getElementById("score").textContent = String(state.score);
  document.getElementById("best").textContent = String(state.best);
}

hud();
const loop = startLoop({
  update,
  draw,
  onPauseChange(paused) {
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    pauseBtn.setAttribute("aria-pressed", String(paused));
    msg.hidden = !paused && state.score > 0;
    msg.textContent = paused ? "Paused" : "Tap or press Space";
  }
});

stage.dataset.ready = "true";
