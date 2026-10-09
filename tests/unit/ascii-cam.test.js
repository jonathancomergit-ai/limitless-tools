/* ============================================================
   ASCII Cam - unit tests

   "Darkest" and "lightest" depend on the colour mode, so here
   is the rule the tests check:

     Every character set is ordered by INK: a space first (no
     ink), the fullest character last ("@", "█").

     Light ink on a dark screen (green terminal, white on black,
     full colour): the space is the darkest character, the
     fullest is the lightest. Black -> " ", white -> "@".

     Dark ink on paper (black on white): it flips. The space is
     the lightest, the fullest the darkest. Black -> "@",
     white -> " ".
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHARSETS, DEFAULTS, LOOKS, toAscii, normalizeSettings, charsFor, cleanCustom, gridRows,
  adjust, contrastFactor, luma, levelIndex, asText, hasInk, fileStamp, cameraError
} from "../../items/ascii-cam/ascii.js";

/* ---- a tiny RGBA image builder ---- */
function solid(w, h, [r, g, b, a = 255]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d.set([r, g, b, a], i * 4); }
  return d;
}
/* Left-to-right grey ramp, 0 -> 255. */
function ramp(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255);
      d.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return d;
}
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const first = (set) => Array.from(set)[0];
const last = (set) => Array.from(set).at(-1);
const one = (rgb, opts) => toAscii(solid(4, 4, rgb), 4, 4, { cols: 1, rows: 1, ...opts }).lines[0];

/* ---- black -> darkest, white -> lightest -------------------- */

test("dark screen modes: black -> space (darkest), white -> fullest (lightest)", () => {
  for (const colour of ["green", "white", "colour"]) {
    assert.equal(LOOKS[colour].ink, "light");
    for (const charset of ["classic", "blocks", "binary"]) {
      assert.equal(one(BLACK, { colour, charset }), first(CHARSETS[charset]), `${colour}/${charset} black`);
      assert.equal(one(WHITE, { colour, charset }), last(CHARSETS[charset]), `${colour}/${charset} white`);
    }
  }
  assert.equal(one(BLACK, { colour: "green" }), " ");
  assert.equal(one(WHITE, { colour: "green" }), "@");
  assert.equal(one(WHITE, { colour: "white", charset: "blocks" }), "█");
});

test("black on white (paper): the mapping flips, black -> fullest, white -> space", () => {
  assert.equal(LOOKS.paper.ink, "dark");
  for (const charset of ["classic", "blocks", "binary"]) {
    assert.equal(one(BLACK, { colour: "paper", charset }), last(CHARSETS[charset]));
    assert.equal(one(WHITE, { colour: "paper", charset }), first(CHARSETS[charset]));
  }
});

test("invert flips it once more", () => {
  assert.equal(one(BLACK, { colour: "green", invert: true }), "@");
  assert.equal(one(WHITE, { colour: "green", invert: true }), " ");
  assert.equal(one(BLACK, { colour: "paper", invert: true }), " ");
});

test("a grey ramp walks through every character in order", () => {
  const set = Array.from(CHARSETS.classic);
  const out = toAscii(ramp(100, 1), 100, 1, { cols: set.length, rows: 1 }).lines[0];
  assert.deepEqual(Array.from(out), set);
});

test("characters are ordered by ink: space first, fullest last", () => {
  for (const set of Object.values(CHARSETS)) { assert.equal(first(set), " "); }
  assert.equal(last(CHARSETS.classic), "@");
  assert.equal(last(CHARSETS.blocks), "█");
});

/* ---- custom sets --------------------------------------------- */

test("custom sets work, including multi-byte characters", () => {
  assert.equal(one(BLACK, { charset: "custom", custom: "ab" }), "a");
  assert.equal(one(WHITE, { charset: "custom", custom: "ab" }), "b");
  assert.equal(one(WHITE, { charset: "custom", custom: "·★" }), "★");
  assert.equal(one(BLACK, { charset: "custom", custom: "🌑🌓🌕" }), "🌑");
  assert.equal(one(WHITE, { charset: "custom", custom: "🌑🌓🌕" }), "🌕");
  assert.equal(one([128, 128, 128], { charset: "custom", custom: "🌑🌓🌕" }), "🌓");
  /* one character: every cell gets it */
  assert.equal(one(BLACK, { charset: "custom", custom: "x" }), "x");
  assert.equal(one(WHITE, { charset: "custom", custom: "x" }), "x");
});

test("an empty custom set falls back to classic; line breaks are dropped", () => {
  assert.deepEqual(charsFor("custom", ""), Array.from(CHARSETS.classic));
  assert.deepEqual(charsFor("custom", "a\nb\tc"), ["a", "b", "c"]);
  assert.equal(Array.from(cleanCustom("x".repeat(100))).length, 64);
  assert.equal(one(WHITE, { charset: "custom", custom: "" }), "@");
  assert.deepEqual(charsFor("nope"), Array.from(CHARSETS.classic));
});

/* ---- size: rows x cols ---------------------------------------- */

test("output has exactly rows x cols", () => {
  for (const [w, h, cols, rows] of [[64, 48, 40, 15], [10, 10, 7, 3], [3, 2, 9, 5], [320, 240, 160, 60]]) {
    const out = toAscii(ramp(w, h), w, h, { cols, rows });
    assert.equal(out.lines.length, rows);
    assert.equal(out.rows, rows);
    assert.equal(out.cols, cols);
    for (const line of out.lines) { assert.equal(Array.from(line).length, cols); }
  }
  /* blocks and emoji are one character each */
  const b = toAscii(ramp(30, 20), 30, 20, { cols: 12, rows: 4, charset: "custom", custom: "🌑🌓🌕" });
  for (const line of b.lines) { assert.equal(Array.from(line).length, 12); }
});

test("rows are worked out for tall characters (about half the columns for a square)", () => {
  assert.equal(gridRows(100, 100, 80), 40);
  assert.equal(gridRows(640, 480, 64), 24);
  assert.equal(gridRows(480, 640, 60), 40);
  assert.equal(gridRows(1000, 1, 80), 1);       // never zero
  assert.equal(gridRows(1, 1000, 160), 200);    // capped
  const out = toAscii(ramp(640, 480), 640, 480, { cols: 64 });
  assert.equal(out.lines.length, 24);
});

test("full colour mode returns a colour for every cell", () => {
  const out = toAscii(solid(8, 8, [255, 0, 0]), 8, 8, { cols: 4, rows: 2, colour: "colour" });
  assert.equal(out.colors.length, 4 * 2 * 3);
  assert.deepEqual([...out.colors.slice(0, 3)], [255, 0, 0]);
  assert.equal(toAscii(solid(8, 8, [255, 0, 0]), 8, 8, { cols: 4, rows: 2 }).colors, null);
});

test("see-through counts as black", () => {
  assert.equal(one([255, 255, 255, 0], { colour: "green" }), " ");
});

/* ---- contrast + brightness ------------------------------------ */

test("brightness lifts or darkens everything", () => {
  const grey = [128, 128, 128];
  const mid = one(grey);
  const set = CHARSETS.classic;
  assert.ok(set.indexOf(one(grey, { brightness: 60 })) > set.indexOf(mid));
  assert.ok(set.indexOf(one(grey, { brightness: -60 })) < set.indexOf(mid));
  assert.equal(one(grey, { brightness: 100 }), "@");
  assert.equal(one(grey, { brightness: -100 }), " ");
});

test("contrast pushes greys apart; -100 flattens to mid grey", () => {
  assert.equal(contrastFactor(0), 1);
  assert.equal(contrastFactor(100), 5);
  assert.equal(contrastFactor(-100), 0);
  assert.equal(adjust(0.5, 100), 0.5);           // mid grey stays put
  assert.ok(adjust(0.6, 50) > 0.6);
  assert.ok(adjust(0.4, 50) < 0.4);
  assert.equal(adjust(0.1, -100), 0.5);
  assert.equal(adjust(0.9, -100), 0.5);
  /* more contrast = more distinct characters off a soft ramp */
  const soft = new Uint8ClampedArray(20 * 4);
  for (let x = 0; x < 20; x++) { const v = 100 + x * 3; soft.set([v, v, v, 255], x * 4); }
  const count = (c) => new Set(toAscii(soft, 20, 1, { cols: 20, rows: 1, contrast: c }).lines[0]).size;
  assert.ok(count(80) > count(0));
  assert.equal(count(-100), 1);
});

test("luma and levelIndex", () => {
  assert.equal(luma(0, 0, 0), 0);
  assert.ok(Math.abs(luma(255, 255, 255) - 1) < 1e-9);
  assert.ok(luma(0, 255, 0) > luma(255, 0, 0));
  assert.equal(levelIndex(0, 10), 0);
  assert.equal(levelIndex(1, 10), 9);
  assert.equal(levelIndex(1, 10, { ink: "dark" }), 0);
  assert.equal(levelIndex(0.5, 1), 0);
});

/* ---- settings + helpers -------------------------------------- */

test("normalizeSettings fills gaps and clamps", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULTS);
  assert.deepEqual(normalizeSettings(null), DEFAULTS);
  const s = normalizeSettings({ cols: 9999, contrast: -500, brightness: "x", charset: "emoji", colour: "pink", invert: "yes", custom: 5 });
  assert.equal(s.cols, 160);
  assert.equal(s.contrast, -100);
  assert.equal(s.brightness, 0);
  assert.equal(s.charset, "classic");
  assert.equal(s.colour, "green");
  assert.equal(s.invert, false);
  assert.equal(s.custom, DEFAULTS.custom);
  assert.equal(normalizeSettings({ cols: 3 }).cols, 24);
});

test("asText trims line ends; hasInk spots an all-space picture", () => {
  assert.equal(asText(["ab  ", "  c "]), "ab\n  c\n");
  assert.equal(hasInk(["   ", "  "]), false);
  assert.equal(hasInk(["  .", "  "]), true);
  const dark = toAscii(solid(8, 8, BLACK), 8, 8, { cols: 8 });
  assert.equal(hasInk(dark.lines), false);
});

test("fileStamp and camera messages", () => {
  assert.equal(fileStamp(new Date(2026, 9, 9, 7, 5, 3)), "ascii-cam-20261009-070503");
  assert.match(cameraError({ name: "NotAllowedError" }), /denied/);
  assert.match(cameraError({ name: "NotFoundError" }), /No camera/);
  assert.match(cameraError({ name: "NotReadableError" }), /busy/);
  assert.match(cameraError(null, { secure: false }), /secure/);
  assert.match(cameraError(null, { supported: false }), /can't use a camera/);
  assert.match(cameraError(new Error("x")), /Couldn't start/);
});
