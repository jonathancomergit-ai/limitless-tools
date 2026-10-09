/* ============================================================
   Icon Maker - the pure parts

   No DOM in here, so it's all unit tested
   (tests/unit/icon-maker.test.js).

     OUTPUTS            every file we make, and its size
     normalizeSettings  tidy saved / typed settings
     placement          where the picture goes inside an icon
     makeIco            several PNGs -> one favicon.ico
     linkTags/manifest  the snippets to paste into a site
   ============================================================ */

/* kind:
     plain     your padding, background and corners
     apple     always a filled square (iOS rounds it for you)
     maskable  filled to the edge, picture kept in the safe zone */
export const OUTPUTS = [
  { file: "favicon.ico", sizes: [16, 32, 48], kind: "plain", label: "favicon.ico", note: "16, 32 and 48 in one file" },
  { file: "apple-touch-icon.png", size: 180, kind: "apple", label: "Apple touch", note: "180 × 180" },
  { file: "icon-192.png", size: 192, kind: "plain", label: "Android", note: "192 × 192" },
  { file: "icon-512.png", size: 512, kind: "plain", label: "Android", note: "512 × 512" },
  { file: "icon-maskable-512.png", size: 512, kind: "maskable", label: "Maskable", note: "512 × 512, safe zone" }
];

export const ICO_SIZES = [16, 32, 48];

/* The maskable safe zone: a circle 80% of the icon wide. A square
   picture fits inside it at 80% / sqrt(2) of the icon. */
export const SAFE_ZONE = 0.8;
export const SAFE_SQUARE = SAFE_ZONE / Math.SQRT2;    // ~0.566

export const DEFAULTS = Object.freeze({
  fit: "contain",     // contain = whole picture; cover = fill the square, crop the rest
  padding: 8,         // % of the icon on each side
  radius: 18,         // % of the icon: 0 = square, 50 = circle
  bg: "#11121c",
  transparent: false,
  name: "My Site",
  shortName: "Site"
});

const HEX = /^#[0-9a-f]{6}$/i;

export function int(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) { return fallback; }
  return Math.min(hi, Math.max(lo, n));
}

/* "#ABC" -> "#aabbcc"; anything else -> null */
export function normalizeHex(v) {
  let s = String(v || "").trim().toLowerCase();
  if (!s.startsWith("#")) { s = `#${s}`; }
  if (/^#[0-9a-f]{3}$/.test(s)) { s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`; }
  return HEX.test(s) ? s : null;
}

/* Names go into JSON and HTML: keep them short and plain. */
export function cleanName(v, max, fallback) {
  const s = String(v ?? "").replace(/[\u0000-\u001f<>"]/g, "").trim().slice(0, max);
  return s || fallback;
}

export function normalizeSettings(d = {}) {
  const s = d && typeof d === "object" ? d : {};
  return {
    fit: s.fit === "cover" ? "cover" : "contain",
    padding: int(s.padding, 0, 40, DEFAULTS.padding),
    radius: int(s.radius, 0, 50, DEFAULTS.radius),
    bg: normalizeHex(s.bg) || DEFAULTS.bg,
    transparent: typeof s.transparent === "boolean" ? s.transparent : DEFAULTS.transparent,
    name: cleanName(s.name, 45, DEFAULTS.name),
    shortName: cleanName(s.shortName, 12, DEFAULTS.shortName)
  };
}

/* ============================================================
   PLACEMENT
   Where the picture goes in a size x size icon.
   -> { sx, sy, sw, sh,  dx, dy, dw, dh }  for drawImage(9 args)
   ============================================================ */
export function placement(srcW, srcH, size, settings, kind = "plain") {
  const s = normalizeSettings(settings);
  let pad = s.padding / 100;
  if (kind === "maskable") {
    /* Keep the picture inside the safe circle, whatever the padding. */
    pad = Math.max(pad, (1 - SAFE_SQUARE) / 2);
  }
  const box = size * (1 - 2 * pad);
  const off = (size - box) / 2;

  if (s.fit === "cover") {
    /* Crop the middle square out of the picture. */
    const side = Math.min(srcW, srcH);
    return {
      sx: (srcW - side) / 2, sy: (srcH - side) / 2, sw: side, sh: side,
      dx: off, dy: off, dw: box, dh: box
    };
  }
  /* Whole picture, centred, keeping its shape. */
  const k = box / Math.max(srcW, srcH);
  const dw = srcW * k;
  const dh = srcH * k;
  return {
    sx: 0, sy: 0, sw: srcW, sh: srcH,
    dx: (size - dw) / 2, dy: (size - dh) / 2, dw, dh
  };
}

/* Corner radius in pixels for one icon. Apple and maskable icons
   are always square: the phone cuts its own shape. */
export function cornerRadius(size, settings, kind = "plain") {
  if (kind !== "plain") { return 0; }
  return (size * normalizeSettings(settings).radius) / 100;
}

/* Is the background see-through for this icon? */
export function isClear(settings, kind = "plain") {
  return kind === "plain" && normalizeSettings(settings).transparent;
}

/* ============================================================
   ICO
   Since Windows Vista, an .ico can hold whole PNG files, and
   every browser reads that. So it's just:

     ICONDIR       6 bytes: 0, type 1 (icon), count
     ICONDIRENTRY  16 bytes per image:
                   width, height (0 means 256), colours 0,
                   reserved 0, planes 1, bits 32, size, offset
     the PNGs, one after another

   images: [{ size: 16, data: Uint8Array (a PNG) }]
   ============================================================ */
export function makeIco(images) {
  if (!Array.isArray(images) || !images.length) { throw new Error("No images for the .ico."); }
  if (images.length > 255) { throw new Error("Too many images for one .ico."); }
  const head = 6 + 16 * images.length;
  const total = images.reduce((n, im) => n + im.data.length, head);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, 1, true);
  v.setUint16(4, images.length, true);

  let offset = head;
  images.forEach((im, i) => {
    if (!(im.size >= 1 && im.size <= 256)) { throw new Error("ICO images must be 1 to 256 pixels."); }
    const p = 6 + 16 * i;
    out[p] = im.size === 256 ? 0 : im.size;      // width
    out[p + 1] = im.size === 256 ? 0 : im.size;  // height
    out[p + 2] = 0;                              // palette colours
    out[p + 3] = 0;                              // reserved
    v.setUint16(p + 4, 1, true);                 // colour planes
    v.setUint16(p + 6, 32, true);                // bits per pixel
    v.setUint32(p + 8, im.data.length, true);
    v.setUint32(p + 12, offset, true);
    out.set(im.data, offset);
    offset += im.data.length;
  });
  return out;
}

/* ============================================================
   SNIPPETS
   ============================================================ */
export function linkTags() {
  return [
    '<link rel="icon" href="/favicon.ico" sizes="any">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">'
  ].join("\n");
}

export function manifest(settings) {
  const s = normalizeSettings(settings);
  return JSON.stringify({
    name: s.name,
    short_name: s.shortName,
    icons: [
      { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
      { src: "/icon-maskable-512.png", type: "image/png", sizes: "512x512", purpose: "maskable" }
    ],
    theme_color: s.bg,
    background_color: s.bg,
    display: "standalone"
  }, null, 2);
}
