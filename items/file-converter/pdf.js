/* ============================================================
   File Converter - a tiny PDF writer: pictures in, one PDF out

   One JPEG a page. The page is exactly the size of its picture
   (1 pixel = 0.75 pt, i.e. 96 pixels an inch), so nothing is
   cropped or stretched. The JPEG bytes go in as they are
   (/Filter /DCTDecode): PDF readers decode JPEG themselves, so
   there's no re-encoding and no extra loss.

   The file, object by object:
     1  Catalog     -> 2
     2  Pages       -> each Page
     3  Info        (who made it)
     then for each picture:  Page, Image XObject, content stream
     xref table     the byte offset of every object
     trailer        /Root, /Info, /Size, startxref, %%EOF

   makePdf([jpegBytes, ...]) -> Uint8Array
   jpegInfo(bytes)           -> { width, height, components }

   Pure functions, no DOM: unit tested in tests/unit/file-converter.test.js.
   ============================================================ */

/* Width, height and colour channels from a JPEG's SOF marker. */
export function jpegInfo(bytes) {
  const b = bytes;
  if (!(b && b.length > 4 && b[0] === 0xff && b[1] === 0xd8)) { throw new Error("That isn't a JPEG."); }
  let p = 2;
  while (p + 4 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const marker = b[p + 1];
    if (marker === 0xff) { p++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const len = (b[p + 2] << 8) | b[p + 3];
    /* SOF0..SOF15, but not DHT (C4), JPG (C8) or DAC (CC). */
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (b[p + 5] << 8) | b[p + 6],
        width: (b[p + 7] << 8) | b[p + 8],
        components: b[p + 9]
      };
    }
    if (marker === 0xda || marker === 0xd9) { break; }
    p += 2 + len;
  }
  throw new Error("Couldn't find the size of that JPEG.");
}

const enc = new TextEncoder();
const PT_PER_PX = 0.75;
const num = (v) => String(Math.round(v * 100) / 100);

/* A PDF text string: (like this), with \ ( ) escaped, ASCII only. */
function pdfString(s) {
  return `(${String(s).replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

export function makePdf(jpegs, { title = "Pictures", producer = "Limitless Workshop File Converter", date = new Date() } = {}) {
  if (!Array.isArray(jpegs) || !jpegs.length) { throw new Error("No pictures to put in the PDF."); }
  const pages = jpegs.map((data, k) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let info;
    try { info = jpegInfo(bytes); } catch (err) { throw new Error(`Picture ${k + 1}: ${err.message}`); }
    return { bytes, ...info };
  });

  const chunks = [];
  let size = 0;
  const offsets = [];       // offsets[objectNumber] = byte position
  const put = (x) => {
    const b = typeof x === "string" ? enc.encode(x) : x;
    chunks.push(b);
    size += b.length;
  };
  const obj = (id, body) => {
    offsets[id] = size;
    put(`${id} 0 obj\n`);
    if (Array.isArray(body)) { body.forEach(put); } else { put(body); }
    put("\nendobj\n");
  };

  const count = pages.length;
  const total = 3 + count * 3;    // objects 1..total
  const pageId = (k) => 4 + k * 3;
  const pad = (v) => String(v).padStart(2, "0");
  const d = `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

  /* Header + a comment of 4 high bytes, which tells tools "binary inside". */
  put("%PDF-1.4\n");
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${count} /Kids [${pages.map((_, k) => `${pageId(k)} 0 R`).join(" ")}] >>`);
  obj(3, `<< /Title ${pdfString(title)} /Producer ${pdfString(producer)} /CreationDate ${pdfString(d)} >>`);

  pages.forEach((pg, k) => {
    const id = pageId(k);
    const w = pg.width * PT_PER_PX;
    const h = pg.height * PT_PER_PX;
    const space = pg.components === 1 ? "/DeviceGray" : pg.components === 4 ? "/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]" : "/DeviceRGB";
    const draw = `q ${num(w)} 0 0 ${num(h)} 0 0 cm /Im0 Do Q`;
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w)} ${num(h)}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> /ProcSet [/PDF /ImageC /ImageB] >> /Contents ${id + 2} 0 R >>`);
    obj(id + 1, [
      `<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`,
      pg.bytes,
      "\nendstream"
    ]);
    obj(id + 2, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  });

  /* xref: one 20-byte line an object ("0000000123 00000 n \n"). */
  const xref = size;
  let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) { table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`; }
  put(table);
  put(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
