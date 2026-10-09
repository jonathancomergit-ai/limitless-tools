/* ============================================================
   Image Squisher - unit tests
   The zip writer (headers, CRC32, entry count) and the pure helpers.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, makeZip, dosDateTime, SIG_LOCAL, SIG_CENTRAL, SIG_END } from "../../items/image-squisher/zip.js";
import {
  fitSize, normalizeSettings, outputName, uniqueNames, formatBytes, percentSaved, looksLikeImage, limit, DEFAULTS, MAX_SIDE
} from "../../items/image-squisher/squish.js";

const enc = new TextEncoder();

/* ---- a small zip reader, just for checking ---- */
function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(v.getUint32(end, true), SIG_END, "end record signature");
  const count = v.getUint16(end + 10, true);
  const cdSize = v.getUint32(end + 12, true);
  const cdStart = v.getUint32(end + 16, true);
  assert.equal(cdStart + cdSize, end, "central directory ends where the end record starts");

  const files = [];
  let p = cdStart;
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), SIG_CENTRAL, "central header signature");
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const offset = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    assert.equal(v.getUint32(offset, true), SIG_LOCAL, "local header signature");
    assert.equal(v.getUint16(offset + 8, true), 0, "stored, not deflated");
    assert.equal(v.getUint32(offset + 14, true), crc, "local and central CRC agree");
    const localName = v.getUint16(offset + 26, true);
    const dataStart = offset + 30 + localName + v.getUint16(offset + 28, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    files.push({ name, crc, data });
    p += 46 + nameLen;
  }
  return { count, files };
}

test("crc32 of '123456789' is cbf43926", () => {
  assert.equal(crc32("123456789").toString(16), "cbf43926");
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(crc32("The quick brown fox jumps over the lazy dog").toString(16), "414fa339");
});

test("makeZip writes valid signatures, entry count and CRCs", () => {
  const a = enc.encode("hello");
  const b = new Uint8Array(1000).map((_, i) => i & 0xff);
  const zip = makeZip([{ name: "a.txt", data: a }, { name: "café.webp", data: b }], { date: new Date(2026, 9, 9, 12, 30, 10) });

  assert.equal(new DataView(zip.buffer).getUint32(0, true), SIG_LOCAL, "starts with PK\\3\\4");
  assert.equal(String.fromCharCode(zip[0], zip[1]), "PK");

  const { count, files } = readZip(zip);
  assert.equal(count, 2);
  assert.deepEqual(files.map((f) => f.name), ["a.txt", "café.webp"]);
  assert.equal(files[0].crc, crc32(a));
  assert.equal(files[1].crc, crc32(b));
  assert.deepEqual([...files[0].data], [...a]);
  assert.deepEqual([...files[1].data], [...b]);
  assert.equal(zip.length, (30 + 5 + 5) + (30 + 10 + 1000) + (46 + 5) + (46 + 10) + 22);
});

test("makeZip refuses an empty list", () => {
  assert.throws(() => makeZip([]), /Nothing to zip/);
});

test("dosDateTime packs date and time the zip way", () => {
  const { time, date } = dosDateTime(new Date(2026, 9, 9, 12, 30, 10));
  assert.equal(date >> 9, 2026 - 1980);
  assert.equal((date >> 5) & 0xf, 10);
  assert.equal(date & 0x1f, 9);
  assert.equal(time >> 11, 12);
  assert.equal((time >> 5) & 0x3f, 30);
  assert.equal((time & 0x1f) * 2, 10);
});

test("fitSize keeps the shape and never enlarges", () => {
  assert.deepEqual(fitSize(4000, 3000, 1920, 1920), { width: 1920, height: 1440 });
  assert.deepEqual(fitSize(3000, 4000, 1920, 1920), { width: 1440, height: 1920 });
  assert.deepEqual(fitSize(800, 600, 1920, 1920), { width: 800, height: 600 });
  assert.deepEqual(fitSize(800, 600, 0, 300), { width: 400, height: 300 });
  assert.deepEqual(fitSize(800, 600, 0, 0), { width: 800, height: 600 });
  assert.deepEqual(fitSize(0, 0, 100, 100), { width: 1, height: 1 });
  const huge = fitSize(30000, 1000, 0, 0);
  assert.ok(huge.width <= MAX_SIDE);
});

test("normalizeSettings cleans junk", () => {
  assert.deepEqual(normalizeSettings({}), { ...DEFAULTS });
  assert.deepEqual(
    normalizeSettings({ maxWidth: "", maxHeight: "-5", format: "bmp", quality: 400 }),
    { maxWidth: 0, maxHeight: 0, format: "webp", quality: 100 }
  );
  assert.equal(normalizeSettings({ format: "png" }).format, "png");
  assert.equal(limit("99999"), MAX_SIDE);
});

test("names: new extension, safe characters, no clashes", () => {
  assert.equal(outputName("Holiday photo.JPG", "webp"), "Holiday photo.webp");
  assert.equal(outputName("a/b:c.png", "jpeg"), "a_b_c.jpg");
  assert.equal(outputName(".png", "png"), "image.png");
  assert.deepEqual(uniqueNames(["a.webp", "b.webp", "A.webp", "a.webp"]), ["a.webp", "b.webp", "A (2).webp", "a (3).webp"]);
});

test("formatBytes, percentSaved, looksLikeImage", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(percentSaved(1000, 250), 75);
  assert.equal(percentSaved(1000, 1200), -20);
  assert.equal(percentSaved(0, 10), 0);
  assert.equal(looksLikeImage({ type: "image/png", name: "x" }), true);
  assert.equal(looksLikeImage({ type: "", name: "x.HEIC" }), false);
  assert.equal(looksLikeImage({ type: "", name: "x.jpeg" }), true);
  assert.equal(looksLikeImage({ type: "application/pdf", name: "x.pdf" }), false);
});
