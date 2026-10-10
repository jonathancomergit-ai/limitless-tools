/* ============================================================
   Thumbnail Maker - layout maths (no DOM, unit tested)

   A layout is plain data, so it can be saved, imported and
   tested:

     {
       size: "youtube" | "shorts" | "square",
       bg: { type: "solid" | "gradient", c1, c2, angle },
       layers: [ ...bottom first, top last... ]
     }

   Every layer has a centre (x, y) in full-size canvas pixels,
   a tilt (rot, degrees) and hidden. Then by kind:

     text     text, font, size (px), fill, outline (px), outlineColor
     sticker  shape, size (px), color
     photo    scale, pw, ph   (the picture's own size; the
                               picture itself is NEVER stored)

   And every layer can have shadow and glow (+ glowColor).

   Sections:
     1. presets     sizes, fonts, stickers
     2. numbers     clamp, fit / cover, pinch
     3. boxes       layer size, rotated hit-test, bounds
     4. lists       reorder, hit-test the stack
     5. resize      move a layout to another size
     6. gradient    CSS-style angle -> canvas line
     7. guides      where YouTube / Shorts cover your picture
     8. checking    clean an untrusted layout (imports)
   ============================================================ */

/* ============================================================
   1. PRESETS
   ============================================================ */
export const SIZES = Object.freeze({
  youtube: Object.freeze({ w: 1280, h: 720, label: "YouTube" }),
  shorts: Object.freeze({ w: 1080, h: 1920, label: "TikTok / Shorts" }),
  square: Object.freeze({ w: 1080, h: 1080, label: "Square" })
});

export function sizeOf(key) { return SIZES[key] || SIZES.youtube; }

/* The kit fonts only, each at its boldest weight. */
export const FONTS = Object.freeze({
  grotesk: Object.freeze({ family: "Space Grotesk", weight: 700, label: "Grotesk" }),
  inter: Object.freeze({ family: "Inter", weight: 900, label: "Inter" }),
  mono: Object.freeze({ family: "JetBrains Mono", weight: 800, label: "Mono" })
});

export function fontCss(key, px) {
  const f = FONTS[key] || FONTS.grotesk;
  return `${f.weight} ${Math.round(px)}px "${f.family}", sans-serif`;
}

/* Sticker shapes (drawn in stickers.js). aspect = width / height. */
export const STICKERS = Object.freeze({
  arrow: Object.freeze({ label: "Arrow", aspect: 1.7, color: "#FF2D2D" }),
  ring: Object.freeze({ label: "Circle", aspect: 1, color: "#FF2D2D" }),
  burst: Object.freeze({ label: "NEW!", aspect: 1, color: "#FFE13C" }),
  shocked: Object.freeze({ label: "Shocked", aspect: 1, color: "#FFC93C" }),
  fire: Object.freeze({ label: "Fire", aspect: 0.8, color: "#FF7A1A" }),
  star: Object.freeze({ label: "Star", aspect: 1, color: "#FFD23C" }),
  heart: Object.freeze({ label: "Heart", aspect: 1.1, color: "#FF3B6B" }),
  check: Object.freeze({ label: "Tick", aspect: 1, color: "#2BD96B" }),
  cross: Object.freeze({ label: "Cross", aspect: 1, color: "#FF2D2D" })
});

export const MAX_LAYERS = 30;
export const MAX_TEXT = 120;
export const LINE_HEIGHT = 1.02;

/* ============================================================
   2. NUMBERS
   ============================================================ */
export function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) { return lo; }
  return Math.min(hi, Math.max(lo, n));
}

/* Like clamp, but a bad value falls back to `fallback`. */
export function num(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" && typeof v !== "boolean" ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/* Wrap any angle into -180..180. */
export function wrapAngle(deg) {
  let a = ((Number(deg) || 0) % 360 + 360) % 360;
  if (a > 180) { a -= 360; }
  return a;
}

/* Scale that fits (contains) a w x h picture inside a box. */
export function fitScale(w, h, boxW, boxH) {
  if (!(w > 0 && h > 0)) { return 1; }
  return Math.min(boxW / w, boxH / h);
}

/* Scale that covers the whole box (some of the picture is cut off). */
export function coverScale(w, h, boxW, boxH) {
  if (!(w > 0 && h > 0)) { return 1; }
  return Math.max(boxW / w, boxH / h);
}

/* Two fingers: how much they spread (scale) and turned (degrees)
   since they went down. a0/b0 = start points, a1/b1 = now. */
export function pinch(a0, b0, a1, b1) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const t0 = Math.atan2(b0.y - a0.y, b0.x - a0.x);
  const t1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
  return {
    scale: d0 > 0 ? d1 / d0 : 1,
    turn: wrapAngle(((t1 - t0) * 180) / Math.PI)
  };
}

/* ============================================================
   3. BOXES
   ============================================================ */

/* A layer's unrotated width and height, in canvas pixels.
   Text needs its measured width (measure = { w } at its size,
   widest line); without it, a rough guess is used. */
export function layerSize(layer, measure = null) {
  if (layer.kind === "text") {
    const lines = String(layer.text || "").split("\n").length;
    const pad = (layer.outline || 0) * 2;
    const w = measure && measure.w > 0 ? measure.w : longestLine(layer.text) * layer.size * 0.6;
    return { w: Math.max(1, w + pad), h: Math.max(1, lines * layer.size * LINE_HEIGHT + pad) };
  }
  if (layer.kind === "sticker") {
    const aspect = (STICKERS[layer.shape] || STICKERS.star).aspect;
    return aspect >= 1 ? { w: layer.size * aspect, h: layer.size } : { w: layer.size, h: layer.size / aspect };
  }
  if (layer.kind === "photo") {
    return { w: Math.max(1, layer.pw * layer.scale), h: Math.max(1, layer.ph * layer.scale) };
  }
  return { w: 1, h: 1 };
}

function longestLine(text) {
  return Math.max(1, ...String(text || "").split("\n").map((l) => l.length));
}

/* The box: centre, size and tilt. */
export function layerBox(layer, measure = null) {
  const { w, h } = layerSize(layer, measure);
  return { cx: layer.x, cy: layer.y, w, h, rot: layer.rot || 0 };
}

/* Turn a point into the box's own frame (undo the tilt). */
export function toLocal(box, px, py) {
  const a = (-(box.rot || 0) * Math.PI) / 180;
  const dx = px - box.cx;
  const dy = py - box.cy;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

/* Is point (px, py) inside a rotated box? `slop` widens it (fingers). */
export function pointInBox(box, px, py, slop = 0) {
  const p = toLocal(box, px, py);
  return Math.abs(p.x) <= box.w / 2 + slop && Math.abs(p.y) <= box.h / 2 + slop;
}

/* The 4 corners of a rotated box, clockwise from top-left. */
export function corners(box) {
  const a = ((box.rot || 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx * box.w) / 2;
    const y = (sy * box.h) / 2;
    return { x: box.cx + x * c - y * s, y: box.cy + x * s + y * c };
  });
}

/* Upright bounds that hold the rotated box. */
export function bounds(box) {
  const pts = corners(box);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/* ============================================================
   4. LISTS
   ============================================================ */

/* Move one item from index `from` to `to`; a new array. */
export function moveItem(list, from, to) {
  const out = list.slice();
  if (from < 0 || from >= out.length) { return out; }
  const t = Math.max(0, Math.min(out.length - 1, to));
  const [it] = out.splice(from, 1);
  out.splice(t, 0, it);
  return out;
}

/* The top-most visible layer under a point, or -1.
   boxOf(layer, i) gives each layer's box. */
export function hitTest(layers, px, py, boxOf, slop = 0) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.hidden) { continue; }
    if (pointInBox(boxOf(l, i), px, py, slop)) { return i; }
  }
  return -1;
}

/* The "Size" slider: what it moves for each kind, and its range.
   text + sticker: px; picture: percent. */
export function sizeRange(kind, W, H) {
  const s = Math.min(W, H);
  if (kind === "text") { return { min: 16, max: Math.min(600, Math.round(s * 0.6)), step: 1, unit: "px" }; }
  if (kind === "sticker") { return { min: 40, max: Math.round(s * 1.5), step: 1, unit: "px" }; }
  return { min: 1, max: 400, step: 1, unit: "%" };
}

export function sizeValue(layer) {
  return layer.kind === "photo" ? Math.round(layer.scale * 100) : Math.round(layer.size);
}

/* Grow or shrink a layer by k (pinch, + / - keys). */
export function scaleLayer(layer, k, W, H) {
  if (layer.kind === "photo") { return { ...layer, scale: clamp(layer.scale * k, 0.01, 4) }; }
  const r = sizeRange(layer.kind, W, H);
  const size = clamp(layer.size * k, r.min, r.max);
  const n = { ...layer, size };
  if (layer.kind === "text") { n.outline = clamp((layer.outline || 0) * (size / layer.size), 0, 60); }
  return n;
}

/* Keep a layer's centre on the canvas (a margin may hang off). */
export function keepOnCanvas(layer, W, H) {
  return { ...layer, x: clamp(layer.x, 0, W), y: clamp(layer.y, 0, H) };
}

/* ============================================================
   5. RESIZE - the same layout on another canvas size.
   Positions stretch with the canvas; sizes follow the smaller
   change, so text never grows wider than the new canvas.
   ============================================================ */
export function resizeLayout(layout, toKey) {
  const from = sizeOf(layout.size);
  const to = sizeOf(toKey);
  const kx = to.w / from.w;
  const ky = to.h / from.h;
  const k = Math.min(kx, ky);
  const layers = layout.layers.map((l) => {
    const n = { ...l, x: round2(l.x * kx), y: round2(l.y * ky) };
    if (l.kind === "text") { n.size = round2(l.size * k); n.outline = round2((l.outline || 0) * k); }
    if (l.kind === "sticker") { n.size = round2(l.size * k); }
    if (l.kind === "photo") { n.scale = round4(l.scale * k); }
    return n;
  });
  return { ...layout, size: SIZES[toKey] ? toKey : "youtube", layers };
}

function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

/* ============================================================
   6. GRADIENT - CSS angles: 0 = to top, 90 = to right.
   Returns the line for createLinearGradient, long enough that
   the two colours land exactly on the far corners (like CSS).
   ============================================================ */
export function gradientLine(W, H, angle) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = Math.abs((W / 2) * dx) + Math.abs((H / 2) * dy);
  return {
    x0: W / 2 - dx * half,
    y0: H / 2 - dy * half,
    x1: W / 2 + dx * half,
    y1: H / 2 + dy * half
  };
}

/* ============================================================
   7. GUIDES - parts of the picture the app covers up.
   Rough, but on the safe side. In canvas pixels.
   ============================================================ */
export function safeZones(key) {
  const { w: W, h: H } = sizeOf(key);
  if (key === "youtube") {
    /* the video length box, bottom right */
    const bw = Math.round(W * 0.15);
    const bh = Math.round(H * 0.1);
    const m = Math.round(W * 0.012);
    return [{ x: W - bw - m, y: H - bh - m, w: bw, h: bh, label: "Timestamp" }];
  }
  if (key === "shorts") {
    return [
      { x: 0, y: 0, w: W, h: Math.round(H * 0.1), label: "Top bar" },
      { x: W - Math.round(W * 0.16), y: Math.round(H * 0.42), w: Math.round(W * 0.16), h: Math.round(H * 0.36), label: "Buttons" },
      { x: 0, y: H - Math.round(H * 0.22), w: W, h: Math.round(H * 0.22), label: "Title + caption" }
    ];
  }
  return [];
}

/* ============================================================
   8. CHECKING - layouts come from saves and imported files,
   so every field is checked and clamped. Bad layers are
   dropped; a hopeless layout gives null.
   ============================================================ */
const HEX = /^#[0-9a-f]{6}$/i;
export function color(v, fallback) { return typeof v === "string" && HEX.test(v) ? v.toUpperCase() : fallback; }

export function cleanLayer(l, W = 1280, H = 720) {
  if (!l || typeof l !== "object") { return null; }
  const base = {
    kind: l.kind,
    x: num(l.x, -W, W * 2, W / 2),
    y: num(l.y, -H, H * 2, H / 2),
    rot: wrapAngle(num(l.rot, -360, 360, 0)),
    hidden: l.hidden === true,
    shadow: l.shadow === true,
    glow: l.glow === true,
    glowColor: color(l.glowColor, "#FF2D78")
  };
  if (l.kind === "text") {
    const text = typeof l.text === "string" ? l.text.replace(/\r/g, "").slice(0, MAX_TEXT) : "";
    return {
      ...base,
      text,
      font: FONTS[l.font] ? l.font : "grotesk",
      size: num(l.size, 8, 600, 100),
      fill: color(l.fill, "#FFFFFF"),
      outline: num(l.outline, 0, 60, 0),
      outlineColor: color(l.outlineColor, "#000000")
    };
  }
  if (l.kind === "sticker") {
    const shape = STICKERS[l.shape] ? l.shape : null;
    if (!shape) { return null; }
    return { ...base, shape, size: num(l.size, 20, 2000, 200), color: color(l.color, STICKERS[shape].color) };
  }
  if (l.kind === "photo") {
    /* at most 20000 a side: both sides by the same factor, so a
       panorama keeps its shape (and its size on the canvas) */
    const pw = num(l.pw, 1, Infinity, 1280);
    const ph = num(l.ph, 1, Infinity, 720);
    const k = Math.min(1, 20000 / Math.max(pw, ph));
    return {
      ...base,
      scale: num(num(l.scale, 0.01, 4, 1) / k, 0.01, 4, 1),
      pw: Math.max(1, Math.round(pw * k)),
      ph: Math.max(1, Math.round(ph * k))
    };
  }
  return null;
}

export function cleanLayout(v) {
  if (!v || typeof v !== "object" || !Array.isArray(v.layers)) { return null; }
  const size = SIZES[v.size] ? v.size : "youtube";
  const { w, h } = SIZES[size];
  const bg = v.bg && typeof v.bg === "object" ? v.bg : {};
  const layers = v.layers.slice(0, MAX_LAYERS).map((l) => cleanLayer(l, w, h)).filter(Boolean);
  /* one picture at most */
  const firstPhoto = layers.findIndex((l) => l.kind === "photo");
  return {
    size,
    bg: {
      type: bg.type === "gradient" ? "gradient" : "solid",
      c1: color(bg.c1, "#1B1F3B"),
      c2: color(bg.c2, "#FF2D78"),
      angle: Math.round(num(bg.angle, 0, 360, 135))
    },
    layers: layers.filter((l, i) => l.kind !== "photo" || i === firstPhoto)
  };
}

/* Defaults for new layers, sized for the canvas. */
export function newText(W, H, text = "YOUR TEXT") {
  return cleanLayer({
    kind: "text", text, x: W / 2, y: H / 2, size: Math.round(Math.min(W, H) * 0.16),
    fill: "#FFFFFF", outline: Math.round(Math.min(W, H) * 0.018), outlineColor: "#000000", shadow: true
  }, W, H);
}

export function newSticker(shape, W, H) {
  return cleanLayer({
    kind: "sticker", shape, x: W / 2, y: H / 2, size: Math.round(Math.min(W, H) * 0.3), shadow: true
  }, W, H);
}

/* A picture layer, covering the canvas. */
export function newPhoto(pw, ph, W, H) {
  return cleanLayer({ kind: "photo", pw, ph, x: W / 2, y: H / 2, scale: coverScale(pw, ph, W, H) }, W, H);
}

/* Short name for the layer list. */
export function layerName(l) {
  if (l.kind === "photo") { return "Your picture"; }
  if (l.kind === "sticker") { return `Sticker: ${(STICKERS[l.shape] || { label: l.shape }).label}`; }
  const t = String(l.text || "").replace(/\n+/g, " ").trim();
  return `Text: ${t ? (t.length > 22 ? `${t.slice(0, 21)}…` : t) : "(empty)"}`;
}
