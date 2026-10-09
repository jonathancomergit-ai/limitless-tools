/* ============================================================
   File Converter - BMP writer (24-bit)

   Browsers read BMP but can't write it, so this does.
   24 bits a pixel (blue, green, red), rows bottom-up, each row
   padded to a multiple of 4 bytes. BMP has no see-through here:
   clear pixels are blended onto the background colour.

     "BM" fileSize 0 0 pixelOffset(54)
     BITMAPINFOHEADER: 40, width, height, 1 plane, 24 bits,
                       no compression, image size, 2835 px/m (72 dpi)

   makeBmp(rgba, width, height, { background: [r, g, b] }) -> Uint8Array
   Pure functions, no DOM: unit tested in tests/unit/file-converter.test.js.
   ============================================================ */

export function makeBmp(rgba, width, height, { background = [255, 255, 255] } = {}) {
  if (!(width >= 1 && height >= 1)) { throw new Error("A picture needs a size."); }
  if (rgba.length < width * height * 4) { throw new Error("Not enough pixels for that size."); }
  const stride = Math.ceil((width * 3) / 4) * 4;
  const imageSize = stride * height;
  const out = new Uint8Array(54 + imageSize);
  const v = new DataView(out.buffer);
  out[0] = 0x42;                         // B
  out[1] = 0x4d;                         // M
  v.setUint32(2, out.length, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);          // positive = bottom-up
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(30, 0, true);              // BI_RGB
  v.setUint32(34, imageSize, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);

  const [br, bg, bb] = background;
  for (let y = 0; y < height; y++) {
    let p = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const a = rgba[o + 3] / 255;
      out[p++] = Math.round(rgba[o + 2] * a + bb * (1 - a));
      out[p++] = Math.round(rgba[o + 1] * a + bg * (1 - a));
      out[p++] = Math.round(rgba[o] * a + br * (1 - a));
    }
  }
  return out;
}

/* "#1a2b3c" -> [26, 43, 60]. Anything odd -> white. */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) { return [255, 255, 255]; }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
