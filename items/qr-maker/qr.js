/* ============================================================
   QR Maker - a QR code encoder in plain JS

   Byte mode (UTF-8), versions 1 to 40, error correction
   L / M / Q / H, any of the 8 masks (or the best one).
   Follows ISO/IEC 18004. No DOM: unit tested in
   tests/unit/qr-maker.test.js.

     encode(text, { ecl, mask, minVersion, maxVersion })
       -> { version, size, ecl, mask, bytes, modules }
          modules[y][x] === true means a dark square

   The steps, in order:
     1. text -> UTF-8 bytes -> bits (mode, length, data, padding)
     2. pick the smallest version it fits in
     3. split into blocks, add Reed-Solomon error correction,
        interleave
     4. draw the fixed patterns (finders, timing, alignment)
     5. lay the data in a zig-zag, apply a mask, add format
        and version info
   ============================================================ */

export const ECL = { L: 0, M: 1, Q: 2, H: 3 };
export const ECL_NAMES = ["L", "M", "Q", "H"];
/* The 2 format bits for each level (yes, the order is odd). */
const ECL_FORMAT = [1, 0, 3, 2];

/* Error correction codewords per block, by level then version. */
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
];

/* Number of error correction blocks, by level then version. */
const BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
];

const BYTE_MODE = 0b0100;

/* ============================================================
   SIZES + CAPACITY
   ============================================================ */
export function sizeOf(version) { return version * 4 + 17; }

/* Modules left for data + error correction once every fixed
   pattern is drawn. */
export function rawDataModules(version) {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) { n -= 36; }
  }
  return n;
}

export function dataCodewords(version, ecl) {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[ecl][version] * BLOCKS[ecl][version];
}

/* Bits for the length field in byte mode. */
export function countBits(version) { return version <= 9 ? 8 : 16; }

/* How many bytes fit, in byte mode? */
export function byteCapacity(version, ecl) {
  return Math.floor((dataCodewords(version, ecl) * 8 - 4 - countBits(version)) / 8);
}

/* ============================================================
   GALOIS FIELD + REED-SOLOMON (GF(256), polynomial 0x11D)
   ============================================================ */
export function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/* The generator polynomial for `degree` codewords, highest power
   first, leading 1 left out. */
export function rsDivisor(degree) {
  const out = new Array(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < out.length) { out[j] ^= out[j + 1]; }
    }
    root = gfMul(root, 0x02);
  }
  return out;
}

/* The error correction codewords for one block of data. */
export function rsRemainder(data, divisor) {
  const out = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    divisor.forEach((coef, i) => { out[i] ^= gfMul(coef, factor); });
  }
  return out;
}

/* ============================================================
   1-3. DATA CODEWORDS + ERROR CORRECTION
   ============================================================ */
export function utf8(text) { return [...new TextEncoder().encode(String(text))]; }

function pushBits(bits, value, len) {
  for (let i = len - 1; i >= 0; i--) { bits.push((value >>> i) & 1); }
}

/* Mode + length + bytes + terminator + padding, as codewords. */
export function dataCodewordsFor(bytes, version, ecl) {
  const cap = dataCodewords(version, ecl) * 8;
  const bits = [];
  pushBits(bits, BYTE_MODE, 4);
  pushBits(bits, bytes.length, countBits(version));
  for (const b of bytes) { pushBits(bits, b, 8); }
  if (bits.length > cap) { throw new Error("Data too long for this version."); }
  pushBits(bits, 0, Math.min(4, cap - bits.length));        // terminator
  pushBits(bits, 0, (8 - (bits.length % 8)) % 8);           // to a whole byte
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) { pushBits(bits, pad, 8); }
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) { b = (b << 1) | bits[i + j]; }
    out.push(b);
  }
  return out;
}

/* Split into blocks (short ones first), add RS codewords to
   each, then interleave: byte 0 of every block, byte 1, ... */
export function addEccAndInterleave(data, version, ecl) {
  const numBlocks = BLOCKS[ecl][version];
  const eccLen = ECC_PER_BLOCK[ecl][version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);

  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) { dat.push(0); }       // a gap, skipped below
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) { out.push(block[i]); }
    });
  }
  return out;
}

/* ============================================================
   4-5. THE GRID
   ============================================================ */
export function alignmentPositions(version) {
  if (version === 1) { return []; }
  const n = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = sizeOf(version) - 7; out.length < n; pos -= step) { out.splice(1, 0, pos); }
  return out;
}

/* 15 format bits: 2 for the level, 3 for the mask, 10 of BCH
   error correction, then XOR 101010000010010. */
export function formatBits(ecl, mask) {
  const data = (ECL_FORMAT[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) { rem = (rem << 1) ^ ((rem >>> 9) * 0x537); }
  return ((data << 10) | rem) ^ 0x5412;
}

/* 18 version bits (version 7 and up): 6 + 12 of BCH. */
export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) { rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25); }
  return (version << 12) | rem;
}

const bit = (x, i) => ((x >>> i) & 1) !== 0;

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

class Grid {
  constructor(version) {
    this.version = version;
    this.size = sizeOf(version);
    this.dark = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }

  set(x, y, dark) { this.dark[y][x] = dark; this.fixed[y][x] = true; }

  drawPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) {                     // timing lines
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {   // finders + separators
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < n && y >= 0 && y < n) { this.set(x, y, d !== 2 && d !== 4); }
        }
      }
    }
    const pos = alignmentPositions(this.version);
    const last = pos.length - 1;
    pos.forEach((ay, i) => pos.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) { return; }
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) { this.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
      }
    }));
    this.drawFormat(ECL.L, 0);                         // reserve the space; real bits later
    this.drawVersion();
  }

  drawFormat(ecl, mask) {
    const b = formatBits(ecl, mask);
    const n = this.size;
    for (let i = 0; i <= 5; i++) { this.set(8, i, bit(b, i)); }
    this.set(8, 7, bit(b, 6));
    this.set(8, 8, bit(b, 7));
    this.set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) { this.set(14 - i, 8, bit(b, i)); }
    for (let i = 0; i < 8; i++) { this.set(n - 1 - i, 8, bit(b, i)); }
    for (let i = 8; i < 15; i++) { this.set(8, n - 15 + i, bit(b, i)); }
    this.set(8, n - 8, true);                          // the "dark module"
  }

  drawVersion() {
    if (this.version < 7) { return; }
    const b = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      this.set(a, c, bit(b, i));
      this.set(c, a, bit(b, i));
    }
  }

  /* Two columns at a time, right to left, snaking up and down,
     skipping the vertical timing line. */
  drawCodewords(codewords) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) { right = 5; }
      for (let v = 0; v < n; v++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? n - 1 - v : v;
          if (!this.fixed[y][x] && i < codewords.length * 8) {
            this.dark[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    const f = MASKS[mask];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.fixed[y][x] && f(x, y)) { this.dark[y][x] = !this.dark[y][x]; }
      }
    }
  }
}

/* ============================================================
   MASK PENALTY (the four rules from the standard)
   Lower = easier for a camera to read.
   ============================================================ */
const FINDER_LIKE = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
];

export function penalty(dark) {
  const n = dark.length;
  let score = 0;
  const at = (x, y, rows) => (rows ? dark[y][x] : dark[x][y]);

  for (const rows of [true, false]) {
    for (let a = 0; a < n; a++) {
      /* rule 1: five or more in a row */
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && at(b, a, rows) === at(b - 1, a, rows)) {
          run++;
        } else {
          if (run >= 5) { score += 3 + (run - 5); }
          run = 1;
        }
      }
      /* rule 3: looks like a finder pattern */
      for (let b = 0; b + 11 <= n; b++) {
        for (const pat of FINDER_LIKE) {
          let hit = true;
          for (let k = 0; k < 11 && hit; k++) { hit = at(b + k, a, rows) === (pat[k] === 1); }
          if (hit) { score += 40; }
        }
      }
    }
  }
  /* rule 2: 2x2 blocks of one colour */
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const c = dark[y][x];
      if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) { score += 3; }
    }
  }
  /* rule 4: far from half dark */
  let darkCount = 0;
  for (const row of dark) { for (const d of row) { if (d) { darkCount++; } } }
  const pct = (darkCount * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/* ============================================================
   ENCODE
   ============================================================ */
export function encode(text, { ecl = "M", mask = -1, minVersion = 1, maxVersion = 40 } = {}) {
  const level = typeof ecl === "number" ? ecl : ECL[String(ecl).toUpperCase()];
  if (!(level >= 0 && level <= 3)) { throw new Error("Error correction must be L, M, Q or H."); }
  if (!(mask === -1 || (Number.isInteger(mask) && mask >= 0 && mask <= 7))) { throw new Error("Mask must be 0 to 7, or -1 for the best."); }

  const bytes = utf8(text);
  let version = 0;
  for (let v = Math.max(1, minVersion); v <= Math.min(40, maxVersion); v++) {
    if (bytes.length <= byteCapacity(v, level)) { version = v; break; }
  }
  if (!version) {
    const err = new Error(`Too long for a QR code: ${bytes.length} bytes. At level ${ECL_NAMES[level]} the most is ${byteCapacity(40, level)}.`);
    err.code = "too-long";
    throw err;
  }

  const codewords = addEccAndInterleave(dataCodewordsFor(bytes, version, level), version, level);
  const grid = new Grid(version);
  grid.drawPatterns();
  grid.drawCodewords(codewords);

  let chosen = mask;
  if (chosen === -1) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      grid.applyMask(m);
      grid.drawFormat(level, m);
      const p = penalty(grid.dark);
      if (p < best) { best = p; chosen = m; }
      grid.applyMask(m);                  // masking twice undoes it
    }
  }
  grid.applyMask(chosen);
  grid.drawFormat(level, chosen);

  return { version, size: grid.size, ecl: ECL_NAMES[level], mask: chosen, bytes: bytes.length, modules: grid.dark };
}
