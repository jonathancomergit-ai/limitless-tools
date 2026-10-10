/* ============================================================
   Easing Curve Editor - unit tests
   The Bezier solver, bounce / elastic, CSS linear(), the
   closest Godot easing, and that every "Copy as" output is
   valid and gives the same curve.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bezierAt, easer, FUNCS, GODOT_EASES, DIRS, PRESETS, fromPreset, checkCurve, isCurve, cleanPoints, presetIdOf,
  closestGodot, maxGap, toLinear, linearPoints, breaksOf, cssValue, toCss, toJs, toGdscript, jsName, gdFloat, num, Y_MIN, Y_MAX
} from "../../items/easing-editor/ease.js";

const near = (a, b, d = 0.001) => assert.ok(Math.abs(a - b) <= d, `${a} is not within ${d} of ${b}`);
const EASE = [0.25, 0.1, 0.25, 1];
const FN_CURVES = ["bounce", "elastic"].flatMap((kind) => DIRS.map((dir) => ({ kind, dir, p: EASE, name: `${kind} ${dir}` })));

/* ---- the solver ---- */
test('the Bezier solver matches known values for "ease" within 0.001', () => {
  const known = { 0.1: 0.0948, 0.2: 0.2952, 0.25: 0.4085, 0.4: 0.6825, 0.5: 0.8024, 0.6: 0.8852, 0.75: 0.9605, 0.9: 0.9943 };
  for (const [t, y] of Object.entries(known)) { near(bezierAt(EASE, Number(t)), y); }
  assert.equal(bezierAt(EASE, 0), 0);
  assert.equal(bezierAt(EASE, 1), 1);
});

test("linear is a straight line, and ease-in-out is symmetric", () => {
  for (let t = 0; t <= 1; t += 0.05) { near(bezierAt([0, 0, 1, 1], t), t, 1e-6); }
  const io = [0.42, 0, 0.58, 1];
  for (let t = 0.05; t < 1; t += 0.05) { near(bezierAt(io, t) + bezierAt(io, 1 - t), 1, 1e-6); }
});

test("overshooting handles overshoot, and steep ends still solve", () => {
  const backOut = fromPreset("back-out").p;
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => bezierAt(backOut, i / 100)));
  assert.ok(peak > 1.05, `back out should overshoot, peak ${peak}`);
  /* x1 = x2 = 0 or 1: flat slope at an end, Newton alone would stall. */
  for (const p of [[0, 1, 0, 1], [1, 0, 1, 0], [1, 0, 0, 1], [0, 1.75, 1, -0.75]]) {
    for (let t = 0.01; t < 1; t += 0.07) { assert.ok(Number.isFinite(bezierAt(p, t)), String(p)); }
    near(bezierAt([1, 0, 0, 1], 0.5), 0.5, 1e-6);
  }
});

/* ---- bounce + elastic ---- */
test("bounce and elastic start at 0, end at 1; bounce hits the floor", () => {
  for (const c of FN_CURVES) {
    const f = easer(c);
    near(f(0), 0, 1e-9);
    near(f(1), 1, 1e-9);
  }
  const out = FUNCS.bounce.out;
  near(out(1 / 2.75), 1, 1e-9);
  near(out(2 / 2.75), 1, 1e-9);
  near(out(2.5 / 2.75), 1, 1e-9);
  assert.ok(FUNCS.elastic.out(0.15) > 1.2, "elastic out overshoots");
});

/* ---- CSS linear() ---- */
function parseLinear(text) {
  const m = text.match(/^linear\((.*)\)$/);
  assert.ok(m, `not a linear(): ${text.slice(0, 40)}`);
  const parts = m[1].split(", ");
  return parts.map((part, i) => {
    const bits = part.split(" ");
    assert.ok(bits.length === 1 || bits.length === 2, `bad stop: ${part}`);
    const y = Number(bits[0]);
    assert.ok(Number.isFinite(y), `bad value: ${part}`);
    let x;
    if (bits.length === 2) {
      assert.match(bits[1], /^\d+(\.\d+)?%$/, `bad percentage: ${part}`);
      x = Number(bits[1].slice(0, -1)) / 100;
    } else {
      x = i === 0 ? 0 : i === parts.length - 1 ? 1 : NaN;
      assert.ok(Number.isFinite(x), `middle stop with no %: ${part}`);
    }
    return [x, y];
  });
}
function interp(stops, x) {
  for (let i = 1; i < stops.length; i++) {
    const [x0, y0] = stops[i - 1];
    const [x1, y1] = stops[i];
    if (x <= x1) { return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return stops[stops.length - 1][1];
}

test("linear() starts at 0, ends at 1, and its x values only go up", () => {
  for (const c of FN_CURVES) {
    const text = cssValue(c);
    const stops = parseLinear(text);
    assert.equal(stops[0][1], 0, `${c.name} starts at 0`);
    assert.equal(stops[0][0], 0);
    assert.equal(stops.at(-1)[1], 1, `${c.name} ends at 1`);
    assert.equal(stops.at(-1)[0], 1);
    for (let i = 1; i < stops.length; i++) {
      assert.ok(stops[i][0] > stops[i - 1][0], `${c.name}: x goes down or repeats at stop ${i}`);
    }
    assert.ok(stops.length < 120, `${c.name}: ${stops.length} stops is too many`);
  }
});

test("linear() follows the real curve closely", () => {
  for (const c of FN_CURVES) {
    const stops = parseLinear(cssValue(c));
    const f = easer(c);
    for (let i = 0; i <= 500; i++) { near(interp(stops, i / 500), f(i / 500), 0.01); }
  }
});

test("linear() keeps the bounce floor hits", () => {
  for (const dir of DIRS) {
    const c = { kind: "bounce", dir, p: EASE, name: "b" };
    const pts = linearPoints(easer(c), { breaks: breaksOf(c) });
    for (const b of breaksOf(c)) { assert.ok(pts.some(([x]) => Math.abs(x - b) < 1e-12), `${dir}: corner at ${b} kept`); }
  }
  assert.equal(toLinear((t) => t), "linear(0, 1)");
});

/* ---- CSS ---- */
test("CSS output: a valid cubic-bezier() custom property and transition", () => {
  const css = toCss(fromPreset("back-out"), 650);
  assert.match(css, /^\s*--ease-back-out: cubic-bezier\(0\.34, 1\.56, 0\.64, 1\);$/m);
  assert.match(css, /transition: transform 650ms var\(--ease-back-out\);/);
  assert.match(toCss(fromPreset("ease-in")), /keyword "ease-in"/);
  /* Braces balance, every declaration ends with ; */
  for (const c of [...PRESETS.map((p) => fromPreset(p.id)), ...FN_CURVES]) {
    const out = toCss(c).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.equal((out.match(/{/g) || []).length, (out.match(/}/g) || []).length);
    for (const line of out.split("\n").filter((l) => l.startsWith("  "))) { assert.match(line, /;$/, line); }
  }
  assert.match(toCss(FN_CURVES[1]), /--ease-bounce-out: linear\(0, /);
});

test("cubic-bezier numbers are short and tidy", () => {
  assert.equal(cssValue({ kind: "bezier", p: [0.1 + 0.2, -0.5600001, 1, 0], name: "x" }), "cubic-bezier(0.3, -0.56, 1, 0)");
  assert.equal(num(-0.0001), "0");
  assert.equal(gdFloat(1), "1.0");
  assert.equal(gdFloat(-0.5), "-0.5");
});

/* ---- JS: run it, compare with the solver ---- */
test("JS output is a working function that matches the curve", () => {
  const curves = [...PRESETS.map((p) => fromPreset(p.id)), ...FN_CURVES, { kind: "bezier", p: [0.9, -0.7, 0.1, 1.7], name: "Wild one" }];
  for (const c of curves) {
    const src = toJs(c, 500);
    const name = jsName(c);
    assert.match(name, /^[a-zA-Z][a-zA-Z0-9]*$/);
    const fn = new Function(`${src}\nreturn ${name};`)();
    const f = easer(c);
    for (let i = 0; i <= 100; i++) { near(fn(i / 100), f(i / 100), 1e-5); }
  }
  assert.match(toJs(fromPreset("ease"), 500), /easing: "cubic-bezier\(0\.25, 0\.1, 0\.25, 1\)"/);
});

/* ---- GDScript: shape checks (no Godot here), and a mini-run ---- */
test("GDScript output is tidy Godot 4 code", () => {
  const curves = [...PRESETS.map((p) => fromPreset(p.id)), ...FN_CURVES];
  for (const c of curves) {
    const gd = toGdscript(c, 600);
    const code = gd.split("\n").filter((l) => !l.startsWith("#"));
    assert.ok(code.includes("func ease_curve(t: float) -> float:"), c.name);
    for (const line of code) {
      assert.doesNotMatch(line, /^ +\S/, `indent with tabs, not spaces: ${line}`);
      assert.doesNotMatch(line, /;\s*$|Math\.|\bconst [a-z]+ =|\blet\b|=>/, `JavaScript leaked in: ${line}`);
    }
    /* Every block opener ends with a colon and is followed by a deeper line. */
    code.forEach((line, i) => {
      if (/^\t*(func|if|elif|else|for)\b/.test(line)) {
        assert.match(line, /:$/, line);
        const depth = (s) => s.match(/^\t*/)[0].length;
        assert.ok(depth(code[i + 1]) === depth(line) + 1, `nothing inside: ${line}`);
      }
    });
    assert.match(gd, /\.set_trans\(Tween\.TRANS_[A-Z]+\)\.set_ease\(Tween\.EASE_(IN|OUT|IN_OUT)\)/);
    assert.match(gd, /\.set_custom_interpolator\(ease_curve\)/);
    assert.match(gd, /, 0\.6\)/, "duration in seconds");
  }
  assert.match(toGdscript(fromPreset("back-out")), /const EASE_P2 := Vector2\(0\.64, 1\.0\)/);
});

/* Run the GDScript Bezier by turning it into JS line by line - proves the maths in it. */
test("GDScript ease_curve() gives the same numbers as the solver", () => {
  for (const c of [fromPreset("ease"), fromPreset("back-in-out"), ...FN_CURVES]) {
    const gd = toGdscript(c);
    const lines = gd.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    const js = [];
    const stack = [0];
    for (const raw of lines) {
      const depth = raw.match(/^\t*/)[0].length;
      while (stack.length > 1 && depth < stack.at(-1)) { stack.pop(); js.push("}"); }
      let l = raw.trim()
        .replace(/^const (\w+) := Vector2\(([^,]+), ([^)]+)\)$/, "const $1 = { x: $2, y: $3 };")
        .replace(/^func (\w+)\(([^)]*)\) -> float:$/, (_, n, args) => `function ${n}(${args.replace(/: float/g, "")}) {`)
        .replace(/^for _i in (\d+):$/, "for (let _i = 0; _i < $1; _i++) {")
        .replace(/^elif (.*):$/, "else if ($1) {")
        .replace(/^if (.*):$/, "if ($1) {")
        .replace(/^else:$/, "else {")
        .replace(/^var (\w+) := /, "let $1 = ")
        .replace(/\babsf\(/g, "Math.abs(").replace(/\bpow\(/g, "Math.pow(").replace(/\bsin\(/g, "Math.sin(")
        .replace(/\bTAU\b/g, "(2 * Math.PI)");
      if (l.endsWith("{")) { stack.push(depth + 1); }
      js.push(l);
    }
    while (stack.length > 1) { stack.pop(); js.push("}"); }
    const fn = new Function(`${js.join("\n")}\nreturn ease_curve;`)();
    const f = easer(c);
    for (let i = 0; i <= 50; i++) { near(fn(i / 50), f(i / 50), 1e-5); }
  }
});

/* ---- closest Godot easing ---- */
test("closest Godot easing: exact for bounce / elastic, sensible for Beziers", () => {
  assert.deepEqual(closestGodot({ kind: "bounce", dir: "out", p: EASE }), { trans: "TRANS_BOUNCE", ease: "EASE_OUT", gap: 0 });
  assert.deepEqual(closestGodot({ kind: "elastic", dir: "in-out", p: EASE }), { trans: "TRANS_ELASTIC", ease: "EASE_IN_OUT", gap: 0 });
  const lin = closestGodot(fromPreset("linear"));
  assert.equal(lin.trans, "TRANS_LINEAR");
  near(lin.gap, 0, 1e-6);
  assert.equal(closestGodot(fromPreset("back-out")).trans, "TRANS_BACK");
  assert.equal(closestGodot(fromPreset("back-out")).ease, "EASE_OUT");
  assert.equal(closestGodot(fromPreset("ease-in")).ease, "EASE_IN");
  assert.equal(closestGodot(fromPreset("ease-in-out")).ease, "EASE_IN_OUT");
  /* Godot's own equations end where they should. */
  for (const dir of DIRS) {
    for (const [name, g] of Object.entries(GODOT_EASES[dir])) {
      near(g(0), 0, 0.0011);
      near(g(1), 1, 0.0011);
      assert.ok(maxGap(g, g) === 0, name);
    }
  }
});

/* ---- curves from saves ---- */
test("checkCurve always gives a legal curve", () => {
  const junk = [null, 7, "x", {}, { kind: "nope" }, { kind: "bezier", p: [2, 9, -1, -9] }, { kind: "bounce", dir: "sideways" }];
  for (const j of junk) {
    const c = checkCurve(j);
    assert.ok(isCurve(c), JSON.stringify(j));
    assert.ok(c.p[0] >= 0 && c.p[0] <= 1 && c.p[2] >= 0 && c.p[2] <= 1);
    assert.ok(c.p[1] >= Y_MIN && c.p[1] <= Y_MAX && c.p[3] >= Y_MIN && c.p[3] <= Y_MAX);
  }
  assert.deepEqual(cleanPoints([0.123, 1.999, 1.5, -2]), [0.12, Y_MAX, 1, Y_MIN]);
  assert.equal(presetIdOf(fromPreset("ease-out")), "ease-out");
  assert.equal(presetIdOf({ kind: "bezier", p: [0.1, 0.2, 0.3, 0.4] }), null);
  assert.equal(isCurve({ kind: "bezier", p: [0, 0, 1] }), false);
});
