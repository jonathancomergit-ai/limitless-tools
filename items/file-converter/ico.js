/* ============================================================
   File Converter - .ico read and write

   An .ico is a little folder of pictures, one a size:
     header     reserved 0, type 1 (icon) or 2 (cursor), count
     directory  16 bytes an entry: width, height (0 = 256),
                colours, reserved, planes, bits, size, offset
     data       each picture: a whole PNG, or an old-style
                "DIB" (a BMP without its file header)

   makeIco([{ width, height, data: pngBytes }])  -> Uint8Array
   readIco(bytes)        -> { type, entries: [{ width, height, bpp, isPng, data }] }
   largestEntry(entries) -> the biggest (then the most colours)
   dibToRgba(data)       -> { width, height, rgba }  for old-style entries
                            (1, 4, 8, 24 and 32 bits, AND mask honoured)

   Pure functions, no DOM: unit tested in tests/unit/file-converter.test.js.
   ============================================================ */

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const isPngBytes = (b) => b && b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v);

export function makeIco(images) {
  if (!Array.isArray(images) || !images.length) { throw new Error("No pictures for the icon."); }
  if (images.length > 64) { throw new Error("Too many sizes for one icon."); }
  for (const im of images) {
    if (!(im.width >= 1 && im.width <= 256 && im.height >= 1 && im.height <= 256)) { throw new Error("Icon pictures must be 1 to 256 pixels a side."); }
  }
  const head = 6 + 16 * images.length;
  const total = images.reduce((n, im) => n + im.data.length, head);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, 1, true);
  v.setUint16(4, images.length, true);
  let offset = head;
  images.forEach((im, k) => {
    const p = 6 + k * 16;
    out[p] = im.width >= 256 ? 0 : im.width;
    out[p + 1] = im.height >= 256 ? 0 : im.height;
    out[p + 2] = 0;                       // colours in the palette (none)
    out[p + 3] = 0;
    v.setUint16(p + 4, 1, true);          // planes
    v.setUint16(p + 6, 32, true);         // bits a pixel
    v.setUint32(p + 8, im.data.length, true);
    v.setUint32(p + 12, offset, true);
    out.set(im.data, offset);
    offset += im.data.length;
  });
  return out;
}

export function readIco(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 6) { throw new Error("That icon file is too short."); }
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = v.getUint16(2, true);
  if (v.getUint16(0, true) !== 0 || (type !== 1 && type !== 2)) { throw new Error("That isn't an .ico file."); }
  const count = v.getUint16(4, true);
  if (!count) { throw new Error("That icon has no pictures in it."); }
  if (b.length < 6 + count * 16) { throw new Error("That icon file is cut short."); }
  const entries = [];
  for (let k = 0; k < count; k++) {
    const p = 6 + k * 16;
    const size = v.getUint32(p + 8, true);
    const offset = v.getUint32(p + 12, true);
    if (offset + size > b.length || size < 8) { continue; }      // a broken entry: skip it
    const data = b.subarray(offset, offset + size);
    const png = isPngBytes(data);
    let width = b[p] || 256;
    let height = b[p + 1] || 256;
    let bpp = v.getUint16(p + 6, true);
    if (png && data.length >= 24) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(16);
      height = dv.getUint32(20);
      bpp = bpp || 32;
    } else if (!png && data.length >= 16) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      bpp = dv.getUint16(14, true) || bpp;
    }
    entries.push({ width, height, bpp, isPng: png, data });
  }
  if (!entries.length) { throw new Error("Every picture in that icon is broken."); }
  return { type, entries };
}

export function largestEntry(entries) {
  return entries.reduce((best, e) => (!best || e.width * e.height > best.width * best.height ||
    (e.width * e.height === best.width * best.height && e.bpp > best.bpp) ? e : best), null);
}

/* An old-style icon picture (BITMAPINFOHEADER + pixels + AND mask) -> RGBA. */
export function dibToRgba(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const hdr = v.getUint32(0, true);
  if (hdr < 40 || data.length < hdr) { throw new Error("That icon picture is in a format this tool can't read."); }
  const width = v.getInt32(4, true);
  const height = Math.abs(v.getInt32(8, true)) / 2;          // XOR + AND masks stacked
  const bpp = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  if (compression !== 0 && compression !== 3) { throw new Error("That icon picture is compressed in a way this tool can't read."); }
  if (!(width > 0 && height > 0 && width <= 1024 && height <= 1024)) { throw new Error("That icon picture has a strange size."); }
  if (![1, 4, 8, 24, 32].includes(bpp)) { throw new Error(`${bpp}-bit icon pictures aren't supported.`); }

  let p = hdr + (compression === 3 && hdr === 40 ? 12 : 0);
  const palette = [];
  if (bpp <= 8) {
    const used = Math.min(v.getUint32(32, true) || 1 << bpp, 1 << bpp);   // never trust a huge count
    for (let k = 0; k < used; k++) { palette.push([data[p + 2], data[p + 1], data[p], 255]); p += 4; }
  }
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const maskStart = p + stride * height;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let anyAlpha = false;

  for (let y = 0; y < height; y++) {
    const row = p + (height - 1 - y) * stride;               // bottom-up
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let px;
      if (bpp === 32) { const q = row + x * 4; px = [data[q + 2], data[q + 1], data[q], data[q + 3]]; } else if (bpp === 24) { const q = row + x * 3; px = [data[q + 2], data[q + 1], data[q], 255]; } else {
        const bit = x * bpp;
        const byte = data[row + (bit >> 3)];
        const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        px = palette[idx] || [0, 0, 0, 255];
      }
      if (bpp === 32 && px[3]) { anyAlpha = true; }
      rgba.set(px, o);
    }
  }
  /* The AND mask: 1 = see-through. 32-bit pictures use their own
     alpha, unless it's all zero (then the mask is the truth). */
  const hasMask = maskStart + maskStride * height <= data.length;
  if (hasMask && !(bpp === 32 && anyAlpha)) {
    for (let y = 0; y < height; y++) {
      const row = maskStart + (height - 1 - y) * maskStride;
      for (let x = 0; x < width; x++) {
        const clear = (data[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        rgba[(y * width + x) * 4 + 3] = clear ? 0 : 255;
      }
    }
  }
  return { width, height, rgba };
}
