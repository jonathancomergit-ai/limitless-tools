/* ============================================================
   Thumbnail Maker - drawing

   render(ctx, layout, opts) paints a whole thumbnail at full
   size: background, then every layer from the bottom up. The
   editor and the export use the very same function, so what
   you see is what you download. The editor just adds extras
   on top (selection box, safe-area guide, a "picture missing"
   placeholder) that never reach the file.

   opts:
     photo      the picture (ImageBitmap / <img>), or null
     fx         effect scale for small previews (1 = full size)
     editor     { selected, guides } or null for a clean render
   ============================================================ */

import { sizeOf, fontCss, layerBox, corners, safeZones, gradientLine, LINE_HEIGHT } from "./layout.js";
import { drawSticker } from "./stickers.js";

/* ---- text measuring, cached (the hit-test needs it too) ---- */
const cache = new Map();
let measureCtx = null;

export function clearMeasures() { cache.clear(); }

export function measureText(layer) {
  const key = `${layer.font}|${layer.size}|${layer.text}`;
  let m = cache.get(key);
  if (!m) {
    if (!measureCtx) { measureCtx = document.createElement("canvas").getContext("2d"); }
    measureCtx.font = fontCss(layer.font, layer.size);
    const w = Math.max(1, ...String(layer.text).split("\n").map((l) => measureCtx.measureText(l).width));
    m = { w };
    if (cache.size > 300) { cache.clear(); }
    cache.set(key, m);
  }
  return m;
}

/* A layer's box, ready for hit-testing and handles. */
export function boxOf(layer) {
  return layerBox(layer, layer.kind === "text" ? measureText(layer) : null);
}

/* ============================================================
   THE WHOLE PICTURE
   ============================================================ */
export function render(ctx, layout, { photo = null, fx = 1, editor = null } = {}) {
  const { w: W, h: H } = sizeOf(layout.size);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  background(ctx, layout.bg, W, H);
  for (const layer of layout.layers) {
    if (layer.hidden) { continue; }
    if (layer.kind === "photo" && !photo) {
      if (editor) { missingPhoto(ctx, layer, W); }
      continue;
    }
    drawLayer(ctx, layer, photo, fx);
  }
  if (editor) {
    if (editor.guides) { guides(ctx, layout.size, W); }
    const sel = layout.layers[editor.selected];
    if (sel) { handles(ctx, boxOf(sel), W, sel.hidden); }
  }
  ctx.restore();
}

function background(ctx, bg, W, H) {
  if (bg.type === "gradient") {
    const g = gradientLine(W, H, bg.angle);
    const grad = ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
    grad.addColorStop(0, bg.c1);
    grad.addColorStop(1, bg.c2);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = bg.c1;
  }
  ctx.fillRect(0, 0, W, H);
}

/* ============================================================
   ONE LAYER, with its effects:
     glow    a coloured blur all round (drawn twice: brighter)
     shadow  a soft dark drop shadow, down and right
   then the layer itself on top, crisp.
   ============================================================ */
function drawLayer(ctx, layer, photo, fx) {
  const box = boxOf(layer);
  const ref = Math.min(box.w, box.h);
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate(((layer.rot || 0) * Math.PI) / 180);
  const paint = () => shape(ctx, layer, box, photo);

  if (layer.glow) {
    ctx.save();
    ctx.shadowColor = layer.glowColor;
    ctx.shadowBlur = Math.max(4, ref * 0.22) * fx;
    paint();
    paint();
    ctx.restore();
  }
  if (layer.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = Math.max(3, ref * 0.08) * fx;
    ctx.shadowOffsetX = Math.max(2, ref * 0.045) * fx;
    ctx.shadowOffsetY = Math.max(2, ref * 0.045) * fx;
    paint();
    ctx.restore();
  }
  paint();
  ctx.restore();
}

function shape(ctx, layer, box, photo) {
  if (layer.kind === "text") {
    text(ctx, layer);
  } else if (layer.kind === "sticker") {
    drawSticker(ctx, layer.shape, box.w, box.h, layer.color);
  } else if (layer.kind === "photo" && photo) {
    ctx.drawImage(photo, -box.w / 2, -box.h / 2, box.w, box.h);
  }
}

/* Big text: a thick round outline UNDER the fill, so the
   letters keep their full shape. */
function text(ctx, layer) {
  const lines = String(layer.text).split("\n");
  const step = layer.size * LINE_HEIGHT;
  ctx.font = fontCss(layer.font, layer.size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  lines.forEach((line, i) => {
    const y = (i - (lines.length - 1) / 2) * step + layer.size * 0.04;
    if (layer.outline > 0) {
      ctx.lineWidth = layer.outline * 2;
      ctx.strokeStyle = layer.outlineColor;
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = layer.fill;
    ctx.fillText(line, 0, y);
  });
}

/* ============================================================
   EDITOR EXTRAS (never exported)
   ============================================================ */
function missingPhoto(ctx, layer, W) {
  const box = boxOf(layer);
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate((box.rot * Math.PI) / 180);
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(-box.w / 2, -box.h / 2, box.w, box.h);
  ctx.setLineDash([W * 0.012, W * 0.008]);
  ctx.lineWidth = W * 0.003;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.font = `600 ${Math.round(W * 0.03)}px "Inter", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Add your picture again", 0, 0);
  ctx.restore();
}

function guides(ctx, key, W) {
  ctx.save();
  ctx.lineWidth = W * 0.003;
  ctx.font = `600 ${Math.round(W * 0.022)}px "Inter", sans-serif`;
  ctx.textBaseline = "top";
  for (const z of safeZones(key)) {
    ctx.fillStyle = "rgba(255, 45, 45, 0.28)";
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([W * 0.01, W * 0.007]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(z.label, z.x + W * 0.01, z.y + W * 0.008, z.w - W * 0.02);
  }
  ctx.restore();
}

function handles(ctx, box, W, hidden) {
  const pts = corners(box);
  const lw = Math.max(2, W * 0.0025);
  ctx.save();
  ctx.lineWidth = lw * 2.5;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  outline(ctx, pts);
  ctx.lineWidth = lw;
  ctx.strokeStyle = hidden ? "rgba(255, 255, 255, 0.6)" : "#35D6F5";
  ctx.setLineDash([lw * 5, lw * 3]);
  outline(ctx, pts);
  ctx.setLineDash([]);
  const s = lw * 6;
  for (const p of pts) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    ctx.strokeStyle = "#0B0C13";
    ctx.lineWidth = lw;
    ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  ctx.restore();
}

function outline(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
}
