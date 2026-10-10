/* ============================================================
   Particle Designer - the particle engine

   Pure maths, no DOM: the page, the exports and the unit tests
   all use the same code, so what you see is what you export.

   Sections:
     1. ranges + defaults   every setting, its limits
     2. presets             fire, smoke, sparks, magic, rain, explosion
     3. normalize           untrusted settings -> safe settings
     4. colour              hex <-> rgba, gradient over life
     5. the simulation      seeded random, emit, step
     6. drawing             one function, any 2D canvas context
     7. frames              a fixed clip for the sheet + GIF
     8. JSON                export / import
     9. Godot               a CPUParticles2D .tscn scene

   The motion follows Godot 4's CPUParticles2D step by step
   (gravity, then damping, then move), so the Godot export
   behaves like the preview. See README.md for the mapping.
   ============================================================ */

/* ============================================================
   1. RANGES + DEFAULTS
   [min, max] for each number. Pixels and seconds.
   ============================================================ */
export const RANGES = Object.freeze({
  rate:           [0, 400],     // particles per second
  burst:          [0, 300],     // particles at once
  burstEvery:     [0, 5],       // seconds between bursts, 0 = once
  lifetime:       [0.1, 6],     // seconds
  lifetimeRandom: [0, 1],       // up to this share shorter
  areaWidth:      [0, 600],     // emitter box, px (0 x 0 = a point)
  areaHeight:     [0, 400],
  speedMin:       [0, 1000],    // px / s
  speedMax:       [0, 1000],
  direction:      [-180, 180],  // degrees, 0 = right, -90 = up
  spread:         [0, 180],     // degrees either side
  gravity:        [-1000, 1000], // px / s², + = down
  wind:           [-1000, 1000], // px / s², + = right
  drag:           [0, 1000],    // px / s² of speed lost
  sizeStart:      [1, 128],     // px
  sizeEnd:        [0, 128],
  sizeRandom:     [0, 1]        // up to this share smaller
});

export const SHAPES = Object.freeze(["circle", "square", "spark"]);
export const BLENDS = Object.freeze(["normal", "add"]);
export const MAX_STOPS = 5;
export const MAX_PARTICLES = 2500;
export const FORMAT = "particle-designer";
export const FORMAT_VERSION = 1;

export const DEFAULTS = Object.freeze({
  name: "effect",
  rate: 60,
  burst: 0,
  burstEvery: 0,
  lifetime: 1,
  lifetimeRandom: 0.2,
  areaWidth: 0,
  areaHeight: 0,
  speedMin: 60,
  speedMax: 120,
  direction: -90,
  spread: 25,
  gravity: 0,
  wind: 0,
  drag: 0,
  sizeStart: 12,
  sizeEnd: 2,
  sizeRandom: 0.2,
  shape: "circle",
  blend: "normal",
  colors: Object.freeze([
    Object.freeze({ at: 0, color: "#ffffff", alpha: 1 }),
    Object.freeze({ at: 1, color: "#35d6f5", alpha: 0 })
  ])
});

/* ============================================================
   2. PRESETS
   `at` is where the emitter sits on the preview (0-1 of the
   width and height). Everything else is a normal setting.
   ============================================================ */
const stop = (at, color, alpha = 1) => ({ at, color, alpha });

export const PRESETS = Object.freeze({
  fire: {
    at: [0.5, 0.78],
    settings: {
      rate: 110, lifetime: 0.9, lifetimeRandom: 0.4, areaWidth: 34, areaHeight: 6,
      speedMin: 40, speedMax: 95, direction: -90, spread: 14, gravity: -70, drag: 20,
      sizeStart: 28, sizeEnd: 6, sizeRandom: 0.4, shape: "circle", blend: "add",
      colors: [stop(0, "#fff3b0", 1), stop(0.25, "#ffb52e", 0.9), stop(0.6, "#ff4a1c", 0.65), stop(1, "#5a1a10", 0)]
    }
  },
  smoke: {
    at: [0.5, 0.8],
    settings: {
      rate: 26, lifetime: 2.8, lifetimeRandom: 0.3, areaWidth: 24, areaHeight: 4,
      speedMin: 25, speedMax: 55, direction: -90, spread: 18, gravity: -22, wind: 14, drag: 6,
      sizeStart: 18, sizeEnd: 70, sizeRandom: 0.3, shape: "circle", blend: "normal",
      colors: [stop(0, "#a3a8b4", 0), stop(0.15, "#8a8f9c", 0.5), stop(0.6, "#5d6270", 0.3), stop(1, "#3a3d46", 0)]
    }
  },
  sparks: {
    at: [0.5, 0.62],
    settings: {
      rate: 70, lifetime: 0.85, lifetimeRandom: 0.5, speedMin: 180, speedMax: 380,
      direction: -90, spread: 55, gravity: 620, drag: 40,
      sizeStart: 16, sizeEnd: 8, sizeRandom: 0.3, shape: "spark", blend: "add",
      colors: [stop(0, "#ffffff", 1), stop(0.3, "#ffd54a", 1), stop(0.7, "#ff7a1a", 0.8), stop(1, "#ff3d00", 0)]
    }
  },
  magic: {
    at: [0.5, 0.55],
    settings: {
      rate: 80, lifetime: 1.4, lifetimeRandom: 0.4, areaWidth: 50, areaHeight: 50,
      speedMin: 10, speedMax: 55, direction: -90, spread: 180, gravity: -45, drag: 10,
      sizeStart: 11, sizeEnd: 2, sizeRandom: 0.5, shape: "circle", blend: "add",
      colors: [stop(0, "#ffffff", 1), stop(0.3, "#c58cff", 0.9), stop(0.7, "#4fd6ff", 0.7), stop(1, "#3a5bff", 0)]
    }
  },
  rain: {
    at: [0.5, 0.02],
    settings: {
      rate: 170, lifetime: 0.9, lifetimeRandom: 0.2, areaWidth: 600, areaHeight: 0,
      speedMin: 480, speedMax: 620, direction: 100, spread: 2, gravity: 300, drag: 0,
      sizeStart: 18, sizeEnd: 18, sizeRandom: 0.4, shape: "spark", blend: "normal",
      colors: [stop(0, "#b8d8ff", 0.75), stop(1, "#8fb6ff", 0.45)]
    }
  },
  explosion: {
    at: [0.5, 0.5],
    settings: {
      rate: 0, burst: 170, burstEvery: 1.6, lifetime: 1.1, lifetimeRandom: 0.5, areaWidth: 10, areaHeight: 10,
      speedMin: 60, speedMax: 430, direction: 0, spread: 180, gravity: 120, drag: 280,
      sizeStart: 24, sizeEnd: 4, sizeRandom: 0.4, shape: "circle", blend: "add",
      colors: [stop(0, "#ffffff", 1), stop(0.15, "#ffe066", 1), stop(0.4, "#ff7b25", 0.85), stop(0.7, "#b02a10", 0.4), stop(1, "#301010", 0)]
    }
  }
});
export const PRESET_KEYS = Object.freeze(Object.keys(PRESETS));

export function preset(name) {
  const p = PRESETS[name];
  if (!p) { throw new Error(`No preset called ${name}.`); }
  return normalize({ ...structuredClone(DEFAULTS), ...structuredClone(p.settings), name });
}

/* ============================================================
   3. NORMALIZE
   Anything (a save, an imported file) -> a complete, safe
   settings object. Junk becomes the default; numbers are
   clamped. speedMin <= speedMax; 2-5 colour stops, sorted.
   ============================================================ */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

export function normalize(input = {}) {
  const s = input && typeof input === "object" ? input : {};
  const out = { name: cleanName(s.name) };
  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    const v = Number(s[key]);
    out[key] = round(clamp(Number.isFinite(v) && s[key] !== null && s[key] !== "" ? v : DEFAULTS[key], lo, hi));
  }
  for (const key of ["rate", "burst"]) { out[key] = Math.round(out[key]); }
  if (out.speedMin > out.speedMax) { [out.speedMin, out.speedMax] = [out.speedMax, out.speedMin]; }
  out.shape = SHAPES.includes(s.shape) ? s.shape : DEFAULTS.shape;
  out.blend = BLENDS.includes(s.blend) ? s.blend : DEFAULTS.blend;
  out.colors = normalizeStops(s.colors);
  return out;
}

export function cleanName(name) {
  const n = String(name ?? "").replace(/[^\w -]/g, "").trim().slice(0, 40);
  return n || DEFAULTS.name;
}

export function normalizeStops(list) {
  const stops = (Array.isArray(list) ? list : [])
    .filter((st) => st && typeof st === "object" && parseHex(st.color))
    .slice(0, MAX_STOPS)
    .map((st) => {
      const at = Number(st.at);
      const alpha = Number(st.alpha);
      return {
        at: round(clamp(Number.isFinite(at) ? at : 0, 0, 1)),
        color: toHex(parseHex(st.color)),
        alpha: round(clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1))
      };
    })
    .sort((a, b) => a.at - b.at);
  if (stops.length >= 2) { return stops; }
  if (stops.length === 1) { return [{ ...stops[0], at: 0 }, { ...stops[0], at: 1 }]; }
  return DEFAULTS.colors.map((st) => ({ ...st }));
}

/* ============================================================
   4. COLOUR
   ============================================================ */

/* "#rgb" or "#rrggbb" -> [r, g, b] (0-255), or null. */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) { return null; }
  let h = m[1];
  if (h.length === 3) { h = [...h].map((c) => c + c).join(""); }
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function toHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}

/* The colour at t (0 = born, 1 = gone), straight-line blend
   between the two stops either side. Returns [r, g, b, a]
   with r, g, b 0-255 and a 0-1. Before the first stop or after
   the last, the end colour holds. */
export function colorAt(stops, t) {
  const list = stops.length ? stops : DEFAULTS.colors;
  const rgba = (st) => [...parseHex(st.color), st.alpha];
  if (t <= list[0].at) { return rgba(list[0]); }
  const last = list[list.length - 1];
  if (t >= last.at) { return rgba(last); }
  for (let i = 1; i < list.length; i++) {
    const b = list[i];
    if (t <= b.at) {
      const a = list[i - 1];
      const k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
      const ca = rgba(a);
      const cb = rgba(b);
      return ca.map((v, j) => v + (cb[j] - v) * k);
    }
  }
  return rgba(last);
}

/* Size at t: a straight line from sizeStart to sizeEnd. */
export function sizeAt(s, t) {
  return s.sizeStart + (s.sizeEnd - s.sizeStart) * clamp(t, 0, 1);
}

/* For the gradient bar: a CSS linear-gradient() string. */
export function cssGradient(stops) {
  const parts = stops.map((st) => {
    const [r, g, b] = parseHex(st.color);
    return `rgba(${r}, ${g}, ${b}, ${st.alpha}) ${round(st.at * 100, 1)}%`;
  });
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/* ============================================================
   5. THE SIMULATION
   ============================================================ */

/* mulberry32: a tiny seeded random generator. Same seed, same
   numbers, on every device. */
export function makeRandom(seed = 1) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A running effect. settings can be swapped any time
   (sys.settings = ...); the particles already flying keep going.

     const sys = createSystem(settings, { seed: 7, x: 200, y: 300 });
     sys.step(1 / 60);
     sys.particles   // [{ x, y, vx, vy, age, life, scale }, ...]
*/
export function createSystem(settings, { seed = 1, x = 0, y = 0 } = {}) {
  const random = makeRandom(seed);
  const sys = {
    settings: normalize(settings),
    particles: [],
    x,
    y,
    time: 0,
    emitted: 0,
    carry: 0,              // part of a particle owed by the rate
    nextBurst: 0,          // time of the next burst
    step(dt) { stepSystem(sys, random, dt); return sys; },
    burst(count) { emitMany(sys, random, count ?? (sys.settings.burst || 40)); return sys; },
    clear() { sys.particles.length = 0; sys.carry = 0; return sys; },
    /* Start again from time 0 (the first burst fires again). */
    restart() { sys.clear(); sys.time = 0; sys.nextBurst = 0; return sys; }
  };
  return sys;
}

function spawn(sys, random) {
  if (sys.particles.length >= MAX_PARTICLES) { return null; }
  const s = sys.settings;
  const angle = (s.direction + (random() * 2 - 1) * s.spread) * Math.PI / 180;
  const speed = s.speedMin + (s.speedMax - s.speedMin) * random();
  const p = {
    x: sys.x + (random() - 0.5) * s.areaWidth,
    y: sys.y + (random() - 0.5) * s.areaHeight,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    age: 0,
    life: s.lifetime * (1 - s.lifetimeRandom * random()),
    scale: 1 - s.sizeRandom * random()
  };
  sys.particles.push(p);
  sys.emitted++;
  return p;
}

function emitMany(sys, random, count) {
  for (let i = 0; i < count; i++) { spawn(sys, random); }
}

/* Godot's order: gravity into velocity, damping takes speed
   off (never below 0), then move. */
function moveParticle(p, s, dt) {
  p.vx += s.wind * dt;
  p.vy += s.gravity * dt;
  if (s.drag > 0) {
    const v = Math.hypot(p.vx, p.vy);
    const left = v - s.drag * dt;
    if (left <= 0) { p.vx = 0; p.vy = 0; } else { p.vx *= left / v; p.vy *= left / v; }
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.age += dt;
}

function stepSystem(sys, random, dt) {
  const s = sys.settings;
  dt = Math.max(0, Math.min(dt, 0.25));

  /* Age and move what's flying; drop what's done. */
  let keep = 0;
  for (const p of sys.particles) {
    moveParticle(p, s, dt);
    if (p.age < p.life) { sys.particles[keep++] = p; }
  }
  sys.particles.length = keep;

  /* Bursts: at time 0, then every burstEvery seconds (if set). */
  if (s.burst > 0 && sys.time + dt >= sys.nextBurst && sys.nextBurst >= 0) {
    emitMany(sys, random, s.burst);
    sys.nextBurst = s.burstEvery > 0 ? Math.max(sys.nextBurst + s.burstEvery, sys.time + dt) : -1;
  } else if (s.burst > 0 && sys.nextBurst < 0 && s.burstEvery > 0) {
    sys.nextBurst = sys.time + s.burstEvery;    // "Burst every" was just turned on
  }

  /* The steady stream. Each new particle is moved on by the time
     since it was "due", so a stream looks smooth at any frame rate. */
  sys.carry += s.rate * dt;
  while (sys.carry >= 1) {
    sys.carry -= 1;
    const p = spawn(sys, random);
    if (p && s.rate > 0) { moveParticle(p, s, Math.min(dt, sys.carry / s.rate)); }
  }
  if (s.rate === 0) { sys.carry = 0; }
  sys.time += dt;
}

/* ============================================================
   6. DRAWING
   ctx is any CanvasRenderingContext2D. offsetX/offsetY move the
   effect, zoom scales it around (0, 0).
   ============================================================ */
export function drawParticles(ctx, sys, { offsetX = 0, offsetY = 0, zoom = 1 } = {}) {
  const s = sys.settings;
  ctx.save();
  ctx.globalCompositeOperation = s.blend === "add" ? "lighter" : "source-over";
  for (const p of sys.particles) {
    const t = p.age / p.life;
    const [r, g, b, a] = colorAt(s.colors, t);
    if (a <= 0.004) { continue; }
    const size = sizeAt(s, t) * p.scale * zoom;
    if (size <= 0.05) { continue; }
    const x = (p.x + offsetX) * zoom;
    const y = (p.y + offsetY) * zoom;
    ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a.toFixed(3)})`;
    if (s.shape === "square") {
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    } else if (s.shape === "spark") {
      /* A thin streak along the way it's moving: size long, a quarter wide. */
      const moving = Math.abs(p.vx) + Math.abs(p.vy) > 0.01;
      const angle = moving ? Math.atan2(p.vy, p.vx) : s.direction * Math.PI / 180;
      ctx.beginPath();
      ctx.ellipse(x, y, size / 2, Math.max(0.5, size / 8), angle, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/* ============================================================
   7. FRAMES
   A fixed clip, the same every time: for the sprite sheet and
   the GIF. A stream is run for one lifetime first so it's
   full; a burst-only effect starts on its burst.

   Returns { frames: [snapshot], box } where each snapshot is a
   copy of the particles, and box is the area they cover.
   ============================================================ */
export function simulateFrames(settings, { frames = 24, fps = 24, seed = 1 } = {}) {
  const s = normalize(settings);
  const sys = createSystem(s, { seed, x: 0, y: 0 });
  const dt = 1 / fps;
  if (s.rate > 0) {
    for (let t = 0; t < s.lifetime; t += dt) { sys.step(dt); }
  }
  const out = [];
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let f = 0; f < frames; f++) {
    sys.step(f === 0 && s.rate === 0 ? 0 : dt);
    const snap = sys.particles.map((p) => ({ ...p }));
    for (const p of snap) {
      const r = Math.max(s.sizeStart, s.sizeEnd) * p.scale / 2;
      box.minX = Math.min(box.minX, p.x - r);
      box.minY = Math.min(box.minY, p.y - r);
      box.maxX = Math.max(box.maxX, p.x + r);
      box.maxY = Math.max(box.maxY, p.y + r);
    }
    out.push(snap);
  }
  if (!Number.isFinite(box.minX)) { Object.assign(box, { minX: -1, minY: -1, maxX: 1, maxY: 1 }); }
  return { frames: out, box, settings: s };
}

/* Fit the box into a size x size frame: { zoom, offsetX, offsetY }
   for drawParticles. Never zooms in more than 2x. */
export function fitBox(box, size, { pad = 4, maxZoom = 2 } = {}) {
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const zoom = Math.min(maxZoom, (size - pad * 2) / Math.max(w, h));
  return {
    zoom,
    offsetX: size / 2 / zoom - (box.minX + w / 2),
    offsetY: size / 2 / zoom - (box.minY + h / 2)
  };
}

/* Sprite sheet grid: as close to square as it gets. */
export function sheetGrid(count) {
  const cols = Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

/* ============================================================
   8. JSON
   ============================================================ */
export function toJson(settings) {
  const s = normalize(settings);
  return { format: FORMAT, version: FORMAT_VERSION, ...s };
}

export function jsonText(settings) {
  return JSON.stringify(toJson(settings), null, 2);
}

/* Text from a file -> { ok, settings } or { ok: false, error }. */
export function fromJsonText(text) {
  let data;
  if (typeof text !== "string" || !text.trim()) { return { ok: false, error: "That file is empty." }; }
  if (text.length > 200_000) { return { ok: false, error: "That file is too big to be an effect." }; }
  try { data = JSON.parse(text); } catch { return { ok: false, error: "That file isn't JSON." }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) { return { ok: false, error: "That file isn't a particle effect." }; }
  if (data.format !== FORMAT) { return { ok: false, error: "That JSON isn't a Particle Designer effect (no \"format\": \"particle-designer\")." }; }
  if (Number(data.version) > FORMAT_VERSION) { return { ok: false, error: "That effect was made by a newer version. Reload the page and try again." }; }
  const { format, version, ...rest } = data;
  return { ok: true, settings: normalize(rest) };
}

export function fileBase(name) {
  return cleanName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "effect";
}

/* ============================================================
   9. GODOT 4 - a CPUParticles2D scene (.tscn)
   Save it as <name>.tscn in your project, then drag it into a
   scene (or instance it). See README.md for the mapping.
   ============================================================ */
export const GODOT_TEX = 64;   // the generated textures are 64 px

/* Godot-style number: no exponent, no trailing zeros. */
export function gdNum(v, places = 4) {
  const n = round(Number(v) || 0, places);
  return Object.is(n, -0) ? "0" : String(n);
}

function nodeName(name) {
  const words = cleanName(name).split(/[\s_-]+/).filter(Boolean);
  const n = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return /^[A-Za-z]/.test(n) ? n : `Effect${n}`;
}

/* Returns the whole .tscn text. */
export function toGodot(settings) {
  const s = normalize(settings);
  const subs = [];
  const add = (type, id, lines) => { subs.push({ type, id, lines }); return `SubResource("${id}")`; };

  /* Material: additive blending. */
  const material = s.blend === "add" ? add("CanvasItemMaterial", "CanvasItemMaterial_add", ["blend_mode = 1"]) : null;

  /* Texture: the particle shape, white, so the colour ramp tints it. */
  const texGrad = s.shape === "square"
    ? ["offsets = PackedFloat32Array(0, 1)", "colors = PackedColorArray(1, 1, 1, 1, 1, 1, 1, 1)"]
    : ["offsets = PackedFloat32Array(0, 0.9, 1)", "colors = PackedColorArray(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0)"];
  const shapeGrad = add("Gradient", "Gradient_shape", texGrad);
  const texLines = [`gradient = ${shapeGrad}`, `width = ${s.shape === "spark" ? GODOT_TEX / 4 : GODOT_TEX}`, `height = ${GODOT_TEX}`];
  if (s.shape !== "square") { texLines.push("fill = 1", "fill_from = Vector2(0.5, 0.5)", "fill_to = Vector2(1, 0.5)"); }
  const texture = add("GradientTexture2D", "GradientTexture2D_shape", texLines);

  /* Colour over life. */
  const ramp = add("Gradient", "Gradient_color", [
    `offsets = PackedFloat32Array(${s.colors.map((c) => gdNum(c.at)).join(", ")})`,
    `colors = PackedColorArray(${s.colors.map((c) => [...parseHex(c.color).map((v) => gdNum(v / 255)), gdNum(c.alpha)].join(", ")).join(", ")})`
  ]);

  /* Size over life: the biggest size is scale 1 on the curve. */
  const big = Math.max(s.sizeStart, s.sizeEnd, 0.001);
  const y0 = s.sizeStart / big;
  const y1 = s.sizeEnd / big;
  const slope = y1 - y0;
  const curve = add("Curve", "Curve_size", [
    `_data = [Vector2(0, ${gdNum(y0)}), 0.0, ${gdNum(slope)}, 0, 1, Vector2(1, ${gdNum(y1)}), ${gdNum(slope)}, 0.0, 1, 0]`,
    "point_count = 2"
  ]);
  const scaleMax = big / GODOT_TEX;

  const rad = s.direction * Math.PI / 180;
  const shared = [
    ...(material ? [`material = ${material}`] : []),
    `lifetime = ${gdNum(s.lifetime)}`,
    `lifetime_randomness = ${gdNum(s.lifetimeRandom)}`,
    `texture = ${texture}`,
    ...(s.areaWidth > 0 || s.areaHeight > 0
      ? ["emission_shape = 3", `emission_rect_extents = Vector2(${gdNum(s.areaWidth / 2)}, ${gdNum(s.areaHeight / 2)})`]
      : []),
    ...(s.shape === "spark" ? ["particle_flag_align_y = true"] : []),
    `direction = Vector2(${gdNum(Math.cos(rad))}, ${gdNum(Math.sin(rad))})`,
    `spread = ${gdNum(s.spread)}`,
    `gravity = Vector2(${gdNum(s.wind)}, ${gdNum(s.gravity)})`,
    `initial_velocity_min = ${gdNum(s.speedMin)}`,
    `initial_velocity_max = ${gdNum(s.speedMax)}`,
    ...(s.drag > 0 ? [`damping_min = ${gdNum(s.drag)}`, `damping_max = ${gdNum(s.drag)}`] : []),
    `scale_amount_min = ${gdNum(scaleMax * (1 - s.sizeRandom), 5)}`,
    `scale_amount_max = ${gdNum(scaleMax, 5)}`,
    `scale_amount_curve = ${curve}`,
    `color_ramp = ${ramp}`
  ];

  /* One node for the stream, one for the burst; both if both. */
  const name = nodeName(s.name);
  const nodes = [];
  const stream = s.rate > 0;
  const burst = s.burst > 0;
  if (stream || !burst) {
    nodes.push({
      head: `[node name="${name}" type="CPUParticles2D"]`,
      lines: [`amount = ${Math.max(1, Math.round(s.rate * s.lifetime))}`, ...shared]
    });
  }
  if (burst) {
    const burstLines = [
      `amount = ${s.burst}`,
      ...(s.burstEvery > 0 ? [] : ["one_shot = true"]),
      "explosiveness = 1.0",
      ...shared
    ];
    nodes.push({
      head: stream ? `[node name="Burst" type="CPUParticles2D" parent="."]` : `[node name="${name}" type="CPUParticles2D"]`,
      lines: burstLines
    });
  }
  if (!stream && !burst) { nodes[0].lines.splice(1, 0, "emitting = false"); }

  const out = [`[gd_scene load_steps=${subs.length + 1} format=3]`, ""];
  for (const sub of subs) {
    out.push(`[sub_resource type="${sub.type}" id="${sub.id}"]`, ...sub.lines, "");
  }
  for (const node of nodes) { out.push(node.head, ...node.lines, ""); }
  return out.join("\n");
}
