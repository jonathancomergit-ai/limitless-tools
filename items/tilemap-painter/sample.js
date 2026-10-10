/* ============================================================
   Tilemap Painter - the sample tileset and starter level

   Drawn in code (no picture file to fetch), so the tool works
   the moment it opens. 32 tiles of 16 x 16 px in an 8 x 4 grid,
   no spacing, PICO-8 colours. Tiles on rows 2-4 have see-through
   backgrounds, so they sit on top of a ground layer.
   ============================================================ */

import { createMap } from "./tilemap.js";

export const SAMPLE_NAME = "sample-tiles.png";
export const SAMPLE = Object.freeze({ tileW: 16, tileH: 16, spacing: 0, margin: 0, imageW: 128, imageH: 64 });

/* What each tile is (0-based), for labels and screen readers. */
export const SAMPLE_TILES = [
  "grass", "dirt", "stone", "brick", "water", "sand", "planks", "dark stone",
  "sky", "cloud", "bush", "trunk", "tree top", "flower", "grass tuft", "rock",
  "coin", "chest", "door", "ladder", "spikes", "torch", "sign", "key",
  "heart", "star", "lava", "ice", "snow", "window", "fence", "mushroom"
];

const C = {
  k: "#000000", n: "#1d2b53", p: "#7e2553", g: "#008751", b: "#ab5236", d: "#5f574f",
  l: "#c2c3c7", w: "#fff1e8", r: "#ff004d", o: "#ffa300", y: "#ffec27", G: "#00e436",
  B: "#29adff", v: "#83769c", P: "#ff77a8", s: "#ffccaa"
};

/* Draws the 128 x 64 sheet into a 2D context. */
export function drawSample(g) {
  let ox = 0;
  let oy = 0;
  const r = (x, y, w, h, c) => { g.fillStyle = C[c] || c; g.fillRect(ox + x, oy + y, w, h); };
  const at = (i) => { ox = (i % 8) * 16; oy = Math.floor(i / 8) * 16; };
  g.clearRect(0, 0, 128, 64);

  /* ---- row 1: ground ---- */
  at(0); r(0, 0, 16, 16, "b"); r(0, 0, 16, 5, "G"); r(0, 5, 16, 2, "g");
  r(2, 7, 2, 2, "g"); r(9, 7, 2, 1, "g"); r(13, 7, 1, 2, "g"); r(4, 11, 2, 1, "p"); r(11, 13, 2, 1, "p");
  at(1); r(0, 0, 16, 16, "b"); r(3, 3, 2, 1, "p"); r(10, 5, 2, 1, "p"); r(6, 10, 2, 1, "p"); r(12, 12, 2, 1, "p"); r(1, 13, 1, 1, "s");
  at(2); r(0, 0, 16, 16, "d"); r(0, 0, 16, 1, "l"); r(0, 0, 1, 16, "l"); r(1, 1, 6, 6, "l"); r(2, 2, 5, 5, "d");
  r(8, 8, 7, 7, "l"); r(9, 9, 6, 6, "d"); r(15, 0, 1, 16, "k"); r(0, 15, 16, 1, "k");
  at(3); r(0, 0, 16, 16, "b");
  for (const [y, off] of [[0, 0], [4, 4], [8, 0], [12, 4]]) {
    r(0, y + 3, 16, 1, "p");
    for (let x = off; x < 16; x += 8) { r(x, y, 1, 3, "p"); }
    r(off + 1, y, 6, 1, "o");
  }
  at(4); r(0, 0, 16, 16, "n"); r(0, 0, 16, 3, "B"); r(2, 6, 4, 1, "B"); r(9, 9, 5, 1, "B"); r(3, 13, 3, 1, "B"); r(0, 0, 3, 1, "w"); r(8, 1, 3, 1, "w");
  at(5); r(0, 0, 16, 16, "s"); r(0, 0, 16, 2, "y"); r(3, 5, 1, 1, "o"); r(10, 8, 1, 1, "o"); r(6, 12, 1, 1, "o"); r(13, 3, 1, 1, "o");
  at(6); r(0, 0, 16, 16, "b"); r(0, 0, 16, 1, "o"); r(0, 7, 16, 1, "p"); r(0, 15, 16, 1, "p"); r(0, 8, 16, 1, "o");
  r(5, 0, 1, 7, "p"); r(11, 8, 1, 7, "p"); r(2, 3, 1, 1, "k"); r(13, 3, 1, 1, "k"); r(2, 11, 1, 1, "k"); r(13, 11, 1, 1, "k");
  at(7); r(0, 0, 16, 16, "n"); r(1, 1, 6, 5, "d"); r(9, 3, 6, 6, "d"); r(2, 9, 5, 6, "d"); r(1, 1, 6, 1, "v"); r(9, 3, 6, 1, "v"); r(2, 9, 5, 1, "v");

  /* ---- row 2: sky + plants (bush, tree, flowers sit on top) ---- */
  at(8); r(0, 0, 16, 16, "B");
  at(9); r(0, 0, 16, 16, "B"); r(2, 7, 12, 5, "w"); r(4, 5, 5, 2, "w"); r(8, 4, 4, 3, "w"); r(2, 11, 12, 1, "l");
  at(10); r(2, 6, 12, 10, "g"); r(4, 4, 8, 2, "g"); r(4, 6, 3, 2, "G"); r(9, 8, 2, 2, "G"); r(5, 11, 2, 2, "G"); r(1, 15, 14, 1, "n");
  at(11); r(5, 0, 6, 16, "b"); r(6, 0, 1, 16, "o"); r(9, 3, 1, 4, "p"); r(8, 10, 1, 4, "p"); r(3, 14, 10, 2, "b");
  at(12); r(1, 3, 14, 13, "g"); r(3, 1, 10, 2, "g"); r(0, 6, 16, 7, "g"); r(3, 3, 4, 3, "G"); r(9, 6, 3, 2, "G"); r(5, 10, 2, 2, "G"); r(12, 11, 2, 2, "G"); r(6, 14, 4, 2, "b");
  at(13); r(7, 8, 2, 8, "g"); r(9, 11, 3, 1, "G"); r(6, 3, 4, 4, "P"); r(5, 4, 6, 2, "P"); r(7, 4, 2, 2, "y");
  at(14); r(2, 11, 1, 5, "G"); r(4, 9, 1, 7, "g"); r(7, 12, 1, 4, "G"); r(10, 10, 1, 6, "g"); r(13, 12, 1, 4, "G");
  at(15); r(3, 8, 10, 8, "d"); r(5, 6, 6, 2, "d"); r(5, 7, 3, 3, "l"); r(9, 11, 3, 1, "n"); r(2, 15, 12, 1, "n");

  /* ---- row 3: things to find ---- */
  at(16); r(5, 3, 6, 10, "o"); r(4, 4, 8, 8, "o"); r(6, 4, 4, 8, "y"); r(7, 5, 1, 6, "w");
  at(17); r(1, 5, 14, 10, "b"); r(1, 5, 14, 2, "o"); r(1, 9, 14, 1, "p"); r(7, 8, 2, 3, "y"); r(1, 14, 14, 1, "p");
  at(18); r(3, 1, 10, 15, "p"); r(4, 2, 8, 14, "b"); r(4, 2, 8, 1, "o"); r(10, 8, 1, 2, "y"); r(7, 2, 1, 14, "p");
  at(19); r(3, 0, 2, 16, "b"); r(11, 0, 2, 16, "b"); for (let y = 2; y < 16; y += 4) { r(5, y, 6, 2, "o"); }
  at(20); for (let x = 0; x < 16; x += 4) { r(x + 1, 6, 2, 10, "l"); r(x + 1, 4, 2, 2, "w"); r(x, 12, 4, 4, "d"); }
  at(21); r(7, 7, 2, 9, "b"); r(6, 3, 4, 4, "o"); r(7, 1, 2, 3, "y"); r(7, 5, 2, 2, "y");
  at(22); r(7, 9, 2, 7, "b"); r(1, 2, 14, 8, "b"); r(2, 3, 12, 6, "o"); r(4, 5, 8, 1, "p"); r(4, 7, 5, 1, "p");
  at(23); r(2, 4, 6, 6, "y"); r(4, 6, 2, 2, "k"); r(8, 6, 7, 2, "y"); r(12, 8, 2, 3, "y"); r(10, 8, 1, 2, "y");

  /* ---- row 4: more ---- */
  at(24); r(2, 4, 5, 6, "r"); r(9, 4, 5, 6, "r"); r(1, 5, 14, 4, "r"); r(3, 9, 10, 2, "r"); r(5, 11, 6, 2, "r"); r(7, 13, 2, 1, "r"); r(3, 5, 2, 2, "w");
  at(25); r(7, 1, 2, 4, "y"); r(5, 5, 6, 6, "y"); r(1, 6, 14, 3, "y"); r(4, 11, 3, 3, "y"); r(9, 11, 3, 3, "y"); r(3, 13, 2, 2, "o"); r(11, 13, 2, 2, "o");
  at(26); r(0, 0, 16, 16, "r"); r(0, 0, 16, 3, "o"); r(2, 6, 5, 2, "o"); r(9, 10, 5, 2, "o"); r(4, 13, 3, 1, "y"); r(11, 4, 2, 1, "y");
  at(27); r(0, 0, 16, 16, "B"); r(0, 0, 16, 2, "w"); r(2, 4, 1, 8, "w"); r(3, 3, 1, 3, "w"); r(10, 7, 1, 6, "l"); r(0, 15, 16, 1, "n");
  at(28); r(0, 0, 16, 16, "b"); r(0, 0, 16, 6, "w"); r(0, 6, 3, 2, "w"); r(6, 6, 4, 2, "w"); r(12, 6, 2, 3, "w"); r(0, 5, 16, 1, "l"); r(4, 11, 2, 1, "p");
  at(29); r(0, 0, 16, 16, "d"); r(2, 2, 12, 12, "n"); r(3, 3, 4, 4, "y"); r(9, 3, 4, 4, "y"); r(3, 9, 4, 4, "o"); r(9, 9, 4, 4, "o");
  at(30); r(2, 3, 3, 13, "s"); r(11, 3, 3, 13, "s"); r(0, 6, 16, 2, "o"); r(0, 11, 16, 2, "o"); r(2, 3, 3, 1, "w"); r(11, 3, 3, 1, "w");
  at(31); r(2, 3, 12, 6, "r"); r(4, 2, 8, 1, "r"); r(4, 4, 2, 2, "w"); r(9, 5, 3, 2, "w"); r(6, 9, 4, 7, "s"); r(6, 15, 4, 1, "o");
}

/* A canvas holding the sample sheet. */
export function sampleCanvas() {
  const c = document.createElement("canvas");
  c.width = SAMPLE.imageW;
  c.height = SAMPLE.imageH;
  drawSample(c.getContext("2d"));
  return c;
}

/* ---- the starter level: 20 x 12 tiles, three layers ----
   Letters are tiles (see SAMPLE_TILES); "." is empty. */
const KEY = {
  G: 0, D: 1, S: 2, B: 3, W: 4, A: 5, P: 6, C: 7,
  "~": 8, c: 9, U: 10, T: 11, L: 12, F: 13, t: 14, r: 15,
  o: 16, h: 17, d: 18, l: 19, s: 22, k: 23, m: 31, f: 30
};
const SKY = [
  "~~~~~~~~~~~~~~~~~~~~", "~~~cc~~~~~~~~~~~~~~~", "~~~~~~~~~~~c~~~~~~~~", "~~~~~~~~~~~~~~~~~~~~",
  "~~~~~~~~~~~~~~~~~~~~", "~~~~~~~~~~~~~~~~~~~~", "~~~~~~~~~~~~~~~~~~~~", "~~~~~~~~~~~~~~~~~~~~",
  "....................", "....................", "....................", "...................."
];
const GROUND = [
  "....................", "....................", "....................", "....................",
  "..............BBBB..", "....................", "......PPPP..........", "....................",
  "GGGGGAWWWWWWWAGGGGGG", "DDDDDDAWWWWWADDDDDDD", "DDSDDDDAAAAADDDSDDDD", "CCCCCCCCCCCCCCCCCCCC"
];
const DECOR = [
  "....................", "....................", "....................", "..............ooo.k.",
  ".............l......", ".......o.o...l......", "..L..........l......", "s.T.Ft.......lm.Uh.d",
  "....................", "....................", "....................", "...................."
];

export function starterMap() {
  const w = 20;
  const h = 12;
  const map = createMap(w, h, { layers: 3, names: ["Sky", "Ground", "Decor"] });
  [SKY, GROUND, DECOR].forEach((rows, li) => {
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch in KEY) { map.layers[li].data[y * w + x] = KEY[ch] + 1; }
    }));
  });
  return map;
}
