/* ============================================================
   ASCII Cam - the pure mapping (no DOM, unit tested)

   Pixels in, text out:

     rgba (w x h)  ->  cols x rows cells  ->  one character each

   How a character is picked:

     1. Average the pixels in the cell (a box filter).
     2. Light level v = luma (Rec. 709), 0 = black .. 1 = white.
     3. Contrast + brightness: v = (v - 0.5) * k + 0.5 + b.
     4. Ink density: every character set is ordered by INK,
        from the emptiest (a space) to the fullest ("@", "█").
          - Light ink on a dark screen (green terminal, white
            on black, full colour): more light = more ink.
          - Dark ink on paper (black on white): less light =
            more ink, so the mapping flips.
        Either way black comes out as the darkest-looking
        character and white as the lightest-looking one.
     5. "Invert" flips it once more, for a negative.

   Characters are about twice as tall as they are wide, so a
   picture W x H becomes cols x round(cols * H / W * 0.5) cells.
   ============================================================ */

/* Ordered by ink: emptiest first, fullest last. */
export const CHARSETS = {
  classic: " .:-=+*#%@",
  blocks: " ░▒▓█",
  binary: " 10"            // "1" uses less ink than "0"
};

export const CHARSET_NAMES = ["classic", "blocks", "binary", "custom"];
export const COLOUR_MODES = ["green", "white", "paper", "colour"];

/* What each colour mode looks like. `ink` says which way the
   characters glow: "light" on a dark screen, "dark" on paper. */
export const LOOKS = {
  green:  { bg: "#020B06", fg: "#3DF5A0", ink: "light", label: "Green terminal" },
  white:  { bg: "#000000", fg: "#F2F2F2", ink: "light", label: "White on black" },
  paper:  { bg: "#FBFAF5", fg: "#111111", ink: "dark",  label: "Black on white" },
  colour: { bg: "#000000", fg: null,      ink: "light", label: "Full colour" }
};

/* Characters are ~twice as tall as wide (width / height). */
export const CELL_ASPECT = 0.5;

export const LIMITS = {
  cols: [24, 160],
  contrast: [-100, 100],
  brightness: [-100, 100],
  rows: 200,
  custom: 64
};

export const DEFAULTS = {
  cols: 64,
  contrast: 0,
  brightness: 0,
  charset: "classic",
  custom: " .oO@",
  colour: "green",
  invert: false,
  timer: false
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const int = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : d;
};

/* A user's own set: as typed, light ink first. Line breaks and
   tabs are dropped; at most 64 characters (emoji count as one). */
export function cleanCustom(text) {
  return Array.from(String(text ?? "").replace(/[\r\n\t]/g, "")).slice(0, LIMITS.custom).join("");
}

/* Any settings object -> a safe, complete one. */
export function normalizeSettings(s = {}) {
  const src = s && typeof s === "object" ? s : {};
  return {
    cols: int(src.cols, ...LIMITS.cols, DEFAULTS.cols),
    contrast: int(src.contrast, ...LIMITS.contrast, DEFAULTS.contrast),
    brightness: int(src.brightness, ...LIMITS.brightness, DEFAULTS.brightness),
    charset: CHARSET_NAMES.includes(src.charset) ? src.charset : DEFAULTS.charset,
    custom: typeof src.custom === "string" ? cleanCustom(src.custom) : DEFAULTS.custom,
    colour: COLOUR_MODES.includes(src.colour) ? src.colour : DEFAULTS.colour,
    invert: typeof src.invert === "boolean" ? src.invert : DEFAULTS.invert,
    timer: typeof src.timer === "boolean" ? src.timer : DEFAULTS.timer
  };
}

/* The characters to use, as an array (so "░" or an emoji is one).
   An empty custom set falls back to classic. */
export function charsFor(charset, custom = "") {
  if (charset === "custom") {
    const c = Array.from(cleanCustom(custom));
    if (c.length) { return c; }
  }
  return Array.from(CHARSETS[charset] || CHARSETS.classic);
}

/* How many rows of text for a w x h picture at `cols` columns. */
export function gridRows(w, h, cols, aspect = CELL_ASPECT) {
  if (!(w > 0) || !(h > 0) || !(cols > 0)) { return 1; }
  return clamp(Math.round((h / w) * cols * aspect), 1, LIMITS.rows);
}

/* Contrast factor from the -100..100 slider:
   0 = as is, +100 = 5x punchier, -100 = flat grey. */
export function contrastFactor(contrast) {
  const c = clamp(Number(contrast) || 0, -100, 100);
  return c >= 0 ? 1 + c / 25 : 1 + c / 100;
}

/* One light level (0..1) through contrast + brightness, 0..1 out. */
export function adjust(v, contrast = 0, brightness = 0) {
  const k = contrastFactor(contrast);
  const b = clamp(Number(brightness) || 0, -100, 100) / 200;   // +-0.5
  return clamp((v - 0.5) * k + 0.5 + b, 0, 1);
}

/* Rec. 709 luma of 0..255 r, g, b -> 0..1. */
export function luma(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/* Light level 0..1 -> index into a set of n characters. */
export function levelIndex(v, n, { ink = "light", invert = false } = {}) {
  let density = ink === "dark" ? 1 - v : v;
  if (invert) { density = 1 - density; }
  return clamp(Math.floor(density * n), 0, n - 1);
}

/* ============================================================
   toAscii(rgba, w, h, options)

   rgba     Uint8ClampedArray / array, w * h * 4 (ImageData.data)
   options  cols, rows (worked out if left out), contrast,
            brightness, charset, custom, colour (a mode name),
            invert, aspect

   Returns { lines, cols, rows, colors }
     lines   rows strings, each exactly cols characters
     colors  for "colour" mode: Uint8ClampedArray(cols*rows*3)
             of each cell's adjusted colour, else null

   See-through pixels count as black (a camera has none).
   ============================================================ */
export function toAscii(rgba, w, h, opts = {}) {
  const s = normalizeSettings(opts);
  const cols = clamp(Math.round(Number(opts.cols) || s.cols), 1, 1000);
  const rows = opts.rows ? clamp(Math.round(opts.rows), 1, 1000) : gridRows(w, h, cols, opts.aspect ?? CELL_ASPECT);
  const chars = charsFor(s.charset, s.custom);
  const look = LOOKS[s.colour];
  const wantColour = s.colour === "colour";
  const colors = wantColour ? new Uint8ClampedArray(cols * rows * 3) : null;
  const k = contrastFactor(s.contrast);
  const b = s.brightness / 200;
  const tone = (x) => clamp((x - 0.5) * k + 0.5 + b, 0, 1);
  const lines = [];

  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / rows));
    let line = "";
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / cols));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const i = (y * w + x) * 4;
          const a = rgba[i + 3] / 255;
          sr += rgba[i] * a;
          sg += rgba[i + 1] * a;
          sb += rgba[i + 2] * a;
          n++;
        }
      }
      if (n) { sr /= n; sg /= n; sb /= n; }
      const v = tone(luma(sr, sg, sb));
      line += chars[levelIndex(v, chars.length, { ink: look.ink, invert: s.invert })];
      if (colors) {
        const o = (r * cols + c) * 3;
        colors[o] = tone(sr / 255) * 255;
        colors[o + 1] = tone(sg / 255) * 255;
        colors[o + 2] = tone(sb / 255) * 255;
      }
    }
    lines.push(line);
  }
  return { lines, cols, rows, colors };
}

/* The text to copy: one line per row, trailing spaces trimmed. */
export function asText(lines) {
  return lines.map((l) => l.replace(/\s+$/u, "")).join("\n") + "\n";
}

/* True if the output has any ink at all (not just spaces). */
export function hasInk(lines) {
  return lines.some((l) => /\S/u.test(l));
}

/* "ascii-cam-20261009-153012" for file names. */
export function fileStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `ascii-cam-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* A friendly line for each getUserMedia failure. */
export function cameraError(err, { secure = true, supported = true } = {}) {
  if (!secure) { return "The camera only works on a secure (https) page. Try the sample instead."; }
  if (!supported) { return "This browser can't use a camera. Try the sample instead."; }
  switch (err && err.name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "Camera permission was denied. Allow the camera for this site in your browser settings, then press Start camera again. Or try the sample.";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "No camera found on this device. Try the sample instead.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is busy (another app or tab may be using it). Close that, then press Start camera again.";
    case "AbortError":
      return "The camera didn't start. Press Start camera to try again.";
    default:
      return "Couldn't start the camera. Press Start camera to try again, or try the sample.";
  }
}
