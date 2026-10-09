/* ============================================================
   File Converter - what is this file, and what can it become?

   detect({ head, name, type })  -> { kind, format, label }
     head = the first bytes (64 is plenty), name = file name,
     type = the browser's MIME type. Magic bytes win; then the
     MIME type; then the extension.
     kind: "image" | "data" | "audio" | "video" | "text" | "other"
     ("text" = plain text: read it, then call detectText)

   detectText(text)  -> "json" | "xml" | "yaml" | "csv" | null
   targetsFor(det)   -> [{ value, label, disabled? }]  only what makes sense
   blockedNote(det)  -> why we can't convert it here, or ""

   Pure functions, no DOM: unit tested in tests/unit/file-converter.test.js.
   ============================================================ */

import { sniffDelimiter, parseCSV } from "./csv.js";

export const FORMATS = {
  png:  { kind: "image", ext: "png",  mime: "image/png",  label: "PNG" },
  jpg:  { kind: "image", ext: "jpg",  mime: "image/jpeg", label: "JPG" },
  webp: { kind: "image", ext: "webp", mime: "image/webp", label: "WebP" },
  bmp:  { kind: "image", ext: "bmp",  mime: "image/bmp",  label: "BMP" },
  ico:  { kind: "image", ext: "ico",  mime: "image/x-icon", label: "ICO" },
  gif:  { kind: "image", ext: "gif",  mime: "image/gif",  label: "GIF", inOnly: true },
  avif: { kind: "image", ext: "avif", mime: "image/avif", label: "AVIF", inOnly: true },
  pdf:  { kind: "other", ext: "pdf",  mime: "application/pdf", label: "PDF" },
  csv:  { kind: "data",  ext: "csv",  mime: "text/csv", label: "CSV" },
  json: { kind: "data",  ext: "json", mime: "application/json", label: "JSON" },
  xml:  { kind: "data",  ext: "xml",  mime: "application/xml", label: "XML" },
  yaml: { kind: "data",  ext: "yaml", mime: "application/yaml", label: "YAML" },
  wav:  { kind: "audio", ext: "wav",  mime: "audio/wav", label: "WAV" },
  mp3:  { kind: "audio", ext: "mp3",  mime: "audio/mpeg", label: "MP3" },
  ogg:  { kind: "audio", ext: "ogg",  mime: "audio/ogg", label: "OGG" },
  opus: { kind: "audio", ext: "opus", mime: "audio/ogg", label: "Opus" },
  m4a:  { kind: "audio", ext: "m4a",  mime: "audio/mp4", label: "M4A" },
  aac:  { kind: "audio", ext: "aac",  mime: "audio/aac", label: "AAC" },
  flac: { kind: "audio", ext: "flac", mime: "audio/flac", label: "FLAC" },
  weba: { kind: "audio", ext: "weba", mime: "audio/webm", label: "WebM audio" },
  mp4:  { kind: "video", ext: "mp4",  mime: "video/mp4", label: "MP4 video" },
  mov:  { kind: "video", ext: "mov",  mime: "video/quicktime", label: "MOV video" },
  webm: { kind: "video", ext: "webm", mime: "video/webm", label: "WebM video" },
  mkv:  { kind: "video", ext: "mkv",  mime: "video/x-matroska", label: "MKV video" },
  avi:  { kind: "video", ext: "avi",  mime: "video/x-msvideo", label: "AVI video" },
  ogv:  { kind: "video", ext: "ogv",  mime: "video/ogg", label: "OGG video" },
  heic: { kind: "other", ext: "heic", mime: "image/heic", label: "HEIC" },
  txt:  { kind: "text",  ext: "txt",  mime: "text/plain", label: "Text" }
};

const EXT = {
  jpeg: "jpg", jpe: "jpg", jfif: "jpg", yml: "yaml", tsv: "csv", tab: "csv", m4b: "m4a", oga: "ogg",
  m4v: "mp4", qt: "mov", heif: "heic", cur: "ico", text: "txt", log: "txt"
};
const MIME = {
  "image/jpg": "jpg", "image/pjpeg": "jpg", "image/vnd.microsoft.icon": "ico", "image/x-ms-bmp": "bmp",
  "text/xml": "xml", "text/yaml": "yaml", "text/x-yaml": "yaml", "application/x-yaml": "yaml",
  "text/tab-separated-values": "csv", "application/csv": "csv", "text/json": "json",
  "audio/x-wav": "wav", "audio/wave": "wav", "audio/vnd.wave": "wav", "audio/mp3": "mp3", "audio/x-m4a": "m4a",
  "audio/x-flac": "flac", "audio/x-aac": "aac", "image/heif": "heic"
};

export function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

function fromExt(name) {
  const e = extOf(name);
  const f = EXT[e] || e;
  return FORMATS[f] ? f : "";
}
function fromMime(type) {
  const t = String(type || "").toLowerCase().split(";")[0].trim();
  if (MIME[t]) { return MIME[t]; }
  return Object.keys(FORMATS).find((k) => FORMATS[k].mime === t && k !== "opus") || "";
}

const ascii = (b, at, len) => String.fromCharCode(...b.subarray(at, at + len));
const starts = (b, sig, at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/* Magic bytes -> a format, or "" if they say nothing. */
export function sniffBytes(head, name = "", type = "") {
  const b = head instanceof Uint8Array ? head : new Uint8Array(head || []);
  const ext = fromExt(name);
  const mimeF = fromMime(type);
  const hint = ext || mimeF;
  if (starts(b, [0x89, 0x50, 0x4e, 0x47])) { return "png"; }
  if (starts(b, [0xff, 0xd8, 0xff])) { return "jpg"; }
  if (ascii(b, 0, 4) === "GIF8") { return "gif"; }
  if (starts(b, [0x42, 0x4d]) && b.length >= 14 && (hint === "bmp" || b[14] === 40 || b[14] === 12 || b[14] === 108 || b[14] === 124)) { return "bmp"; }
  if (starts(b, [0, 0, 1, 0]) || starts(b, [0, 0, 2, 0])) { return "ico"; }
  if (ascii(b, 0, 4) === "RIFF") {
    const kind = ascii(b, 8, 4);
    if (kind === "WEBP") { return "webp"; }
    if (kind === "WAVE") { return "wav"; }
    if (kind === "AVI ") { return "avi"; }
  }
  if (ascii(b, 0, 5) === "%PDF-") { return "pdf"; }
  if (ascii(b, 0, 4) === "OggS") {
    if (ascii(b, 28, 8) === "OpusHead") { return hint === "opus" ? "opus" : "ogg"; }
    if (hint === "ogv" || /^video\//.test(type) || ascii(b, 28, 7).includes("theora")) { return "ogv"; }
    return "ogg";
  }
  if (ascii(b, 0, 4) === "fLaC") { return "flac"; }
  if (ascii(b, 0, 3) === "ID3") { return "mp3"; }
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) { return "aac"; }             // ADTS
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) { return "mp3"; }             // MPEG frame sync
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) {                                  // EBML: WebM / MKV
    if (hint === "weba" || /^audio\//.test(type)) { return "weba"; }
    if (hint === "mkv") { return "mkv"; }
    return "webm";
  }
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4).toLowerCase();
    if (brand === "avif" || brand === "avis") { return "avif"; }
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) { return "heic"; }
    if (brand === "m4a " || brand === "m4b " || brand === "m4p ") { return "m4a"; }
    if (brand === "qt  ") { return "mov"; }
    if (hint === "m4a" || /^audio\//.test(type)) { return "m4a"; }
    if (hint === "mov") { return "mov"; }
    return "mp4";
  }
  return "";
}

/* Does this look like text (no NUL bytes, few control characters)? */
export function looksLikeText(head) {
  const b = head instanceof Uint8Array ? head : new Uint8Array(head || []);
  if (!b.length) { return false; }
  let odd = 0;
  for (const c of b) {
    if (c === 0) { return false; }
    if (c < 9 || (c > 13 && c < 32)) { odd++; }
  }
  return odd / b.length < 0.02;
}

export function detect({ head, name = "", type = "" } = {}) {
  let format = sniffBytes(head, name, type);
  if (!format) {
    const hint = fromExt(name) || fromMime(type);
    if (hint && FORMATS[hint].kind === "data") { format = hint; } else if (looksLikeText(head)) { format = "txt"; } else { format = hint; }
  }
  if (!format) { return { kind: "other", format: "", label: extOf(name) ? extOf(name).toUpperCase() : "Unknown" }; }
  const f = FORMATS[format];
  return { kind: f.kind, format, label: f.label };
}

/* Which data format is this text? */
export function detectText(text) {
  const t = String(text ?? "").replace(/^\ufeff/, "").trim();
  if (!t) { return null; }
  if (t[0] === "{" || t[0] === "[") { return "json"; }    // even broken JSON: its error is the useful one
  if (t[0] === "<") { return "xml"; }
  const lines = t.split(/\r\n|\r|\n/).filter((l) => l.trim() && !/^\s*#/.test(l)).slice(0, 20);
  const yamlish = lines.length && (/^---(\s|$)/.test(t) || lines.every((l) => /^\s*-(\s|$)/.test(l) || /^\s*("[^"]*"|'[^']*'|[^\s,"'#][^,]*?):(\s|$)/.test(l) || /^\s{2,}\S/.test(l)));
  if (yamlish) { return "yaml"; }
  try {
    const d = sniffDelimiter(t);
    const rows = parseCSV(t.slice(0, 20000), { delimiter: d });
    if (rows.length && rows[0].length >= 2) { return "csv"; }
    if (rows.length > 1 && rows.every((r) => r.length === 1)) { return "csv"; }   // one column
  } catch { /* not CSV either */ }
  if (/^[\w"'][^:\n]*:\s/.test(t)) { return "yaml"; }
  return null;
}

const IMAGE_OUT = ["png", "jpg", "webp", "bmp", "ico", "pdf"];
const DATA_OUT = ["csv", "json", "xml", "yaml"];

export function targetsFor(det) {
  if (!det) { return []; }
  const label = (v) => (v === "pdf" ? "PDF" : FORMATS[v].label);
  if (det.kind === "image") {
    return IMAGE_OUT.filter((v) => v !== det.format).map((v) => ({ value: v, label: label(v) }));
  }
  if (det.kind === "data") {
    return DATA_OUT.filter((v) => v !== det.format).map((v) => ({ value: v, label: label(v) }));
  }
  if (det.kind === "audio") {
    return [{ value: "wav", label: det.format === "wav" ? "WAV (16-bit, re-sampled)" : "WAV" }, { value: "mp3", label: "MP3 (can't, see below)", disabled: true }];
  }
  if (det.kind === "video") {
    return [{ value: "wav", label: "WAV (sound only)" }, { value: "video", label: "Another video format (can't)", disabled: true }];
  }
  return [];
}

export function blockedNote(det) {
  if (!det) { return ""; }
  if (det.kind === "video") { return "Video can't be converted here: it needs video encoders browsers don't let pages use. You can still save its sound as WAV."; }
  if (det.format === "heic") { return "HEIC photos can't be read by most browsers. On an iPhone, set Camera > Formats to Most Compatible, or share the photo as JPG."; }
  if (det.format === "pdf") { return "Reading PDFs isn't possible here. This tool can make a PDF from pictures, though."; }
  if (det.kind === "text") { return ""; }
  if (det.kind === "other") { return "This tool doesn't know this kind of file."; }
  return "";
}

/* The default target: the last one you chose for this format, if it still fits. */
export function defaultTarget(det, last = {}) {
  const ok = targetsFor(det).filter((t) => !t.disabled).map((t) => t.value);
  if (!ok.length) { return ""; }
  const want = last && last[det.format];
  if (ok.includes(want)) { return want; }
  const preferred = { image: det.format === "png" ? "webp" : "png", data: det.format === "json" ? "csv" : "json", audio: "wav", video: "wav" }[det.kind];
  return ok.includes(preferred) ? preferred : ok[0];
}
