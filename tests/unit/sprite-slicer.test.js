/* ============================================================
   Sprite Sheet Slicer - unit tests
   Grid maths (margin + spacing), auto-detect on a made-up
   image, animation order, frame maps and the copied zip writer.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS, normalizeSettings, gridFrames, autoDetect, isEmptyRect, emptyTest,
  playOrder, frameAt, moveItem, baseName, frameName, phaserMap, godotMap, sizeProblem, MAX_FRAMES
} from "../../items/sprite-slicer/slice.js";
import { makeZip, crc32, SIG_END } from "../../items/sprite-slicer/zip.js";

/* ---- a tiny RGBA image builder ---- */
function image(w, h, bg = [0, 0, 0, 0]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d.set(bg, i * 4); }
  return {
    w, h, d,
    fill(x, y, fw, fh, rgba = [255, 0, 0, 255]) {
      for (let yy = y; yy < y + fh; yy++) {
        for (let xx = x; xx < x + fw; xx++) { d.set(rgba, (yy * w + xx) * 4); }
      }
      return this;
    }
  };
}

/* ---- grid ---------------------------------------------------- */

test("grid by cell size: no margin, no spacing", () => {
  const g = gridFrames(128, 64, { mode: "size", cellW: 32, cellH: 32 });
  assert.equal(g.error, "");
  assert.equal(g.cols, 4);
  assert.equal(g.rows, 2);
  assert.equal(g.frames.length, 8);
  assert.deepEqual(g.frames[5], { x: 32, y: 32, w: 32, h: 32, col: 1, row: 1 });
  assert.equal(g.leftX, 0);
  assert.equal(g.leftY, 0);
});

test("grid by cell size with margin and spacing", () => {
  /* 2 | 16 | 1 | 16 | 1 | 16 | 2  = 54 wide;  2 | 16 | 1 | 16 | 2 = 37 high */
  const g = gridFrames(54, 37, { mode: "size", cellW: 16, cellH: 16, margin: 2, spacing: 1 });
  assert.equal(g.cols, 3);
  assert.equal(g.rows, 2);
  assert.deepEqual(g.frames.map((f) => [f.x, f.y]), [[2, 2], [19, 2], [36, 2], [2, 19], [19, 19], [36, 19]]);
  assert.equal(g.leftX, 0);
  assert.equal(g.leftY, 0);
});

test("grid by cell size reports pixels left over", () => {
  const g = gridFrames(70, 32, { mode: "size", cellW: 32, cellH: 32 });
  assert.equal(g.cols, 2);
  assert.equal(g.leftX, 6);
  assert.equal(g.leftY, 0);
});

test("grid by rows x columns works out the cell size", () => {
  const g = gridFrames(54, 37, { mode: "count", cols: 3, rows: 2, margin: 2, spacing: 1 });
  assert.equal(g.cellW, 16);
  assert.equal(g.cellH, 16);
  assert.equal(g.frames.length, 6);
  assert.deepEqual(g.frames[4], { x: 19, y: 19, w: 16, h: 16, col: 1, row: 1 });

  const odd = gridFrames(100, 10, { mode: "count", cols: 3, rows: 1 });
  assert.equal(odd.cellW, 33);
  assert.equal(odd.leftX, 1);
});

test("grid errors are friendly, not crashes", () => {
  assert.match(gridFrames(20, 20, { mode: "size", cellW: 64, cellH: 64 }).error, /bigger than the picture/);
  assert.match(gridFrames(10, 10, { mode: "count", cols: 50, rows: 1 }).error, /Too many/);
  assert.match(gridFrames(10, 10, { mode: "size", margin: 6 }).error, /margin/);
  assert.match(gridFrames(4096, 4096, { mode: "size", cellW: 1, cellH: 1 }).error, new RegExp(String(MAX_FRAMES)));
  assert.equal(gridFrames(20, 20, { mode: "size", cellW: 64, cellH: 64 }).frames.length, 0);
});

/* ---- empty cells + auto-detect ------------------------------ */

test("isEmptyRect sees see-through cells", () => {
  const img = image(8, 4).fill(5, 1, 2, 2);
  assert.equal(isEmptyRect(img.d, img.w, { x: 0, y: 0, w: 4, h: 4 }), true);
  assert.equal(isEmptyRect(img.d, img.w, { x: 4, y: 0, w: 4, h: 4 }), false);
});

test("a flat background colour counts as empty (magic pink)", () => {
  const img = image(8, 4, [255, 0, 255, 255]).fill(5, 1, 2, 2, [0, 0, 0, 255]);
  const empty = emptyTest(img.d);
  assert.equal(isEmptyRect(img.d, img.w, { x: 0, y: 0, w: 4, h: 4 }, empty), true);
  assert.equal(isEmptyRect(img.d, img.w, { x: 4, y: 0, w: 4, h: 4 }, empty), false);
});

test("autoDetect finds sprites by their gaps, in reading order, trimmed", () => {
  /* 20 x 12. Top band: two sprites of different heights.
     Bottom band: one wide sprite. */
  const img = image(20, 12)
    .fill(1, 1, 3, 4)       // A: x 1-3, y 1-4
    .fill(7, 2, 5, 2)       // B: x 7-11, y 2-3
    .fill(2, 8, 15, 3);     // C: x 2-16, y 8-10
  const frames = autoDetect(img.d, img.w, img.h);
  assert.deepEqual(frames, [
    { x: 1, y: 1, w: 3, h: 4 },
    { x: 7, y: 2, w: 5, h: 2 },
    { x: 2, y: 8, w: 15, h: 3 }
  ]);
});

test("autoDetect keeps a sprite with a hole in it in one piece", () => {
  const img = image(10, 6).fill(1, 1, 5, 4);
  img.fill(3, 2, 1, 2, [0, 0, 0, 0]);        // a see-through hole in the middle
  assert.deepEqual(autoDetect(img.d, img.w, img.h), [{ x: 1, y: 1, w: 5, h: 4 }]);
});

test("autoDetect on a magic-pink sheet, and on an empty one", () => {
  const pink = image(12, 5, [255, 0, 255, 255]).fill(1, 1, 3, 3, [9, 9, 9, 255]).fill(7, 1, 4, 2, [9, 9, 9, 255]);
  assert.deepEqual(autoDetect(pink.d, pink.w, pink.h), [{ x: 1, y: 1, w: 3, h: 3 }, { x: 7, y: 1, w: 4, h: 2 }]);
  const blank = image(6, 6);
  assert.deepEqual(autoDetect(blank.d, blank.w, blank.h), []);
});

/* ---- animation ---------------------------------------------- */

test("playOrder: forwards, and ping-pong without doubled ends", () => {
  assert.deepEqual(playOrder(4), [0, 1, 2, 3]);
  assert.deepEqual(playOrder(4, true), [0, 1, 2, 3, 2, 1]);
  assert.deepEqual(playOrder(2, true), [0, 1]);
  assert.deepEqual(playOrder(0, true), []);
});

test("frameAt steps at the frame rate and loops", () => {
  const order = playOrder(3);
  assert.equal(frameAt(order, 0, 10), 0);
  assert.equal(frameAt(order, 0.15, 10), 1);
  assert.equal(frameAt(order, 0.35, 10), 0);
  assert.equal(frameAt([], 1, 10), -1);
});

test("moveItem moves one item and leaves the input alone", () => {
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(list, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(list, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(list, 1, 99), ["a", "c", "d", "b"]);
  assert.deepEqual(list, ["a", "b", "c", "d"]);
});

/* ---- names + maps ------------------------------------------- */

test("names are safe and padded", () => {
  assert.equal(baseName("My Hero (run).png"), "my-hero-run");
  assert.equal(baseName("../../etc.png"), "etc");
  assert.equal(baseName(""), "sprite");
  assert.equal(frameName("hero", 3, 12), "hero_03.png");
  assert.equal(frameName("hero", 7, 150), "hero_007.png");
});

test("phaserMap is a Phaser 3 JSON Hash atlas", () => {
  const frames = [{ x: 0, y: 0, w: 16, h: 16 }, { x: 16, y: 0, w: 16, h: 16 }];
  const map = phaserMap(frames, { image: "hero.png", width: 32, height: 16, prefix: "hero" });
  assert.deepEqual(Object.keys(map.frames), ["hero_00.png", "hero_01.png"]);
  assert.deepEqual(map.frames["hero_01.png"].frame, { x: 16, y: 0, w: 16, h: 16 });
  assert.equal(map.frames["hero_01.png"].rotated, false);
  assert.deepEqual(map.meta.size, { w: 32, h: 16 });
  assert.equal(map.meta.image, "hero.png");
});

test("godotMap lists Rect2-style regions and the speed", () => {
  const map = godotMap([{ x: 4, y: 5, w: 6, h: 7 }], { image: "a.png", width: 20, height: 20, prefix: "a", fps: 12, pingpong: true });
  assert.deepEqual(map.frames, [{ name: "a_00", region: [4, 5, 6, 7] }]);
  assert.deepEqual(map.animation, { name: "a", speed: 12, loop: true, pingpong: true });
});

/* ---- settings ----------------------------------------------- */

test("normalizeSettings clamps odd values and keeps good ones", () => {
  assert.deepEqual(normalizeSettings({}), { ...DEFAULTS });
  const n = normalizeSettings({ mode: "nope", cellW: -5, cols: 9999, fps: "12", spacing: 2.6, skipEmpty: "yes", zoom: 99 });
  assert.equal(n.mode, "size");
  assert.equal(n.cellW, 1);
  assert.equal(n.cols, 256);
  assert.equal(n.fps, 12);
  assert.equal(n.spacing, 3);
  assert.equal(n.skipEmpty, true);
  assert.equal(n.zoom, 16);
  assert.deepEqual(normalizeSettings(null), { ...DEFAULTS });
});

test("sizeProblem guards huge sheets", () => {
  assert.equal(sizeProblem(512, 512), "");
  assert.match(sizeProblem(9000, 10), /8192/);
  assert.match(sizeProblem(5000, 5000), /Too big/);
  assert.match(sizeProblem(0, 10), /no size/);
});

/* ---- the copied zip writer ---------------------------------- */

test("the copied zip writer still makes a valid zip", () => {
  const zip = makeZip([{ name: "frames/a_00.png", data: new Uint8Array([1, 2, 3]) }]);
  assert.equal(String.fromCharCode(zip[0], zip[1]), "PK");
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(zip.length - 22, true), SIG_END);
  assert.equal(v.getUint16(zip.length - 22 + 10, true), 1);
  assert.equal(v.getUint32(14, true), crc32(new Uint8Array([1, 2, 3])));
});
