/* ============================================================
   Image Squisher - pure helpers (no DOM)

   Sizes, names, settings. Unit tested in
   tests/unit/image-squisher.test.js.
   ============================================================ */

export const FORMATS = {
  webp: { mime: "image/webp", ext: "webp", label: "WebP" },
  jpeg: { mime: "image/jpeg", ext: "jpg",  label: "JPEG" },
  png:  { mime: "image/png",  ext: "png",  label: "PNG" }
};

export const DEFAULTS = Object.freeze({ maxWidth: 1920, maxHeight: 1920, format: "webp", quality: 80 });

/* Browsers refuse canvases past about 16k px a side or ~268M px;
   phones give up far sooner. Stay well inside both. */
export const MAX_SIDE = 8192;
export const MAX_AREA = 40_000_000;

/* A size limit from a form box: blank, 0 or junk = no limit. */
export function limit(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SIDE) : 0;
}

/* Fit w x h inside maxW x maxH, keeping the shape. Never makes
   an image bigger. 0 means "no limit" on that side. */
export function fitSize(w, h, maxW = 0, maxH = 0) {
  if (!(w > 0) || !(h > 0)) { return { width: 1, height: 1 }; }
  let scale = 1;
  if (maxW > 0) { scale = Math.min(scale, maxW / w); }
  if (maxH > 0) { scale = Math.min(scale, maxH / h); }
  /* The browser's own ceiling, even with no limit set. */
  scale = Math.min(scale, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale))
  };
}

/* Clean settings from a save file or the form. */
export function normalizeSettings(d = {}) {
  const q = Math.round(Number(d.quality));
  return {
    maxWidth: d.maxWidth === 0 ? 0 : limit(d.maxWidth ?? DEFAULTS.maxWidth),
    maxHeight: d.maxHeight === 0 ? 0 : limit(d.maxHeight ?? DEFAULTS.maxHeight),
    format: Object.hasOwn(FORMATS, d.format) ? d.format : DEFAULTS.format,
    quality: Number.isFinite(q) ? Math.min(100, Math.max(1, q)) : DEFAULTS.quality
  };
}

/* "Holiday photo.JPG" + "webp" -> "Holiday photo.webp" */
export function outputName(name, format) {
  const ext = (FORMATS[format] || FORMATS.jpeg).ext;
  const base = String(name || "image")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")   // unsafe in file names
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .trim() || "image";
  return `${base.slice(0, 120)}.${ext}`;
}

/* Same name twice in one zip? Number the repeats: a.webp, a (2).webp */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((n) => {
    const key = n.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count === 1) { return n; }
    const dot = n.lastIndexOf(".");
    const out = dot > 0 ? `${n.slice(0, dot)} (${count})${n.slice(dot)}` : `${n} (${count})`;
    seen.set(out.toLowerCase(), 1);
    return out;
  });
}

/* 1536 -> "1.5 KB" */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) { return "-"; }
  if (n < 1024) { return `${n} B`; }
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/* How much smaller, in whole percent. Negative = it got bigger. */
export function percentSaved(before, after) {
  if (!(before > 0) || !(after >= 0)) { return 0; }
  return Math.round((1 - after / before) * 100);
}

/* Worth trying to decode? Phones sometimes give no type at all. */
export function looksLikeImage(file) {
  if (!file) { return false; }
  if (/^image\//.test(file.type || "")) { return true; }
  return !file.type && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name || "");
}

/* The zip's file name for today. */
export function zipName(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `squished-images-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`;
}
