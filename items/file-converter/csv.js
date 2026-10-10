/* ============================================================
   File Converter - CSV (RFC 4180), read and write

   CSV in one breath:
     - one record a line; fields split by the delimiter
     - a field may be wrapped in "double quotes"; then it can
       hold the delimiter, line breaks, and "" for one quote
     - lines end in CRLF (we read CRLF, LF and lone CR alike)

   parseCSV(text, { delimiter })   -> [["a","b"], ["1","2"]]
   sniffDelimiter(text)            -> "," ";" "\t" or "|"
   rowsToObjects(rows)             -> [{ a: 1, b: 2 }]   (header row = keys)
   objectsToRows(list)             -> [["a","b"], [1, 2]]
   stringifyCSV(rows, { delimiter, eol })

   Errors are thrown as Error with .line (1-based), and the
   message starts "Line N:". Pure functions, no DOM: unit tested
   in tests/unit/file-converter.test.js.
   ============================================================ */

export const DELIMITERS = [",", ";", "\t", "|"];

function fail(message, line) {
  const err = new Error(`Line ${line}: ${message}`);
  err.line = line;
  return err;
}

/* Read CSV text into rows of strings. Blank lines are skipped. */
export function parseCSV(text, { delimiter = "," } = {}) {
  const src = String(text ?? "").replace(/^\ufeff/, "");
  const d = delimiter;
  if (typeof d !== "string" || d.length !== 1 || d === '"' || d === "\n" || d === "\r") {
    throw new Error("The delimiter must be one character (not a quote or a line break).");
  }
  const rows = [];
  let row = [];
  let field = "";
  let line = 1;          // the line we're on now
  let quoted = false;    // inside "..."
  let quoteLine = 0;     // where the open quote started
  let wasQuoted = false; // this field had quotes (so it ends at the next delimiter)
  let rowQuoted = false; // this record had a quoted field (so "" is a real, empty record)
  let i = 0;
  const n = src.length;

  const endField = () => { row.push(field); field = ""; wasQuoted = false; };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "" && !rowQuoted)) { rows.push(row); }
    row = [];
    rowQuoted = false;
  };

  while (i < n) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
        i++;
        /* After a closing quote: only a delimiter or a line end. */
        const next = src[i];
        if (i < n && next !== d && next !== "\n" && next !== "\r") {
          throw fail(`unexpected ${JSON.stringify(next)} after a closing quote. Put quotes round the whole field, and double any quote inside it ("").`, line);
        }
        continue;
      }
      if (c === "\r") {
        if (src[i + 1] === "\n") { i++; }
        field += "\n";
        line++;
        i++;
        continue;
      }
      if (c === "\n") { line++; }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field === "" && !wasQuoted) {
        quoted = true;
        wasQuoted = true;
        rowQuoted = true;
        quoteLine = line;
        i++;
        continue;
      }
      /* A stray quote in the middle of a plain field: keep it, as most tools do. */
      field += c;
      i++;
      continue;
    }
    if (c === d) { endField(); i++; continue; }
    if (c === "\r" || c === "\n") {
      endRow();
      if (c === "\r" && src[i + 1] === "\n") { i++; }
      i++;
      line++;
      continue;
    }
    field += c;
    i++;
  }
  if (quoted) { throw fail("a quoted field is never closed (a \" is missing).", quoteLine); }
  if (field !== "" || row.length || wasQuoted) { endRow(); }
  return rows;
}

/* Guess the delimiter: the one that splits the first records into
   the same number of fields (more than one) most often. */
export function sniffDelimiter(text) {
  const sample = String(text ?? "").slice(0, 20000);
  let best = ",";
  let bestScore = 0;
  for (const d of DELIMITERS) {
    let rows;
    try { rows = parseCSV(sample, { delimiter: d }); } catch { continue; }
    if (sample.length === 20000 && rows.length > 1) { rows = rows.slice(0, -1); }   // maybe cut short
    rows = rows.slice(0, 50);
    if (!rows.length) { continue; }
    const first = rows[0].length;
    if (first < 2) { continue; }
    const same = rows.filter((r) => r.length === first).length;
    const score = (same / rows.length) * 1000 + first;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/* "12" -> 12, "true" -> true. Only exact, canonical forms, so the
   text comes back the same: "007", "1e3", "+5" and " 3" stay text. */
export function typed(s) {
  if (typeof s !== "string") { return s; }
  if (s === "true") { return true; }
  if (s === "false") { return false; }
  if (/^-?(0|[1-9]\d*)(\.\d*[1-9])?$/.test(s)) {
    const v = Number(s);
    if (Number.isFinite(v) && String(v) === s) { return v; }
  }
  return s;
}

/* Header names: blanks get "column_N", repeats get "_2", "_3"... */
export function headerNames(row) {
  const seen = new Map();
  return row.map((raw, i) => {
    let name = String(raw ?? "");
    if (!name.trim()) { name = `column_${i + 1}`; }
    if (seen.has(name)) {
      let k = seen.get(name) + 1;
      while (seen.has(`${name}_${k}`)) { k++; }
      seen.set(name, k);
      name = `${name}_${k}`;
    }
    seen.set(name, 1);
    return name;
  });
}

/* The first row is the header. Short rows are padded with "",
   long rows get extra "column_N" keys. */
export function rowsToObjects(rows, { types = true } = {}) {
  if (!rows.length) { return []; }
  const head = headerNames(rows[0]);
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);   // no spread: big files overflow the stack
  for (let i = head.length; i < width; i++) { head.push(headerNames([...head, ""])[i]); }
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((k, i) => {
      const v = r[i] ?? "";
      o[k] = types ? typed(v) : v;
    });
    return o;
  });
}

/* A cell as text: null -> "", objects -> JSON. */
export function cellText(v) {
  if (v === null || v === undefined) { return ""; }
  if (typeof v === "object") { return JSON.stringify(v); }
  return String(v);
}

/* A list of objects -> header row + rows. Keys in first-seen order. */
export function objectsToRows(list) {
  const keys = [];
  const seen = new Set();
  for (const o of list) {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const k of Object.keys(o)) { if (!seen.has(k)) { seen.add(k); keys.push(k); } }
    }
  }
  return [keys, ...list.map((o) => keys.map((k) => (o && typeof o === "object" ? o[k] : undefined)))];
}

/* Rows -> CSV text. Quotes only the fields that need it. */
export function stringifyCSV(rows, { delimiter = ",", eol = "\r\n" } = {}) {
  const needs = (s) => s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s);
  return rows.map((r) => r.map((v) => {
    const s = cellText(v);
    return needs(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(delimiter)).join(eol) + (rows.length ? eol : "");
}
