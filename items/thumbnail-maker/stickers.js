/* ============================================================
   Thumbnail Maker - stickers, drawn in code

   No emoji fonts, no image files: every sticker is canvas
   paths, so it looks the same on every device and stays sharp
   at any size.

     drawSticker(ctx, shape, w, h, color)

   draws it centred on (0, 0) in a w x h box. Thick dark
   outlines, like real thumbnail stickers.
   ============================================================ */

const INK = "#111111";

export function drawSticker(ctx, shape, w, h, color) {
  const fn = SHAPES[shape];
  if (!fn) { return; }
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  fn(ctx, w, h, color);
  ctx.restore();
}

/* Fill, then a dark outline on top. */
function paint(ctx, path, fill, lw) {
  ctx.fillStyle = fill;
  ctx.fill(path);
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke(path);
  }
}

function star(points, outer, inner, turn = -Math.PI / 2) {
  const p = new Path2D();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = turn + (i * Math.PI) / points;
    if (i) { p.lineTo(Math.cos(a) * r, Math.sin(a) * r); } else { p.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  }
  p.closePath();
  return p;
}

function circle(r, x = 0, y = 0) {
  const p = new Path2D();
  p.arc(x, y, r, 0, Math.PI * 2);
  return p;
}

const SHAPES = {
  /* A fat arrow pointing right. */
  arrow(ctx, w, h, color) {
    const lw = h * 0.07;
    const head = h * 0.62;
    const shaft = h * 0.4;
    const L = -w / 2 + lw;
    const R = w / 2 - lw;
    const T = -h / 2 + lw;
    const B = h / 2 - lw;
    const p = new Path2D();
    p.moveTo(L, -shaft / 2);
    p.lineTo(R - head, -shaft / 2);
    p.lineTo(R - head, T);
    p.lineTo(R, 0);
    p.lineTo(R - head, B);
    p.lineTo(R - head, shaft / 2);
    p.lineTo(L, shaft / 2);
    p.closePath();
    paint(ctx, p, color, lw);
  },

  /* A ring to circle something. */
  ring(ctx, w, h, color) {
    const s = Math.min(w, h);
    const band = s * 0.1;
    const r = s / 2 - band / 2 - s * 0.02;
    ctx.lineWidth = band + s * 0.04;
    ctx.strokeStyle = INK;
    ctx.stroke(circle(r));
    ctx.lineWidth = band;
    ctx.strokeStyle = color;
    ctx.stroke(circle(r));
  },

  /* A starburst with NEW! on it. */
  burst(ctx, w, h, color) {
    const s = Math.min(w, h);
    const lw = s * 0.035;
    paint(ctx, star(14, s / 2 - lw, s * 0.38), color, lw);
    ctx.rotate(-0.2);
    ctx.font = `700 ${Math.round(s * 0.27)}px "Space Grotesk", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = s * 0.05;
    ctx.strokeStyle = "#FFFFFF";
    ctx.strokeText("NEW!", 0, s * 0.02);
    ctx.fillStyle = "#E5142B";
    ctx.fillText("NEW!", 0, s * 0.02);
  },

  /* A shocked face: big eyes, raised brows, open mouth. */
  shocked(ctx, w, h, color) {
    const s = Math.min(w, h);
    const lw = s * 0.035;
    paint(ctx, circle(s / 2 - lw), color, lw);
    /* eyes */
    for (const side of [-1, 1]) {
      const eye = new Path2D();
      eye.ellipse(side * s * 0.17, -s * 0.08, s * 0.1, s * 0.13, 0, 0, Math.PI * 2);
      paint(ctx, eye, "#FFFFFF", lw * 0.7);
      ctx.fillStyle = INK;
      ctx.fill(circle(s * 0.045, side * s * 0.17, -s * 0.06));
      /* brows */
      const brow = new Path2D();
      brow.moveTo(side * s * 0.08, -s * 0.27);
      brow.quadraticCurveTo(side * s * 0.18, -s * 0.36, side * s * 0.28, -s * 0.28);
      ctx.lineWidth = s * 0.04;
      ctx.strokeStyle = INK;
      ctx.stroke(brow);
    }
    /* mouth */
    const mouth = new Path2D();
    mouth.ellipse(0, s * 0.22, s * 0.09, s * 0.13, 0, 0, Math.PI * 2);
    paint(ctx, mouth, "#5A1A12", lw * 0.7);
    /* cheeks */
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#FF5A5A";
    ctx.fill(circle(s * 0.07, -s * 0.3, s * 0.13));
    ctx.fill(circle(s * 0.07, s * 0.3, s * 0.13));
    ctx.globalAlpha = 1;
  },

  /* A flame with a yellow heart. */
  fire(ctx, w, h, color) {
    const lw = w * 0.05;
    const flame = (k) => {
      const W = (w / 2 - lw) * k;
      const H = (h / 2 - lw) * k;
      const p = new Path2D();
      p.moveTo(0, H);
      p.bezierCurveTo(-W * 1.05, H, -W * 1.05, H * 0.05, -W * 0.55, -H * 0.3);
      p.bezierCurveTo(-W * 0.5, -H * 0.05, -W * 0.25, H * 0.05, -W * 0.15, -H * 0.05);
      p.bezierCurveTo(-W * 0.35, -H * 0.5, -W * 0.05, -H * 0.85, W * 0.1, -H);
      p.bezierCurveTo(W * 0.1, -H * 0.6, W * 0.45, -H * 0.45, W * 0.55, -H * 0.15);
      p.bezierCurveTo(W * 0.62, -H * 0.3, W * 0.62, -H * 0.42, W * 0.58, -H * 0.55);
      p.bezierCurveTo(W * 1.1, -H * 0.15, W * 1.05, H, 0, H);
      p.closePath();
      return p;
    };
    paint(ctx, flame(1), color, lw);
    ctx.translate(0, h * 0.14);
    paint(ctx, flame(0.55), "#FFE13C", 0);
  },

  star(ctx, w, h, color) {
    const s = Math.min(w, h);
    const lw = s * 0.045;
    ctx.translate(0, s * 0.04);
    paint(ctx, star(5, s / 2 - lw, s * 0.21), color, lw);
  },

  heart(ctx, w, h, color) {
    const lw = h * 0.05;
    const W = w / 2 - lw;
    const H = h / 2 - lw;
    const p = new Path2D();
    p.moveTo(0, H);
    p.bezierCurveTo(-W * 0.4, H * 0.6, -W, H * 0.15, -W, -H * 0.35);
    p.bezierCurveTo(-W, -H * 0.85, -W * 0.45, -H, 0, -H * 0.55);
    p.bezierCurveTo(W * 0.45, -H, W, -H * 0.85, W, -H * 0.35);
    p.bezierCurveTo(W, H * 0.15, W * 0.4, H * 0.6, 0, H);
    p.closePath();
    paint(ctx, p, color, lw);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#FFFFFF";
    const shine = new Path2D();
    shine.ellipse(-W * 0.5, -H * 0.42, W * 0.16, H * 0.1, -0.7, 0, Math.PI * 2);
    ctx.fill(shine);
    ctx.globalAlpha = 1;
  },

  /* A round badge with a tick. */
  check(ctx, w, h, color) {
    const s = Math.min(w, h);
    const lw = s * 0.04;
    paint(ctx, circle(s / 2 - lw), color, lw);
    const p = new Path2D();
    p.moveTo(-s * 0.22, s * 0.02);
    p.lineTo(-s * 0.06, s * 0.18);
    p.lineTo(s * 0.24, -s * 0.16);
    ctx.lineWidth = s * 0.15;
    ctx.strokeStyle = INK;
    ctx.stroke(p);
    ctx.lineWidth = s * 0.09;
    ctx.strokeStyle = "#FFFFFF";
    ctx.stroke(p);
  },

  /* A round badge with a cross. */
  cross(ctx, w, h, color) {
    const s = Math.min(w, h);
    const lw = s * 0.04;
    paint(ctx, circle(s / 2 - lw), color, lw);
    const d = s * 0.17;
    const p = new Path2D();
    p.moveTo(-d, -d);
    p.lineTo(d, d);
    p.moveTo(d, -d);
    p.lineTo(-d, d);
    ctx.lineWidth = s * 0.15;
    ctx.strokeStyle = INK;
    ctx.stroke(p);
    ctx.lineWidth = s * 0.09;
    ctx.strokeStyle = "#FFFFFF";
    ctx.stroke(p);
  }
};
