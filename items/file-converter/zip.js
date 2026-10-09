/* ============================================================
   File Converter - a tiny store-only .zip writer (copied from Image Squisher)

   No compression ("stored"), because the images inside are
   already compressed: deflating a JPEG or WebP saves next to
   nothing and costs time on a phone.

   A zip file is just:
     [local header + file data] for each file
     [central directory entry] for each file
     [end of central directory record]

   All numbers are little-endian. Names are UTF-8 (flag bit 11).
   Pure functions, no DOM: unit tested in tests/unit/file-converter.test.js.
   ============================================================ */

export const SIG_LOCAL = 0x04034b50;
export const SIG_CENTRAL = 0x02014b50;
export const SIG_END = 0x06054b50;

const UTF8_FLAG = 0x0800;
const VERSION = 20;           // 2.0: the plain old format everyone reads
const MAX_ENTRIES = 0xffff;   // no zip64 here
const MAX_BYTES = 0xffffffff;

/* ---- CRC-32 (the zip / PNG one, polynomial 0xEDB88320) ---- */
let TABLE = null;
function table() {
  if (TABLE) { return TABLE; }
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    TABLE[n] = c >>> 0;
  }
  return TABLE;
}

/* crc32(bytes) -> unsigned 32-bit number. Strings are read as UTF-8. */
export function crc32(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) { c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); }
  return (c ^ 0xffffffff) >>> 0;
}

/* MS-DOS time and date, the way zip stores them (2-second steps,
   years from 1980). Uses local time, like every zip tool. */
export function dosDateTime(d = new Date()) {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/* entries: [{ name: "a.webp", data: Uint8Array }]
   Returns the whole .zip as one Uint8Array. */
export function makeZip(entries, { date = new Date() } = {}) {
  if (!Array.isArray(entries) || !entries.length) { throw new Error("Nothing to zip."); }
  if (entries.length > MAX_ENTRIES) { throw new Error("Too many files for one zip."); }

  const enc = new TextEncoder();
  const { time, date: day } = dosDateTime(date);

  const files = entries.map((e) => {
    const name = enc.encode(String(e.name || "file"));
    const data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data);
    return { name, data, crc: crc32(data) };
  });

  const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
  const total = localSize + centralSize + 22;
  if (total > MAX_BYTES) { throw new Error("That's too much for one zip. Try fewer files."); }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (v) => { view.setUint16(p, v, true); p += 2; };
  const u32 = (v) => { view.setUint32(p, v >>> 0, true); p += 4; };
  const bytes = (b) => { out.set(b, p); p += b.length; };

  /* ---- local headers + data ---- */
  const offsets = [];
  for (const f of files) {
    offsets.push(p);
    u32(SIG_LOCAL);
    u16(VERSION);          // version needed
    u16(UTF8_FLAG);        // flags
    u16(0);                // method: stored
    u16(time);
    u16(day);
    u32(f.crc);
    u32(f.data.length);    // compressed size
    u32(f.data.length);    // uncompressed size
    u16(f.name.length);
    u16(0);                // extra length
    bytes(f.name);
    bytes(f.data);
  }

  /* ---- central directory ---- */
  const centralStart = p;
  files.forEach((f, i) => {
    u32(SIG_CENTRAL);
    u16(VERSION);          // version made by
    u16(VERSION);          // version needed
    u16(UTF8_FLAG);
    u16(0);
    u16(time);
    u16(day);
    u32(f.crc);
    u32(f.data.length);
    u32(f.data.length);
    u16(f.name.length);
    u16(0);                // extra
    u16(0);                // comment
    u16(0);                // disk number
    u16(0);                // internal attributes
    u32(0);                // external attributes
    u32(offsets[i]);
    bytes(f.name);
  });

  /* ---- end record ---- */
  u32(SIG_END);
  u16(0);                  // this disk
  u16(0);                  // disk with the directory
  u16(files.length);
  u16(files.length);
  u32(centralSize);
  u32(centralStart);
  u16(0);                  // comment length

  return out;
}
