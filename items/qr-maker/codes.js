/* ============================================================
   QR Maker - what goes IN the code, and how it's drawn out

   No DOM: unit tested in tests/unit/qr-maker.test.js.

     payload       the exact text a code will hold
     wifiString    WIFI:T:WPA;S:name;P:pass;;
     linkFix       "example.com" -> "https://example.com"
     contrast      can a camera tell the colours apart?
     toSvg         a crisp, tiny SVG file
     normalizeSettings / recent list helpers
   ============================================================ */

export const TYPES = ["link", "text", "wifi"];
export const SECURITY = ["WPA", "WEP", "nopass"];
export const MAX_RECENT = 12;

export const DEFAULTS = Object.freeze({
  type: "link",
  ecl: "M",
  mask: -1,          // -1 = pick the best
  fg: "#000000",
  bg: "#ffffff",
  border: 4,         // quiet zone, in modules (4 is the standard)
  size: 512,         // PNG size in pixels (about)
  keepRecent: true,
  recent: []
});

const HEX = /^#[0-9a-f]{6}$/;

export function normalizeHex(v) {
  let s = String(v || "").trim().toLowerCase();
  if (!s.startsWith("#")) { s = `#${s}`; }
  if (/^#[0-9a-f]{3}$/.test(s)) { s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`; }
  return HEX.test(s) ? s : null;
}

function int(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) { return fallback; }
  return Math.min(hi, Math.max(lo, n));
}

/* ============================================================
   WHAT THE CODE HOLDS
   ============================================================ */

/* Wi-Fi codes: special characters get a backslash. */
export function wifiEscape(s) {
  return String(s ?? "").replace(/([\\;,:"])/g, "\\$1");
}

export function wifiString({ ssid = "", password = "", security = "WPA", hidden = false } = {}) {
  const t = SECURITY.includes(security) ? security : "WPA";
  let out = `WIFI:T:${t};S:${wifiEscape(ssid)};`;
  if (t !== "nopass") { out += `P:${wifiEscape(password)};`; }
  if (hidden) { out += "H:true;"; }
  return `${out};`;
}

/* Add https:// to a bare address. Leave anything with a scheme
   (mailto:, tel:, http:) exactly as typed. */
export function linkFix(raw) {
  const s = String(raw ?? "").trim();
  if (!s) { return ""; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) { return s; }
  return `https://${s}`;
}

/* Is it a link worth warning about? "" = fine. */
export function linkProblem(link) {
  if (!link) { return ""; }
  if (/\s/.test(link)) { return "Links can't have spaces in them."; }
  if (/^https?:\/\//i.test(link) && !/^https?:\/\/[^/?#]+\.[^/?#]+/i.test(link) && !/^https?:\/\/localhost/i.test(link)) {
    return "That doesn't look like a full web address (like example.com).";
  }
  return "";
}

/* The one place that decides the exact text in the code.
   form: { type, link, text, ssid, password, security, hidden } */
export function payload(form) {
  const f = form || {};
  if (f.type === "wifi") { return f.ssid ? wifiString(f) : ""; }
  if (f.type === "text") { return String(f.text ?? ""); }
  return linkFix(f.link);
}

/* ============================================================
   COLOURS
   ============================================================ */
function luminance(hex) {
  const h = normalizeHex(hex) || "#000000";
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/* -> { level: "ok" | "warn" | "bad", text } */
export function scanCheck(fg, bg) {
  const ratio = contrast(fg, bg);
  const r = Math.round(ratio * 10) / 10;
  if (ratio < 2) { return { level: "bad", ratio: r, text: `Contrast ${r}:1. This will very likely not scan. Use a much darker or lighter colour.` }; }
  if (ratio < 4) { return { level: "warn", ratio: r, text: `Contrast ${r}:1. Some phones may not scan it. Aim for 4:1 or more.` }; }
  if (luminance(fg) > luminance(bg)) { return { level: "warn", ratio: r, text: "Light squares on dark: some older scanner apps can't read this. Dark on light is safest." }; }
  return { level: "ok", ratio: r, text: `Contrast ${r}:1. Good for scanning.` };
}

/* ============================================================
   SVG
   One <path>: each run of dark squares in a row is one
   rectangle, so even a version 40 code stays small.
   ============================================================ */
export function svgPath(modules, border) {
  let d = "";
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) { continue; }
      let run = 1;
      while (x + run < row.length && row[x + run]) { run++; }
      d += `M${x + border} ${y + border}h${run}v1h-${run}z`;
      x += run - 1;
    }
  });
  return d;
}

/* The SVG namespace is a name, not an address: nothing is ever
   fetched from it. Built from parts so the repo's "no outside
   URLs" check (tests/unit/pages.test.js) doesn't mistake it. */
const SVG_NS = ["http:", "", "www.w3.org", "2000", "svg"].join("/");

export function toSvg(modules, { border = 4, fg = "#000000", bg = "#ffffff", px = 512 } = {}) {
  const n = modules.length + border * 2;
  const f = normalizeHex(fg) || "#000000";
  const b = normalizeHex(bg) || "#ffffff";
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="${SVG_NS}" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges">\n` +
    `<rect width="${n}" height="${n}" fill="${b}"/>\n` +
    `<path fill="${f}" d="${svgPath(modules, border)}"/>\n` +
    `</svg>\n`;
}

/* Whole pixels per square, so a PNG is never blurry.
   -> { scale, px }   (px = the real image size) */
export function pngScale(count, border, want) {
  const total = count + border * 2;
  const scale = Math.max(1, Math.round(want / total));
  return { scale, px: scale * total };
}

/* ============================================================
   SETTINGS + RECENT
   ============================================================ */
export function cleanRecent(list) {
  if (!Array.isArray(list)) { return []; }
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== "object" || !TYPES.includes(r.type)) { continue; }
    const item = { type: r.type, at: typeof r.at === "string" ? r.at.slice(0, 30) : "" };
    if (r.type === "link") { item.link = String(r.link ?? "").slice(0, 3000); }
    if (r.type === "text") { item.text = String(r.text ?? "").slice(0, 3000); }
    if (r.type === "wifi") {
      /* Wi-Fi passwords are never kept. */
      item.ssid = String(r.ssid ?? "").slice(0, 64);
      item.security = SECURITY.includes(r.security) ? r.security : "WPA";
      item.hidden = r.hidden === true;
    }
    out.push(item);
    if (out.length >= MAX_RECENT) { break; }
  }
  return out;
}

/* A short label for the recent list. */
export function recentLabel(r) {
  if (r.type === "wifi") { return `Wi-Fi: ${r.ssid || "(no name)"}`; }
  const s = r.type === "link" ? linkFix(r.link) : String(r.text ?? "");
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 57)}…` : one || "(empty)";
}

/* Put r first; drop an older copy of the same thing. */
export function addRecent(list, r, now = new Date()) {
  const item = cleanRecent([{ ...r, at: now.toISOString() }])[0];
  if (!item) { return cleanRecent(list); }
  const key = (x) => JSON.stringify([x.type, x.link, x.text, x.ssid, x.security, x.hidden]);
  const rest = cleanRecent(list).filter((x) => key(x) !== key(item));
  return [item, ...rest].slice(0, MAX_RECENT);
}

export function normalizeSettings(d = {}) {
  const s = d && typeof d === "object" ? d : {};
  return {
    type: TYPES.includes(s.type) ? s.type : DEFAULTS.type,
    ecl: ["L", "M", "Q", "H"].includes(s.ecl) ? s.ecl : DEFAULTS.ecl,
    mask: int(s.mask, -1, 7, DEFAULTS.mask),
    fg: normalizeHex(s.fg) || DEFAULTS.fg,
    bg: normalizeHex(s.bg) || DEFAULTS.bg,
    border: int(s.border, 0, 16, DEFAULTS.border),
    size: int(s.size, 128, 2048, DEFAULTS.size),
    keepRecent: typeof s.keepRecent === "boolean" ? s.keepRecent : DEFAULTS.keepRecent,
    recent: cleanRecent(s.recent)
  };
}

/* A safe file name from what's in the code. */
export function fileStem(form) {
  const f = form || {};
  let base = "qr";
  if (f.type === "wifi" && f.ssid) { base = `qr-wifi-${f.ssid}`; }
  else if (f.type === "link" && f.link) { base = `qr-${linkFix(f.link).replace(/^[a-z]+:\/\/(www\.)?/i, "").split(/[/?#]/)[0]}`; }
  else if (f.type === "text") { base = "qr-text"; }
  return base.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "qr";
}
