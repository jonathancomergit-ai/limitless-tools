/* ============================================================
   Palette Lab - colour maths (pure, no DOM)

     parseHex / toHex          "#ffc93c" <-> { r, g, b } (0..255)
     contrast(a, b)            WCAG 2 contrast ratio, 1..21
     grade(ratio)              which WCAG levels it passes
     rgbToHsl / hslToRgb       HSL, for people who think in it
     toOklch / fromOklch       OKLCH: a "perceptual" colour space
                               where equal steps LOOK equal
     simulate(hex, type)       colour-blindness preview
     generate(...)             5-colour harmonies, locks kept
     toCss / toJson / toGpl / toGodot   exports

   Unit tested in tests/unit/palette-lab.test.js.
   ============================================================ */

/* ============================================================
   HEX
   ============================================================ */

/* Accepts "#abc", "abc", "#aabbcc". Returns null for junk. */
export function parseHex(text) {
  let h = String(text ?? "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) { h = h.split("").map((c) => c + c).join(""); }
  if (!/^[0-9a-f]{6}$/.test(h)) { return null; }
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

const byte = (v) => Math.round(Math.min(255, Math.max(0, v)));
export function toHex({ r, g, b }) {
  return "#" + [r, g, b].map((v) => byte(v).toString(16).padStart(2, "0")).join("");
}

/* "#ABC" -> "#aabbcc", or null. */
export function normalizeHex(text) {
  const c = parseHex(text);
  return c ? toHex(c) : null;
}

/* ============================================================
   WCAG CONTRAST
   ============================================================ */
const toLinear = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const fromLinear = (l) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

export function luminance(hex) {
  const c = typeof hex === "string" ? parseHex(hex) : hex;
  if (!c) { return 0; }
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Normal text: AA 4.5, AAA 7. Large text (24px, or 19px bold): AA 3, AAA 4.5. */
export function grade(ratio) {
  return { aa: ratio >= 4.5, aaa: ratio >= 7, aaLarge: ratio >= 3, aaaLarge: ratio >= 4.5 };
}

/* Black or white, whichever reads better on this colour. */
export function inkFor(hex) {
  return contrast(hex, "#000000") >= contrast(hex, "#ffffff") ? "#000000" : "#ffffff";
}

/* ============================================================
   HSL
   ============================================================ */
export function rgbToHsl({ r, g, b }) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) { h = (G - B) / d + (G < B ? 6 : 0); } else if (max === G) { h = (B - R) / d + 2; } else { h = (R - G) / d + 4; }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }) {
  const S = s / 100; const L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: 255 * f(0), g: 255 * f(8), b: 255 * f(4) };
}

/* ============================================================
   OKLCH (Björn Ottosson's OKLab, in polar form)
   L 0..1 lightness, C 0..~0.37 colourfulness, H 0..360 hue
   ============================================================ */
export function toOklch(hex) {
  const c = typeof hex === "string" ? parseHex(hex) : hex;
  const r = toLinear(c.r); const g = toLinear(c.g); const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.hypot(A, B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) { H += 360; }
  return { l: L, c: C, h: C < 1e-4 ? 0 : H };
}

/* Linear RGB (0..1, may be out of range) for an OKLCH colour. */
function oklchToLinear({ l: L, c: C, h: H }) {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
}

/* OKLCH -> hex. Colours a screen can't show have their chroma
   lowered until they fit (keeps the hue and lightness). */
export function fromOklch({ l, c, h }) {
  const L = Math.min(1, Math.max(0, l));
  let C = Math.max(0, c);
  let lin = oklchToLinear({ l: L, c: C, h });
  const fits = (v) => v.every((x) => x >= -1e-4 && x <= 1 + 1e-4);
  if (!fits(lin)) {
    let lo = 0; let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(oklchToLinear({ l: L, c: mid, h }))) { lo = mid; } else { hi = mid; }
    }
    C = lo;
    lin = oklchToLinear({ l: L, c: C, h });
  }
  return toHex({ r: fromLinear(lin[0]), g: fromLinear(lin[1]), b: fromLinear(lin[2]) });
}

/* ============================================================
   COLOUR-BLINDNESS (Machado, Oliveira & Fernandes 2009,
   severity 1.0), applied in linear RGB.
   ============================================================ */
export const CVD = {
  protanopia: [
    0.152286, 1.052583, -0.204868,
    0.114503, 0.786281, 0.099216,
    -0.003882, -0.048116, 1.051998
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968,
    0.280085, 0.672501, 0.047413,
    -0.011820, 0.042940, 0.968881
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779,
    -0.078411, 0.930809, 0.147602,
    0.004733, 0.691367, 0.303900
  ]
};

export function simulate(hex, type) {
  const m = CVD[type];
  const c = parseHex(hex);
  if (!m || !c) { return normalizeHex(hex); }
  const r = toLinear(c.r); const g = toLinear(c.g); const b = toLinear(c.b);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  return toHex({
    r: fromLinear(clamp01(m[0] * r + m[1] * g + m[2] * b)),
    g: fromLinear(clamp01(m[3] * r + m[4] * g + m[5] * b)),
    b: fromLinear(clamp01(m[6] * r + m[7] * g + m[8] * b))
  });
}

/* ============================================================
   PALETTES
   ============================================================ */
export const MODES = ["analogous", "complementary", "triadic", "base"];

/* Hue offset (degrees) for each of the 5 slots. */
const OFFSETS = {
  analogous:     [-40, -20, 0, 20, 40],
  complementary: [0, 0, 180, 0, 180],
  triadic:       [0, 120, 240, 0, 120],
  base:          [0, 0, 0, 0, 0]
};

/* Lightness for each slot: dark to light, so a palette always has
   something readable on something else. */
const LIGHT = [0.26, 0.42, 0.6, 0.76, 0.93];

/* palette: 5 hex colours now, locks: 5 booleans,
   rand: () => 0..1, base: the colour for "base" mode.
   Locked colours are copied over untouched. */
export function generate({ mode = "analogous", palette = [], locks = [], base = null, rand = Math.random } = {}) {
  const m = MODES.includes(mode) ? mode : "analogous";
  const offsets = OFFSETS[m];
  const jitter = (n) => (rand() * 2 - 1) * n;

  /* The anchor: a locked colour, the base colour, or a random one. */
  const lockedAt = locks.findIndex((on, i) => on && normalizeHex(palette[i]));
  let anchor;
  let anchorSlot = 2;
  if (m === "base" && normalizeHex(base)) {
    anchor = toOklch(normalizeHex(base));
  } else if (lockedAt !== -1) {
    anchor = toOklch(normalizeHex(palette[lockedAt]));
    anchorSlot = lockedAt;
  } else {
    anchor = { l: 0.6, c: 0.09 + rand() * 0.1, h: rand() * 360 };
  }
  const chroma = Math.max(0.04, anchor.c);
  const spin = m === "base" ? 0 : (rand() < 0.5 ? 1 : -1);
  const hue0 = anchor.h - spin * offsets[anchorSlot];

  const out = [];
  for (let i = 0; i < 5; i++) {
    if (locks[i] && normalizeHex(palette[i])) { out.push(normalizeHex(palette[i])); continue; }
    if (m === "base" && i === 2 && normalizeHex(base)) { out.push(normalizeHex(base)); continue; }
    const l = Math.min(0.97, Math.max(0.15, LIGHT[i] + jitter(0.05)));
    /* Very dark and very light colours can't be very colourful. */
    const c = chroma * (1 - Math.abs(l - 0.62) * 1.1) + jitter(0.025);
    const h = (hue0 + spin * offsets[i] + jitter(m === "base" ? 6 : 10) + 720) % 360;
    out.push(fromOklch({ l, c: Math.max(0, c), h }));
  }
  return out;
}

/* ============================================================
   EXPORTS
   ============================================================ */
const name = (i) => `color-${i + 1}`;
const f3 = (v) => (v / 255).toFixed(3);

export function toCss(colors) {
  return `:root {\n${colors.map((c, i) => `  --${name(i)}: ${c};`).join("\n")}\n}\n`;
}

export function toJson(colors, title = "Palette Lab") {
  return JSON.stringify({ name: title, colors }, null, 2) + "\n";
}

/* GIMP / Aseprite / Inkscape / Krita palette file. */
export function toGpl(colors, title = "Palette Lab") {
  const rows = colors.map((c, i) => {
    const { r, g, b } = parseHex(c);
    return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${name(i)} ${c}`;
  });
  return `GIMP Palette\nName: ${title.replace(/[\r\n]/g, " ")}\nColumns: ${colors.length}\n#\n${rows.join("\n")}\n`;
}

/* A GDScript constant, for Godot 3 and 4. */
export function toGodot(colors) {
  const rows = colors.map((c) => {
    const { r, g, b } = parseHex(c);
    return `\tColor(${f3(r)}, ${f3(g)}, ${f3(b)}),  # ${c}`;
  });
  return `const PALETTE = [\n${rows.join("\n")}\n]\n`;
}

export const EXPORTS = {
  css:   { label: "CSS",   ext: "css",  mime: "text/css",         make: toCss },
  json:  { label: "JSON",  ext: "json", mime: "application/json", make: toJson },
  gpl:   { label: "GPL",   ext: "gpl",  mime: "text/plain",       make: toGpl },
  godot: { label: "Godot", ext: "gd",   mime: "text/plain",       make: toGodot }
};
