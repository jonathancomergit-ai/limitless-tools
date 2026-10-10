/* ============================================================
   Tilemap Painter - unit tests
   Flood fill, the tileset grid, the Tiled JSON shape (1-based
   gids, 0 = empty) and reading it back, CSV round-trip, undo /
   redo with its cap, layers, resize and the save format.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LAYERS, createMap, cloneMap, resizeMap, addLayer, deleteLayer, moveLayer, floodFill, plot,
  rectPoints, linePoints, eyedropper, tilesetGrid, tileRect, maxMapSize, createHistory,
  toTmj, fromTmj, layerCsv, parseCsv, encodeLayer, decodeLayer, encodeMap, decodeMap, baseName, fileOnly
} from "../../items/tilemap-painter/tilemap.js";
import { starterMap, SAMPLE, SAMPLE_TILES } from "../../items/tilemap-painter/sample.js";

/* A map from rows of digits ("." = 0). */
function fromRows(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const m = createMap(w, h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { m.layers[0].data[y * w + x] = ch === "." ? 0 : Number(ch); }));
  return m;
}
function rowsOf(data, w) {
  const out = [];
  for (let i = 0; i < data.length; i += w) { out.push([...data.subarray(i, i + w)].map((v) => (v ? String(v) : ".")).join("")); }
  return out;
}

const TILESET = { image: "tiles.png", imageW: 128, imageH: 64, tileW: 16, tileH: 16, spacing: 0, margin: 0 };

/* ---- flood fill ------------------------------------------- */

test("flood fill: fills the touching region only, 4-way", () => {
  const m = fromRows([
    "..1..",
    "..1..",
    "111.1",
    "....1"
  ]);
  const n = floodFill(m.layers[0].data, 5, 4, 0, 0, 7);
  assert.equal(n, 4);
  assert.deepEqual(rowsOf(m.layers[0].data, 5), [
    "771..",
    "771..",
    "111.1",
    "....1"
  ]);
});

test("flood fill: diagonal gaps don't leak, the same tile is a no-op, outside is a no-op", () => {
  const m = fromRows([
    ".1.",
    "1.1",
    ".1."
  ]);
  const d = m.layers[0].data;
  assert.equal(floodFill(d, 3, 3, 1, 1, 5), 1);
  assert.equal(d[4], 5);
  assert.equal(d[0], 0);
  assert.equal(floodFill(d, 3, 3, 1, 1, 5), 0);
  assert.equal(floodFill(d, 3, 3, -1, 0, 5), 0);
  assert.equal(floodFill(d, 3, 3, 3, 0, 5), 0);
});

test("flood fill: replaces a tile region with empty (erase fill)", () => {
  const m = fromRows(["22.", "2.3", "222"]);
  assert.equal(floodFill(m.layers[0].data, 3, 3, 0, 0, 0), 6);
  assert.deepEqual(rowsOf(m.layers[0].data, 3), ["...", "..3", "..."]);
});

test("flood fill: a big open map doesn't blow the stack", () => {
  const m = createMap(256, 256);
  assert.equal(floodFill(m.layers[0].data, 256, 256, 128, 128, 3), 256 * 256);
});

/* ---- tools ------------------------------------------------ */

test("box and line points, plot skips the outside", () => {
  assert.equal(rectPoints(3, 2, 1, 0).length, 9);
  assert.deepEqual(linePoints(0, 0, 3, 0), [[0, 0], [1, 0], [2, 0], [3, 0]]);
  const m = createMap(4, 4);
  assert.equal(plot(m.layers[0].data, 4, 4, rectPoints(-1, -1, 1, 1), 2), 4);
  assert.equal(plot(m.layers[0].data, 4, 4, rectPoints(0, 0, 1, 1), 2), 0);
});

test("eyedropper: the top-most visible tile", () => {
  const m = addLayer(createMap(2, 1));
  m.layers[0].data[0] = 3;
  m.layers[1].data[0] = 9;
  assert.equal(eyedropper(m, 0, 0), 9);
  m.layers[1].visible = false;
  assert.equal(eyedropper(m, 0, 0), 3);
  assert.equal(eyedropper(m, 1, 0), 0);
  assert.equal(eyedropper(m, 5, 0), 0);
});

/* ---- tileset grid ----------------------------------------- */

test("tileset grid: spacing and margin, left-over pixels", () => {
  const g = tilesetGrid(2 * 2 + 4 * 16 + 3 * 1, 2 * 2 + 2 * 16 + 1, { tileW: 16, tileH: 16, spacing: 1, margin: 2 });
  assert.equal(g.columns, 4);
  assert.equal(g.rows, 2);
  assert.equal(g.count, 8);
  assert.equal(g.leftX, 0);
  assert.equal(g.leftY, 0);
  assert.deepEqual(tileRect(5, 4, { tileW: 16, tileH: 16, spacing: 1, margin: 2 }), { x: 2 + 17, y: 2 + 17, w: 16, h: 16 });
  const odd = tilesetGrid(70, 40, { tileW: 16, tileH: 16 });
  assert.equal(odd.columns, 4);
  assert.equal(odd.leftX, 6);
  assert.equal(odd.leftY, 8);
  assert.match(tilesetGrid(10, 10, { tileW: 16, tileH: 16 }).error, /smaller than one/);
});

test("the map picture stays within 4096 px a side", () => {
  assert.deepEqual(maxMapSize(16, 16), { w: 256, h: 256 });
  assert.deepEqual(maxMapSize(32, 64), { w: 128, h: 64 });
});

test("the sample: 8 x 4 tiles of 16 px, each one named, and a starter level", () => {
  const g = tilesetGrid(SAMPLE.imageW, SAMPLE.imageH, SAMPLE);
  assert.equal(g.count, 32);
  assert.equal(SAMPLE_TILES.length, 32);
  const m = starterMap();
  assert.equal(m.layers.length, 3);
  for (const l of m.layers) { assert.ok(l.data.some((v) => v > 0)); assert.ok(Math.max(...l.data) <= 32); }
});

/* ---- Tiled JSON ------------------------------------------- */

test("tmj: an orthogonal map with an embedded tileset and 1-based gids (0 = empty)", () => {
  const m = createMap(3, 2, { layers: 2, names: ["Ground", "Things"] });
  m.layers[0].data.set([1, 1, 2, 0, 0, 32]);
  m.layers[1].visible = false;
  const j = toTmj(m, TILESET);
  assert.equal(j.type, "map");
  assert.equal(j.orientation, "orthogonal");
  assert.equal(j.renderorder, "right-down");
  assert.equal(j.infinite, false);
  assert.equal(j.width, 3);
  assert.equal(j.height, 2);
  assert.equal(j.tilewidth, 16);
  assert.equal(j.tileheight, 16);
  assert.equal(j.nextlayerid, 3);
  assert.equal(typeof j.version, "string");
  assert.equal(j.tilesets.length, 1);
  assert.deepEqual(j.tilesets[0], {
    columns: 8, firstgid: 1, image: "tiles.png", imageheight: 64, imagewidth: 128, margin: 0,
    name: "tiles", spacing: 0, tilecount: 32, tileheight: 16, tilewidth: 16
  });
  assert.equal(j.layers.length, 2);
  assert.deepEqual(j.layers[0], {
    data: [1, 1, 2, 0, 0, 32], height: 2, id: 1, name: "Ground", opacity: 1,
    type: "tilelayer", visible: true, width: 3, x: 0, y: 0
  });
  assert.equal(j.layers[1].visible, false);
  assert.ok(j.layers[1].data.every((v) => v === 0));
  assert.ok(Array.isArray(j.layers[0].data), "plain array, not a typed array");
  /* real JSON, so it survives a save + load */
  assert.deepEqual(JSON.parse(JSON.stringify(j)), j);
});

test("tmj: tiles the tileset doesn't have are written as empty", () => {
  const m = createMap(3, 1);
  m.layers[0].data.set([8, 9, 40]);
  assert.deepEqual(toTmj(m, { ...TILESET, imageW: 64, imageH: 32 }).layers[0].data, [8, 0, 0]);
});

test("tmj: the tileset image is a bare file name", () => {
  assert.equal(toTmj(createMap(1, 1), { ...TILESET, image: "C:\\art\\forest.png" }).tilesets[0].image, "forest.png");
  assert.equal(fileOnly("../a/b/c.png"), "c.png");
});

test("tmj: what this tool writes, it reads back the same", () => {
  const m = starterMap();
  m.layers[1].visible = false;
  const back = fromTmj(JSON.parse(JSON.stringify(toTmj(m, { ...TILESET, spacing: 1, margin: 2, imageW: 4 + 8 * 16 + 7, imageH: 4 + 4 * 16 + 3 }))));
  assert.deepEqual(back.notes, []);
  assert.equal(back.map.w, m.w);
  assert.equal(back.map.h, m.h);
  assert.deepEqual(back.map.layers.map((l) => l.name), ["Sky", "Ground", "Decor"]);
  assert.deepEqual(back.map.layers.map((l) => l.visible), [true, false, true]);
  m.layers.forEach((l, i) => assert.deepEqual([...back.map.layers[i].data], [...l.data]));
  assert.deepEqual(back.tileset, { image: "tiles.png", imageW: 139, imageH: 71, tileW: 16, tileH: 16, spacing: 1, margin: 2 });
});

test("tmj import: firstgid, flip flags, base64 and other tilesets", () => {
  const base = toTmj(createMap(2, 2), TILESET);
  base.tilesets[0].firstgid = 5;
  base.tilesets.push({ firstgid: 37, image: "other.png", tilewidth: 16, tileheight: 16, tilecount: 4 });
  base.layers[0].data = [5, 0x80000006, 40, 0];
  const r = fromTmj(base);
  assert.deepEqual([...r.map.layers[0].data], [1, 2, 0, 0]);
  assert.equal(r.notes.length, 3);

  const b64 = toTmj(createMap(2, 1), TILESET);
  const bytes = new Uint8Array(new Uint32Array([3, 0]).buffer);
  b64.layers[0].encoding = "base64";
  b64.layers[0].data = btoa(String.fromCharCode(...bytes));
  assert.deepEqual([...fromTmj(b64).map.layers[0].data], [3, 0]);
});

test("tmj import: says why it can't", () => {
  const ok = () => toTmj(createMap(2, 2), TILESET);
  const bad = (patch, re) => assert.throws(() => fromTmj(patch(ok())), re);
  bad((j) => { j.orientation = "isometric"; return j; }, /orthogonal/);
  bad((j) => { j.infinite = true; return j; }, /Infinite/);
  bad((j) => { j.tilesets = [{ firstgid: 1, source: "tiles.tsx" }]; return j; }, /Embed/);
  bad((j) => { j.layers[0].compression = "zlib"; return j; }, /Compressed/);
  bad((j) => { j.layers[0].data = [1]; return j; }, /cells/);
  bad((j) => { j.layers = [{ type: "objectgroup" }]; return j; }, /no tile layers/);
  bad(() => [], /isn't a Tiled map/);
  bad((j) => { j.width = 9999; return j; }, /256/);
});

/* ---- CSV -------------------------------------------------- */

test("csv: tile numbers from 0, -1 = empty, one row per map row", () => {
  const m = fromRows(["1.3", ".2."]);
  assert.equal(layerCsv(m.layers[0].data, 3, 2), "0,-1,2\n-1,1,-1\n");
});

test("csv: round-trip", () => {
  const m = starterMap();
  for (const l of m.layers) {
    const text = layerCsv(l.data, m.w, m.h);
    const back = parseCsv(text);
    assert.equal(back.w, m.w);
    assert.equal(back.h, m.h);
    assert.deepEqual([...back.data], [...l.data]);
    assert.equal(layerCsv(back.data, back.w, back.h), text);
  }
  assert.throws(() => parseCsv("1,2\n3"), /same number/);
  assert.throws(() => parseCsv("1,x"), /isn't a tile number/);
  assert.throws(() => parseCsv(""), /empty/);
});

/* ---- history ---------------------------------------------- */

test("history: undo / redo a stroke and a layer change", () => {
  let m = createMap(3, 1);
  const h = createHistory();
  const before = m.layers[0].data.slice();
  plot(m.layers[0].data, 3, 1, [[0, 0], [1, 0]], 4);
  assert.equal(h.cells(0, before, m.layers[0].data), true);
  assert.equal(h.cells(0, m.layers[0].data, m.layers[0].data), false, "no change, no step");

  const next = addLayer(m);
  h.snapshot(m, next);
  m = next;
  assert.equal(m.layers.length, 2);

  m = h.undo(m).map;
  assert.equal(m.layers.length, 1);
  m = h.undo(m).map;
  assert.deepEqual([...m.layers[0].data], [0, 0, 0]);
  assert.equal(h.canUndo, false);
  m = h.redo(m).map;
  assert.deepEqual([...m.layers[0].data], [4, 4, 0]);
  m = h.redo(m).map;
  assert.equal(m.layers.length, 2);
  assert.equal(h.canRedo, false);
});

test("history: capped, oldest steps fall off; a new step clears redo", () => {
  const m = createMap(1, 1);
  const h = createHistory({ limit: 5 });
  for (let i = 1; i <= 9; i++) {
    const before = m.layers[0].data.slice();
    m.layers[0].data[0] = i;
    h.cells(0, before, m.layers[0].data);
  }
  assert.equal(h.size, 5);
  let mm = m;
  for (let i = 0; i < 5; i++) { mm = h.undo(mm).map; }
  assert.equal(mm.layers[0].data[0], 4);
  assert.equal(h.undo(mm).step, null);
  h.redo(mm);
  const before = mm.layers[0].data.slice();
  mm.layers[0].data[0] = 20;
  h.cells(0, before, mm.layers[0].data);
  assert.equal(h.canRedo, false);
});

/* ---- layers + resize -------------------------------------- */

test("layers: add (capped), delete (never the last), move", () => {
  let m = createMap(2, 2);
  for (let i = 0; i < 20; i++) { m = addLayer(m); }
  assert.equal(m.layers.length, MAX_LAYERS);
  assert.equal(new Set(m.layers.map((l) => l.name)).size, MAX_LAYERS);
  const one = createMap(1, 1);
  assert.equal(deleteLayer(one, 0), one);
  const two = addLayer(one);
  two.layers[1].data[0] = 5;
  const moved = moveLayer(two, 1, -1);
  assert.equal(moved.layers[0].data[0], 5);
  assert.equal(two.layers[1].data[0], 5, "the old map is left alone");
  assert.equal(moveLayer(two, 1, 1), two);
});

test("resize keeps the top-left; smaller crops", () => {
  const m = fromRows(["12", "34"]);
  const big = resizeMap(m, 3, 3);
  assert.deepEqual(rowsOf(big.layers[0].data, 3), ["12.", "34.", "..."]);
  const small = resizeMap(big, 1, 2);
  assert.deepEqual(rowsOf(small.layers[0].data, 1), ["1", "3"]);
  assert.equal(resizeMap(m, 2, 2), m);
  const c = cloneMap(m);
  c.layers[0].data[0] = 9;
  assert.equal(m.layers[0].data[0], 1);
});

/* ---- save format ------------------------------------------ */

test("save: run-length layers round-trip, and bad ones are refused", () => {
  const d = Uint16Array.from([0, 0, 0, 5, 5, 7, 0, 0]);
  assert.equal(encodeLayer(d), "0*3,5*2,7,0*2");
  assert.deepEqual([...decodeLayer("0*3,5*2,7,0*2", 8)], [...d]);
  assert.throws(() => decodeLayer("0*3", 8), /wrong size/);
  assert.throws(() => decodeLayer("0*9", 8), /doesn't fit/);
  assert.throws(() => decodeLayer("a", 1), /broken/);

  const m = starterMap();
  const back = decodeMap(JSON.parse(JSON.stringify(encodeMap(m))));
  assert.equal(back.layers.length, 3);
  m.layers.forEach((l, i) => assert.deepEqual([...back.layers[i].data], [...l.data]));
  assert.ok(JSON.stringify(encodeMap(m)).length < 1500, "a level is small");
  assert.throws(() => decodeMap({ w: 0, h: 1, layers: [] }), /size/);
  assert.throws(() => decodeMap({ w: 1, h: 1, layers: [] }), /layers/);
});

test("file names", () => {
  assert.equal(baseName("My Level 2.png"), "my-level-2");
  assert.equal(baseName("", "x"), "x");
});
