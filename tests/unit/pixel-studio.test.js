/* ============================================================
   Pixel Studio - unit tests
   Flood fill, Bresenham lines, undo / redo, mirror, layer
   compositing, the sprite sheet JSON, resize / crop, the
   compact save format and the copied GIF encoder.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hexToColor, colorToHex, createDoc, cloneDoc, resizeDoc, getPixel, setPixel, plot,
  floodFill, linePoints, rectPoints, mirrorPoints, eyedropper, composite, over,
  createHistory, addLayer, deleteLayer, moveLayer, addFrame, duplicateFrame, deleteFrame,
  scaleUp, fitScale, sheetLayout, sheetJson, encodeDoc, decodeDoc, MAX_LAYERS, MAX_FRAMES
} from "../../items/pixel-studio/canvas-ops.js";
import { PRESETS } from "../../items/pixel-studio/palettes.js";
import { encodeGif, readGif } from "../../items/pixel-studio/gif.js";

const RED = hexToColor("#ff0000");
const BLUE = hexToColor("#0000ff");
const GREEN = hexToColor("#00ff00");
const key = (pts) => pts.map(([x, y]) => `${x},${y}`).join(" ");

/* Draw a picture from rows of characters: "." = see-through. */
function celFrom(rows, colors) {
  const h = rows.length;
  const w = rows[0].length;
  const cel = new Uint32Array(w * h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { cel[y * w + x] = ch === "." ? 0 : colors[ch]; }));
  return { cel, w, h };
}
function rowsOf(cel, w, h, names) {
  const back = new Map(Object.entries(names).map(([k, v]) => [v, k]));
  const out = [];
  for (let y = 0; y < h; y++) {
    let s = "";
    for (let x = 0; x < w; x++) { const c = cel[y * w + x]; s += c ? back.get(c) || "?" : "."; }
    out.push(s);
  }
  return out;
}

/* ---- colours ------------------------------------------------- */

test("colours: hex in, same hex out; see-through is 0", () => {
  for (const hex of ["#000000", "#ff004d", "#29adff", "#fff1e8"]) { assert.equal(colorToHex(hexToColor(hex)), hex); }
  assert.equal(hexToColor("#f00"), RED);
  assert.equal(hexToColor("#ff000000"), 0);
  assert.equal(colorToHex(hexToColor("#11223380")), "#11223380");
  assert.equal(hexToColor("nope"), null);
  /* laid out like ImageData: R first */
  assert.deepEqual([...new Uint8Array(new Uint32Array([hexToColor("#102030")]).buffer)], [0x10, 0x20, 0x30, 255]);
});

/* ---- flood fill ---------------------------------------------- */

test("flood fill stops at borders (a closed outline)", () => {
  const c = { R: RED };
  const { cel, w, h } = celFrom([
    "........",
    ".RRRRR..",
    ".R...R..",
    ".R...R..",
    ".RRRRR..",
    "........"
  ], c);
  const n = floodFill(cel, w, h, 3, 2, BLUE);
  assert.equal(n, 6);
  assert.deepEqual(rowsOf(cel, w, h, { R: RED, B: BLUE }), [
    "........",
    ".RRRRR..",
    ".RBBBR..",
    ".RBBBR..",
    ".RRRRR..",
    "........"
  ]);
});

test("flood fill is 4-way: a diagonal gap does not leak", () => {
  const { cel, w, h } = celFrom([
    "R....",
    ".R...",
    "..R..",
    "...R.",
    "....R"
  ], { R: RED });
  floodFill(cel, w, h, 0, 4, BLUE);          // the bottom-left triangle
  assert.deepEqual(rowsOf(cel, w, h, { R: RED, B: BLUE }), [
    "R....",
    "BR...",
    "BBR..",
    "BBBR.",
    "BBBBR"
  ]);
});

test("flood fill stops at the canvas edge, and same colour is a no-op", () => {
  const { cel, w, h } = celFrom(["....", "....", "...."], {});
  assert.equal(floodFill(cel, w, h, 1, 1, GREEN), 12);
  assert.ok(cel.every((v) => v === GREEN));
  const copy = cel.slice();
  assert.equal(floodFill(cel, w, h, 0, 0, GREEN), 0);
  assert.deepEqual(cel, copy);
  assert.equal(floodFill(cel, w, h, 9, 9, RED), 0);   // outside: nothing
});

test("flood fill copes with a big spiral without blowing the stack", () => {
  const w = 128;
  const h = 128;
  const cel = new Uint32Array(w * h);
  /* every other column a wall with one gap, alternating top / bottom */
  for (let x = 1; x < w; x += 2) {
    for (let y = 0; y < h; y++) { cel[y * w + x] = RED; }
    cel[(x % 4 === 1 ? h - 1 : 0) * w + x] = 0;
  }
  const empty = cel.filter((v) => v === 0).length;
  assert.equal(floodFill(cel, w, h, 0, 0, BLUE), empty);
});

/* ---- lines + rectangles -------------------------------------- */

test("line: horizontal, vertical and 45 degrees", () => {
  assert.equal(key(linePoints(0, 0, 3, 0)), "0,0 1,0 2,0 3,0");
  assert.equal(key(linePoints(2, 3, 2, 0)), "2,3 2,2 2,1 2,0");
  assert.equal(key(linePoints(0, 0, 3, 3)), "0,0 1,1 2,2 3,3");
  assert.equal(key(linePoints(5, 5, 5, 5)), "5,5");
});

test("line: shallow, steep and negative slopes hit exactly the right pixels", () => {
  /* Each pixel is the one nearest the true line (no ties in these). */
  /* shallow: y = 2x/5 */
  assert.equal(key(linePoints(0, 0, 5, 2)), "0,0 1,0 2,1 3,1 4,2 5,2");
  /* steep: x = 2y/5 */
  assert.equal(key(linePoints(0, 0, 2, 5)), "0,0 0,1 1,2 1,3 2,4 2,5");
  /* negative slope, going up and right: y = 3 - 3x/7 */
  assert.equal(key(linePoints(0, 3, 7, 0)), "0,3 1,3 2,2 3,2 4,1 5,1 6,0 7,0");
  /* steep and negative, going left and down */
  assert.equal(key(linePoints(3, 0, 0, 7)), "3,0 3,1 2,2 2,3 1,4 1,5 0,6 0,7");
  /* backwards: same pixel set as forwards, no gaps */
  const fwd = linePoints(1, 1, 7, 4);
  const back = linePoints(7, 4, 1, 1);
  assert.deepEqual(new Set(fwd.map(String)), new Set(back.map(String)));
  for (let i = 1; i < fwd.length; i++) {
    assert.ok(Math.abs(fwd[i][0] - fwd[i - 1][0]) <= 1 && Math.abs(fwd[i][1] - fwd[i - 1][1]) <= 1, "connected");
  }
  /* one pixel per step along the long axis */
  assert.equal(linePoints(-3, 10, 9, 2).length, 13);
});

test("rectangle: outline and filled, corners in any order", () => {
  assert.equal(rectPoints(0, 0, 2, 2).length, 8);
  assert.equal(rectPoints(2, 2, 0, 0, true).length, 9);
  assert.equal(key(rectPoints(3, 1, 1, 1)), "1,1 2,1 3,1");
});

/* ---- mirror + eyedropper ------------------------------------- */

test("mirror: left/right, top/bottom and both, no doubles", () => {
  assert.equal(key(mirrorPoints([[1, 2]], 8, 8, { x: true })), "1,2 6,2");
  assert.equal(key(mirrorPoints([[1, 2]], 8, 8, { y: true })), "1,2 1,5");
  assert.equal(key(mirrorPoints([[1, 2]], 8, 8, { x: true, y: true })), "1,2 6,2 1,5 6,5");
  /* the middle column of an odd width mirrors onto itself */
  assert.equal(key(mirrorPoints([[4, 0]], 9, 9, { x: true })), "4,0");
  assert.equal(mirrorPoints([[1, 1]], 8, 8, {}).length, 1);
});

test("eyedropper reads the top visible colour", () => {
  const doc = createDoc(8, 8, { layers: 2 });
  setPixel(doc.frames[0][0], 8, 8, 1, 1, RED);
  setPixel(doc.frames[0][1], 8, 8, 1, 1, BLUE);
  setPixel(doc.frames[0][0], 8, 8, 2, 2, GREEN);
  assert.equal(eyedropper(doc, 0, 1, 1), BLUE);
  assert.equal(eyedropper(doc, 0, 2, 2), GREEN);
  assert.equal(eyedropper(doc, 0, 3, 3), 0);
  doc.layers[1].visible = false;
  assert.equal(eyedropper(doc, 0, 1, 1), RED);
});

/* ---- compositing --------------------------------------------- */

test("compositing: visible layers only, top layer wins", () => {
  const doc = createDoc(8, 8, { layers: 3 });
  const [a, b, c] = doc.frames[0];
  setPixel(a, 8, 8, 0, 0, RED);
  setPixel(b, 8, 8, 0, 0, GREEN);
  setPixel(c, 8, 8, 1, 0, BLUE);
  setPixel(a, 8, 8, 2, 0, RED);
  let out = composite(doc, 0);
  assert.equal(out[0], GREEN);
  assert.equal(out[1], BLUE);
  assert.equal(out[2], RED);
  assert.equal(out[3], 0);
  doc.layers[1].visible = false;
  out = composite(doc, 0);
  assert.equal(out[0], RED);
  /* reorder: green moves to the bottom, red now shows on top */
  doc.layers[1].visible = true;
  const moved = moveLayer(doc, 1, -1);
  assert.equal(composite(moved, 0)[0], RED);
  assert.equal(composite(doc, 0)[0], GREEN, "the old document is untouched");
});

test("compositing blends half see-through colours", () => {
  const half = hexToColor("#0000ff80");
  const mixed = over(hexToColor("#ff0000"), half);
  const hex = colorToHex(mixed);
  assert.equal(hex.slice(0, 3), "#7f");
  assert.equal(mixed >>> 24, 255);
  assert.equal(over(0, half), half);
});

/* ---- undo / redo --------------------------------------------- */

test("undo / redo returns the exact pixels", () => {
  let doc = createDoc(16, 16);
  const cel = () => doc.frames[0][0];
  const hist = createHistory();
  const states = [cel().slice()];

  /* three strokes: a pixel, a line, a fill */
  const strokes = [
    () => setPixel(cel(), 16, 16, 3, 3, RED),
    () => plot(cel(), 16, 16, linePoints(0, 15, 15, 0), BLUE),
    () => floodFill(cel(), 16, 16, 0, 0, GREEN)
  ];
  for (const s of strokes) {
    const before = cel().slice();
    s();
    assert.ok(hist.pixels(0, 0, before, cel()));
    states.push(cel().slice());
  }
  assert.equal(hist.size, 3);

  for (let i = 3; i > 0; i--) {
    doc = hist.undo(doc).doc;
    assert.deepEqual(cel(), states[i - 1], `undo back to state ${i - 1}`);
  }
  assert.equal(hist.canUndo, false);
  for (let i = 1; i <= 3; i++) {
    doc = hist.redo(doc).doc;
    assert.deepEqual(cel(), states[i], `redo to state ${i}`);
  }
  assert.equal(hist.canRedo, false);
});

test("undo / redo of a layer or frame change, and a new step clears redo", () => {
  let doc = createDoc(8, 8);
  setPixel(doc.frames[0][0], 8, 8, 0, 0, RED);
  const hist = createHistory();
  const before = cloneDoc(doc);
  doc = duplicateFrame(doc, 0);
  hist.snapshot(before, doc, { before: { frame: 0 }, after: { frame: 1 } });
  assert.equal(doc.frames.length, 2);
  const u = hist.undo(doc);
  assert.equal(u.dir, -1);
  assert.deepEqual(u.step.meta.before, { frame: 0 });
  doc = u.doc;
  assert.equal(doc.frames.length, 1);
  assert.equal(doc.frames[0][0][0], RED);
  doc = hist.redo(doc).doc;
  assert.equal(doc.frames.length, 2);
  doc = hist.undo(doc).doc;
  const b = doc.frames[0][0].slice();
  setPixel(doc.frames[0][0], 8, 8, 1, 1, BLUE);
  hist.pixels(0, 0, b, doc.frames[0][0]);
  assert.equal(hist.canRedo, false);
  assert.equal(hist.pixels(0, 0, doc.frames[0][0], doc.frames[0][0]), false, "no change, no step");
});

test("the undo stack is capped", () => {
  const hist = createHistory({ limit: 5 });
  const a = new Uint32Array(4);
  for (let i = 0; i < 9; i++) { const b = a.slice(); b[0] = i + 1; hist.pixels(0, 0, a, b); }
  assert.equal(hist.size, 5);
  const big = createHistory({ limit: 100, maxBytes: 3 * 128 * 128 * 4 * 2 });
  let doc = createDoc(128, 128);
  for (let i = 0; i < 6; i++) { const next = addFrame(doc); big.snapshot(doc, next); doc = deleteFrame(next, 1); }
  assert.ok(big.size >= 1 && big.size < 6);
});

/* ---- layers + frames ----------------------------------------- */

test("layers and frames: add, delete, limits", () => {
  let doc = createDoc(8, 8);
  for (let i = 0; i < 6; i++) { doc = addLayer(doc); }
  assert.equal(doc.layers.length, MAX_LAYERS);
  assert.equal(new Set(doc.layers.map((l) => l.name)).size, MAX_LAYERS);
  doc = deleteLayer(doc, 0);
  assert.equal(doc.layers.length, MAX_LAYERS - 1);
  for (let i = 0; i < 30; i++) { doc = addFrame(doc); }
  assert.equal(doc.frames.length, MAX_FRAMES);
  assert.ok(doc.frames.every((cels) => cels.length === doc.layers.length));
  let one = createDoc(8, 8);
  one = deleteFrame(deleteLayer(one, 0), 0);
  assert.equal(one.layers.length, 1);
  assert.equal(one.frames.length, 1);
});

/* ---- resize / crop ------------------------------------------- */

test("resize keeps the art (centred or top-left) and crops when smaller", () => {
  const doc = createDoc(8, 8);
  setPixel(doc.frames[0][0], 8, 8, 0, 0, RED);
  setPixel(doc.frames[0][0], 8, 8, 7, 7, BLUE);
  const big = resizeDoc(doc, 16, 12, { x: 0.5, y: 0.5 });
  assert.equal(big.w, 16);
  assert.equal(getPixel(big.frames[0][0], 16, 12, 4, 2), RED);
  assert.equal(getPixel(big.frames[0][0], 16, 12, 11, 9), BLUE);
  const tl = resizeDoc(doc, 16, 16, { x: 0, y: 0 });
  assert.equal(getPixel(tl.frames[0][0], 16, 16, 0, 0), RED);
  const small = resizeDoc(doc, 4, 4, { x: 0, y: 0 });
  assert.equal(small.w, 8, "8 is the smallest size");
  const crop = resizeDoc(resizeDoc(doc, 16, 16, { x: 0, y: 0 }), 8, 8, { x: 0, y: 0 });
  assert.deepEqual(crop.frames[0][0], doc.frames[0][0]);
});

/* ---- export -------------------------------------------------- */

test("scale up: every pixel becomes a k x k block", () => {
  const px = Uint32Array.from([1, 2, 3, 4]);
  assert.deepEqual([...scaleUp(px, 2, 2, 2)], [1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
  assert.equal(fitScale(128, 128, 32), 32);
  assert.equal(fitScale(128 * 5, 128 * 5, 32), 9);    // 40 M pixels at most
  assert.equal(fitScale(128 * 5, 128, 32), 12);       // 8192 px a side at most
  assert.equal(fitScale(100, 100, 0), 1);
  /* the exports pass iOS Safari's canvas cap: 4096 x 4096 worth */
  assert.equal(fitScale(1024, 1024, 8, { maxPixels: 16_777_216 }), 4);
  assert.equal(fitScale(640, 640, 32, { maxPixels: 16_777_216 }), 6);
});

test("sprite sheet layout + JSON", () => {
  const layout = sheetLayout(5, 16, 16, { scale: 2 });
  assert.equal(layout.cols, 3);
  assert.equal(layout.rows, 2);
  assert.equal(layout.width, 96);
  assert.equal(layout.height, 64);
  assert.deepEqual(layout.rects[4], { x: 32, y: 32, w: 32, h: 32 });
  const json = sheetJson(layout, { image: "hero.png", fps: 10, frameW: 16, frameH: 16, scale: 2, name: "hero" });
  assert.equal(json.frames.length, 5);
  assert.deepEqual(json.frames[1], { filename: "hero_01", frame: { x: 32, y: 0, w: 32, h: 32 }, duration: 100 });
  assert.equal(json.meta.fps, 10);
  assert.deepEqual(json.meta.size, { w: 96, h: 64 });
  assert.equal(json.meta.frameCount, 5);
  assert.equal(sheetLayout(24, 8, 8, { cols: 8 }).rows, 3);
});

/* ---- save format --------------------------------------------- */

test("save format round-trips every pixel, layer and frame", () => {
  let doc = createDoc(24, 16, { layers: 2, frames: 3 });
  doc.layers[1].visible = false;
  doc.layers[0].name = "Ink";
  plot(doc.frames[0][0], 24, 16, rectPoints(2, 2, 10, 8, true), RED);
  plot(doc.frames[1][0], 24, 16, rectPoints(3, 2, 11, 8, true), RED);
  plot(doc.frames[2][1], 24, 16, linePoints(0, 0, 23, 15), hexToColor("#12345680"));
  doc = duplicateFrame(doc, 2);
  const enc = encodeDoc(doc);
  const json = JSON.parse(JSON.stringify(enc));
  const back = decodeDoc(json);
  assert.equal(back.w, 24);
  assert.deepEqual(back.layers, [{ name: "Ink", visible: true }, { name: "Layer 2", visible: false }]);
  assert.equal(back.frames.length, 4);
  back.frames.forEach((cels, f) => cels.forEach((cel, l) => assert.deepEqual(cel, doc.frames[f][l], `frame ${f} layer ${l}`)));
  /* empty cels are stored once */
  assert.ok(enc.cels.length < 8);
});

test("save format: many colours and bad input", () => {
  const doc = createDoc(16, 16);
  for (let i = 0; i < 256; i++) { doc.frames[0][0][i] = hexToColor(`#${(i * 997).toString(16).padStart(6, "0").slice(-6)}`); }
  const back = decodeDoc(JSON.parse(JSON.stringify(encodeDoc(doc))));
  assert.deepEqual(back.frames[0][0], doc.frames[0][0]);
  assert.throws(() => decodeDoc({ w: 4, h: 4 }));
  assert.throws(() => decodeDoc({ ...encodeDoc(createDoc(8, 8)), cels: ["rA*3."] }));
  assert.throws(() => decodeDoc({ ...encodeDoc(createDoc(8, 8)), colors: ["red"] }));
});

test("a full 128 x 128, 4 layers x 24 frames animation saves under 1 MB", () => {
  let doc = createDoc(128, 128, { layers: 4, frames: 1 });
  const pal = PRESETS.pico8.colors.map(hexToColor);
  /* a busy scene: a striped backdrop, a moving sprite, sparkles, an outline */
  for (let y = 0; y < 128; y++) { for (let x = 0; x < 128; x++) { doc.frames[0][0][y * 128 + x] = pal[((x >> 3) + (y >> 2)) % 6]; } }
  for (let f = 1; f < 24; f++) { doc = duplicateFrame(doc, f - 1); }
  for (let f = 0; f < 24; f++) {
    const [, sprite, fx, ink] = doc.frames[f];
    plot(sprite, 128, 128, rectPoints(10 + f * 4, 40, 40 + f * 4, 90, true), pal[8 + (f % 4)]);
    for (let k = 0; k < 60; k++) { setPixel(fx, 128, 128, (k * 37 + f * 11) % 128, (k * 53 + f * 7) % 128, pal[10]); }
    plot(ink, 128, 128, linePoints(0, f * 5, 127, 127 - f * 5), pal[0]);
  }
  const text = JSON.stringify(encodeDoc(doc));
  assert.ok(text.length < 1_000_000, `save is ${text.length} bytes`);
  const back = decodeDoc(JSON.parse(text));
  assert.deepEqual(back.frames[23][1], doc.frames[23][1]);
  assert.deepEqual(back.frames[17][0], doc.frames[17][0]);
});

/* ---- the GIF encoder (copied from gif-maker) ----------------- */

test("GIF: frames composite, scale up and encode with see-through", () => {
  const doc = createDoc(8, 8, { frames: 2 });
  setPixel(doc.frames[0][0], 8, 8, 0, 0, RED);
  setPixel(doc.frames[1][0], 8, 8, 7, 7, BLUE);
  const frames = [0, 1].map((f) => ({
    data: new Uint8ClampedArray(scaleUp(composite(doc, f), 8, 8, 2).buffer),
    delay: 125
  }));
  const bytes = encodeGif({ width: 16, height: 16, frames });
  const gif = readGif(bytes);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 6)), "GIF89a");
  assert.equal(gif.width, 16);
  assert.equal(gif.frames.length, 2);
  assert.equal(gif.frames[0].transparentIndex, 0);
  assert.equal(gif.frames[0].delay, 130);       // GIF delays are in 1/100 s
  const red = gif.palette.findIndex((c) => c[0] === 255 && c[1] === 0 && c[2] === 0);
  assert.deepEqual([...gif.frames[0].indexes.subarray(0, 3)], [red, red, 0]);
  assert.equal(gif.frames[0].indexes[16], red);   // the 2x block goes down a row too
});
