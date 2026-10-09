/* ============================================================
   Icon Maker - unit tests
   The ICO writer (header + directory for 3 sizes), placement
   maths, the maskable safe zone, snippets and settings.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTPUTS, DEFAULTS, SAFE_ZONE, normalizeSettings, normalizeHex, placement, cornerRadius, isClear,
  makeIco, linkTags, manifest
} from "../../items/icon-maker/icon.js";
import { makeZip, SIG_END } from "../../items/icon-maker/zip.js";

/* A fake "PNG" of n bytes: the writer just copies it. */
const png = (n, fill) => new Uint8Array(n).fill(fill);

test("makeIco writes a valid header and directory for 3 sizes", () => {
  const images = [{ size: 16, data: png(100, 1) }, { size: 32, data: png(200, 2) }, { size: 48, data: png(300, 3) }];
  const ico = makeIco(images);
  const v = new DataView(ico.buffer);

  /* ICONDIR */
  assert.equal(v.getUint16(0, true), 0, "reserved");
  assert.equal(v.getUint16(2, true), 1, "type 1 = icon");
  assert.equal(v.getUint16(4, true), 3, "image count");

  /* ICONDIRENTRY x 3 */
  const head = 6 + 16 * 3;
  let offset = head;
  images.forEach((im, i) => {
    const p = 6 + 16 * i;
    assert.equal(ico[p], im.size, "width");
    assert.equal(ico[p + 1], im.size, "height");
    assert.equal(ico[p + 2], 0, "palette");
    assert.equal(ico[p + 3], 0, "reserved");
    assert.equal(v.getUint16(p + 4, true), 1, "planes");
    assert.equal(v.getUint16(p + 6, true), 32, "bits per pixel");
    assert.equal(v.getUint32(p + 8, true), im.data.length, "bytes");
    assert.equal(v.getUint32(p + 12, true), offset, "offset");
    assert.deepEqual([...ico.subarray(offset, offset + im.data.length)], [...im.data], "image data in place");
    offset += im.data.length;
  });
  assert.equal(ico.length, head + 600);
});

test("makeIco: 256 is written as 0, and bad input throws", () => {
  const ico = makeIco([{ size: 256, data: png(4, 9) }]);
  assert.equal(ico[6], 0);
  assert.equal(ico[7], 0);
  assert.throws(() => makeIco([]), /No images/);
  assert.throws(() => makeIco([{ size: 300, data: png(1, 0) }]), /1 to 256/);
});

test("the favicon output holds 16, 32 and 48", () => {
  assert.deepEqual(OUTPUTS.find((o) => o.file === "favicon.ico").sizes, [16, 32, 48]);
  assert.deepEqual(OUTPUTS.filter((o) => o.size).map((o) => o.size), [180, 192, 512, 512]);
});

test("placement: whole picture, centred, keeps its shape", () => {
  const p = placement(200, 100, 100, { fit: "contain", padding: 10 });
  assert.deepEqual([p.sx, p.sy, p.sw, p.sh], [0, 0, 200, 100]);
  assert.equal(p.dw, 80);
  assert.equal(p.dh, 40);
  assert.equal(p.dx, 10);
  assert.equal(p.dy, 30);
});

test("placement: fill square crops the middle", () => {
  const p = placement(300, 100, 64, { fit: "cover", padding: 0 });
  assert.deepEqual([p.sx, p.sy, p.sw, p.sh], [100, 0, 100, 100]);
  assert.deepEqual([p.dx, p.dy, p.dw, p.dh], [0, 0, 64, 64]);
});

test("maskable keeps the picture inside the safe circle", () => {
  const p = placement(100, 100, 512, { fit: "cover", padding: 0 }, "maskable");
  /* the square's corners must sit inside a circle 80% wide */
  const r = Math.hypot(p.dw / 2, p.dh / 2);
  assert.ok(r <= (512 * SAFE_ZONE) / 2 + 0.001, `corner at ${r}`);
  /* bigger padding than the safe zone needs is kept */
  assert.equal(placement(100, 100, 512, { padding: 30 }, "maskable").dw, 512 * 0.4);
});

test("corners and see-through only apply to plain icons", () => {
  assert.equal(cornerRadius(200, { radius: 25 }), 50);
  assert.equal(cornerRadius(180, { radius: 25 }, "apple"), 0);
  assert.equal(cornerRadius(512, { radius: 25 }, "maskable"), 0);
  assert.equal(isClear({ transparent: true }), true);
  assert.equal(isClear({ transparent: true }, "apple"), false);
});

test("snippets: link tags and a valid manifest", () => {
  assert.match(linkTags(), /<link rel="icon" href="\/favicon.ico" sizes="any">/);
  assert.match(linkTags(), /apple-touch-icon\.png/);
  const m = JSON.parse(manifest({ name: "Hi <b>", shortName: "Hi", bg: "#ABC" }));
  assert.equal(m.name, "Hi b");
  assert.equal(m.theme_color, "#aabbcc");
  assert.equal(m.icons.length, 3);
  assert.equal(m.icons[2].purpose, "maskable");
});

test("settings are tidied", () => {
  assert.deepEqual(normalizeSettings({}), { ...DEFAULTS });
  const n = normalizeSettings({ fit: "zoom", padding: 99, radius: -3, bg: "red", transparent: 1, name: "", shortName: "A very long short name" });
  assert.equal(n.fit, "contain");
  assert.equal(n.padding, 40);
  assert.equal(n.radius, 0);
  assert.equal(n.bg, DEFAULTS.bg);
  assert.equal(n.transparent, false);
  assert.equal(n.name, DEFAULTS.name);
  assert.equal(n.shortName.length, 12);
  assert.equal(normalizeHex("FFF"), "#ffffff");
  assert.equal(normalizeHex("#12345g"), null);
});

test("the copied zip writer still makes a valid zip", () => {
  const zip = makeZip([{ name: "favicon.ico", data: png(10, 7) }]);
  assert.equal(String.fromCharCode(zip[0], zip[1]), "PK");
  assert.equal(new DataView(zip.buffer).getUint32(zip.length - 22, true), SIG_END);
});
