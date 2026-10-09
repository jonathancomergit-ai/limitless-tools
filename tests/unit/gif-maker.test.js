/* ============================================================
   GIF Maker - unit tests
   The GIF89a encoder (header, trailer, LZW, frames, loop, delay,
   colours, dithering) and the pure frame / settings maths.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quantize, nearest, mapPixels, lzwEncode, lzwDecode, ByteWriter, tableBits, delayCs,
  encodeGif, readGif, TRAILER
} from "../../items/gif-maker/gif.js";
import {
  DEFAULTS, SIZES, MAX_CLIP_FRAMES, normalizeSettings, targetAspect, cropRect, outputSize, fitWithin,
  moveItem, loopValue, playCount, frameAtTime, clipPlan, fixedBytes, estimateBytes, formatBytes,
  baseName, gifFileName
} from "../../items/gif-maker/frames.js";

/* ---- test pictures ---- */

/* A tiny repeatable random number maker. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* w x h RGBA, filled by fn(x, y) -> [r, g, b, a?]. */
function picture(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      d.set([r, g, b, a], (y * w + x) * 4);
    }
  }
  return d;
}

const gradient = (w, h, shift = 0) => picture(w, h, (x, y) => [(x * 255) / w, (y * 255) / h, (x + y + shift) % 256]);
function noise(w, h, seed) {
  const r = rng(seed);
  return picture(w, h, () => [r() * 256, r() * 256, r() * 256]);
}

/* ---- the file ------------------------------------------------ */

test("output starts with GIF89a and ends with the trailer byte 0x3B", () => {
  const gif = encodeGif({ width: 8, height: 6, frames: [{ data: gradient(8, 6), delay: 100 }] });
  assert.ok(gif instanceof Uint8Array);
  assert.equal(String.fromCharCode(...gif.subarray(0, 6)), "GIF89a");
  assert.equal(gif[gif.length - 1], 0x3b);
  assert.equal(TRAILER, 0x3b);
  /* the logical screen size, little-endian */
  assert.equal(gif[6] | (gif[7] << 8), 8);
  assert.equal(gif[8] | (gif[9] << 8), 6);
});

test("frame count is right (read back with readGif)", () => {
  for (const n of [1, 2, 6, 13]) {
    const frames = Array.from({ length: n }, (_, i) => ({ data: gradient(12, 10, i * 20), delay: 100 }));
    const g = readGif(encodeGif({ width: 12, height: 10, frames }));
    assert.equal(g.frames.length, n, `${n} frames`);
    assert.equal(g.width, 12);
    assert.equal(g.height, 10);
    for (const f of g.frames) { assert.equal(f.indexes.length, 12 * 10); }
  }
});

test("the loop setting is written (Netscape block)", () => {
  const frames = [{ data: gradient(4, 4), delay: 100 }, { data: gradient(4, 4, 99), delay: 100 }];
  assert.equal(readGif(encodeGif({ width: 4, height: 4, frames, loop: 0 })).loop, 0);        // forever
  assert.equal(readGif(encodeGif({ width: 4, height: 4, frames, loop: 2 })).loop, 2);        // play 3 times
  assert.equal(readGif(encodeGif({ width: 4, height: 4, frames, loop: -1 })).loop, null);    // once: no block
  /* and through the settings */
  assert.equal(loopValue(normalizeSettings({ loop: "forever" })), 0);
  assert.equal(loopValue(normalizeSettings({ loop: "once" })), -1);
  assert.equal(loopValue(normalizeSettings({ loop: "times", loopCount: 3 })), 2);
  const raw = encodeGif({ width: 4, height: 4, frames, loop: loopValue({ loop: "times", loopCount: 5 }) });
  assert.ok(Buffer.from(raw).includes(Buffer.from("NETSCAPE2.0")));
  assert.equal(readGif(raw).loop, 4);
});

test("the frame delay is written, in 1/100 s", () => {
  const frames = [
    { data: gradient(4, 4), delay: 200 },
    { data: gradient(4, 4, 50), delay: 50 },
    { data: gradient(4, 4, 90), delay: 1230 }
  ];
  const g = readGif(encodeGif({ width: 4, height: 4, frames }));
  assert.deepEqual(g.frames.map((f) => f.delay), [200, 50, 1230]);
  assert.equal(delayCs(200), 20);
  assert.equal(delayCs(0), 10);       // missing -> 100 ms
  assert.equal(delayCs(5), 2);        // never faster than 20 ms
  assert.equal(delayCs(1e9), 65535);
});

test("the colour limit is respected", () => {
  for (const colors of [64, 96, 128, 256]) {
    const frames = [{ data: noise(40, 30, colors), delay: 100 }, { data: gradient(40, 30), delay: 100 }];
    const q = quantize(frames.map((f) => f.data), colors);
    assert.ok(q.palette.length <= colors, `palette ${q.palette.length} <= ${colors}`);
    const g = readGif(encodeGif({ width: 40, height: 30, frames, colors }));
    assert.ok(g.palette.length >= colors && g.palette.length <= 256);    // table is a power of two
    const used = new Set();
    for (const f of g.frames) { for (const i of f.indexes) { used.add(i); } }
    assert.ok(used.size <= colors, `${used.size} colours used, limit ${colors}`);
    assert.ok(Math.max(...used) < colors);
  }
});

test("see-through pixels get their own index and still fit the limit", () => {
  const data = picture(16, 16, (x, y) => (x < 4 ? [0, 0, 0, 0] : [x * 16, y * 16, 128, 255]));
  const q = quantize([data], 64);
  assert.equal(q.transparent, true);
  assert.ok(q.palette.length <= 63);
  const g = readGif(encodeGif({ width: 16, height: 16, frames: [{ data, delay: 100 }], colors: 64 }));
  assert.equal(g.frames[0].transparentIndex, 0);
  assert.equal(g.frames[0].indexes[0], 0);                 // top-left is see-through
  assert.notEqual(g.frames[0].indexes[8], 0);              // x = 8 is not
});

test("dithering on and off both give valid GIFs", () => {
  const frames = [{ data: gradient(48, 32), delay: 100 }, { data: noise(48, 32, 7), delay: 100 }];
  const plain = encodeGif({ width: 48, height: 32, frames, colors: 64, dither: false });
  const dith = encodeGif({ width: 48, height: 32, frames, colors: 64, dither: true });
  for (const gif of [plain, dith]) {
    assert.equal(String.fromCharCode(...gif.subarray(0, 6)), "GIF89a");
    assert.equal(gif[gif.length - 1], 0x3b);
    const g = readGif(gif);
    assert.equal(g.frames.length, 2);
    for (const f of g.frames) {
      assert.equal(f.indexes.length, 48 * 32);
      assert.ok(Math.max(...f.indexes) < 64);
    }
  }
  assert.notDeepEqual(readGif(plain).frames[0].indexes, readGif(dith).frames[0].indexes);
});

test("few colours are kept exactly (pixel art stays perfect)", () => {
  const cols = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [250, 250, 250], [9, 9, 9]];
  const data = picture(10, 7, (x, y) => cols[(x + y * 3) % cols.length]);
  const g = readGif(encodeGif({ width: 10, height: 7, frames: [{ data, delay: 100 }], colors: 64, dither: true }));
  g.frames[0].indexes.forEach((idx, i) => {
    assert.deepEqual(g.palette[idx], [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  });
});

test("bad input is refused", () => {
  assert.throws(() => encodeGif({ width: 4, height: 4, frames: [] }), /at least one frame/);
  assert.throws(() => encodeGif({ width: 4, height: 4, frames: [{ data: new Uint8ClampedArray(8) }] }), /RGBA/);
  assert.throws(() => encodeGif({ width: 0, height: 4, frames: [{ data: new Uint8ClampedArray(0) }] }), /size/);
  assert.throws(() => readGif(new Uint8Array([1, 2, 3, 4, 5, 6])), /Not a GIF/);
});

/* ---- LZW ----------------------------------------------------- */

test("LZW round-trips on test data", () => {
  const cases = [
    [new Uint8Array([]), 2],
    [new Uint8Array([0]), 2],
    [new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 2],
    [Uint8Array.from("ABABABABABABAABBBAAABBBAB", (c) => c.charCodeAt(0) - 65), 2],
    [Uint8Array.from({ length: 5000 }, (_, i) => i % 7), 3],
    [Uint8Array.from({ length: 3000 }, () => 3), 2]
  ];
  for (const [data, min] of cases) {
    assert.deepEqual(lzwDecode(lzwEncode(data, min), min), data, `length ${data.length}, min code ${min}`);
  }
});

test("LZW round-trips past 4096 codes (the table resets)", () => {
  const r = rng(42);
  /* Random bytes barely repeat, so nearly every step adds a code:
     50 000 of them fill the 4096-entry table many times over. */
  const big = Uint8Array.from({ length: 50000 }, () => Math.floor(r() * 256));
  const packed = lzwEncode(big, 8);
  assert.deepEqual(lzwDecode(packed, 8), big);
  /* count the clear codes in the stream: more than the first one */
  const smallAlphabet = Uint8Array.from({ length: 60000 }, () => Math.floor(r() * 4));
  assert.deepEqual(lzwDecode(lzwEncode(smallAlphabet, 2), 2), smallAlphabet);
  const clears = countClears(packed, 8);
  assert.ok(clears >= 2, `${clears} clear codes`);
});

/* Walks the code stream the way a decoder does, counting clears. */
function countClears(data, min) {
  const clear = 1 << min;
  const eoi = clear + 1;
  let size = min + 1;
  let next = eoi + 1;
  let first = true;
  let acc = 0;
  let bits = 0;
  let pos = 0;
  let n = 0;
  for (;;) {
    while (bits < size && pos < data.length) { acc |= data[pos++] << bits; bits += 8; }
    if (bits < size) { return n; }
    const code = acc & ((1 << size) - 1);
    acc >>>= size;
    bits -= size;
    if (code === clear) { n++; size = min + 1; next = eoi + 1; first = true; continue; }
    if (code === eoi) { return n; }
    if (first) { first = false; continue; }
    if (next < 4096) { next++; if (next === 1 << size && size < 12) { size++; } }
  }
}

test("LZW inside a whole GIF decodes back to the mapped pixels", () => {
  const w = 64;
  const h = 64;
  const data = noise(w, h, 3);
  const { palette } = quantize([data], 256);
  const idx = mapPixels(data, w, h, palette);
  const g = readGif(encodeGif({ width: w, height: h, frames: [{ data, delay: 100 }], colors: 256 }));
  assert.deepEqual(g.frames[0].indexes, idx);
});

/* ---- helpers in gif.js ---------------------------------------- */

test("tableBits, nearest, ByteWriter", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 64, 65, 256].map(tableBits), [1, 1, 2, 2, 3, 6, 7, 8]);
  assert.equal(nearest([[0, 0, 0], [255, 255, 255], [250, 10, 10]], 240, 30, 20), 2);
  const w = new ByteWriter(2);
  w.text("GIF");
  w.word(0x1234);
  w.bytes(new Uint8Array([7, 8, 9]));
  assert.deepEqual([...w.done()], [71, 73, 70, 0x34, 0x12, 7, 8, 9]);
});

/* ---- settings ------------------------------------------------- */

test("settings normalise: defaults, clamps and junk", () => {
  assert.deepEqual(normalizeSettings({}), { ...DEFAULTS });
  assert.deepEqual(normalizeSettings(null), { ...DEFAULTS });
  const s = normalizeSettings({ size: 999, delay: 3, loop: "sometimes", loopCount: 99, colors: 9, dither: "yes", crop: "round", clipSeconds: 12 });
  assert.equal(s.size, DEFAULTS.size);
  assert.equal(s.delay, 20);
  assert.equal(s.loop, "forever");
  assert.equal(s.loopCount, 20);
  assert.equal(s.colors, 64);
  assert.equal(s.dither, DEFAULTS.dither);
  assert.equal(s.crop, "original");
  assert.equal(s.clipSeconds, 5);
  assert.equal(normalizeSettings({ delay: 154 }).delay, 150);
  assert.equal(normalizeSettings({ colors: 300 }).colors, 256);
  assert.equal(normalizeSettings({ size: "480" }).size, 480);
  for (const size of SIZES) { assert.equal(normalizeSettings({ size }).size, size); }
});

/* ---- crop + size ----------------------------------------------- */

test("crop rect maths: square, 16:9 and original", () => {
  assert.deepEqual(cropRect(400, 300, targetAspect("square")), { x: 50, y: 0, w: 300, h: 300 });
  assert.deepEqual(cropRect(300, 400, targetAspect("square")), { x: 0, y: 50, w: 300, h: 300 });
  assert.deepEqual(cropRect(1600, 1200, targetAspect("wide")), { x: 0, y: 150, w: 1600, h: 900 });
  assert.deepEqual(cropRect(900, 1600, targetAspect("wide")), { x: 0, y: 547, w: 900, h: 506 });
  /* original: the first frame's shape, so the first frame is never cut */
  const a = targetAspect("original", 640, 480);
  assert.deepEqual(cropRect(640, 480, a), { x: 0, y: 0, w: 640, h: 480 });
  /* a later, wider frame is cut to that shape */
  assert.deepEqual(cropRect(800, 480, a), { x: 80, y: 0, w: 640, h: 480 });
  assert.equal(targetAspect("original", 0, 0), 4 / 3);
});

test("output size from the size setting (longest side)", () => {
  assert.deepEqual(outputSize(4 / 3, 320), { width: 320, height: 240 });
  assert.deepEqual(outputSize(3 / 4, 320), { width: 240, height: 320 });
  assert.deepEqual(outputSize(1, 160), { width: 160, height: 160 });
  assert.deepEqual(outputSize(16 / 9, 640), { width: 640, height: 360 });
  assert.deepEqual(outputSize(100, 160), { width: 160, height: 2 });
  assert.deepEqual(fitWithin(4000, 3000, 960), { width: 960, height: 720 });
  assert.deepEqual(fitWithin(100, 50, 960), { width: 100, height: 50 });
});

/* ---- order + playback ------------------------------------------- */

test("frame order moves", () => {
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(list, 0, 1), ["b", "a", "c", "d"]);
  assert.deepEqual(moveItem(list, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(list, 1, 3), ["a", "c", "d", "b"]);
  assert.deepEqual(moveItem(list, 0, -1), list);
  assert.deepEqual(moveItem(list, 2, 9), list);
  assert.deepEqual(list, ["a", "b", "c", "d"], "the original is untouched");
});

test("preview playback: frame at a time, stopping after the plays", () => {
  assert.equal(frameAtTime(0, 4, 100), 0);
  assert.equal(frameAtTime(0.25, 4, 100), 2);
  assert.equal(frameAtTime(0.45, 4, 100), 0);              // loops
  assert.equal(frameAtTime(0.45, 4, 100, 1), 3);           // once: holds the last frame
  assert.equal(frameAtTime(1, 0, 100), -1);
  assert.equal(playCount(normalizeSettings({ loop: "times", loopCount: 4 })), 4);
  assert.equal(playCount(normalizeSettings({ loop: "once" })), 1);
  assert.equal(playCount(normalizeSettings({})), Infinity);
});

test("camera clip plan: real speed, capped frames", () => {
  assert.deepEqual(clipPlan(2, 200), { count: 10, interval: 200 });
  assert.deepEqual(clipPlan(1, 100), { count: 10, interval: 100 });
  const fast = clipPlan(5, 20);
  assert.ok(fast.count <= MAX_CLIP_FRAMES);
  assert.ok(fast.interval >= 20);
  assert.equal(clipPlan(3, 100, 4).count, 4);              // only room for 4 more
  assert.equal(clipPlan(3, 100, 0).count, 0);
});

/* ---- estimate + names ---------------------------------------------- */

test("size estimate grows with the picture and the frame count", () => {
  const base = { sampleBytes: 4000, sampleW: 120, sampleH: 90, frames: 6, tableBits: 7 };
  const small = estimateBytes({ ...base, width: 160, height: 120 });
  const big = estimateBytes({ ...base, width: 640, height: 480 });
  assert.ok(small > fixedBytes(6, 7));
  assert.ok(big > small * 8 && big < small * 16);
  assert.equal(estimateBytes({ ...base, width: 120, height: 90 }), 4000);   // same size -> same bytes
  /* and against the real encoder: a sample GIF predicts the full one within 2x */
  const make = (w, h) => encodeGif({
    width: w, height: h, colors: 128, dither: false,
    frames: [0, 1, 2].map((i) => ({ data: gradient(w, h, i * 40), delay: 100 }))
  });
  const sample = make(60, 45);
  const real = make(240, 180).length;
  const guess = estimateBytes({ sampleBytes: sample.length, sampleW: 60, sampleH: 45, width: 240, height: 180, frames: 3, tableBits: (sample[10] & 7) + 1 });
  assert.ok(guess > real / 2 && guess < real * 2, `guess ${guess}, real ${real}`);
});

test("formatBytes", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(204800), "200 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});

test("download file names", () => {
  assert.equal(gifFileName("My Holiday (1).JPG"), "my-holiday-1.gif");
  assert.equal(gifFileName("Café crème.png"), "cafe-creme.gif");
  assert.equal(gifFileName(""), "animation.gif");
  assert.equal(gifFileName("???.png"), "animation.gif");
  assert.equal(baseName("a".repeat(80)).length, 40);
});
