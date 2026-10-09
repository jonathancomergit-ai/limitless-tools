/* ============================================================
   Palette Lab - unit tests
   WCAG contrast, hex, HSL, OKLCH, colour-blind simulation,
   palette generation with locks, and the export formats.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHex, toHex, normalizeHex, contrast, grade, inkFor, rgbToHsl, hslToRgb,
  toOklch, fromOklch, simulate, generate, toCss, toJson, toGpl, toGodot, MODES, CVD
} from "../../items/palette-lab/color.js";

const near = (a, b, d = 0.01) => assert.ok(Math.abs(a - b) <= d, `${a} is not close to ${b}`);

/* A seeded random, so generate() is repeatable in tests. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

test("black on white is 21:1, and the same colour is 1:1", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#ffffff", "#000000"), 21, "order doesn't matter");
  assert.equal(contrast("#3d8bfd", "#3d8bfd"), 1);
});

test("known contrast pairs", () => {
  near(contrast("#767676", "#ffffff"), 4.54);   // the classic lightest AA grey
  near(contrast("#777777", "#ffffff"), 4.48);   // one step lighter: fails AA
  near(contrast("#ff0000", "#ffffff"), 4.0);
  near(contrast("#0000ff", "#ffffff"), 8.59);
  near(contrast("#595959", "#ffffff"), 7.0);     // the classic lightest AAA grey
  assert.equal(grade(contrast("#767676", "#fff")).aa, true);
  assert.equal(grade(contrast("#777777", "#fff")).aa, false);
  assert.equal(grade(contrast("#777777", "#fff")).aaLarge, true);
  assert.equal(grade(21).aaa, true);
  assert.equal(inkFor("#ffc93c"), "#000000");
  assert.equal(inkFor("#11121c"), "#ffffff");
});

test("hex parsing", () => {
  assert.deepEqual(parseHex("#ffc93c"), { r: 255, g: 201, b: 60 });
  assert.deepEqual(parseHex("ABC"), { r: 170, g: 187, b: 204 });
  assert.equal(parseHex("#12345"), null);
  assert.equal(parseHex("red"), null);
  assert.equal(parseHex(null), null);
  assert.equal(normalizeHex(" #FFF "), "#ffffff");
  assert.equal(toHex({ r: 300, g: -4, b: 15.6 }), "#ff0010");
});

test("HSL round trip", () => {
  assert.deepEqual(rgbToHsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, l: 50 });
  for (const hex of ["#ffc93c", "#35d6f5", "#123456", "#808080"]) {
    assert.equal(toHex(hslToRgb(rgbToHsl(parseHex(hex)))), hex);
  }
});

test("OKLCH round trip and known values", () => {
  const white = toOklch("#ffffff");
  near(white.l, 1, 0.001);
  near(white.c, 0, 0.001);
  near(toOklch("#000000").l, 0, 0.001);
  const red = toOklch("#ff0000");          // oklch(62.8% 0.258 29.2)
  near(red.l, 0.628, 0.002);
  near(red.c, 0.258, 0.002);
  near(red.h, 29.2, 0.3);
  for (const hex of ["#ffc93c", "#35d6f5", "#ff2d78", "#123456", "#000000", "#ffffff"]) {
    assert.equal(fromOklch(toOklch(hex)), hex);
  }
  /* Out of the screen's range: brought back in, never junk. */
  assert.match(fromOklch({ l: 0.9, c: 0.4, h: 140 }), /^#[0-9a-f]{6}$/);
});

test("colour-blind simulation", () => {
  for (const type of Object.keys(CVD)) {
    assert.equal(simulate("#808080", type), "#808080", `${type}: grey stays grey`);
    assert.equal(simulate("#000000", type), "#000000");
  }
  /* Red and green look alike without red or green cones. */
  const gap = (a, b) => { const x = parseHex(a); const y = parseHex(b); return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b); };
  for (const type of ["protanopia", "deuteranopia"]) {
    assert.ok(gap(simulate("#e53935", type), simulate("#43a047", type)) < gap("#e53935", "#43a047") / 2, type);
  }
  assert.equal(simulate("#ff0000", "nope"), "#ff0000");
});

test("generate: 5 colours in every mode, repeatable with a seed", () => {
  for (const mode of MODES) {
    const p = generate({ mode, rand: seeded(1), base: "#3d8bfd" });
    assert.equal(p.length, 5, mode);
    for (const c of p) { assert.match(c, /^#[0-9a-f]{6}$/, mode); }
    assert.deepEqual(p, generate({ mode, rand: seeded(1), base: "#3d8bfd" }));
  }
  /* Dark to light: the ends always contrast well. */
  const p = generate({ rand: seeded(5) });
  assert.ok(contrast(p[0], p[4]) >= 4.5, `${p[0]} vs ${p[4]}`);
});

test("generate keeps locked colours exactly, and changes the rest", () => {
  const first = generate({ rand: seeded(2) });
  const locks = [false, true, false, false, true];
  const next = generate({ palette: first, locks, rand: seeded(99) });
  assert.equal(next[1], first[1]);
  assert.equal(next[4], first[4]);
  assert.notEqual(next[0], first[0]);
  assert.notEqual(next[2], first[2]);
  /* Base mode keeps the base colour in the middle. */
  assert.equal(generate({ mode: "base", base: "#FFC93C", rand: seeded(3) })[2], "#ffc93c");
});

test("exports", () => {
  const p = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff"];
  assert.equal(toCss(p).split("\n")[1], "  --color-1: #000000;");
  assert.deepEqual(JSON.parse(toJson(p, "Mine")), { name: "Mine", colors: p });
  const gpl = toGpl(p, "Mine").split("\n");
  assert.equal(gpl[0], "GIMP Palette");
  assert.equal(gpl[1], "Name: Mine");
  assert.equal(gpl[4], "  0   0   0\tcolor-1 #000000");
  assert.equal(gpl[6], "255   0   0\tcolor-3 #ff0000");
  assert.match(toGodot(p), /^const PALETTE = \[\n\tColor\(0\.000, 0\.000, 0\.000\),/);
  assert.match(toGodot(p), /Color\(1\.000, 1\.000, 1\.000\)/);
});
