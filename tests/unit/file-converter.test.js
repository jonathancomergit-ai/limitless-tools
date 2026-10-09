/* ============================================================
   File Converter - unit tests
   CSV <-> JSON round trips, YAML and XML read/write and their
   errors, the WAV header, the PDF structure (xref offsets),
   the zip, ICO and BMP headers, and file type detection.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, sniffDelimiter, rowsToObjects, objectsToRows, stringifyCSV, typed } from "../../items/file-converter/csv.js";
import { parseYAML, stringifyYAML } from "../../items/file-converter/yaml.js";
import { parseXML, serializeXML, xmlToValue, valueToXML, xmlName } from "../../items/file-converter/xml.js";
import { makePdf, jpegInfo } from "../../items/file-converter/pdf.js";
import { encodeWav, mixToMono } from "../../items/file-converter/wav.js";
import { makeZip, crc32 } from "../../items/file-converter/zip.js";
import { makeIco, readIco, largestEntry, dibToRgba } from "../../items/file-converter/ico.js";
import { makeBmp, hexToRgb } from "../../items/file-converter/bmp.js";
import { detect, detectText, targetsFor, blockedNote, defaultTarget } from "../../items/file-converter/detect.js";
import {
  DEFAULTS, normalizeSettings, parseData, stringifyData, convertText, toTable, records,
  outputName, uniqueNames, formatBytes, icoSizesFor
} from "../../items/file-converter/convert.js";
import { runJob } from "../../items/file-converter/worker.js";

const ascii = (b, at, len) => Buffer.from(b.subarray(at, at + len)).toString("latin1");
const u16 = (b, at) => b[at] | (b[at + 1] << 8);
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const bytes = (...v) => new Uint8Array(v);

/* A tiny but real-shaped JPEG header: SOI, APP0, SOF0 (3 channels), EOI. */
function fakeJpeg(w, h, comps = 3) {
  return bytes(
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 8 + comps * 3, 0x08, h >> 8, h & 255, w >> 8, w & 255, comps,
    ...Array.from({ length: comps }, (_, i) => [i + 1, 0x11, 0]).flat(),
    0xff, 0xd9
  );
}

/* ---- CSV ------------------------------------------------------ */

const TRICKY = 'name,quote,note\r\n"Smith, Ann","She said ""hi""","line one\r\nline two"\r\nBo,plain,"a,b,c"\r\n';

test("CSV with quotes, commas and newlines round-trips through JSON", () => {
  const { text: json } = convertText(TRICKY, "csv", "json");
  const list = JSON.parse(json);
  assert.deepEqual(list, [
    { name: "Smith, Ann", quote: 'She said "hi"', note: "line one\nline two" },
    { name: "Bo", quote: "plain", note: "a,b,c" }
  ]);
  const back = convertText(json, "json", "csv").text;
  assert.deepEqual(parseCSV(back), parseCSV(TRICKY));
  assert.equal(back, TRICKY.replace("line one\r\nline two", "line one\nline two"));
  /* and the CSV of the JSON reads back to the same JSON */
  assert.deepEqual(JSON.parse(convertText(back, "csv", "json").text), list);
});

test("CSV: CRLF, LF and CR line ends; blank lines skipped; BOM dropped", () => {
  assert.deepEqual(parseCSV("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCSV("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCSV("a,b\r1,2\r"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCSV("\uFEFFa\n\n\nb\n"), [["a"], ["b"]]);
  assert.deepEqual(parseCSV('a,""\n'), [["a", ""]]);
  assert.deepEqual(parseCSV(",\n"), [["", ""]]);
});

test("CSV: errors name the line", () => {
  assert.throws(() => parseCSV('a,b\n1,"open\n2,3\n'), (e) => e.line === 2 && /never closed/.test(e.message) && /^Line 2:/.test(e.message));
  assert.throws(() => parseCSV('a\n"x"y\n'), (e) => e.line === 2 && /after a closing quote/.test(e.message));
  assert.throws(() => parseCSV("a", { delimiter: '"' }), /delimiter/);
});

test("CSV: delimiter sniffing", () => {
  assert.equal(sniffDelimiter("a;b;c\n1;2;3\n"), ";");
  assert.equal(sniffDelimiter("a\tb\n1\t2\n"), "\t");
  assert.equal(sniffDelimiter('a,b\n"x;y",2\n'), ",");
  assert.equal(sniffDelimiter("a|b|c\n1|2|3"), "|");
  assert.equal(sniffDelimiter("just one column\nhere"), ",");
  const { value, delimiter } = parseData("x;y\n1,5;2\n", "csv");
  assert.equal(delimiter, ";");
  assert.deepEqual(value, [{ x: "1,5", y: 2 }]);
});

test("CSV: types only for exact forms; headers made unique", () => {
  assert.equal(typed("12"), 12);
  assert.equal(typed("-3.5"), -3.5);
  assert.equal(typed("true"), true);
  for (const s of ["007", "1e3", "+5", " 3", "1.50", "", "NaN", "0x10"]) { assert.equal(typed(s), s, s); }
  assert.deepEqual(rowsToObjects([["a", "", "a"], ["1", "2", "3", "4"]]), [{ a: 1, column_2: 2, a_2: 3, column_4: 4 }]);
  assert.deepEqual(rowsToObjects([["a", "b"], ["1"]]), [{ a: 1, b: "" }]);
});

test("CSV: writing quotes only what needs it", () => {
  assert.equal(stringifyCSV([["a", "b c", "d,e", 'f"g', " h", null, 3, { x: 1 }]]), 'a,b c,"d,e","f""g"," h",,3,"{""x"":1}"\r\n');
  assert.equal(stringifyCSV([["a;b", "c"]], { delimiter: ";", eol: "\n" }), '"a;b";c\n');
  assert.deepEqual(objectsToRows([{ a: 1 }, { b: 2, a: 3 }]), [["a", "b"], [1, undefined], [3, 2]]);
});

/* ---- YAML ----------------------------------------------------- */

const YAML_DOC = `# settings
title: My list   # a comment
count: 3
ratio: 0.5
on: yes
none: ~
quoted: "a: b # not a comment"
single: 'it''s'
tags: [one, "two, three", 4]
point: {x: 1, y: -2}
people:
  - name: Ada
    langs:
      - en
      - fr
  - name: Bo
    langs: []
matrix:
  - - 1
    - 2
  - [3, 4]
list:
- a
- b
note: |
  line 1
  line 2
folded: >-
  one
  two
`;

test("YAML: maps, lists, nesting, scalars, quotes, flow, block text", () => {
  assert.deepEqual(parseYAML(YAML_DOC), {
    title: "My list",
    count: 3,
    ratio: 0.5,
    on: "yes",
    none: null,
    quoted: "a: b # not a comment",
    single: "it's",
    tags: ["one", "two, three", 4],
    point: { x: 1, y: -2 },
    people: [{ name: "Ada", langs: ["en", "fr"] }, { name: "Bo", langs: [] }],
    matrix: [[1, 2], [3, 4]],
    list: ["a", "b"],
    note: "line 1\nline 2\n",
    folded: "one two"
  });
  assert.equal(parseYAML("42"), 42);
  assert.deepEqual(parseYAML("---\n- 1\n- x\n..."), [1, "x"]);
  assert.equal(parseYAML("# only a comment\n"), null);
  assert.equal(parseYAML('"tab\\there \\u00e9"'), "tab\there \u00e9");
});

test("YAML round-trips (value -> text -> value)", () => {
  const v = parseYAML(YAML_DOC);
  assert.deepEqual(parseYAML(stringifyYAML(v)), v);
  const tricky = {
    "": "empty key", "a b": [[], {}, [[1, [2]]]], "true": "true", n: "12", z: "007",
    s: " padded ", m: "multi\nline", c: "x: y", h: "#hash", d: "- dash", e: "", nul: null,
    big: 1e21, neg: -0.25, inf: Infinity, emoji: "caf\u00e9 \u{1F600}"
  };
  assert.deepEqual(parseYAML(stringifyYAML(tricky)), tricky);
  assert.deepEqual(parseYAML(stringifyYAML([{ a: 1, b: { c: [1, 2] } }, "x", null])), [{ a: 1, b: { c: [1, 2] } }, "x", null]);
  assert.equal(stringifyYAML({ a: "plain", b: "12" }), 'a: plain\nb: "12"\n');
});

test("YAML: clear errors with line numbers", () => {
  const cases = [
    ["a: 1\n  b: 2", 2, /indented more/],
    ["a: 1\na: 2", 2, /appears twice/],
    ["a: &x 1", 1, /anchors/],
    ["a: *x", 1, /aliases/],
    ["a: !!str 1", 1, /tags/],
    ['a: 1\nb: "open', 2, /never closed/],
    ["a:\n\t- x", 2, /tabs/],
    ["- a\nb: 1", 2, /unexpected/],
    ["a: 1\n---\nb: 2", 2, /one YAML document/],
    ["a: [1, 2", 1, /expected , or \]/],
    ["just text\nmore: 1", 2, /unexpected|key/]
  ];
  for (const [text, line, re] of cases) {
    assert.throws(() => parseYAML(text), (e) => e.line === line && re.test(e.message) && e.message.startsWith(`Line ${line}:`), JSON.stringify(text));
  }
});

/* ---- XML ------------------------------------------------------ */

const XML_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE catalog [ <!ELEMENT catalog ANY> ]>
<!-- books -->
<catalog owner="Ann &amp; Bo">
  <book id="1">
    <title>Tea &lt;3 &#233;&#x41;</title>
    <price>9.50</price>
  </book>
  <book id="2" lang='en'>
    <title><![CDATA[a < b & c]]></title>
    <price>12</price>
    <gone/>
  </book>
</catalog>`;

test("XML: reads elements, attributes, text, entities, CDATA, self-closing", () => {
  const root = parseXML(XML_DOC);
  assert.equal(root.name, "catalog");
  assert.deepEqual(root.attrs, { owner: "Ann & Bo" });
  assert.deepEqual(xmlToValue(root), {
    catalog: {
      "@owner": "Ann & Bo",
      book: [
        { "@id": 1, title: "Tea <3 \u00e9A", price: "9.50" },
        { "@id": 2, "@lang": "en", title: "a < b & c", price: 12, gone: "" }
      ]
    }
  });
});

test("XML round-trips (XML -> JSON -> XML -> JSON) and escapes on the way out", () => {
  const v = xmlToValue(parseXML(XML_DOC));
  const text = serializeXML(valueToXML(v));
  assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<catalog owner="Ann &amp; Bo">'));
  assert.match(text, /<title>a &lt; b &amp; c<\/title>/);
  assert.match(text, /<gone\/>/);
  assert.deepEqual(xmlToValue(parseXML(text)), v);
  const attr = serializeXML({ name: "a", attrs: { q: 'say "hi"\nnow' }, children: [] }, { declaration: false });
  assert.equal(attr, '<a q="say &quot;hi&quot;&#10;now"/>\n');
  assert.deepEqual(parseXML(attr).attrs, { q: 'say "hi"\nnow' });
});

test("XML from JSON: lists, odd names, a top-level list", () => {
  assert.equal(xmlName("first name"), "first_name");
  assert.equal(xmlName("1st"), "_1st");
  const xml = serializeXML(valueToXML([{ "first name": "Ann", tags: ["a", "b"] }, { "first name": "Bo" }]), { indent: 0, declaration: false });
  assert.equal(xml, "<rows>\n<row>\n<first_name>Ann</first_name>\n<tags>a</tags>\n<tags>b</tags>\n</row>\n<row>\n<first_name>Bo</first_name>\n</row>\n</rows>\n");
  /* a CSV-shaped list comes back as the same rows */
  const rows = [{ a: 1, b: "x" }, { a: 2, b: "y" }];
  assert.deepEqual(records(xmlToValue(parseXML(serializeXML(valueToXML(rows))))), rows);
  /* a several-key object gets a <root> */
  assert.match(serializeXML(valueToXML({ a: 1, b: 2 })), /<root>\n {2}<a>1<\/a>\n {2}<b>2<\/b>\n<\/root>/);
});

test("XML: clear errors with line numbers", () => {
  const cases = [
    ["<a>\n<b>\n</a>", 3, /doesn't match <b>/],
    ["<a>\n  <b/>\n", 3, /never closed/],
    ['<a x=1/>', 1, /needs quotes/],
    ["<a>\n&nbsp;</a>", 2, /unknown entity/],
    ["<a/>\n<b/>", 2, /second root/],
    ["", 1, /no XML element/],
    ["<a x='1' x='2'/>", 1, /appears twice/],
    ["<a>1 < 2</a>", 1, /&lt;/],
    ["<a>AT&T</a>", 1, /&amp;/],
    ["hello <a/>", 1, /before the first element/],
    ["<a/>\ntrailing", 2, /after the end/],
    ["<a>\n<!-- open\n</a>", 2, /comment/]
  ];
  for (const [text, line, re] of cases) {
    assert.throws(() => parseXML(text), (e) => e.line === line && re.test(e.message), JSON.stringify(text));
  }
});

/* ---- the data pipeline ------------------------------------------- */

test("any data format -> any other, via one JS value", () => {
  const value = [{ id: 1, name: "Ann, Jr.", ok: true }, { id: 2, name: 'Bo "B"', ok: false }];
  const formats = ["csv", "json", "xml", "yaml"];
  for (const from of formats) {
    const text = stringifyData(value, from);
    for (const to of formats) {
      const out = convertText(text, from, to).text;
      assert.deepEqual(records(parseData(out, to).value), value, `${from} -> ${to}`);
    }
  }
});

test("JSON errors give a line; empty input is caught", () => {
  assert.throws(() => parseData('{\n  "a": 1,\n  "b": \n}', "json"), (e) => e.line === 4 && /^Line 4: this isn't valid JSON/.test(e.message));
  assert.throws(() => parseData("   ", "csv"), /empty/);
  assert.throws(() => parseData("x", "nope"), /Can't read/);
});

test("the table preview: records found, cells as text, 50 rows max", () => {
  const big = Array.from({ length: 120 }, (_, i) => ({ n: i, tags: [i] }));
  const t = toTable(big, 50);
  assert.deepEqual(t.columns, ["n", "tags"]);
  assert.equal(t.rows.length, 50);
  assert.equal(t.total, 120);
  assert.deepEqual(t.rows[3], ["3", "[3]"]);
  assert.deepEqual(toTable({ people: { person: [{ a: 1 }] } }).rows, [["1"]]);
  assert.deepEqual(toTable([[1, 2], [3]]).columns, ["column_1", "column_2"]);
  assert.deepEqual(toTable([1, "x"]).rows, [["1"], ["x"]]);
  assert.deepEqual(toTable({ a: 1, b: 2 }).rows, [["1", "2"]]);
  assert.equal(stringifyData([{ a: 1 }], "csv", { delimiter: "tab" }), "a\r\n1\r\n");
  assert.equal(stringifyData({ a: [1] }, "json", { jsonIndent: 0 }), '{"a":[1]}\n');
});

/* ---- WAV ------------------------------------------------------ */

test("the WAV header is right (RIFF/WAVE/fmt /data, sizes, rate, block align)", () => {
  const left = new Float32Array([0, 1, -1, 0.5]);
  const right = new Float32Array([0, -1, 1, 2]);      // 2 is clamped
  const w = encodeWav([left, right], 44100);
  assert.equal(ascii(w, 0, 4), "RIFF");
  assert.equal(u32(w, 4), w.length - 8);
  assert.equal(ascii(w, 8, 4), "WAVE");
  assert.equal(ascii(w, 12, 4), "fmt ");
  assert.equal(u32(w, 16), 16);
  assert.equal(u16(w, 20), 1);             // PCM
  assert.equal(u16(w, 22), 2);             // channels
  assert.equal(u32(w, 24), 44100);         // sample rate
  assert.equal(u32(w, 28), 44100 * 4);     // bytes a second
  assert.equal(u16(w, 32), 4);             // block align
  assert.equal(u16(w, 34), 16);            // bits
  assert.equal(ascii(w, 36, 4), "data");
  assert.equal(u32(w, 40), 4 * 4);
  assert.equal(w.length, 44 + 16);
  const s = new DataView(w.buffer);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((k) => s.getInt16(44 + k * 2, true)), [0, 32767, -32768, -32768, 32767, 16384, 32767]);
});

test("WAV: mono mix, odd input", () => {
  const [m] = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 0])]);
  assert.deepEqual([...m], [0.5, 0]);
  const w = encodeWav([new Float32Array(3)], 8000);
  assert.equal(u16(w, 22), 1);
  assert.equal(u16(w, 32), 2);
  assert.equal(u32(w, 28), 16000);
  assert.throws(() => encodeWav([], 44100), /No sound/);
  assert.throws(() => encodeWav([new Float32Array(1)], 0), /sample rate/);
});

/* ---- PDF ------------------------------------------------------ */

test("the PDF starts with %PDF-, ends with %%EOF, and every xref offset points at 'n 0 obj'", () => {
  const pdf = makePdf([fakeJpeg(40, 20), fakeJpeg(8, 8, 1)], { date: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) });
  const text = Buffer.from(pdf).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.endsWith("%%EOF\n"));
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);
  assert.ok(text.startsWith("xref\n", start));
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(start)).map(Number);
  assert.equal(first, 0);
  assert.equal(count, 3 + 2 * 3 + 1);
  const lines = text.slice(start).split("\n").slice(2, 2 + count);
  assert.equal(lines[0], "0000000000 65535 f ");
  for (let id = 1; id < count; id++) {
    const m = /^(\d{10}) 00000 n $/.exec(lines[id]);
    assert.ok(m, `xref line ${id}: ${JSON.stringify(lines[id])}`);
    assert.ok(text.startsWith(`${id} 0 obj\n`, Number(m[1])), `object ${id} isn't at ${m[1]}`);
  }
  assert.match(text, /\/Type \/Pages \/Count 2 \/Kids \[4 0 R 7 0 R\]/);
  assert.match(text, /\/MediaBox \[0 0 30 15\]/);                  // 40 x 20 px at 0.75 pt
  assert.match(text, /\/Width 40 \/Height 20 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode/);
  assert.match(text, /\/ColorSpace \/DeviceGray/);
  assert.match(text, /\/CreationDate \(D:20260102030405Z\)/);
  assert.match(text, /trailer\n<< \/Size 10 \/Root 1 0 R \/Info 3 0 R >>/);
  /* the JPEG bytes are in there untouched */
  assert.ok(Buffer.from(pdf).includes(Buffer.from(fakeJpeg(40, 20))));
  /* the declared stream length is right */
  const len = Number(/\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/.exec(text)[1]);
  assert.equal(len, fakeJpeg(40, 20).length);
});

test("PDF: JPEG size reading and errors", () => {
  assert.deepEqual(jpegInfo(fakeJpeg(300, 200)), { width: 300, height: 200, components: 3 });
  assert.throws(() => jpegInfo(bytes(0x89, 0x50, 0x4e, 0x47)), /isn't a JPEG/);
  assert.throws(() => makePdf([]), /No pictures/);
  assert.throws(() => makePdf([bytes(1, 2, 3)]), /Picture 1/);
});

/* ---- ZIP ------------------------------------------------------ */

test("the ZIP starts with PK\\x03\\x04 and lists every file", () => {
  const zip = makeZip([{ name: "a.json", data: new TextEncoder().encode("[1]") }, { name: "b.csv", data: bytes(1, 2) }]);
  assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const end = zip.length - 22;
  assert.equal(u32(zip, end), 0x06054b50);
  assert.equal(u16(zip, end + 10), 2);
  assert.equal(crc32("123456789"), 0xcbf43926);
  /* the same job through the worker's entry point */
  const viaJob = runJob("zip", { entries: [{ name: "x.txt", data: bytes(65) }] });
  assert.equal(ascii(viaJob, 0, 2), "PK");
  assert.equal(ascii(runJob("pdf", { jpegs: [fakeJpeg(2, 2)] }), 0, 5), "%PDF-");
  assert.equal(ascii(runJob("wav", { channels: [new Float32Array(2), new Float32Array(2)], sampleRate: 22050, mono: true }), 0, 4), "RIFF");
  assert.throws(() => runJob("nope", {}), /Unknown job/);
});

/* ---- ICO ------------------------------------------------------ */

const PNG_HEAD = (w, h) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

test("the ICO header is right, and it reads back", () => {
  const ico = makeIco([{ width: 16, height: 16, data: PNG_HEAD(16, 16) }, { width: 256, height: 256, data: PNG_HEAD(256, 256) }]);
  assert.deepEqual([...ico.subarray(0, 6)], [0, 0, 1, 0, 2, 0]);
  assert.equal(ico[6], 16);                     // width
  assert.equal(ico[6 + 16], 0);                 // 256 is written as 0
  assert.equal(u16(ico, 6 + 4), 1);             // planes
  assert.equal(u16(ico, 6 + 6), 32);            // bits
  assert.equal(u32(ico, 6 + 8), 33);            // size
  assert.equal(u32(ico, 6 + 12), 6 + 32);       // first offset
  assert.equal(u32(ico, 6 + 16 + 12), 6 + 32 + 33);
  const { type, entries } = readIco(ico);
  assert.equal(type, 1);
  assert.deepEqual(entries.map((e) => [e.width, e.height, e.isPng]), [[16, 16, true], [256, 256, true]]);
  assert.equal(largestEntry(entries).width, 256);
  assert.throws(() => readIco(bytes(1, 2, 3, 4, 5, 6)), /isn't an .ico/);
  assert.throws(() => makeIco([{ width: 300, height: 300, data: bytes(1) }]), /256/);
});

test("ICO: old-style 32-bit and 1-bit (with AND mask) pictures decode to RGBA", () => {
  /* 2 x 2, 32-bit BGRA, rows bottom-up; mask ignored because alpha is used */
  const h32 = new Uint8Array(40 + 16 + 8);
  const v = new DataView(h32.buffer);
  v.setUint32(0, 40, true); v.setInt32(4, 2, true); v.setInt32(8, 4, true); v.setUint16(12, 1, true); v.setUint16(14, 32, true);
  h32.set([255, 0, 0, 255, 0, 255, 0, 128], 40);        // bottom row: blue, half green
  h32.set([0, 0, 255, 255, 0, 0, 0, 0], 48);            // top row: red, clear
  const a = dibToRgba(h32);
  assert.deepEqual([a.width, a.height], [2, 2]);
  assert.deepEqual([...a.rgba], [255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 255, 0, 128]);

  /* 2 x 1, 1-bit: palette black/white, pixels [white, black], mask clears the 2nd */
  const h1 = new Uint8Array(40 + 8 + 4 + 4);
  const w = new DataView(h1.buffer);
  w.setUint32(0, 40, true); w.setInt32(4, 2, true); w.setInt32(8, 2, true); w.setUint16(12, 1, true); w.setUint16(14, 1, true);
  h1.set([0, 0, 0, 0, 255, 255, 255, 0], 40);
  h1[48] = 0b10000000;                                    // pixel 0 = index 1 (white)
  h1[52] = 0b01000000;                                    // mask: pixel 1 see-through
  assert.deepEqual([...dibToRgba(h1).rgba], [255, 255, 255, 255, 0, 0, 0, 0]);
});

/* ---- BMP ------------------------------------------------------ */

test("the BMP header is right; rows bottom-up, padded, alpha on the background", () => {
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255,   0, 255, 0, 0,     // top row: red, clear
    0, 0, 255, 255,   255, 255, 255, 128 // bottom row: blue, half white
  ]);
  const b = makeBmp(rgba, 2, 2, { background: [0, 0, 0] });
  assert.equal(ascii(b, 0, 2), "BM");
  assert.equal(u32(b, 2), b.length);
  assert.equal(u32(b, 10), 54);
  assert.equal(u32(b, 14), 40);
  assert.equal(u32(b, 18), 2);
  assert.equal(u32(b, 22), 2);
  assert.equal(u16(b, 26), 1);
  assert.equal(u16(b, 28), 24);
  assert.equal(u32(b, 34), 8 * 2);              // 6 bytes a row, padded to 8
  assert.equal(b.length, 54 + 16);
  assert.deepEqual([...b.subarray(54, 60)], [255, 0, 0, 128, 128, 128]);   // bottom row first, BGR
  assert.deepEqual([...b.subarray(62, 68)], [0, 0, 255, 0, 0, 0]);         // top row: red, clear -> black
  assert.deepEqual(hexToRgb("#1a2b3c"), [26, 43, 60]);
  assert.deepEqual(hexToRgb("nope"), [255, 255, 255]);
});

/* ---- detect --------------------------------------------------- */

test("detect(): magic bytes first, then MIME, then the name", () => {
  const d = (head, name = "", type = "") => detect({ head: Uint8Array.from(head), name, type });
  const str = (s) => [...Buffer.from(s, "latin1")];
  assert.equal(d([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10], "photo.jpg").format, "png");     // bytes beat the name
  assert.equal(d([0xff, 0xd8, 0xff, 0xe0]).format, "jpg");
  assert.equal(d(str("RIFF\0\0\0\0WEBPVP8 ")).format, "webp");
  assert.equal(d(str("RIFF\0\0\0\0WAVEfmt ")).kind, "audio");
  assert.equal(d([0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0]).format, "bmp");
  assert.equal(d([0, 0, 1, 0, 1, 0]).format, "ico");
  assert.equal(d(str("ID3\x03")).format, "mp3");
  assert.equal(d(str("OggS\0")).format, "ogg");
  assert.equal(d(str("fLaC")).format, "flac");
  assert.equal(d(str("\0\0\0\x20ftypM4A ")).format, "m4a");
  assert.equal(d(str("\0\0\0\x20ftypisom"), "clip.mp4").kind, "video");
  assert.equal(d(str("\0\0\0\x20ftypheic")).format, "heic");
  assert.equal(d([0x1a, 0x45, 0xdf, 0xa3], "a.webm", "video/webm").kind, "video");
  assert.equal(d([0x1a, 0x45, 0xdf, 0xa3], "a.weba", "audio/webm").kind, "audio");
  assert.equal(d(str("%PDF-1.7")).format, "pdf");
  assert.equal(d(str("a,b\n1,2"), "data.csv").format, "csv");
  assert.equal(d(str("a: 1"), "conf.yml").format, "yaml");
  assert.equal(d(str("{}"), "", "application/json").format, "json");
  assert.equal(d(str("hello"), "notes.txt").kind, "text");
  assert.equal(d([0, 1, 2, 3, 0, 9], "x.bin").kind, "other");
});

test("detectText(): CSV, JSON, XML or YAML", () => {
  assert.equal(detectText('{"a": 1}'), "json");
  assert.equal(detectText("[1, 2"), "json");                  // broken JSON is still JSON (its error helps)
  assert.equal(detectText("  <?xml version='1.0'?><a/>"), "xml");
  assert.equal(detectText("name: Ann\nage: 3\n"), "yaml");
  assert.equal(detectText("---\n- a\n- b\n"), "yaml");
  assert.equal(detectText("# list\n- a\n- b"), "yaml");
  assert.equal(detectText('name,age\n"Ann, Jr.",3\n'), "csv");
  assert.equal(detectText("a;b\n1;2"), "csv");
  assert.equal(detectText(""), null);
});

test("targets: only formats that make sense; MP3 and video out are shown but can't be picked", () => {
  const vals = (det) => targetsFor(det).filter((t) => !t.disabled).map((t) => t.value);
  assert.deepEqual(vals({ kind: "image", format: "png" }), ["jpg", "webp", "bmp", "ico", "pdf"]);
  assert.deepEqual(vals({ kind: "image", format: "gif" }), ["png", "jpg", "webp", "bmp", "ico", "pdf"]);
  assert.deepEqual(vals({ kind: "data", format: "csv" }), ["json", "xml", "yaml"]);
  assert.deepEqual(vals({ kind: "audio", format: "mp3" }), ["wav"]);
  assert.ok(targetsFor({ kind: "audio", format: "ogg" }).some((t) => t.value === "mp3" && t.disabled));
  assert.deepEqual(vals({ kind: "video", format: "mp4" }), ["wav"]);
  assert.deepEqual(vals({ kind: "other", format: "pdf" }), []);
  assert.match(blockedNote({ kind: "video", format: "mp4" }), /Video can't be converted here/);
  assert.match(blockedNote({ kind: "other", format: "heic" }), /HEIC/);
  assert.equal(blockedNote({ kind: "image", format: "png" }), "");
  assert.equal(defaultTarget({ kind: "data", format: "csv" }), "json");
  assert.equal(defaultTarget({ kind: "data", format: "csv" }, { csv: "yaml" }), "yaml");
  assert.equal(defaultTarget({ kind: "data", format: "csv" }, { csv: "csv" }), "json");
  assert.equal(defaultTarget({ kind: "image", format: "png" }), "webp");
  assert.equal(defaultTarget({ kind: "other", format: "" }), "");
});

/* ---- settings and names ------------------------------------------ */

test("settings: defaults, clamping, junk thrown away", () => {
  assert.deepEqual(normalizeSettings({}), { ...DEFAULTS, icoSizes: [16, 32, 48] });
  const n = normalizeSettings({
    quality: 500, background: "red", icoSizes: [48, 16, 17, 16], delimiter: "nope", jsonIndent: 3,
    sampleRate: 12345, mono: 1, targets: { csv: "json", "x y": "z", png: 5 }
  });
  assert.equal(n.quality, 100);
  assert.equal(n.background, "#ffffff");
  assert.deepEqual(n.icoSizes, [16, 48]);
  assert.equal(n.delimiter, "auto");
  assert.equal(n.jsonIndent, 2);
  assert.equal(n.sampleRate, 44100);
  assert.equal(n.mono, true);
  assert.deepEqual(n.targets, { csv: "json" });
  assert.deepEqual(icoSizesFor({ icoSizes: [16], icoSource: true }, 100, 60), [16, 100]);
  assert.deepEqual(icoSizesFor({ icoSizes: [], icoSource: true }, 1000, 600), [256]);
});

test("names and sizes", () => {
  assert.equal(outputName("photo.final.JPG", "webp"), "photo.final.webp");
  assert.equal(outputName("data.csv", "yaml"), "data.yaml");
  assert.equal(outputName("data.json", "csv", { tab: true }), "data.tsv");
  assert.equal(outputName("song.mp3", "wav"), "song.wav");
  assert.equal(outputName("a/b:c.png", "jpg"), "a_b_c.jpg");
  assert.deepEqual(uniqueNames(["a.png", "a.png", "A.png", "b"]), ["a.png", "a-2.png", "A-3.png", "b"]);
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});
