/* ============================================================
   File Converter - YAML (a simple, common subset)

   Reads:
     - maps          key: value           (nested by indenting)
     - lists         - item               (also "- key: value")
     - scalars       plain, 'single', "double \n escapes"
     - types         null ~  true false  12  -3.5  0x1F  .inf  .nan
     - flow          [a, b]  {a: 1, b: 2}
     - block text    |  |-  >  >-          (literal / folded)
     - comments      # like this
     - one document  (a leading --- is fine)
   Not supported (a clear error says so): anchors & and aliases *,
   tags !!, complex keys ?, several documents, multi-line quotes.

   YAML 1.2 rules: yes / no / on / off stay text.

   parseYAML(text)       -> a plain JS value
   stringifyYAML(value)  -> YAML text that parseYAML reads back

   Errors are thrown as Error with .line, message "Line N: ...".
   Pure functions, no DOM: unit tested in tests/unit/file-converter.test.js.
   ============================================================ */

function fail(message, line) {
  const err = new Error(`Line ${line}: ${message}`);
  err.line = line;
  return err;
}

/* ---- scalars ---------------------------------------------- */

const NULLS = new Set(["", "~", "null", "Null", "NULL"]);
const TRUES = new Set(["true", "True", "TRUE"]);
const FALSES = new Set(["false", "False", "FALSE"]);

/* A plain (unquoted) scalar -> its value, YAML 1.2 core schema. */
export function plainValue(s) {
  if (NULLS.has(s)) { return null; }
  if (TRUES.has(s)) { return true; }
  if (FALSES.has(s)) { return false; }
  if (/^[-+]?(0|[1-9][0-9_]*)$/.test(s)) {
    const v = Number(s.replace(/_/g, ""));
    if (Number.isSafeInteger(v)) { return v; }
  }
  if (/^0x[0-9a-fA-F]+$/.test(s)) { return parseInt(s.slice(2), 16); }
  if (/^0o[0-7]+$/.test(s)) { return parseInt(s.slice(2), 8); }
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(s)) { return Number(s); }
  if (/^[-+]?\.(inf|Inf|INF)$/.test(s)) { return s[0] === "-" ? -Infinity : Infinity; }
  if (/^\.(nan|NaN|NAN)$/.test(s)) { return NaN; }
  return s;
}

const ESCAPES = { n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "\\": "\\", "/": "/", " ": " ", b: "\b", f: "\f", e: "\x1b", a: "\x07", v: "\v", N: "\u0085", _: "\u00a0" };

/* Read a quoted scalar starting at s[i]. Returns { value, end }. */
function readQuoted(s, i, line) {
  const q = s[i];
  let out = "";
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (q === "'") {
      if (c === "'") {
        if (s[j + 1] === "'") { out += "'"; j += 2; continue; }
        return { value: out, end: j + 1 };
      }
      out += c;
      j++;
      continue;
    }
    if (c === '"') { return { value: out, end: j + 1 }; }
    if (c === "\\") {
      const e = s[j + 1];
      if (e === "x" || e === "u" || e === "U") {
        const len = e === "x" ? 2 : e === "u" ? 4 : 8;
        const hex = s.slice(j + 2, j + 2 + len);
        if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) { throw fail(`bad escape \\${e}${hex}.`, line); }
        out += String.fromCodePoint(parseInt(hex, 16));
        j += 2 + len;
        continue;
      }
      if (!(e in ESCAPES)) { throw fail(`unknown escape \\${e ?? ""} in a "double-quoted" string.`, line); }
      out += ESCAPES[e];
      j += 2;
      continue;
    }
    out += c;
    j++;
  }
  throw fail(`a ${q === '"' ? "double" : "single"}-quoted string is never closed. Multi-line quotes aren't supported here: use \\n inside "double quotes".`, line);
}

/* A comment starts at # when it's first, or after a space,
   and not inside quotes. */
export function stripComment(s) {
  let q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') { i++; continue; }
      if (c === q) {
        if (q === "'" && s[i + 1] === "'") { i++; continue; }
        q = "";
      }
      continue;
    }
    const prev = i === 0 ? " " : s[i - 1];
    if ((c === '"' || c === "'") && /[\s:[{,-]/.test(prev)) { q = c; continue; }
    if (c === "#" && /\s/.test(prev)) { return s.slice(0, i).trimEnd(); }
  }
  return s.trimEnd();
}

/* ---- flow collections: [a, b] and {a: 1} -------------------- */

function parseFlow(s, line) {
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) { i++; } };
  function value(ctx) {
    ws();
    const c = s[i];
    if (c === "[") {
      i++;
      const arr = [];
      ws();
      if (s[i] === "]") { i++; return arr; }
      for (;;) {
        arr.push(value("seq"));
        ws();
        if (s[i] === ",") { i++; ws(); if (s[i] === "]") { i++; return arr; } continue; }
        if (s[i] === "]") { i++; return arr; }
        throw fail(`expected , or ] in a [flow list].`, line);
      }
    }
    if (c === "{") {
      i++;
      const obj = {};
      ws();
      if (s[i] === "}") { i++; return obj; }
      for (;;) {
        const k = value("key");
        const key = k === null ? "" : String(k);
        ws();
        let v = null;
        if (s[i] === ":") { i++; v = value("map"); ws(); }
        if (Object.prototype.hasOwnProperty.call(obj, key)) { throw fail(`the key "${key}" appears twice.`, line); }
        obj[key] = v;
        if (s[i] === ",") { i++; ws(); if (s[i] === "}") { i++; return obj; } continue; }
        if (s[i] === "}") { i++; return obj; }
        throw fail(`expected , or } in a {flow map}.`, line);
      }
    }
    if (c === '"' || c === "'") {
      const r = readQuoted(s, i, line);
      i = r.end;
      return r.value;
    }
    const start = i;
    while (i < s.length) {
      const ch = s[i];
      if (ch === "," || ch === "]" || ch === "}" || ch === "[" || ch === "{") { break; }
      if (ch === ":" && (ctx === "key" || /[\s,\]}]/.test(s[i + 1] ?? " "))) { break; }
      i++;
    }
    const raw = s.slice(start, i).trim();
    if (ctx === "key") { return raw; }
    return plainValue(raw);
  }
  const v = value("top");
  ws();
  if (i < s.length) { throw fail(`unexpected ${JSON.stringify(s.slice(i, i + 10))} after a flow ${Array.isArray(v) ? "list" : "map"}.`, line); }
  return v;
}

/* One value written on the same line as its key or dash. */
function inlineValue(text, line) {
  const t = text.trim();
  const c = t[0];
  if (c === "&" || c === "*") { throw fail("anchors (&) and aliases (*) aren't supported here.", line); }
  if (c === "!") { throw fail("tags (like !!str) aren't supported here.", line); }
  if (c === "[" || c === "{") { return parseFlow(t, line); }
  if (c === '"' || c === "'") {
    const r = readQuoted(t, 0, line);
    if (t.slice(r.end).trim()) { throw fail(`unexpected text after a quoted string: ${JSON.stringify(t.slice(r.end).trim())}.`, line); }
    return r.value;
  }
  if (c === "%" || c === "@" || c === "`") { throw fail(`a plain value can't start with ${c}. Put it in quotes.`, line); }
  return plainValue(t);
}

/* "key: rest" -> { key, rest }, or null if this line isn't a map entry. */
function splitKey(content, line) {
  const c = content[0];
  if (c === "?" && (content[1] === " " || content.length === 1)) { throw fail("complex keys (? key) aren't supported here.", line); }
  if (c === '"' || c === "'") {
    let r;
    try { r = readQuoted(content, 0, line); } catch { return null; }
    const after = content.slice(r.end);
    const m = after.match(/^\s*:(\s|$)/);
    if (!m) { return null; }
    return { key: r.value, rest: after.slice(m[0].length).trim() };
  }
  if (c === "[" || c === "{") { return null; }
  const m = content.match(/:(\s|$)/);
  if (!m) { return null; }
  const key = content.slice(0, m.index).trim();
  if (!key) { return null; }
  return { key, rest: content.slice(m.index + m[0].length).trim() };
}

const isSeq = (content) => content === "-" || /^-\s/.test(content);

/* ---- the block parser -------------------------------------- */

export function parseYAML(text) {
  const lines = String(text ?? "").replace(/^\ufeff/, "").split(/\r\n|\r|\n/);
  let i = 0;
  let started = false;

  /* The next line that holds something, or null. */
  function peek() {
    while (i < lines.length) {
      const raw = lines[i];
      const lead = raw.match(/^[ \t]*/)[0];
      const content = stripComment(raw.slice(lead.length));
      if (!content) { i++; continue; }
      if (lead.includes("\t")) { throw fail("tabs can't be used to indent YAML. Use spaces.", i + 1); }
      if (lead.length === 0) {
        if (content === "---" || content.startsWith("--- ")) {
          if (started) { throw fail("only one YAML document is supported (found a second ---).", i + 1); }
          started = true;
          const rest = content.slice(3).trim();
          if (!rest) { i++; continue; }
          lines[i] = rest;
          return { indent: 0, content: rest, line: i + 1 };
        }
        if (content === "...") { i = lines.length; return null; }
        if (content[0] === "%" && !started) { i++; continue; }
      }
      started = true;
      return { indent: lead.length, content, line: i + 1 };
    }
    return null;
  }

  /* Replace the current line, e.g. "- a: 1" -> "  a: 1" (same column). */
  function rewrite(indent, content) { lines[i] = " ".repeat(indent) + content; }

  function node(minIndent) {
    const p = peek();
    if (!p || p.indent < minIndent) { return null; }
    if (isSeq(p.content)) { return seq(p.indent); }
    if (splitKey(p.content, p.line)) { return map(p.indent); }
    if (/^[|>]/.test(p.content)) { i++; return block(p.content, p.line, minIndent - 1); }
    i++;
    const v = inlineValue(p.content, p.line);
    const q = peek();
    if (q && q.indent >= minIndent && q.indent >= p.indent) {
      throw fail(`unexpected text. Is a "key:" or "- " missing, or is the indent off?`, q.line);
    }
    return v;
  }

  function map(indent) {
    const obj = {};
    for (;;) {
      const p = peek();
      if (!p || p.indent < indent) { break; }
      if (p.indent > indent) { throw fail("this line is indented more than the lines above it.", p.line); }
      if (isSeq(p.content)) { throw fail(`a "- " list item can't sit next to "key:" lines at the same indent.`, p.line); }
      const kv = splitKey(p.content, p.line);
      if (!kv) { throw fail(`expected "key: value" here.`, p.line); }
      if (Object.prototype.hasOwnProperty.call(obj, kv.key)) { throw fail(`the key "${kv.key}" appears twice.`, p.line); }
      i++;
      let v;
      if (kv.rest === "") {
        const q = peek();
        if (q && q.indent > indent) { v = node(q.indent); } else if (q && q.indent === indent && isSeq(q.content)) { v = seq(indent); } else { v = null; }
      } else if (/^[|>]/.test(kv.rest)) {
        v = block(kv.rest, p.line, indent);
      } else {
        v = inlineValue(kv.rest, p.line);
      }
      obj[kv.key] = v;
    }
    return obj;
  }

  function seq(indent) {
    const arr = [];
    for (;;) {
      const p = peek();
      if (!p || p.indent < indent) { break; }
      if (p.indent > indent) { throw fail("this line is indented more than the list item above it.", p.line); }
      if (!isSeq(p.content)) { break; }
      const rest = p.content.slice(1).replace(/^\s+/, "");
      if (!rest) {
        i++;
        const q = peek();
        arr.push(q && q.indent > indent ? node(q.indent) : null);
        continue;
      }
      if (/^[|>]/.test(rest)) { i++; arr.push(block(rest, p.line, indent)); continue; }
      const col = indent + (p.content.length - rest.length);
      rewrite(col, rest);
      arr.push(node(col));
    }
    return arr;
  }

  /* | and > block text. parent = the indent the text must go deeper than. */
  function block(header, line, parent) {
    const m = header.match(/^([|>])([-+]?)\s*$/);
    if (!m) { throw fail(`a block text header looks like | or |- or > (got ${JSON.stringify(header)}).`, line); }
    const [, style, chomp] = m;
    const body = [];
    let indent = -1;
    while (i < lines.length) {
      const raw = lines[i];
      if (!raw.trim()) { body.push(""); i++; continue; }
      const lead = raw.match(/^ */)[0].length;
      if (indent < 0) {
        if (lead <= parent) { break; }
        indent = lead;
      }
      if (lead < indent) { break; }
      body.push(raw.slice(indent));
      i++;
    }
    /* Trailing blank lines belong to the chomping, not the text. */
    let trail = 0;
    while (body.length && body[body.length - 1] === "") { body.pop(); trail++; }
    let text;
    if (style === "|") {
      text = body.join("\n");
    } else {
      text = "";
      body.forEach((l, k) => {
        if (k === 0) { text = l; return; }
        const prev = body[k - 1];
        if (l === "") { text += "\n"; } else if (prev === "" || /^\s/.test(l) || /^\s/.test(prev)) { text += (prev === "" ? "" : "\n") + l; } else { text += ` ${l}`; }
      });
    }
    if (!body.length) { return ""; }
    if (chomp === "-") { return text; }
    if (chomp === "+") { return `${text}\n${"\n".repeat(trail)}`; }
    return `${text}\n`;
  }

  const first = peek();
  if (!first) { return null; }
  const v = node(0);
  const extra = peek();
  if (extra) { throw fail("unexpected text. Is the indent off?", extra.line); }
  return v;
}

/* ---- writing ------------------------------------------------ */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* Can this string go without quotes, and read back the same? */
function plainOk(s) {
  if (!s || s !== s.trim()) { return false; }
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) { return false; }
  if (/[\n\r\t\0-\x1f\x7f\u0085\u2028\u2029]/.test(s)) { return false; }
  if (/:\s|\s#|:$/.test(s)) { return false; }
  return plainValue(s) === s;
}

function scalar(v) {
  if (v === null || v === undefined) { return "null"; }
  if (typeof v === "boolean") { return String(v); }
  if (typeof v === "number") {
    if (Number.isNaN(v)) { return ".nan"; }
    if (!Number.isFinite(v)) { return v > 0 ? ".inf" : "-.inf"; }
    return String(v);
  }
  const s = String(v);
  return plainOk(s) ? s : JSON.stringify(s);
}

/* Keys are always read back as text, so "1" or "true" can stay plain. */
function keyText(k) {
  const plain = k && k === k.trim() && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(k) && !/[\n\r\t\0-\x1f\x7f\u0085\u2028\u2029]/.test(k) && !/:\s|\s#|:$/.test(k);
  return plain ? k : JSON.stringify(k);
}

function lines(v, indent) {
  const pad = " ".repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) { return [`${pad}[]`]; }
    const out = [];
    for (const item of v) {
      if ((Array.isArray(item) || isObj(item)) && (Array.isArray(item) ? item.length : Object.keys(item).length)) {
        const sub = lines(item, indent + 2);
        sub[0] = `${pad}- ${sub[0].slice(indent + 2)}`;
        out.push(...sub);
      } else {
        out.push(`${pad}- ${Array.isArray(item) ? "[]" : isObj(item) ? "{}" : scalar(item)}`);
      }
    }
    return out;
  }
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (!keys.length) { return [`${pad}{}`]; }
    const out = [];
    for (const k of keys) {
      const val = v[k];
      const kt = keyText(k);
      if (Array.isArray(val) && val.length) { out.push(`${pad}${kt}:`, ...lines(val, indent + 2)); } else if (isObj(val) && Object.keys(val).length) { out.push(`${pad}${kt}:`, ...lines(val, indent + 2)); } else if (Array.isArray(val)) { out.push(`${pad}${kt}: []`); } else if (isObj(val)) { out.push(`${pad}${kt}: {}`); } else { out.push(`${pad}${kt}: ${scalar(val)}`); }
    }
    return out;
  }
  return [`${pad}${scalar(v)}`];
}

export function stringifyYAML(value) {
  return `${lines(value, 0).join("\n")}\n`;
}
