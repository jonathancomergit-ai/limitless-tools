/* ============================================================
   Particle Designer - unit tests
   Same seed = same particles, JSON round-trips, the colour
   gradient blends right, and the Godot scene is well formed.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RANGES, DEFAULTS, PRESET_KEYS, MAX_STOPS, preset, normalize, normalizeStops, parseHex, toHex, colorAt, sizeAt,
  createSystem, simulateFrames, fitBox, sheetGrid, makeRandom, toJson, jsonText, fromJsonText, toGodot, gdNum, fileBase
} from "../../items/particle-designer/particles.js";

const run = (settings, seed, steps = 90, dt = 1 / 60) => {
  const sys = createSystem(settings, { seed, x: 100, y: 200 });
  for (let i = 0; i < steps; i++) { sys.step(dt); }
  return sys;
};

/* ---- same seed, same particles ---- */

test("the random maker is repeatable and stays in 0..1", () => {
  const a = makeRandom(42);
  const b = makeRandom(42);
  const xs = Array.from({ length: 500 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 500 }, () => b()));
  assert.ok(xs.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, makeRandom(43)));
});

test("the same seed gives the same particles, for every preset", () => {
  for (const name of PRESET_KEYS) {
    const a = run(preset(name), 7, 40);
    const b = run(preset(name), 7, 40);
    assert.ok(a.particles.length > 0, `${name} made no particles`);
    assert.deepEqual(a.particles, b.particles, `${name} differs with the same seed`);
    assert.notDeepEqual(a.particles, run(preset(name), 8, 40).particles, `${name} ignores the seed`);
  }
});

test("frames for the sheet / GIF are the same every time", () => {
  const a = simulateFrames(preset("fire"), { frames: 12, fps: 24 });
  const b = simulateFrames(preset("fire"), { frames: 12, fps: 24 });
  assert.equal(a.frames.length, 12);
  assert.deepEqual(a.frames, b.frames);
  assert.deepEqual(a.box, b.box);
  /* a burst-only effect starts on its burst */
  const boom = simulateFrames(preset("explosion"), { frames: 4 });
  assert.equal(boom.frames[0].length, preset("explosion").burst);
});

test("rate, burst and lifetime control how many are alive", () => {
  const s = normalize({ ...DEFAULTS, rate: 100, lifetime: 1, lifetimeRandom: 0, burst: 0 });
  const sys = run(s, 1, 120);          // 2 s: full, steady
  assert.ok(Math.abs(sys.particles.length - 100) <= 2, `expected about 100, got ${sys.particles.length}`);
  const b = run({ ...s, rate: 0, burst: 50, burstEvery: 0 }, 1, 1);
  assert.equal(b.particles.length, 50);
  assert.equal(run({ ...s, rate: 0, burst: 50, burstEvery: 0 }, 1, 120).particles.length, 0, "a one-off burst dies out");
  assert.equal(run({ ...s, rate: 0, burst: 0 }, 1, 60).particles.length, 0);
});

test("gravity pulls down, drag never reverses a particle", () => {
  const still = normalize({ ...DEFAULTS, speedMin: 0, speedMax: 0, spread: 0, gravity: 100, lifetime: 5, rate: 0, burst: 1 });
  const sys = createSystem(still, { seed: 3 });
  sys.step(0);
  sys.step(0.25);
  assert.ok(Math.abs(sys.particles[0].vy - 25) < 1e-9);
  assert.ok(sys.particles[0].y > 0);
  const dragged = normalize({ ...still, gravity: 0, speedMin: 50, speedMax: 50, direction: 0, drag: 1000 });
  const d = createSystem(dragged, { seed: 3 });
  d.step(0);
  d.step(0.2);
  assert.equal(d.particles[0].vx, 0);
  assert.ok(d.particles[0].x >= 0);
});

/* ---- colour gradient ---- */

const near = (actual, expected, msg) => {
  assert.equal(actual.length, expected.length, msg);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${msg || ""} [${actual}] vs [${expected}]`));
};

test("colour gradient: ends, middles, and between stops", () => {
  const stops = [{ at: 0, color: "#000000", alpha: 0 }, { at: 0.5, color: "#ff0000", alpha: 1 }, { at: 1, color: "#ffffff", alpha: 0.5 }];
  near(colorAt(stops, 0), [0, 0, 0, 0]);
  near(colorAt(stops, 0.5), [255, 0, 0, 1]);
  near(colorAt(stops, 1), [255, 255, 255, 0.5]);
  near(colorAt(stops, 0.25), [127.5, 0, 0, 0.5]);
  near(colorAt(stops, 0.75), [255, 127.5, 127.5, 0.75]);
  /* past the ends, the end colour holds */
  const inner = [{ at: 0.2, color: "#102030", alpha: 1 }, { at: 0.8, color: "#405060", alpha: 0 }];
  near(colorAt(inner, 0), [16, 32, 48, 1]);
  near(colorAt(inner, 1), [64, 80, 96, 0]);
  near(colorAt(inner, 0.5), [40, 56, 72, 0.5]);
});

test("colour stops are sorted, clamped and kept to 2-5", () => {
  const n = normalizeStops([{ at: 2, color: "#FFF" }, { at: -1, color: "#00ff00", alpha: 9 }, { at: 0.5, color: "nope" }]);
  assert.deepEqual(n, [{ at: 0, color: "#00ff00", alpha: 1 }, { at: 1, color: "#ffffff", alpha: 1 }]);
  assert.equal(normalizeStops(Array.from({ length: 9 }, (_, i) => ({ at: i / 8, color: "#123456" }))).length, MAX_STOPS);
  assert.equal(normalizeStops([{ at: 0.3, color: "#abcdef" }]).length, 2);
  assert.equal(normalizeStops("junk").length, 2);
  assert.deepEqual(parseHex("#0af"), [0, 170, 255]);
  assert.equal(parseHex("red"), null);
  assert.equal(toHex([255, 0, 128.4]), "#ff0080");
  assert.equal(sizeAt({ sizeStart: 10, sizeEnd: 30 }, 0.5), 20);
});

/* ---- JSON ---- */

test("JSON round-trips every preset exactly", () => {
  for (const name of PRESET_KEYS) {
    const s = preset(name);
    const back = fromJsonText(jsonText(s));
    assert.ok(back.ok, back.error);
    assert.deepEqual(back.settings, s, name);
  }
  const custom = normalize({ ...DEFAULTS, name: "my fx", rate: 123, wind: -40, shape: "square", blend: "add" });
  assert.deepEqual(fromJsonText(JSON.stringify(toJson(custom))).settings, custom);
  assert.equal(toJson(custom).format, "particle-designer");
  assert.equal(toJson(custom).version, 1);
});

test("JSON import refuses junk and clamps silly numbers", () => {
  assert.equal(fromJsonText("").ok, false);
  assert.equal(fromJsonText("{nope").ok, false);
  assert.equal(fromJsonText("[1,2]").ok, false);
  assert.equal(fromJsonText('{"rate": 5}').ok, false, "needs the format tag");
  assert.equal(fromJsonText('{"format":"particle-designer","version":99}').ok, false);
  const r = fromJsonText(JSON.stringify({ format: "particle-designer", version: 1, rate: 1e9, lifetime: -4, shape: "star", speedMin: 500, speedMax: 100, __proto__x: 1 }));
  assert.ok(r.ok);
  assert.equal(r.settings.rate, RANGES.rate[1]);
  assert.equal(r.settings.lifetime, RANGES.lifetime[0]);
  assert.equal(r.settings.shape, "circle");
  assert.deepEqual([r.settings.speedMin, r.settings.speedMax], [100, 500]);
  assert.equal(Object.keys(r.settings).includes("__proto__x"), false);
  assert.equal(fileBase("Big Boom!"), "big-boom");
});

/* ---- Godot ---- */

function parseTscn(text) {
  const head = text.split("\n")[0];
  const subs = [...text.matchAll(/^\[sub_resource type="(\w+)" id="([\w]+)"\]$/gm)].map((m) => ({ type: m[1], id: m[2] }));
  const nodes = [...text.matchAll(/^\[node name="(\w+)" type="(\w+)"(?: parent="([^"]*)")?\]$/gm)].map((m) => ({ name: m[1], type: m[2], parent: m[3] }));
  const refs = [...text.matchAll(/SubResource\("([\w]+)"\)/g)].map((m) => m[1]);
  return { head, subs, nodes, refs };
}

test("the Godot scene is well formed for every preset", () => {
  for (const name of PRESET_KEYS) {
    const s = preset(name);
    const text = toGodot(s);
    const { head, subs, nodes, refs } = parseTscn(text);
    assert.equal(head, `[gd_scene load_steps=${subs.length + 1} format=3]`, name);
    assert.equal(new Set(subs.map((x) => x.id)).size, subs.length, `${name}: ids must be unique`);
    for (const id of refs) { assert.ok(subs.some((x) => x.id === id), `${name}: ${id} is used but not defined`); }
    /* every sub resource is defined before it's used */
    for (const id of refs) { assert.ok(text.indexOf(`id="${id}"`) < text.indexOf(`SubResource("${id}")`), `${name}: ${id} used early`); }
    assert.ok(nodes.length >= 1 && nodes.every((n) => n.type === "CPUParticles2D"));
    assert.equal(nodes[0].parent, undefined, "the first node is the root");
    for (const n of nodes.slice(1)) { assert.equal(n.parent, ".", "extra nodes hang off the root"); }
    assert.doesNotMatch(text, /NaN|undefined|Infinity|e[+-]\d/, `${name}: bad number`);
    /* every property line looks like `key = value` */
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("[")) { continue; }
      assert.match(line, /^[a-z_0-9]+ = .+$/, `${name}: odd line "${line}"`);
    }
  }
});

test("the Godot mapping: amount, gravity, colours, blend, shape", () => {
  const fire = preset("fire");
  const t = toGodot(fire);
  assert.match(t, new RegExp(`^amount = ${Math.round(fire.rate * fire.lifetime)}$`, "m"));
  assert.match(t, /^gravity = Vector2\(0, -70\)$/m);
  assert.match(t, /^direction = Vector2\(0, -1\)$/m);
  assert.match(t, /^lifetime_randomness = 0\.4$/m);
  assert.match(t, /^blend_mode = 1$/m);
  assert.match(t, /^emission_rect_extents = Vector2\(17, 3\)$/m);
  assert.match(t, /^offsets = PackedFloat32Array\(0, 0\.25, 0\.6, 1\)$/m);
  assert.match(t, /^colors = PackedColorArray\(1, 0\.9529, 0\.6902, 1, /m);
  assert.match(t, /^scale_amount_max = 0\.4375$/m);   // 28 px / 64 px texture

  /* burst only: one node, explosive, one-shot when "once" */
  const once = toGodot({ ...preset("explosion"), burstEvery: 0 });
  assert.match(once, /^amount = 170$/m);
  assert.match(once, /^explosiveness = 1\.0$/m);
  assert.match(once, /^one_shot = true$/m);
  assert.equal(parseTscn(once).nodes.length, 1);

  /* stream + burst: a child Burst node */
  const both = parseTscn(toGodot({ ...preset("magic"), burst: 30 }));
  assert.deepEqual(both.nodes.map((n) => n.name), ["Magic", "Burst"]);

  /* normal blend has no material; sparks align to their movement */
  const smoke = toGodot(preset("smoke"));
  assert.doesNotMatch(smoke, /CanvasItemMaterial/);
  assert.match(toGodot(preset("sparks")), /^particle_flag_align_y = true$/m);
  assert.match(toGodot(preset("rain")), /^width = 16$/m);
  assert.equal(gdNum(-0.00001), "0");
  assert.equal(gdNum(1 / 3), "0.3333");
});

/* ---- sheet maths ---- */

test("sheet grid and fit", () => {
  assert.deepEqual(sheetGrid(24), { cols: 5, rows: 5 });
  assert.deepEqual(sheetGrid(16), { cols: 4, rows: 4 });
  assert.deepEqual(sheetGrid(4), { cols: 2, rows: 2 });
  const f = fitBox({ minX: -50, minY: -100, maxX: 50, maxY: 100 }, 128, { pad: 4 });
  assert.equal(f.zoom, 0.6);
  /* the box centre lands in the frame centre */
  assert.equal((0 + f.offsetX) * f.zoom, 64);
  assert.equal((0 + f.offsetY) * f.zoom, 64);
  assert.equal(fitBox({ minX: -1, minY: -1, maxX: 1, maxY: 1 }, 128).zoom, 2, "never zooms in past 2x");
});
