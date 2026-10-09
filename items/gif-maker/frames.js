/* ============================================================
   GIF Maker - pure logic (no DOM)

   Everything here is plain maths on numbers and lists, so the
   unit tests can check it in Node:

     settings     defaults + normaliseSettings()
     crop         the output shape, and where to cut each photo
     size         output width x height from the "size" setting
     order        move a frame earlier / later
     loop         the setting -> the number the GIF stores
     camera       how many frames a clip gets, and how often
     estimate     a quick "about this big" from a small test GIF
     names        a safe file name for the download
   ============================================================ */

/* ---- settings ---- */
export const SIZES = [160, 240, 320, 480, 640];     // longest side, px
export const CROPS = ["original", "square", "wide"];
export const LOOPS = ["forever", "once", "times"];
export const MIN_DELAY = 20;                        // GIF delays are 1/100 s; 20 ms plays the same everywhere
export const MAX_DELAY = 2000;
export const MIN_COLORS = 64;
export const MAX_COLORS = 256;
export const MAX_FRAMES = 100;                      // photos + clip frames, all together
export const MAX_CLIP_FRAMES = 60;                  // one clip
export const MAX_SOURCE = 960;                      // photos are kept at most this big (longest side)

export const DEFAULTS = Object.freeze({
  size: 320,
  delay: 200,
  loop: "forever",
  loopCount: 3,
  colors: 128,
  dither: true,
  crop: "original",
  clipSeconds: 2
});

const int = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/* Anything in (an old save, an import, a form) -> safe settings. */
export function normalizeSettings(raw = {}) {
  const d = raw && typeof raw === "object" ? raw : {};
  const size = SIZES.includes(Number(d.size)) ? Number(d.size) : DEFAULTS.size;
  return {
    size,
    delay: Math.round(int(d.delay, MIN_DELAY, MAX_DELAY, DEFAULTS.delay) / 10) * 10,
    loop: LOOPS.includes(d.loop) ? d.loop : DEFAULTS.loop,
    loopCount: int(d.loopCount, 2, 20, DEFAULTS.loopCount),
    colors: int(d.colors, MIN_COLORS, MAX_COLORS, DEFAULTS.colors),
    dither: typeof d.dither === "boolean" ? d.dither : DEFAULTS.dither,
    crop: CROPS.includes(d.crop) ? d.crop : DEFAULTS.crop,
    clipSeconds: int(d.clipSeconds, 1, 5, DEFAULTS.clipSeconds)
  };
}

/* ---- crop ---- */

/* The shape of the GIF (width / height). "original" follows the
   first frame, so a GIF of portrait photos stays portrait. */
export function targetAspect(crop, firstW = 4, firstH = 3) {
  if (crop === "square") { return 1; }
  if (crop === "wide") { return 16 / 9; }
  return firstW > 0 && firstH > 0 ? firstW / firstH : 4 / 3;
}

/* The biggest centred box of that aspect inside a w x h picture.
   Frames of another shape are cut to fit, never stretched. */
export function cropRect(w, h, aspect) {
  if (!(w > 0 && h > 0 && aspect > 0)) { return { x: 0, y: 0, w: Math.max(0, w), h: Math.max(0, h) }; }
  let cw = w;
  let ch = w / aspect;
  if (ch > h) { ch = h; cw = h * aspect; }
  cw = Math.min(w, Math.max(1, Math.round(cw)));
  ch = Math.min(h, Math.max(1, Math.round(ch)));
  return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch };
}

/* ---- size ---- */

/* Output size: the longest side is `size`, the other follows the aspect. */
export function outputSize(aspect, size = DEFAULTS.size) {
  const s = Math.max(1, Math.round(size));
  if (!(aspect > 0)) { return { width: s, height: s }; }
  return aspect >= 1
    ? { width: s, height: Math.max(1, Math.round(s / aspect)) }
    : { width: Math.max(1, Math.round(s * aspect)), height: s };
}

/* Shrink w x h so the longest side is at most max (never grows). */
export function fitWithin(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/* ---- order ---- */

/* A copy of list with the item at `from` moved to `to`. */
export function moveItem(list, from, to) {
  const out = list.slice();
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) { return out; }
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/* ---- loop ---- */

/* The number for the GIF's Netscape block:
     0 = forever, -1 = no block (plays once), n = repeat n more times.
   "Play 3 times" = play once + repeat twice. */
export function loopValue(s) {
  if (s.loop === "once") { return -1; }
  if (s.loop === "times") { return Math.max(1, s.loopCount - 1); }
  return 0;
}

/* How many times the preview plays through before it stops. */
export function playCount(s) {
  if (s.loop === "once") { return 1; }
  if (s.loop === "times") { return s.loopCount; }
  return Infinity;
}

/* Which frame shows at time t (seconds), or -1 with no frames.
   Stops on the last frame once every play is done. */
export function frameAtTime(t, count, delayMs, plays = Infinity) {
  if (count <= 0) { return -1; }
  const step = Math.floor((Math.max(0, t) * 1000) / Math.max(1, delayMs));
  if (step >= count * plays) { return count - 1; }
  return step % count;
}

/* ---- camera ---- */

/* A clip of `seconds` with one frame every `delay` ms, so it plays
   back at real speed. Very short delays are stretched so a clip
   never holds more than MAX_CLIP_FRAMES (or the room left). */
export function clipPlan(seconds, delayMs, room = MAX_CLIP_FRAMES) {
  const ms = Math.max(1, seconds) * 1000;
  const cap = Math.max(0, Math.min(MAX_CLIP_FRAMES, room));
  if (!cap) { return { count: 0, interval: delayMs }; }
  const interval = Math.max(delayMs, Math.ceil(ms / cap));
  return { count: Math.max(1, Math.min(cap, Math.round(ms / interval))), interval };
}

/* ---- estimate ---- */

/* Bytes that don't grow with the picture: header, colour table,
   loop block, trailer, plus about 20 bytes a frame. */
export function fixedBytes(frames, tableBits) {
  return 13 + 3 * (1 << tableBits) + (frames > 1 ? 19 : 0) + 1 + frames * 20;
}

/* A test GIF made at a small size (same frames, colours and
   dithering) -> roughly how big the real one will be. Picture data
   grows with the area, a little slower than straight-line because
   bigger pictures have smoother runs for LZW to pack. */
export function estimateBytes({ sampleBytes, sampleW, sampleH, width, height, frames, tableBits = 8 }) {
  const fixed = fixedBytes(frames, tableBits);
  const body = Math.max(0, sampleBytes - fixed);
  const ratio = (width * height) / Math.max(1, sampleW * sampleH);
  return Math.round(fixed + body * Math.pow(ratio, 0.85));
}

/* 1234 -> "1.2 KB" */
export function formatBytes(n) {
  if (!(n >= 0)) { return "?"; }
  if (n < 1024) { return `${n} B`; }
  if (n < 1024 * 1024) { return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`; }
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ---- names ---- */

/* "My Holiday (1).JPG" -> "my-holiday-1". Empty -> fallback. */
export function baseName(name, fallback = "animation") {
  const s = String(name || "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || fallback;
}

export function gifFileName(name) { return `${baseName(name)}.gif`; }
