/* ============================================================
   File Converter - big and odd inputs
   Long CSVs and lists must not overflow the stack, and a crafted
   icon header must not make the reader loop for ever.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV } from "../../items/file-converter/csv.js";
import { dibToRgba } from "../../items/file-converter/ico.js";
import { convertText, toTable } from "../../items/file-converter/convert.js";

test("big inputs: a 200,000-row CSV converts (no stack overflow)", () => {
  const n = 200_000;                    // past the point where spreading this many arguments overflows
  let csv = "id,name,score\n";
  for (let i = 0; i < n; i++) { csv += `${i},row ${i},${i % 7}\n`; }
  const { value, text } = convertText(csv, "csv", "json");
  assert.equal(value.length, n);
  assert.deepEqual(JSON.parse(text)[n - 1], { id: n - 1, name: `row ${n - 1}`, score: (n - 1) % 7 });
  assert.equal(parseCSV(convertText(csv, "csv", "csv").text).length, n + 1);
  assert.equal(toTable(parseCSV(csv)).total, n + 1);                         // a list of arrays
  const yaml = convertText(JSON.stringify({ rows: Array.from({ length: n }, (_, i) => i) }), "json", "yaml").text;
  assert.equal(yaml.split("\n").length, n + 2);
});

test("ICO: a header claiming a huge palette doesn't hang", () => {
  const w = 2;
  const h = 2;
  const d = new Uint8Array(40 + 2 * 4 + 4 * h + 4 * h);
  const v = new DataView(d.buffer);
  v.setUint32(0, 40, true);
  v.setInt32(4, w, true);
  v.setInt32(8, h * 2, true);
  v.setUint16(12, 1, true);
  v.setUint16(14, 1, true);               // 1 bit: 2 colours at most
  v.setUint32(32, 0xffffffff, true);      // ...but it claims 4 billion
  d.set([0, 0, 0, 0, 255, 255, 255, 0], 40);
  d[48] = 0b01000000;                     // bottom row: black, white
  const t = Date.now();
  const { rgba } = dibToRgba(d);
  assert.ok(Date.now() - t < 1000);
  assert.equal(rgba.length, w * h * 4);
  assert.deepEqual([...rgba.subarray(8, 12)], [0, 0, 0, 255]);             // bottom row: black, white
  assert.deepEqual([...rgba.subarray(12, 16)], [255, 255, 255, 255]);
});
