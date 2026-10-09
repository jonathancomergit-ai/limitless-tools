/* ============================================================
   Thumbnail Maker - unit tests
   Layout maths: fit / cover scaling, hit-testing rotated
   layers, bounds, reorder, resizing to another size, the
   gradient line, safe-area guides, checking imported layouts
   and the starter templates.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIZES, sizeOf, FONTS, fontCss, STICKERS, clamp, num, wrapAngle, fitScale, coverScale, pinch,
  layerSize, layerBox, toLocal, pointInBox, corners, bounds, moveItem, hitTest, keepOnCanvas,
  resizeLayout, gradientLine, safeZones, cleanLayer, cleanLayout, newText, newSticker, newPhoto,
  layerName, sizeRange, sizeValue, scaleLayer, MAX_LAYERS, MAX_TEXT
} from "../../items/thumbnail-maker/layout.js";
import { TEMPLATES, templateById } from "../../items/thumbnail-maker/templates.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ~${b}`);

/* ---- presets ---------------------------------------------- */

test("size presets: YouTube, TikTok / Shorts, square", () => {
  assert.deepEqual([SIZES.youtube.w, SIZES.youtube.h], [1280, 720]);
  assert.deepEqual([SIZES.shorts.w, SIZES.shorts.h], [1080, 1920]);
  assert.deepEqual([SIZES.square.w, SIZES.square.h], [1080, 1080]);
  assert.equal(sizeOf("nope"), SIZES.youtube);
});

test("fonts: only the three kit fonts", () => {
  assert.deepEqual(Object.values(FONTS).map((f) => f.family).sort(), ["Inter", "JetBrains Mono", "Space Grotesk"]);
  assert.equal(fontCss("inter", 99.6), '900 100px "Inter", sans-serif');
  assert.equal(fontCss("bogus", 50), '700 50px "Space Grotesk", sans-serif');
});

/* ---- numbers ---------------------------------------------- */

test("clamp, num and wrapAngle", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp("x", 2, 3), 2);
  assert.equal(num("7", 0, 10, 1), 7);
  assert.equal(num(null, 0, 10, 4), 4);
  assert.equal(num(true, 0, 10, 4), 4);
  assert.equal(num(99, 0, 10, 4), 10);
  assert.equal(wrapAngle(190), -170);
  assert.equal(wrapAngle(-190), 170);
  assert.equal(wrapAngle(360), 0);
  assert.equal(wrapAngle(180), 180);
});

test("fit (contain) scaling: known numbers", () => {
  near(fitScale(1920, 1080, 1280, 720), 2 / 3);       // same shape: just shrinks
  near(fitScale(1000, 500, 1280, 720), 1.28);         // wide: width decides
  near(fitScale(600, 800, 1280, 720), 0.9);           // tall: height decides
  near(fitScale(4000, 3000, 1080, 1920), 0.27);       // into Shorts
  assert.equal(fitScale(0, 100, 1280, 720), 1);       // no picture: no change
});

test("cover scaling: known numbers", () => {
  near(coverScale(1920, 1080, 1280, 720), 2 / 3);
  near(coverScale(1000, 500, 1280, 720), 1.44);       // height decides
  near(coverScale(600, 800, 1280, 720), 1280 / 600);  // width decides
  near(coverScale(4000, 3000, 1080, 1920), 0.64);
  /* cover is never smaller than fit */
  for (const [w, h] of [[10, 10], [300, 2000], [5000, 20]]) {
    assert.ok(coverScale(w, h, 1280, 720) >= fitScale(w, h, 1280, 720));
  }
});

test("pinch: spread doubles the size, a quarter turn is 90 degrees", () => {
  const g = pinch({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 20 });
  near(g.scale, 2);
  near(g.turn, 90);
  const same = pinch({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 1, y: 1 }, { x: 9, y: 9 });
  assert.equal(same.scale, 1);   // fingers on one spot: no divide by zero
});

/* ---- boxes + hit-testing ---------------------------------- */

const box = (rot) => ({ cx: 100, cy: 100, w: 200, h: 40, rot });

test("hit-test a layer at 0 degrees", () => {
  assert.ok(pointInBox(box(0), 100, 100));             // centre
  assert.ok(pointInBox(box(0), 195, 115));             // near a corner
  assert.ok(!pointInBox(box(0), 100, 125));            // just below
  assert.ok(!pointInBox(box(0), 205, 100));            // just right
  assert.ok(pointInBox(box(0), 205, 100, 6));          // with finger slop
});

test("hit-test a layer at 90 degrees: tall instead of wide", () => {
  assert.ok(pointInBox(box(90), 100, 190));            // along the long side, now vertical
  assert.ok(pointInBox(box(90), 115, 10));
  assert.ok(!pointInBox(box(90), 190, 100));           // was inside at 0 degrees
  assert.ok(!pointInBox(box(90), 125, 100));
});

test("hit-test a layer at 45 degrees", () => {
  const d = 90 / Math.SQRT2;                           // 90 px along the diagonal
  assert.ok(pointInBox(box(45), 100 + d, 100 + d));    // down-right = along its length
  assert.ok(pointInBox(box(45), 100 - d, 100 - d));
  assert.ok(!pointInBox(box(45), 100 + d, 100 - d));   // across it: outside
  assert.ok(!pointInBox(box(45), 190, 100));           // inside at 0 degrees, not now
  const p = toLocal(box(45), 100 + d, 100 + d);
  near(p.x, 90);
  near(p.y, 0);
});

test("corners and bounds of a rotated box", () => {
  const c = corners(box(0));
  assert.deepEqual(c[0], { x: 0, y: 80 });
  assert.deepEqual(c[2], { x: 200, y: 120 });
  const b90 = bounds(box(90));
  near(b90.w, 40);
  near(b90.h, 200);
  near(b90.x, 80);
  const sq = bounds({ cx: 0, cy: 0, w: 100, h: 100, rot: 45 });
  near(sq.w, 100 * Math.SQRT2);
});

test("layer sizes by kind", () => {
  const t = cleanLayer({ kind: "text", text: "HI\nTHERE", size: 100, outline: 10 });
  assert.deepEqual(layerSize(t, { w: 300 }), { w: 320, h: 2 * 100 * 1.02 + 20 });
  assert.ok(layerSize(t).w > 0);                       // a guess without measuring
  const arrow = cleanLayer({ kind: "sticker", shape: "arrow", size: 100 });
  assert.deepEqual(layerSize(arrow), { w: 170, h: 100 });
  const fire = cleanLayer({ kind: "sticker", shape: "fire", size: 80 });
  assert.deepEqual(layerSize(fire), { w: 80, h: 100 });
  const ph = cleanLayer({ kind: "photo", pw: 1000, ph: 500, scale: 0.5 });
  assert.deepEqual(layerSize(ph), { w: 500, h: 250 });
  const b = layerBox({ ...ph, x: 10, y: 20, rot: 30 });
  assert.deepEqual(b, { cx: 10, cy: 20, w: 500, h: 250, rot: 30 });
});

test("hitTest finds the top-most visible layer", () => {
  const L = [
    { x: 100, y: 100, w: 200, h: 200, rot: 0 },
    { x: 100, y: 100, w: 50, h: 50, rot: 0 },
    { x: 100, y: 100, w: 300, h: 300, rot: 0, hidden: true }
  ];
  const of = (l) => ({ cx: l.x, cy: l.y, w: l.w, h: l.h, rot: l.rot });
  assert.equal(hitTest(L, 100, 100, of), 1);           // the small one is on top
  assert.equal(hitTest(L, 180, 180, of), 0);           // only the big one there
  assert.equal(hitTest(L, 240, 240, of), -1);          // the hidden one doesn't count
});

/* ---- lists ------------------------------------------------ */

test("moveItem reorders without changing the original", () => {
  const a = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(a, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(a, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(a, 1, 99), ["a", "c", "d", "b"]);
  assert.deepEqual(moveItem(a, 9, 0), a);
  assert.deepEqual(a, ["a", "b", "c", "d"]);
});

test("keepOnCanvas keeps the centre inside", () => {
  assert.deepEqual(keepOnCanvas({ x: -50, y: 900 }, 1280, 720), { x: 0, y: 720 });
});

test("size slider ranges, values and scaling", () => {
  assert.deepEqual(sizeRange("photo", 1280, 720), { min: 1, max: 400, step: 1, unit: "%" });
  assert.equal(sizeRange("text", 1280, 720).max, 432);
  assert.equal(sizeValue({ kind: "photo", scale: 0.256 }), 26);
  const t = cleanLayer({ kind: "text", text: "A", size: 100, outline: 10 });
  const big = scaleLayer(t, 2, 1280, 720);
  assert.equal(big.size, 200);
  assert.equal(big.outline, 20);                       // the outline grows with it
  assert.equal(scaleLayer(t, 100, 1280, 720).size, 432);
  const p = cleanLayer({ kind: "photo", pw: 10, ph: 10, scale: 3 });
  assert.equal(scaleLayer(p, 10, 1280, 720).scale, 4);
});

/* ---- resize ----------------------------------------------- */

test("resizeLayout moves a YouTube layout to Shorts", () => {
  const L = cleanLayout({
    size: "youtube",
    bg: { type: "solid", c1: "#000000" },
    layers: [
      { kind: "text", text: "HI", x: 640, y: 360, size: 100, outline: 10 },
      { kind: "sticker", shape: "star", x: 1280, y: 0, size: 200 },
      { kind: "photo", pw: 1280, ph: 720, scale: 1, x: 640, y: 360 }
    ]
  });
  const s = resizeLayout(L, "shorts");
  assert.equal(s.size, "shorts");
  assert.deepEqual([s.layers[0].x, s.layers[0].y], [540, 960]);   // centre stays centre
  assert.deepEqual([s.layers[1].x, s.layers[1].y], [1080, 0]);    // corner stays corner
  assert.equal(s.layers[0].size, 84.38);                          // the smaller change (1080 / 1280)
  assert.equal(s.layers[1].size, 168.75);
  near(s.layers[2].scale, 0.8438, 1e-4);
  assert.equal(L.layers[0].x, 640);                               // original untouched
  const back = resizeLayout(s, "youtube");
  near(back.layers[0].x, 640, 0.01);
});

/* ---- gradient --------------------------------------------- */

test("gradientLine follows CSS angles", () => {
  const right = gradientLine(100, 50, 90);                                          // to right
  near(right.x0, 0); near(right.y0, 25); near(right.x1, 100); near(right.y1, 25);
  const up = gradientLine(100, 50, 0);                                              // to top
  near(up.x0, 50); near(up.y0, 50); near(up.x1, 50); near(up.y1, 0);
  const diag = gradientLine(100, 100, 135);                                         // to bottom right
  near(diag.x0, 0); near(diag.y0, 0); near(diag.x1, 100); near(diag.y1, 100);
});

/* ---- guides ----------------------------------------------- */

test("safe-area guides sit inside the canvas", () => {
  const yt = safeZones("youtube");
  assert.equal(yt.length, 1);
  assert.ok(yt[0].x + yt[0].w <= 1280 && yt[0].y + yt[0].h <= 720);
  assert.ok(yt[0].x > 1280 / 2 && yt[0].y > 720 / 2, "timestamp is bottom right");
  const sh = safeZones("shorts");
  assert.ok(sh.length >= 3);
  for (const z of sh) { assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.w <= 1080 && z.y + z.h <= 1920, z.label); }
  assert.deepEqual(safeZones("square"), []);
});

/* ---- checking untrusted layouts --------------------------- */

test("cleanLayout fixes or drops bad data", () => {
  assert.equal(cleanLayout(null), null);
  assert.equal(cleanLayout({ layers: "no" }), null);
  const c = cleanLayout({
    size: "giant",
    bg: { type: "plaid", c1: "red", c2: "#ff0000", angle: 9999 },
    layers: [
      { kind: "text", text: "x".repeat(500), font: "Comic Sans", size: 99999, fill: "url(evil)", outline: -4 },
      { kind: "sticker", shape: "skull" },
      { kind: "script" },
      "nope",
      { kind: "photo", pw: 100, ph: 100, scale: 1, x: "a" },
      { kind: "photo", pw: 50, ph: 50 },
      { kind: "sticker", shape: "heart", hidden: true, rot: 270 }
    ]
  });
  assert.equal(c.size, "youtube");
  assert.deepEqual(c.bg, { type: "solid", c1: "#1B1F3B", c2: "#FF0000", angle: 360 });
  assert.equal(c.layers.length, 3);                    // text, the first photo, heart
  const t = c.layers[0];
  assert.equal(t.text.length, MAX_TEXT);
  assert.equal(t.font, "grotesk");
  assert.equal(t.size, 600);
  assert.equal(t.fill, "#FFFFFF");
  assert.equal(t.outline, 0);
  assert.equal(c.layers[1].x, 640);
  assert.equal(c.layers[2].rot, -90);
  assert.equal(c.layers[2].hidden, true);
  assert.equal(c.layers[2].color, STICKERS.heart.color);
});

test("cleanLayout caps the number of layers", () => {
  const many = Array.from({ length: 80 }, () => ({ kind: "sticker", shape: "star" }));
  assert.equal(cleanLayout({ layers: many }).layers.length, MAX_LAYERS);
});

test("a clean layout survives a JSON round trip unchanged", () => {
  const c = cleanLayout(TEMPLATES[0].layout);
  assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(c))), c);
});

test("new layers start in the middle", () => {
  const t = newText(1080, 1920);
  assert.deepEqual([t.x, t.y, t.kind], [540, 960, "text"]);
  const s = newSticker("burst", 1280, 720);
  assert.equal(s.shape, "burst");
  const p = newPhoto(2000, 1000, 1280, 720);
  near(p.scale, 0.72);                                 // covers 1280 x 720
  assert.equal(newSticker("nope", 10, 10), null);
});

test("layer names for the list", () => {
  assert.equal(layerName({ kind: "photo" }), "Your picture");
  assert.equal(layerName({ kind: "sticker", shape: "burst" }), "Sticker: NEW!");
  assert.equal(layerName({ kind: "text", text: "TOP\n10" }), "Text: TOP 10");
  assert.equal(layerName({ kind: "text", text: "  " }), "Text: (empty)");
  assert.ok(layerName({ kind: "text", text: "A".repeat(50) }).endsWith("…"));
});

/* ---- templates -------------------------------------------- */

test("4 to 6 templates, each a valid layout with text and stickers", () => {
  assert.ok(TEMPLATES.length >= 4 && TEMPLATES.length <= 6);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) {
    const c = cleanLayout(t.layout);
    assert.equal(c.layers.length, t.layout.layers.length, `${t.id}: a layer was dropped`);
    assert.ok(c.layers.some((l) => l.kind === "text"), `${t.id}: no text`);
    assert.ok(c.layers.some((l) => l.kind === "sticker"), `${t.id}: no sticker`);
    assert.ok(!c.layers.some((l) => l.kind === "photo"), `${t.id}: templates never hold a picture`);
    for (const l of c.layers) {
      assert.ok(l.x >= 0 && l.x <= 1280 && l.y >= 0 && l.y <= 720, `${t.id}: layer off the canvas`);
    }
  }
  assert.equal(templateById("top10").name, "Top 10");
  assert.equal(templateById("zzz"), null);
});
