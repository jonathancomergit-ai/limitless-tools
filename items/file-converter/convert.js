/* ============================================================
   File Converter - the data pipeline + settings + names

   Any of CSV / JSON / XML / YAML -> a plain JS value -> any other.

     parseData(text, "csv", { delimiter })   -> { value, delimiter }
     stringifyData(value, "yaml", settings)  -> text
     convertText(text, from, to, settings)   -> { text, value }
     toTable(value, 50)                      -> { columns, rows, total }

   CSV is a table, so a value becomes a table like this:
     a list of objects   -> one row each, columns = every key
     a list of lists     -> as it is
     a list of values    -> one "value" column
     an object holding one list (e.g. XML <rows><row>...)  -> that list
     any other object    -> one row
   Cells that hold a list or object are written as JSON text.

   Also: the saved settings (DEFAULTS, normalizeSettings), output
   file names, and byte sizes. Pure functions, no DOM: unit
   tested in tests/unit/file-converter.test.js.
   ============================================================ */

import { parseCSV, sniffDelimiter, rowsToObjects, objectsToRows, stringifyCSV, cellText } from "./csv.js";
import { parseYAML, stringifyYAML } from "./yaml.js";
import { parseXML, serializeXML, xmlToValue, valueToXML } from "./xml.js";
import { FORMATS } from "./detect.js";

const ICO_DEFAULT = [16, 32, 48];

/* ---- settings ----------------------------------------------- */

export const DELIMS = { auto: "", comma: ",", semicolon: ";", tab: "\t", pipe: "|" };

export const DEFAULTS = Object.freeze({
  targets: {},            // last chosen target for each source format: { csv: "json" }
  quality: 85,            // JPEG / WebP quality, 1-100
  background: "#ffffff",  // for formats without see-through (JPG, BMP, PDF)
  icoSizes: ICO_DEFAULT,  // sizes inside a made .ico
  icoSource: false,       // also put the picture's own size in (if 256 or less)
  delimiter: "auto",      // CSV: auto | comma | semicolon | tab | pipe
  jsonIndent: 2,          // 0 = one line
  sampleRate: 44100,      // WAV out
  mono: false
});

const clamp = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const RATES = [8000, 16000, 22050, 32000, 44100, 48000, 96000];
const ICO_OK = [16, 24, 32, 48, 64, 128, 256];

export function normalizeSettings(s = {}) {
  const d = DEFAULTS;
  const targets = {};
  if (s.targets && typeof s.targets === "object" && !Array.isArray(s.targets)) {
    for (const [k, v] of Object.entries(s.targets)) {
      if (/^[a-z0-9]{2,5}$/.test(k) && typeof v === "string" && /^[a-z0-9]{2,5}$/.test(v)) { targets[k] = v; }
    }
  }
  const sizes = Array.isArray(s.icoSizes) ? [...new Set(s.icoSizes.map(Number).filter((v) => ICO_OK.includes(v)))].sort((a, b) => a - b) : [...d.icoSizes];
  return {
    targets,
    quality: clamp(s.quality, 1, 100, d.quality),
    background: /^#[0-9a-f]{6}$/i.test(s.background || "") ? s.background.toLowerCase() : d.background,
    icoSizes: sizes.length || s.icoSource ? sizes : [...d.icoSizes],
    icoSource: Boolean(s.icoSource),
    delimiter: Object.hasOwn(DELIMS, s.delimiter) ? s.delimiter : d.delimiter,
    jsonIndent: [0, 2, 4].includes(Number(s.jsonIndent)) ? Number(s.jsonIndent) : d.jsonIndent,
    sampleRate: RATES.includes(Number(s.sampleRate)) ? Number(s.sampleRate) : d.sampleRate,
    mono: Boolean(s.mono)
  };
}

/* ---- parse + write ------------------------------------------ */

/* JSON.parse's errors differ from browser to browser, and some
   don't say where. So when it fails, this walks the text itself
   to find the first problem: { pos, why }. */
export function jsonProblem(text) {
  const s = text;
  let i = 0;
  const ws = () => { while (i < s.length && " \t\n\r".includes(s[i])) { i++; } };
  const what = () => (i >= s.length ? "the end came too soon" : `unexpected ${JSON.stringify(s[i])}`);
  const bad = (why) => { const e = new Error(why); e.pos = i; throw e; };
  function value() {
    ws();
    const c = s[i];
    if (c === "{") {
      i++; ws();
      if (s[i] === "}") { i++; return; }
      for (;;) {
        ws();
        if (s[i] !== '"') { bad(`${what()}: a key must be in "double quotes"`); }
        string();
        ws();
        if (s[i] !== ":") { bad(`${what()}: expected a : after the key`); }
        i++;
        value();
        ws();
        if (s[i] === ",") { i++; ws(); if (s[i] === "}") { bad("a comma before } (trailing commas aren't allowed)"); } continue; }
        if (s[i] === "}") { i++; return; }
        bad(`${what()}: expected , or }`);
      }
    }
    if (c === "[") {
      i++; ws();
      if (s[i] === "]") { i++; return; }
      for (;;) {
        value();
        ws();
        if (s[i] === ",") { i++; ws(); if (s[i] === "]") { bad("a comma before ] (trailing commas aren't allowed)"); } continue; }
        if (s[i] === "]") { i++; return; }
        bad(`${what()}: expected , or ]`);
      }
    }
    if (c === '"') { string(); return; }
    const m = /^(-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?|true|false|null)/.exec(s.slice(i, i + 400));
    if (m) { i += m[0].length; return; }
    if (c === "'") { bad("strings need \"double quotes\", not 'single'"); }
    bad(`${what()}: expected a value`);
  }
  function string() {
    i++;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"') { i++; return; }
      if (ch === "\n") { bad("a string can't run over a line break (use \\n)"); }
      if (ch === "\\") {
        if (!/^(["\\/bfnrt]|u[0-9a-fA-F]{4})/.test(s.slice(i + 1, i + 6))) { bad("a bad \\ escape in a string"); }
        i += s[i + 1] === "u" ? 6 : 2;
        continue;
      }
      i++;
    }
    bad("a string is never closed");
  }
  try {
    value();
    ws();
    if (i < s.length) { bad(`${what()} after the end of the JSON`); }
  } catch (err) {
    return { pos: err.pos ?? i, why: err.message };
  }
  return null;
}

function jsonError(err, text) {
  const p = jsonProblem(text);
  const line = p ? text.slice(0, p.pos).split("\n").length : 0;
  const why = p ? p.why : String(err && err.message || "syntax error");
  const e = new Error(`${line ? `Line ${line}: ` : ""}this isn't valid JSON (${why}).`);
  if (line) { e.line = line; }
  return e;
}

export function parseData(text, format, { delimiter = "auto", types = true } = {}) {
  const src = String(text ?? "").replace(/^\ufeff/, "");
  if (!src.trim()) { throw new Error("It's empty: there's nothing to convert."); }
  if (format === "csv") {
    const d = DELIMS[delimiter] || (delimiter.length === 1 ? delimiter : "") || sniffDelimiter(src);
    const rows = parseCSV(src, { delimiter: d });
    return { value: rowsToObjects(rows, { types }), delimiter: d, rows };
  }
  if (format === "json") {
    try { return { value: JSON.parse(src) }; } catch (err) { throw jsonError(err, src); }
  }
  if (format === "xml") { return { value: xmlToValue(parseXML(src), { types }) }; }
  if (format === "yaml") { return { value: parseYAML(src) }; }
  throw new Error(`Can't read ${format || "that"} as data.`);
}

/* Find the list of records inside a value (see the top). */
export function records(value, depth = 0) {
  if (Array.isArray(value)) { return value; }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && depth < 4) {
      const inner = value[keys[0]];
      if (Array.isArray(inner)) { return inner; }
      if (inner && typeof inner === "object") { return records(inner, depth + 1); }
    }
    /* An object with exactly one list of objects in it (like an XML root). */
    const lists = keys.filter((k) => Array.isArray(value[k]) && value[k].some((v) => v && typeof v === "object"));
    const plain = keys.filter((k) => !k.startsWith("@"));
    if (lists.length === 1 && plain.length === 1) { return value[lists[0]]; }
    return [value];
  }
  return [value];
}

/* A value -> header + rows of cells (for CSV and the preview). */
export function tableRows(value) {
  const list = records(value);
  if (!list.length) { return [[]]; }
  if (list.every((v) => Array.isArray(v))) {
    const width = Math.max(0, ...list.map((r) => r.length));
    return [Array.from({ length: width }, (_, i) => `column_${i + 1}`), ...list];
  }
  if (list.every((v) => v && typeof v === "object")) { return objectsToRows(list); }
  return [["value"], ...list.map((v) => [v && typeof v === "object" ? JSON.stringify(v) : v])];
}

export function toTable(value, limit = 50) {
  const [columns, ...rows] = tableRows(value);
  return { columns: columns.map(String), rows: rows.slice(0, limit).map((r) => columns.map((_, i) => cellText(r[i]))), total: rows.length };
}

export function stringifyData(value, format, settings = {}) {
  const s = normalizeSettings(settings);
  if (format === "json") { return `${JSON.stringify(value, null, s.jsonIndent || undefined)}\n`; }
  if (format === "yaml") { return stringifyYAML(value); }
  if (format === "xml") { return serializeXML(valueToXML(value)); }
  if (format === "csv") {
    const d = DELIMS[s.delimiter] || ",";
    return stringifyCSV(tableRows(value), { delimiter: d });
  }
  throw new Error(`Can't write ${format || "that"}.`);
}

export function convertText(text, from, to, settings = {}) {
  const s = normalizeSettings(settings);
  const { value } = parseData(text, from, { delimiter: s.delimiter });
  /* CSV -> CSV keeps the reader's delimiter unless one was chosen. */
  return { value, text: stringifyData(value, to, s) };
}

/* ---- names and sizes ------------------------------------------ */

export function baseName(name) {
  const b = String(name || "file").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[\\/:*?"<>|\0-\x1f]+/g, "_").trim();
  return b || "file";
}

export function outputName(name, format, { tab = false } = {}) {
  const ext = format === "csv" && tab ? "tsv" : FORMATS[format] ? FORMATS[format].ext : format;
  return `${baseName(name)}.${ext}`;
}

/* Make every name in a zip different: a.png, a-2.png, a-3.png */
export function uniqueNames(names) {
  const seen = new Set();
  return names.map((n) => {
    let name = n;
    const m = /^(.*?)(\.[^.]*)?$/.exec(n);
    let k = 2;
    while (seen.has(name.toLowerCase())) { name = `${m[1]}-${k}${m[2] || ""}`; k++; }
    seen.add(name.toLowerCase());
    return name;
  });
}

export function formatBytes(n) {
  if (!(n >= 0)) { return ""; }
  if (n < 1024) { return `${n} B`; }
  if (n < 1024 * 1024) { return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`; }
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ICO sizes to make: the chosen ones, plus the picture's own size. */
export function icoSizesFor(settings, w, h) {
  const s = normalizeSettings(settings);
  const sizes = new Set(s.icoSizes);
  if (s.icoSource) { sizes.add(Math.min(256, Math.max(w, h))); }
  if (!sizes.size) { sizes.add(32); }
  return [...sizes].sort((a, b) => a - b);
}
