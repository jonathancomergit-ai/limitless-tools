/* ============================================================
   File Converter - a small XML reader and writer

   Our own, because DOMParser isn't in Node (the unit tests) and
   doesn't give line numbers. Handles: elements, attributes,
   text, CDATA, the five named entities and &#123; / &#x1F;,
   self-closing tags, comments, <?xml ...?> and a <!DOCTYPE>
   (skipped). Namespaced names like a:b are kept as plain names.

   parseXML(text)            -> { name, attrs, children }   (the root element)
   serializeXML(node)        -> pretty text with <?xml ...?>

   XML <-> JSON, the convention (simple, and documented in README):
     <a x="1">hi</a>            { "a": { "@x": 1, "#text": "hi" } }
     <a>hi</a>                  { "a": "hi" }
     <a/>                       { "a": "" }
     <r><b>1</b><b>2</b></r>    { "r": { "b": [1, 2] } }      repeats -> a list
     - the root element is the one key of the top object
     - "@name" keys are attributes, "#text" is text next to child elements
     - numbers and true/false are typed (only exact forms, like CSV)
     - a top-level list becomes <rows><row>...</row></rows>;
       a list inside a list becomes <item>s
     - names that aren't legal XML get fixed: "first name" -> first_name

   Errors are thrown as Error with .line, message "Line N: ...".
   Pure functions, no DOM: unit tested in tests/unit/file-converter.test.js.
   ============================================================ */

import { typed, setKey } from "./csv.js";

function lineAt(src, pos) {
  let n = 1;
  for (let i = 0; i < pos && i < src.length; i++) { if (src.charCodeAt(i) === 10) { n++; } }
  return n;
}
function fail(message, src, pos) {
  const line = lineAt(src, pos);
  const err = new Error(`Line ${line}: ${message}`);
  err.line = line;
  return err;
}

const NAME = /[A-Za-z_:À-￯][\w.:\-·-￯]*/y;
const NAMED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/* Turn &lt; &#65; &#x41; into characters. */
function decode(s, src, pos) {
  if (!s.includes("&")) { return s; }
  return s.replace(/&([^;\s&]*);?/g, (m, body, at) => {
    if (!m.endsWith(";")) { throw fail(`a lone "&". Write it as &amp;`, src, pos + at); }
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || !/^#(x[0-9a-fA-F]+|X[0-9a-fA-F]+|[0-9]+)$/.test(body)) {
        throw fail(`bad character reference &${body};`, src, pos + at);
      }
      return String.fromCodePoint(code);
    }
    if (body in NAMED) { return NAMED[body]; }
    throw fail(`unknown entity &${body}; (only &lt; &gt; &amp; &quot; &apos; and &#...; are known)`, src, pos + at);
  });
}

/* ---- reading ------------------------------------------------- */

export function parseXML(text) {
  const src = String(text ?? "").replace(/^\ufeff/, "");
  let i = 0;
  const n = src.length;
  let root = null;
  const stack = [];

  const name = () => {
    NAME.lastIndex = i;
    const m = NAME.exec(src);
    if (!m) { return ""; }
    i += m[0].length;
    return m[0];
  };
  const ws = () => { while (i < n && /\s/.test(src[i])) { i++; } };
  const skipTo = (end, what) => {
    const j = src.indexOf(end, i);
    if (j < 0) { throw fail(`${what} is never closed (no "${end}").`, src, i); }
    i = j + end.length;
  };
  const addText = (t, at) => {
    if (!stack.length) {
      if (t.trim()) { throw fail(root ? "text after the end of the root element." : "text before the first element.", src, at + t.search(/\S/)); }
      return;
    }
    const kids = stack[stack.length - 1].children;
    const last = kids[kids.length - 1];
    if (last && typeof last === "string") { kids[kids.length - 1] = last + t; } else { kids.push(t); }
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { addText(decode(src.slice(i), src, i), i); break; }
    if (lt > i) { addText(decode(src.slice(i, lt), src, i), i); }
    i = lt;
    const start = i;

    if (src.startsWith("<!--", i)) { i += 4; skipTo("-->", "a <!-- comment"); continue; }
    if (src.startsWith("<![CDATA[", i)) {
      i += 9;
      const j = src.indexOf("]]>", i);
      if (j < 0) { throw fail("a <![CDATA[ section is never closed (no \"]]>\").", src, start); }
      if (!stack.length) { throw fail("CDATA outside the root element.", src, start); }
      addText(src.slice(i, j), start);
      i = j + 3;
      continue;
    }
    if (src.startsWith("<?", i)) { i += 2; skipTo("?>", "a <?...?> instruction"); continue; }
    if (src.startsWith("<!", i)) {
      /* <!DOCTYPE ...> - may hold [ ... ] with > inside it. */
      if (stack.length || root) { throw fail("a <!DOCTYPE> can only come before the root element.", src, start); }
      let depth = 0;
      i += 2;
      while (i < n) {
        const c = src[i];
        if (c === "[") { depth++; } else if (c === "]") { depth--; } else if (c === ">" && depth <= 0) { break; }
        i++;
      }
      if (i >= n) { throw fail("a <!DOCTYPE> is never closed.", src, start); }
      i++;
      continue;
    }

    if (src[i + 1] === "/") {
      /* </close> */
      i += 2;
      const nm = name();
      ws();
      if (src[i] !== ">") { throw fail(`expected ">" to end </${nm}`, src, i); }
      i++;
      const open = stack.pop();
      if (!open) { throw fail(`</${nm}> closes nothing.`, src, start); }
      if (open.name !== nm) { throw fail(`</${nm}> doesn't match <${open.name}> (opened on line ${open.line}).`, src, start); }
      delete open.line;
      continue;
    }

    /* <open attr="v"> or <open/> */
    i++;
    const nm = name();
    if (!nm) { throw fail(`"<" must start a tag. Write a plain < as &lt;`, src, start); }
    const el = { name: nm, attrs: {}, children: [], line: lineAt(src, start) };
    for (;;) {
      const before = i;
      ws();
      if (src[i] === ">" || src.startsWith("/>", i)) { break; }
      if (i >= n) { throw fail(`<${nm}> is never finished (no ">").`, src, start); }
      if (i === before) { throw fail(`expected a space before the next attribute in <${nm}>.`, src, i); }
      const an = name();
      if (!an) { throw fail(`unexpected ${JSON.stringify(src[i])} in <${nm}>.`, src, i); }
      ws();
      if (src[i] !== "=") { throw fail(`the attribute ${an} in <${nm}> needs ="value".`, src, i); }
      i++;
      ws();
      const q = src[i];
      if (q !== '"' && q !== "'") { throw fail(`the value of ${an} needs quotes: ${an}="..."`, src, i); }
      const end = src.indexOf(q, i + 1);
      if (end < 0) { throw fail(`the value of ${an} is never closed.`, src, i); }
      const raw = src.slice(i + 1, end);
      if (raw.includes("<")) { throw fail(`a "<" inside the value of ${an}. Write it as &lt;`, src, i); }
      if (Object.prototype.hasOwnProperty.call(el.attrs, an)) { throw fail(`the attribute ${an} appears twice in <${nm}>.`, src, i); }
      setKey(el.attrs, an, decode(raw.replace(/[\t\n\r]/g, " "), src, i + 1));
      i = end + 1;
    }
    const selfClose = src.startsWith("/>", i);
    i += selfClose ? 2 : 1;

    if (stack.length) {
      stack[stack.length - 1].children.push(el);
    } else {
      if (root) { throw fail(`a second root element <${nm}>. XML has exactly one root.`, src, start); }
      root = el;
    }
    if (selfClose) { delete el.line; } else { stack.push(el); }
  }

  if (stack.length) {
    const open = stack[stack.length - 1];
    throw fail(`<${open.name}> (opened on line ${open.line}) is never closed.`, src, src.length);
  }
  if (!root) { throw fail("there's no XML element here.", src, 0); }
  return root;
}

/* ---- writing ------------------------------------------------- */

export const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escAttr = (s) => escText(s).replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");

export function serializeXML(root, { indent = 2, declaration = true } = {}) {
  const pad = (d) => " ".repeat(indent * d);
  const out = [];
  if (declaration) { out.push('<?xml version="1.0" encoding="UTF-8"?>'); }
  function open(el) {
    const attrs = Object.entries(el.attrs || {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
    return `<${el.name}${attrs}`;
  }
  function inline(el) {
    const kids = el.children || [];
    if (!kids.length) { return `${open(el)}/>`; }
    return `${open(el)}>${kids.map((c) => (typeof c === "string" ? escText(c) : inline(c))).join("")}</${el.name}>`;
  }
  function walk(el, d) {
    const kids = el.children || [];
    const hasEl = kids.some((c) => typeof c !== "string");
    const hasText = kids.some((c) => typeof c === "string" && c.trim());
    if (!hasEl || hasText) { out.push(pad(d) + inline(el)); return; }   // text or mixed: keep exactly
    out.push(`${pad(d)}${open(el)}>`);
    for (const c of kids) { if (typeof c !== "string") { walk(c, d + 1); } }
    out.push(`${pad(d)}</${el.name}>`);
  }
  walk(root, 0);
  return `${out.join("\n")}\n`;
}

/* ---- XML <-> plain JS value ----------------------------------- */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function content(el, types) {
  const kids = el.children || [];
  const elems = kids.filter((c) => typeof c !== "string");
  const text = kids.filter((c) => typeof c === "string").join("");
  const attrs = Object.entries(el.attrs || {});
  if (!elems.length && !attrs.length) { return types ? typed(text) : text; }
  const o = {};
  for (const [k, v] of attrs) { setKey(o, `@${k}`, types ? typed(v) : v); }
  for (const c of elems) {
    const v = content(c, types);
    /* content() never returns a list, so a list here means "seen before". */
    if (!Object.prototype.hasOwnProperty.call(o, c.name)) { setKey(o, c.name, v); } else if (Array.isArray(o[c.name])) { o[c.name].push(v); } else { o[c.name] = [o[c.name], v]; }
  }
  if (text.trim()) {
    const t = elems.length ? text.trim() : text;
    o["#text"] = types ? typed(t) : t;
  }
  return o;
}

/* The parsed root -> { rootName: content } */
export function xmlToValue(root, { types = true } = {}) {
  return { [root.name]: content(root, types) };
}

/* Make any text a legal XML name. */
export function xmlName(s) {
  let t = String(s ?? "").trim().replace(/[^\w.\-:·-￯]/g, "_");
  if (!/^[A-Za-z_:À-￯]/.test(t)) { t = `_${t}`; }
  return t;
}

function scalarText(v) {
  if (v === null || v === undefined) { return ""; }
  if (typeof v === "object") { return JSON.stringify(v); }
  return String(v);
}

function build(name, v, listName = "item") {
  const el = { name: xmlName(name), attrs: {}, children: [] };
  if (Array.isArray(v)) {
    for (const item of v) { el.children.push(build(listName, item)); }
    return el;
  }
  if (isObj(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (k.startsWith("@") && k.length > 1 && !isObj(val) && !Array.isArray(val)) { setKey(el.attrs, xmlName(k.slice(1)), scalarText(val)); continue; }
      if (k === "#text") { el.children.push(scalarText(val)); continue; }
      if (Array.isArray(val)) {
        for (const item of val) { el.children.push(build(k, item)); }   // an empty list writes nothing
      } else {
        el.children.push(build(k, val));
      }
    }
    return el;
  }
  const t = scalarText(v);
  if (t) { el.children.push(t); }
  return el;
}

/* A plain JS value -> a root element (see the convention above). */
export function valueToXML(value) {
  if (isObj(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && !keys[0].startsWith("@") && keys[0] !== "#text" && !Array.isArray(value[keys[0]])) {
      return build(keys[0], value[keys[0]]);
    }
    return build("root", value);
  }
  if (Array.isArray(value)) { return build("rows", value, "row"); }
  return build("root", value);
}
