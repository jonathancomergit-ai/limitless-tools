/* ============================================================
   Easing Curve Editor - the maths (no DOM, unit tested)

   A curve is one of:
     { kind: "bezier",  p: [x1, y1, x2, y2], name }
     { kind: "bounce",  dir: "in" | "out" | "in-out", p, name }
     { kind: "elastic", dir: "in" | "out" | "in-out", p, name }

   Bounce and elastic can't be a cubic-bezier(), so they are
   real functions. `p` is kept on them too: the last Bezier
   handles, so grabbing a handle picks up where you left off.

   The bounce / elastic / Tween maths are the same equations
   Godot 4 uses (Robert Penner's), so "TRANS_BOUNCE, EASE_OUT"
   really is the same curve as the one drawn here.

   Sections:
     1. limits + numbers
     2. the Bezier solver
     3. bounce + elastic
     4. Godot Tween equations + closest match
     5. curves: presets, check, evaluate
     6. CSS linear()
     7. Copy as: CSS, GDScript, JS
   ============================================================ */

/* ============================================================
   1. LIMITS + NUMBERS
   ============================================================ */

/* Handles: x must stay in 0..1 (CSS rule). y may overshoot. */
export const Y_MIN = -0.75;
export const Y_MAX = 1.75;
export const DIRS = ["in", "out", "in-out"];
export const KINDS = ["bezier", "bounce", "elastic"];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* 0.25 -> "0.25", 1 -> "1", -0.5600001 -> "-0.56" */
export function num(v, places = 3) {
  const r = Number(v.toFixed(places));
  return String(Object.is(r, -0) ? 0 : r);
}

/* GDScript wants 1.0, not 1, so the constant is a float. */
export function gdFloat(v) {
  const s = num(v);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/* Keep handles legal and tidy (two decimals). */
export function cleanPoints(p) {
  const r = (v) => Math.round(v * 100) / 100;
  return [
    r(clamp(Number(p[0]) || 0, 0, 1)),
    r(clamp(Number(p[1]) || 0, Y_MIN, Y_MAX)),
    r(clamp(Number(p[2]) || 0, 0, 1)),
    r(clamp(Number(p[3]) || 0, Y_MIN, Y_MAX))
  ];
}

/* ============================================================
   2. THE BEZIER SOLVER
   P0 = (0,0), P1 = (x1,y1), P2 = (x2,y2), P3 = (1,1).
   Given time x, find the curve parameter u where X(u) = x,
   then return Y(u). Newton first (fast), bisection if Newton
   wanders off (always works, because X(u) only goes up when
   x1 and x2 are in 0..1).
   ============================================================ */

/* One coordinate of the curve at parameter u. */
export function bez(u, a, b) {
  const v = 1 - u;
  return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
}
function bezSlope(u, a, b) {
  const v = 1 - u;
  return 3 * v * v * a + 6 * v * u * (b - a) + 3 * u * u * (1 - b);
}

export function solveU(x, x1, x2) {
  let u = x;
  for (let i = 0; i < 8; i++) {
    const err = bez(u, x1, x2) - x;
    if (Math.abs(err) < 1e-7) { return u; }
    const d = bezSlope(u, x1, x2);
    if (Math.abs(d) < 1e-6) { break; }
    u -= err / d;
  }
  let lo = 0;
  let hi = 1;
  u = x;
  for (let i = 0; i < 60; i++) {
    const got = bez(u, x1, x2);
    if (Math.abs(got - x) < 1e-7) { break; }
    if (got < x) { lo = u; } else { hi = u; }
    u = (lo + hi) / 2;
  }
  return u;
}

/* The eased value at time x (0..1). */
export function bezierAt(p, x) {
  if (x <= 0) { return 0; }
  if (x >= 1) { return 1; }
  const [x1, y1, x2, y2] = p;
  return bez(solveU(x, x1, x2), y1, y2);
}

/* ============================================================
   3. BOUNCE + ELASTIC (Godot's equations, d = 1)
   ============================================================ */
function bounceOut(t) {
  if (t < 1 / 2.75) { return 7.5625 * t * t; }
  if (t < 2 / 2.75) { const u = t - 1.5 / 2.75; return 7.5625 * u * u + 0.75; }
  if (t < 2.5 / 2.75) { const u = t - 2.25 / 2.75; return 7.5625 * u * u + 0.9375; }
  const u = t - 2.625 / 2.75;
  return 7.5625 * u * u + 0.984375;
}
const bounceIn = (t) => 1 - bounceOut(1 - t);

function elasticIn(t) {
  if (t <= 0) { return 0; }
  if (t >= 1) { return 1; }
  const u = t - 1;
  return -(2 ** (10 * u) * Math.sin((u - 0.075) * (2 * Math.PI) / 0.3));
}
function elasticOut(t) {
  if (t <= 0) { return 0; }
  if (t >= 1) { return 1; }
  return 2 ** (-10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
}
function elasticInOut(t) {
  if (t <= 0) { return 0; }
  if (t >= 1) { return 1; }
  const u = t * 2 - 1;
  const wave = Math.sin((u - 0.1125) * (2 * Math.PI) / 0.45);
  return u < 0 ? -0.5 * 2 ** (10 * u) * wave : 2 ** (-10 * u) * wave * 0.5 + 1;
}

/* Build in-out from in + out, the way Godot does. */
const inOut = (fin, fout) => (t) => (t < 0.5 ? fin(t * 2) * 0.5 : fout(t * 2 - 1) * 0.5 + 0.5);

export const FUNCS = {
  bounce: { in: bounceIn, out: bounceOut, "in-out": inOut(bounceIn, bounceOut) },
  elastic: { in: elasticIn, out: elasticOut, "in-out": elasticInOut }
};

/* ============================================================
   4. GODOT TWEEN EQUATIONS + CLOSEST MATCH
   For a Bezier, which set_trans() + set_ease() comes closest?
   ============================================================ */
const S = 1.70158;
const EQ_IN = {
  LINEAR: (t) => t,
  SINE: (t) => 1 - Math.cos(t * Math.PI / 2),
  QUAD: (t) => t * t,
  CUBIC: (t) => t ** 3,
  QUART: (t) => t ** 4,
  QUINT: (t) => t ** 5,
  EXPO: (t) => (t <= 0 ? 0 : 2 ** (10 * (t - 1)) - 0.001),
  CIRC: (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t)),
  BACK: (t) => t * t * ((S + 1) * t - S),
  BOUNCE: bounceIn,
  ELASTIC: elasticIn
};
const outOf = (fin) => (t) => 1 - fin(1 - t);
const EQ_OUT = Object.fromEntries(Object.entries(EQ_IN).map(([k, f]) => [k, outOf(f)]));
EQ_OUT.EXPO = (t) => (t >= 1 ? 1 : 1.001 * (1 - 2 ** (-10 * t)));
EQ_OUT.BOUNCE = bounceOut;
EQ_OUT.ELASTIC = elasticOut;
const EQ_IN_OUT = Object.fromEntries(Object.keys(EQ_IN).map((k) => [k, inOut(EQ_IN[k], EQ_OUT[k])]));
/* Godot's back in-out uses a bigger overshoot (s * 1.525). */
const S2 = S * 1.525;
EQ_IN_OUT.BACK = (t) => {
  const u = t * 2;
  if (u < 1) { return 0.5 * (u * u * ((S2 + 1) * u - S2)); }
  const w = u - 2;
  return 0.5 * (w * w * ((S2 + 1) * w + S2) + 2);
};
EQ_IN_OUT.ELASTIC = elasticInOut;

export const GODOT_EASES = { in: EQ_IN, out: EQ_OUT, "in-out": EQ_IN_OUT };
const GD_EASE_NAME = { in: "EASE_IN", out: "EASE_OUT", "in-out": "EASE_IN_OUT" };

/* The biggest gap between two easing functions, over 0..1. */
export function maxGap(f, g, steps = 100) {
  let worst = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    worst = Math.max(worst, Math.abs(f(t) - g(t)));
  }
  return worst;
}

/* { trans: "TRANS_SINE", ease: "EASE_OUT", gap: 0.02 } */
export function closestGodot(curve) {
  const c = checkCurve(curve);
  if (c.kind !== "bezier") {
    return { trans: `TRANS_${c.kind.toUpperCase()}`, ease: GD_EASE_NAME[c.dir], gap: 0 };
  }
  const f = (t) => bezierAt(c.p, t);
  let best = null;
  for (const dir of DIRS) {
    for (const [name, g] of Object.entries(GODOT_EASES[dir])) {
      if (name === "BOUNCE" || name === "ELASTIC") { continue; }   // never the closest to a smooth curve
      const gap = maxGap(f, g);
      if (!best || gap < best.gap - 1e-9) { best = { trans: `TRANS_${name}`, ease: GD_EASE_NAME[dir], gap }; }
    }
  }
  return best;
}

/* ============================================================
   5. CURVES: PRESETS, CHECK, EVALUATE
   The first five are the CSS keywords, with the exact values
   from the CSS spec. Back ones are easings.net's.
   ============================================================ */
export const PRESETS = [
  { id: "linear",      label: "Linear",      kind: "bezier", p: [0, 0, 1, 1] },
  { id: "ease",        label: "Ease",        kind: "bezier", p: [0.25, 0.1, 0.25, 1] },
  { id: "ease-in",     label: "Ease in",     kind: "bezier", p: [0.42, 0, 1, 1] },
  { id: "ease-out",    label: "Ease out",    kind: "bezier", p: [0, 0, 0.58, 1] },
  { id: "ease-in-out", label: "Ease in-out", kind: "bezier", p: [0.42, 0, 0.58, 1] },
  { id: "back-in",     label: "Back in",     kind: "bezier", p: [0.36, 0, 0.66, -0.56] },
  { id: "back-out",    label: "Back out",    kind: "bezier", p: [0.34, 1.56, 0.64, 1] },
  { id: "back-in-out", label: "Back in-out", kind: "bezier", p: [0.68, -0.6, 0.32, 1.6] },
  { id: "bounce",      label: "Bounce",      kind: "bounce", dir: "out" },
  { id: "elastic",     label: "Elastic",     kind: "elastic", dir: "out" }
];
export const CSS_KEYWORDS = { linear: "linear", ease: "ease", "ease-in": "ease-in", "ease-out": "ease-out", "ease-in-out": "ease-in-out" };

export const DEFAULT_CURVE = Object.freeze({ kind: "bezier", p: [0.25, 0.1, 0.25, 1], dir: "out", name: "Ease" });

/* Turn a preset into a curve, keeping the current handles for bounce / elastic. */
export function fromPreset(id, keepP = DEFAULT_CURVE.p) {
  const pre = PRESETS.find((x) => x.id === id);
  if (!pre) { return null; }
  if (pre.kind === "bezier") { return { kind: "bezier", p: [...pre.p], dir: "out", name: pre.label }; }
  return { kind: pre.kind, p: cleanPoints(keepP), dir: pre.dir, name: `${pre.label} ${pre.dir}` };
}

/* Anything from a save file goes through here: always gives a legal curve. */
export function checkCurve(c) {
  const ok = c && typeof c === "object";
  const kind = ok && KINDS.includes(c.kind) ? c.kind : "bezier";
  const p = ok && Array.isArray(c.p) && c.p.length === 4 && c.p.every((v) => Number.isFinite(v)) ? cleanPoints(c.p) : [...DEFAULT_CURVE.p];
  const dir = ok && DIRS.includes(c.dir) ? c.dir : "out";
  const name = ok && typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 40) : "Custom";
  return { kind, p, dir, name };
}

export const isCurve = (c) => Boolean(c) && typeof c === "object" && KINDS.includes(c.kind) &&
  Array.isArray(c.p) && c.p.length === 4 && c.p.every((v) => typeof v === "number");

/* A function t -> eased value for any curve. */
export function easer(curve) {
  const c = checkCurve(curve);
  if (c.kind === "bezier") { return (t) => bezierAt(c.p, t); }
  const f = FUNCS[c.kind][c.dir];
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : f(t));
}

/* Which preset (if any) is this curve exactly? */
export function presetIdOf(curve) {
  const c = checkCurve(curve);
  if (c.kind !== "bezier") { return c.kind; }
  const hit = PRESETS.find((x) => x.kind === "bezier" && x.p.every((v, i) => Math.abs(v - c.p[i]) < 1e-9));
  return hit ? hit.id : null;
}

/* ============================================================
   6. CSS linear()
   Sample the curve finely, then keep only the points needed so
   straight-line joins stay within `tolerance` of the real curve
   (Ramer-Douglas-Peucker). Corners like a bounce's floor hits
   are kept, because dropping them would be a big error.
   ============================================================ */
export function linearPoints(f, { samples = 600, tolerance = 0.0015, breaks = [] } = {}) {
  const xs = new Set();
  for (let i = 0; i <= samples; i++) { xs.add(i / samples); }
  for (const b of breaks) { if (b > 0 && b < 1) { xs.add(b); } }
  const pts = [...xs].sort((a, b) => a - b).map((x) => [x, f(x)]);

  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const lineY = ay + (by - ay) * (x - ax) / (bx - ax);   // vertical gap is what the eye sees
      const gap = Math.abs(y - lineY);
      if (gap > worst) { worst = gap; at = i; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* linear(0, 0.1 12.5%, ..., 1). x only ever goes up. */
export function toLinear(f, options) {
  const pts = linearPoints(f, options);
  const parts = ["0"];
  let lastPct = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const pct = Number((pts[i][0] * 100).toFixed(2));
    if (pct <= lastPct || pct >= 100) { continue; }
    lastPct = pct;
    parts.push(`${num(pts[i][1], 4)} ${pct}%`);
  }
  parts.push("1");
  return `linear(${parts.join(", ")})`;
}

/* ============================================================
   7. COPY AS
   ============================================================ */

/* Where a bounce hits the floor: sharp corners linear() must keep. */
export function breaksOf(curve) {
  const c = checkCurve(curve);
  if (c.kind !== "bounce") { return []; }
  const out = [1 / 2.75, 2 / 2.75, 2.5 / 2.75];
  if (c.dir === "out") { return out; }
  if (c.dir === "in") { return out.map((x) => 1 - x); }
  return [...out.map((x) => (1 - x) / 2), ...out.map((x) => 0.5 + x / 2)];
}

/* Just the CSS timing value. */
export function cssValue(curve) {
  const c = checkCurve(curve);
  if (c.kind !== "bezier") { return toLinear(easer(c), { breaks: breaksOf(c) }); }
  return `cubic-bezier(${c.p.map((v) => num(v)).join(", ")})`;
}

/* The first comment line of every export. */
export function heading(curve) {
  const c = checkCurve(curve);
  if (c.kind === "bezier") { return `${c.name}: cubic-bezier(${c.p.map((v) => num(v)).join(", ")})`; }
  const label = `${c.kind} ${c.dir}`;
  return c.name.toLowerCase() === label ? c.name : `${c.name} (${label})`;
}

const cssName = (name) => (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom");

export function toCss(curve, ms = 600) {
  const c = checkCurve(curve);
  const v = cssValue(c);
  const n = cssName(c.name);
  const prop = n.startsWith("ease") ? `--${n}` : `--ease-${n}`;
  const lines = [`/* ${heading(c)} */`];
  if (c.kind !== "bezier") {
    lines.push("/* linear() needs Chrome 113, Firefox 112 or Safari 17.2 and up. */");
  }
  const id = presetIdOf(c);
  if (id && CSS_KEYWORDS[id]) { lines.push(`/* Tip: CSS has this one built in as the keyword "${CSS_KEYWORDS[id]}". */`); }
  lines.push(
    ":root {",
    `  ${prop}: ${v};`,
    "}",
    "",
    ".thing {",
    `  transition: transform ${Math.round(ms)}ms var(${prop});`,
    "}"
  );
  return lines.join("\n") + "\n";
}

/* ---- JavaScript ---- */
const JS_FUNCS = {
  bounce: [
    "function bounceOut(t) {",
    "  if (t < 1 / 2.75) return 7.5625 * t * t;",
    "  if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }",
    "  if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }",
    "  t -= 2.625 / 2.75;",
    "  return 7.5625 * t * t + 0.984375;",
    "}"
  ],
  elastic: {
    in: [
      "function elasticIn(t) {",
      "  if (t <= 0) return 0;",
      "  if (t >= 1) return 1;",
      "  t -= 1;",
      "  return -(Math.pow(2, 10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3));",
      "}"
    ],
    out: [
      "function elasticOut(t) {",
      "  if (t <= 0) return 0;",
      "  if (t >= 1) return 1;",
      "  return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;",
      "}"
    ],
    "in-out": [
      "function elasticInOut(t) {",
      "  if (t <= 0) return 0;",
      "  if (t >= 1) return 1;",
      "  t = t * 2 - 1;",
      "  const wave = Math.sin((t - 0.1125) * (2 * Math.PI) / 0.45);",
      "  return t < 0 ? -0.5 * Math.pow(2, 10 * t) * wave : Math.pow(2, -10 * t) * wave * 0.5 + 1;",
      "}"
    ]
  }
};
const JS_BOUNCE_CALL = {
  in: "1 - bounceOut(1 - t)",
  out: "bounceOut(t)",
  "in-out": "t < 0.5 ? (1 - bounceOut(1 - t * 2)) * 0.5 : bounceOut(t * 2 - 1) * 0.5 + 0.5"
};
const camel = (name) => name.replace(/[^a-zA-Z0-9]+(.)?/g, (_, ch) => (ch ? ch.toUpperCase() : "")).replace(/^./, (ch) => ch.toLowerCase());

export function jsName(curve) {
  const base = camel(checkCurve(curve).name.replace(/^[^a-zA-Z]+/, "")) || "custom";
  return /^ease/.test(base) ? base : `ease${base.replace(/^./, (ch) => ch.toUpperCase())}`;
}

export function toJs(curve, ms = 600) {
  const c = checkCurve(curve);
  const fn = jsName(c);
  const head = [
    `// ${heading(c)}`,
    "// Give it progress t from 0 to 1, get back the eased value.",
    `// Example: el.style.left = ${fn}(t) * 300 + "px";`
  ];
  if (c.kind === "bezier") {
    head.push(`// Web Animations can use the CSS value directly:`,
      `//   el.animate(frames, { duration: ${Math.round(ms)}, easing: "${cssValue(c)}" });`);
    const [x1, y1, x2, y2] = c.p.map((v) => num(v));
    return [
      ...head,
      `function ${fn}(t) {`,
      "  if (t <= 0) return 0;",
      "  if (t >= 1) return 1;",
      `  const x1 = ${x1}, y1 = ${y1}, x2 = ${x2}, y2 = ${y2};`,
      "  const bez = (u, a, b) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;",
      "  // Find where the curve's x equals t (halving the gap each step)...",
      "  let lo = 0, hi = 1, u = t;",
      "  for (let i = 0; i < 40; i++) {",
      "    const x = bez(u, x1, x2);",
      "    if (Math.abs(x - t) < 1e-7) break;",
      "    if (x < t) lo = u; else hi = u;",
      "    u = (lo + hi) / 2;",
      "  }",
      "  // ...then return the curve's y there.",
      "  return bez(u, y1, y2);",
      "}",
      ""
    ].join("\n");
  }
  if (c.kind === "bounce") {
    return [...head, ...JS_FUNCS.bounce, "", `function ${fn}(t) {`, "  if (t <= 0) return 0;", "  if (t >= 1) return 1;",
      `  return ${JS_BOUNCE_CALL[c.dir]};`, "}", ""].join("\n");
  }
  const inner = { in: "elasticIn", out: "elasticOut", "in-out": "elasticInOut" }[c.dir];
  return [...head, ...JS_FUNCS.elastic[c.dir], "", `function ${fn}(t) {`, `  return ${inner}(t);`, "}", ""].join("\n");
}

/* ---- GDScript (Godot 4) ---- tabs, as Godot's editor uses. */
const GD_BOUNCE_OUT = [
  "func _ease_bounce_out(t: float) -> float:",
  "\tif t < 1.0 / 2.75:",
  "\t\treturn 7.5625 * t * t",
  "\telif t < 2.0 / 2.75:",
  "\t\tvar u1 := t - 1.5 / 2.75",
  "\t\treturn 7.5625 * u1 * u1 + 0.75",
  "\telif t < 2.5 / 2.75:",
  "\t\tvar u2 := t - 2.25 / 2.75",
  "\t\treturn 7.5625 * u2 * u2 + 0.9375",
  "\tvar u3 := t - 2.625 / 2.75",
  "\treturn 7.5625 * u3 * u3 + 0.984375"
];
const GD_BOUNCE_CALL = {
  in: ["\treturn 1.0 - _ease_bounce_out(1.0 - t)"],
  out: ["\treturn _ease_bounce_out(t)"],
  "in-out": [
    "\tif t < 0.5:",
    "\t\treturn (1.0 - _ease_bounce_out(1.0 - t * 2.0)) * 0.5",
    "\treturn _ease_bounce_out(t * 2.0 - 1.0) * 0.5 + 0.5"
  ]
};
const GD_ELASTIC = {
  in: [
    "\tvar u := t - 1.0",
    "\treturn -(pow(2.0, 10.0 * u) * sin((u - 0.075) * TAU / 0.3))"
  ],
  out: [
    "\treturn pow(2.0, -10.0 * t) * sin((t - 0.075) * TAU / 0.3) + 1.0"
  ],
  "in-out": [
    "\tvar u := t * 2.0 - 1.0",
    "\tvar wave := sin((u - 0.1125) * TAU / 0.45)",
    "\tif u < 0.0:",
    "\t\treturn -0.5 * pow(2.0, 10.0 * u) * wave",
    "\treturn pow(2.0, -10.0 * u) * wave * 0.5 + 1.0"
  ]
};

export function toGdscript(curve, ms = 600) {
  const c = checkCurve(curve);
  const g = closestGodot(c);
  const secs = gdFloat(Math.round(ms) / 1000);
  const tween = `tween.tween_property(self, "position:x", 400.0, ${secs})`;
  const lines = [
    `# ${heading(c)}`,
    "# Godot 4. Paste into the script of the node you want to move.",
    "#",
    g.gap < 0.0005
      ? "# Built into Tween (the same curve):"
      : `# Closest built-in Tween easing (differs by up to ${Math.max(1, Math.round(g.gap * 100))}%):`,
    `#   var tween := create_tween()`,
    `#   ${tween}.set_trans(Tween.${g.trans}).set_ease(Tween.${g.ease})`,
    "#",
    "# The exact curve, using ease_curve() below (Godot 4.3 and up):",
    `#   ${tween}.set_custom_interpolator(ease_curve)`,
    "#",
    "# Or anywhere else: var eased := ease_curve(t)  # t from 0.0 to 1.0",
    ""
  ];
  if (c.kind === "bezier") {
    const [x1, y1, x2, y2] = c.p.map(gdFloat);
    lines.push(
      `const EASE_P1 := Vector2(${x1}, ${y1})`,
      `const EASE_P2 := Vector2(${x2}, ${y2})`,
      "",
      "",
      "func ease_curve(t: float) -> float:",
      "\tif t <= 0.0:",
      "\t\treturn 0.0",
      "\tif t >= 1.0:",
      "\t\treturn 1.0",
      "\t# Find where the curve's x equals t (halving the gap each step)...",
      "\tvar lo := 0.0",
      "\tvar hi := 1.0",
      "\tvar u := t",
      "\tfor _i in 40:",
      "\t\tvar x := _ease_bezier(u, EASE_P1.x, EASE_P2.x)",
      "\t\tif absf(x - t) < 0.0000001:",
      "\t\t\tbreak",
      "\t\tif x < t:",
      "\t\t\tlo = u",
      "\t\telse:",
      "\t\t\thi = u",
      "\t\tu = (lo + hi) * 0.5",
      "\t# ...then return the curve's y there.",
      "\treturn _ease_bezier(u, EASE_P1.y, EASE_P2.y)",
      "",
      "",
      "func _ease_bezier(u: float, a: float, b: float) -> float:",
      "\tvar v := 1.0 - u",
      "\treturn 3.0 * v * v * u * a + 3.0 * v * u * u * b + u * u * u",
      ""
    );
    return lines.join("\n");
  }
  lines.push(
    "func ease_curve(t: float) -> float:",
    "\tif t <= 0.0:",
    "\t\treturn 0.0",
    "\tif t >= 1.0:",
    "\t\treturn 1.0"
  );
  if (c.kind === "bounce") {
    lines.push(...GD_BOUNCE_CALL[c.dir], "", "", ...GD_BOUNCE_OUT, "");
  } else {
    lines.push(...GD_ELASTIC[c.dir], "");
  }
  return lines.join("\n");
}

export const EXPORTS = {
  css:  { label: "CSS",      make: toCss },
  gd:   { label: "GDScript", make: toGdscript },
  js:   { label: "JS",       make: toJs }
};
