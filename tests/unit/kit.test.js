/* ============================================================
   kit/ pure helpers - unit tests
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { backingSize } from "../../kit/canvas.js";
import { actionFor, isTyping, isClickable, DEFAULT_KEYS } from "../../kit/input.js";
import { itemSlug } from "../../kit/item.js";
import { config, ACCENTS, fullName } from "../../kit/config.js";
import { reducedMotion, onMotionChange } from "../../kit/motion.js";
import raw from "../../site.config.js";

test("backingSize: CSS size x pixel ratio, capped, never zero", () => {
  assert.deepEqual(backingSize(390, 600, 3), { scale: 2, width: 780, height: 1200 });
  assert.deepEqual(backingSize(390, 600, 3, 3), { scale: 3, width: 1170, height: 1800 });
  assert.deepEqual(backingSize(100.4, 50.6, 1), { scale: 1, width: 100, height: 51 });
  assert.deepEqual(backingSize(0, 0, 2), { scale: 2, width: 1, height: 1 });
  assert.equal(backingSize(10, 10, 0.5).scale, 1, "zoomed-out desktop still gets 1x");
  assert.equal(backingSize(10, 10, undefined).scale, 1);
});

test("actionFor maps key codes to actions", () => {
  assert.equal(actionFor("ArrowLeft"), "left");
  assert.equal(actionFor("KeyD"), "right");
  assert.equal(actionFor("Space"), "action");
  assert.equal(actionFor("KeyP"), "pause");
  assert.equal(actionFor("KeyQ"), null);
  assert.equal(actionFor("KeyJ", { jump: ["KeyJ"] }), "jump");
  assert.ok(Object.isFrozen(DEFAULT_KEYS));
});

test("isTyping / isClickable look at the focused element", () => {
  const fake = (match) => ({ closest: (sel) => (sel.split(",").some((s) => s.trim().startsWith(match)) ? {} : null) });
  assert.equal(isTyping(fake("input")), true);
  assert.equal(isTyping(fake("canvas")), false);
  assert.equal(isTyping(null), false);
  assert.equal(isClickable(fake("button")), true);
  assert.equal(isClickable(fake("div")), false);
});

test("itemSlug reads the folder name", () => {
  assert.equal(itemSlug("/items/hello/"), "hello");
  assert.equal(itemSlug("/repo/items/orbit-sim/index.html"), "orbit-sim");
  assert.equal(itemSlug("/items/_template/"), "template");
});

test("site.config.js is valid", () => {
  assert.match(raw.wing, /^[a-z][a-z0-9-]*$/);
  assert.ok(ACCENTS.includes(raw.accent), `accent must be one of ${ACCENTS.join(", ")}`);
  assert.equal(config.wing, raw.wing);
  assert.equal(fullName, `Limitless ${raw.name}`);
  assert.equal(config.wings.length, 3);
  assert.ok(Object.isFrozen(config));
});

test("motion helpers are safe outside a browser", () => {
  assert.equal(reducedMotion(), false);
  assert.equal(typeof onMotionChange(() => {}), "function");
});
