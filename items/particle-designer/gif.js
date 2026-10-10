/* ============================================================
   Particle Designer - a GIF89a encoder in plain JS

   COPIED from items/gif-maker/gif.js, unchanged apart from this
   comment: items can't share code outside kit/, so each item
   that needs it keeps its own copy.

   RGBA frames in, one looping .gif out. No libraries.

   A GIF is just:
     "GIF89a" + screen size + one colour table (up to 256)
     a Netscape block that says "loop"
     for each frame: delay block + image block (LZW-packed)
     the trailer byte 0x3B

   Steps for the pictures:
     1. quantize()   pick up to N colours (exact if few enough,
                     otherwise median cut over a sample)
     2. mapPixels()  every pixel -> nearest colour index,
                     optional Floyd-Steinberg dithering
     3. lzwEncode()  pack the indexes (variable-width LZW)

   Pure functions, no DOM: runs in a Web Worker and in Node
   (unit tests in tests/unit/). readGif() + lzwDecode() are
   here so tests can check the output byte by byte.
   ============================================================ */

export const TRAILER = 0x3b;
const EXT = 0x21;
const IMAGE = 0x2c;
const MAX_CODES = 4096;

/* ============================================================
   1. COLOURS
   ============================================================ */

/* frames: [Uint8ClampedArray RGBA, ...]
   Returns { palette: [[r,g,b], ...], exact, transparent }.
   transparent = true if any pixel has alpha < 128; those pixels
   get their own index later, so the palette holds max - 1. */
export function quantize(frames, maxColors = 256) {
  maxColors = Math.max(2, Math.min(256, Math.round(maxColors) || 256));
  let transparent = false;
  let total = 0;
  for (const f of frames) {
    total += f.length >> 2;
    if (!transparent) {
      for (let i = 3; i < f.length; i += 4) { if (f[i] < 128) { transparent = true; break; } }
    }
  }
  const room = transparent ? maxColors - 1 : maxColors;

  /* Few colours? Keep them exactly (pixel art stays perfect). */
  const exact = new Map();
  outer: for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      if (f[i + 3] < 128) { continue; }
      const key = (f[i] << 16) | (f[i + 1] << 8) | f[i + 2];
      if (!exact.has(key)) {
        exact.set(key, exact.size);
        if (exact.size > room) { break outer; }
      }
    }
  }
  if (exact.size <= room) {
    const palette = [...exact.keys()].map((k) => [k >> 16, (k >> 8) & 255, k & 255]);
    if (!palette.length) { palette.push([0, 0, 0]); }
    return { palette, exact: true, transparent };
  }

  /* Median cut on a 5-bit-per-channel histogram of a sample. */
  const step = Math.max(1, Math.floor(total / 120000));
  const count = new Uint32Array(32768);
  const sums = new Float64Array(32768 * 3);
  let n = 0;
  for (const f of frames) {
    for (let p = 0; p < f.length; p += 4 * step) {
      if (f[p + 3] < 128) { continue; }
      const k = ((f[p] >> 3) << 10) | ((f[p + 1] >> 3) << 5) | (f[p + 2] >> 3);
      count[k]++;
      sums[k * 3] += f[p];
      sums[k * 3 + 1] += f[p + 1];
      sums[k * 3 + 2] += f[p + 2];
      n++;
    }
  }
  const bins = [];
  for (let k = 0; k < 32768; k++) { if (count[k]) { bins.push(k); } }

  const chan = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  function box(list) {
    const lo = [31, 31, 31];
    const hi = [0, 0, 0];
    let weight = 0;
    for (const k of list) {
      for (let c = 0; c < 3; c++) {
        const v = chan(k, c);
        if (v < lo[c]) { lo[c] = v; }
        if (v > hi[c]) { hi[c] = v; }
      }
      weight += count[k];
    }
    const ranges = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const axis = ranges.indexOf(Math.max(...ranges));
    return { list, axis, range: ranges[axis], weight };
  }

  const boxes = [box(bins)];
  while (boxes.length < room) {
    /* Split the box with the most pixels times the widest spread. */
    let best = -1;
    let score = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.list.length < 2 || b.range === 0) { continue; }
      const s = b.weight * (b.range + 1);
      if (s > score) { score = s; best = i; }
    }
    if (best === -1) { break; }
    const b = boxes[best];
    b.list.sort((x, y) => chan(x, b.axis) - chan(y, b.axis));
    let half = b.weight / 2;
    let cut = 0;
    for (; cut < b.list.length - 1; cut++) {
      half -= count[b.list[cut]];
      if (half <= 0) { break; }
    }
    cut = Math.min(Math.max(cut + 1, 1), b.list.length - 1);
    boxes.splice(best, 1, box(b.list.slice(0, cut)), box(b.list.slice(cut)));
  }

  const palette = boxes.map((b) => {
    let r = 0; let g = 0; let bl = 0; let w = 0;
    for (const k of b.list) {
      r += sums[k * 3]; g += sums[k * 3 + 1]; bl += sums[k * 3 + 2]; w += count[k];
    }
    return [Math.round(r / w), Math.round(g / w), Math.round(bl / w)];
  });
  return { palette, exact: false, transparent, sampled: n };
}

/* The nearest palette colour (plain squared RGB distance). */
export function nearest(palette, r, g, b) {
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r; const dg = p[1] - g; const db = p[2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < dist) { dist = d; best = i; if (d === 0) { break; } }
  }
  return best;
}

/* RGBA -> palette indexes. offset is added to every index (1 when
   index 0 is the see-through colour). */
export function mapPixels(rgba, width, height, palette, { dither = false, transparentIndex = -1, offset = 0 } = {}) {
  const out = new Uint8Array(width * height);
  const exact = new Map();
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b] = palette[i];
    const k = (r << 16) | (g << 8) | b;
    if (!exact.has(k)) { exact.set(k, i); }
  }
  const cache = new Int16Array(32768).fill(-1);
  const find = (r, g, b) => {
    const k = (r << 16) | (g << 8) | b;
    const hit = exact.get(k);
    if (hit !== undefined) { return hit; }
    const q = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (cache[q] === -1) { cache[q] = nearest(palette, r, g, b); }
    return cache[q];
  };

  if (!dither) {
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      out[i] = rgba[p + 3] < 128 && transparentIndex >= 0 ? transparentIndex : find(rgba[p], rgba[p + 1], rgba[p + 2]) + offset;
    }
    return out;
  }

  /* Floyd-Steinberg: push each pixel's error to its neighbours. */
  let cur = new Float32Array((width + 2) * 3);
  let next = new Float32Array((width + 2) * 3);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let y = 0; y < height; y++) {
    next.fill(0);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      if (rgba[p + 3] < 128 && transparentIndex >= 0) { out[i] = transparentIndex; continue; }
      const e = (x + 1) * 3;
      const r = clamp(rgba[p] + cur[e]);
      const g = clamp(rgba[p + 1] + cur[e + 1]);
      const b = clamp(rgba[p + 2] + cur[e + 2]);
      const idx = find(r, g, b);
      out[i] = idx + offset;
      const c = palette[idx];
      const er = r - c[0]; const eg = g - c[1]; const eb = b - c[2];
      cur[e + 3] += er * 7 / 16; cur[e + 4] += eg * 7 / 16; cur[e + 5] += eb * 7 / 16;
      next[e - 3] += er * 3 / 16; next[e - 2] += eg * 3 / 16; next[e - 1] += eb * 3 / 16;
      next[e] += er * 5 / 16; next[e + 1] += eg * 5 / 16; next[e + 2] += eb * 5 / 16;
      next[e + 3] += er / 16; next[e + 4] += eg / 16; next[e + 5] += eb / 16;
    }
    [cur, next] = [next, cur];
  }
  return out;
}

/* ============================================================
   2. LZW (the GIF flavour: variable code width, 12 bits max)
   ============================================================ */

/* indexes (Uint8Array) -> packed bytes (no sub-blocks yet). */
export function lzwEncode(indexes, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map();

  const bytes = new ByteWriter(Math.max(64, indexes.length >> 1));
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) { bytes.byte(acc & 255); acc >>>= 8; bits -= 8; }
  };

  emit(clear);
  if (!indexes.length) { emit(eoi); if (bits > 0) { bytes.byte(acc & 255); } return bytes.done(); }

  let prefix = indexes[0];
  for (let i = 1; i < indexes.length; i++) {
    const k = indexes[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === MAX_CODES) {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCodeSize + 1;
    } else {
      if (next >= (1 << size)) { size++; }
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) { bytes.byte(acc & 255); }
  return bytes.done();
}

/* packed bytes -> indexes. The mirror of lzwEncode. */
export function lzwDecode(data, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Int16Array(MAX_CODES);
  const suffix = new Uint8Array(MAX_CODES);
  const lengths = new Uint16Array(MAX_CODES);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; lengths[i] = 1; }

  let size = minCodeSize + 1;
  let mask = (1 << size) - 1;
  let next = eoi + 1;
  let prev = -1;
  const out = [];
  let acc = 0;
  let bits = 0;
  let pos = 0;

  const write = (code) => {
    const len = lengths[code];
    const start = out.length;
    out.length += len;
    for (let c = code, j = len - 1; j >= 0; j--) { out[start + j] = suffix[c]; c = prefix[c]; }
  };
  const first = (code) => { let c = code; while (prefix[c] !== -1) { c = prefix[c]; } return suffix[c]; };

  for (;;) {
    while (bits < size && pos < data.length) { acc |= data[pos++] << bits; bits += 8; }
    if (bits < size) { break; }
    const code = acc & mask;
    acc >>>= size;
    bits -= size;

    if (code === clear) {
      size = minCodeSize + 1;
      mask = (1 << size) - 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) { break; }
    if (prev === -1) {
      if (code >= clear) { throw new Error("Broken LZW data."); }
      write(code);
      prev = code;
      continue;
    }
    if (code > next || (code === next && next >= MAX_CODES)) { throw new Error("Broken LZW data."); }
    if (next < MAX_CODES) {
      const f = first(code < next ? code : prev);
      prefix[next] = prev;
      suffix[next] = f;
      lengths[next] = lengths[prev] + 1;
      next++;
      if (next >= mask + 1 && size < 12) { size++; mask = (1 << size) - 1; }
    }
    write(code);
    prev = code;
  }
  return Uint8Array.from(out);
}

/* ============================================================
   3. THE FILE
   ============================================================ */

/* A growing byte buffer. */
export class ByteWriter {
  constructor(size = 1024) { this.buf = new Uint8Array(size); this.length = 0; }
  room(n) {
    if (this.length + n <= this.buf.length) { return; }
    let size = this.buf.length * 2;
    while (size < this.length + n) { size *= 2; }
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.length));
    this.buf = b;
  }
  byte(v) { this.room(1); this.buf[this.length++] = v; }
  word(v) { this.room(2); this.buf[this.length++] = v & 255; this.buf[this.length++] = (v >> 8) & 255; }
  bytes(arr) { this.room(arr.length); this.buf.set(arr, this.length); this.length += arr.length; }
  text(s) { for (let i = 0; i < s.length; i++) { this.byte(s.charCodeAt(i)); } }
  done() { return this.buf.slice(0, this.length); }
}

/* Data in sub-blocks of up to 255 bytes, then a 0 block. */
function subBlocks(w, data) {
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.subarray(i, Math.min(i + 255, data.length));
    w.byte(chunk.length);
    w.bytes(chunk);
  }
  w.byte(0);
}

/* Smallest n with 2^n >= count (at least 1). */
export function tableBits(count) {
  let n = 1;
  while ((1 << n) < count) { n++; }
  return n;
}

/* GIF delays are in 1/100 s. Browsers treat 0 or 1 as "fast",
   so 2 (20 ms) is the shortest that plays the same everywhere. */
export function delayCs(ms) {
  return Math.max(2, Math.min(65535, Math.round((Number(ms) || 100) / 10)));
}

/* options:
     width, height
     frames:   [{ data: RGBA Uint8ClampedArray, delay: ms }]
     colors:   2..256
     dither:   boolean
     loop:     0 = forever, n = repeat n times, -1 = play once
     onProgress(done, total)
   Returns a Uint8Array holding the whole .gif. */
export function encodeGif({ width, height, frames, colors = 256, dither = false, loop = 0, onProgress = null }) {
  width = Math.round(width);
  height = Math.round(height);
  if (!(width > 0 && height > 0 && width <= 65535 && height <= 65535)) { throw new Error("Bad GIF size."); }
  if (!Array.isArray(frames) || !frames.length) { throw new Error("A GIF needs at least one frame."); }
  for (const f of frames) {
    if (!f || !f.data || f.data.length !== width * height * 4) { throw new Error("Every frame must be width x height RGBA."); }
  }

  const { palette, transparent } = quantize(frames.map((f) => f.data), colors);
  const offset = transparent ? 1 : 0;
  const table = transparent ? [[0, 0, 0], ...palette] : palette;
  const bits = tableBits(table.length);
  const minCode = Math.max(2, bits);

  const w = new ByteWriter(width * height * frames.length / 2 + 1024);
  w.text("GIF89a");
  w.word(width);
  w.word(height);
  w.byte(0x80 | ((bits - 1) << 4) | (bits - 1));   // global table, colour resolution, size
  w.byte(0);                                       // background colour index
  w.byte(0);                                       // square pixels
  for (let i = 0; i < 1 << bits; i++) {
    const c = table[i] || [0, 0, 0];
    w.byte(c[0]); w.byte(c[1]); w.byte(c[2]);
  }

  if (loop >= 0 && frames.length > 1) {
    w.byte(EXT); w.byte(0xff); w.byte(11);
    w.text("NETSCAPE2.0");
    w.byte(3); w.byte(1); w.word(Math.min(65535, Math.round(loop)));
    w.byte(0);
  }

  frames.forEach((f, n) => {
    /* Graphic control: delay, and "clear before the next frame"
       when see-through pixels must not show the last one. */
    w.byte(EXT); w.byte(0xf9); w.byte(4);
    w.byte((transparent ? 2 << 2 : 1 << 2) | (transparent ? 1 : 0));
    w.word(delayCs(f.delay));
    w.byte(0);   // transparent index (always 0 when used)
    w.byte(0);

    w.byte(IMAGE);
    w.word(0); w.word(0);
    w.word(width); w.word(height);
    w.byte(0);   // no local table, not interlaced

    const idx = mapPixels(f.data, width, height, palette, { dither, transparentIndex: transparent ? 0 : -1, offset });
    w.byte(minCode);
    subBlocks(w, lzwEncode(idx, minCode));
    if (onProgress) { onProgress(n + 1, frames.length); }
  });

  w.byte(TRAILER);
  return w.done();
}

/* ============================================================
   4. A SMALL READER (for tests and sanity checks)
   ============================================================ */

/* Returns { width, height, palette, loop, frames: [{ delay, indexes }] }.
   loop is null when there is no Netscape block. */
export function readGif(bytes, { decode = true } = {}) {
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== "GIF89a" && sig !== "GIF87a") { throw new Error("Not a GIF."); }
  let p = 6;
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const width = u16();
  const height = u16();
  const flags = bytes[p++];
  p += 2;
  let palette = [];
  if (flags & 0x80) {
    const n = 1 << ((flags & 7) + 1);
    for (let i = 0; i < n; i++) { palette.push([bytes[p], bytes[p + 1], bytes[p + 2]]); p += 3; }
  }
  const readBlocks = () => {
    const parts = [];
    let size = 0;
    for (let n = bytes[p++]; n; n = bytes[p++]) { parts.push(bytes.subarray(p, p + n)); size += n; p += n; }
    const out = new Uint8Array(size);
    let o = 0;
    for (const part of parts) { out.set(part, o); o += part.length; }
    return out;
  };

  let loop = null;
  let delay = 0;
  let transparentIndex = -1;
  const frames = [];
  for (;;) {
    if (p >= bytes.length) { throw new Error("GIF ends without a trailer."); }
    const b = bytes[p++];
    if (b === TRAILER) { break; }
    if (b === EXT) {
      const label = bytes[p++];
      const data = readBlocks();
      if (label === 0xf9) {
        delay = (data[1] | (data[2] << 8)) * 10;
        transparentIndex = data[0] & 1 ? data[3] : -1;
      } else if (label === 0xff && String.fromCharCode(...data.subarray(0, 11)) === "NETSCAPE2.0") {
        loop = data[12] | (data[13] << 8);
      }
    } else if (b === IMAGE) {
      p += 8;
      const f = bytes[p++];
      if (f & 0x80) { p += 3 * (1 << ((f & 7) + 1)); }
      const min = bytes[p++];
      const data = readBlocks();
      frames.push({ delay, transparentIndex, indexes: decode ? lzwDecode(data, min) : null });
    } else {
      throw new Error(`Unknown GIF block 0x${b.toString(16)}.`);
    }
  }
  return { width, height, palette, loop, frames };
}
