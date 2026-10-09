/* ============================================================
   SFX Maker - the synth (pure, no DOM, no Web Audio)

   A tiny retro sound-effect synth in the spirit of sfxr:
   one oscillator, a pitch that slides, a little vibrato and
   an attack / sustain / decay volume shape.

     render(settings)        -> Float32Array of samples (-1..1)
     encodeWav(samples)      -> Uint8Array, a 16-bit mono 44.1 kHz WAV
     preset("coin", seed)    -> settings for a fresh coin sound
     randomize(seed) / mutate(settings, seed)

   Everything is deterministic: the same settings (including the
   seed used by the noise wave) always give the same samples.
   Unit tested in tests/unit/sfx-maker.test.js.
   ============================================================ */

export const SAMPLE_RATE = 44100;
export const WAVES = ["square", "saw", "sine", "noise"];
export const MAX_SECONDS = 4;

/* Every number setting: [min, max, default]. */
export const RANGES = {
  attack:   [0, 1, 0],          // seconds to reach full volume
  sustain:  [0, 1.5, 0.08],     // seconds at full volume
  decay:    [0, 2, 0.25],       // seconds to fade out
  freq:     [40, 2400, 660],    // start pitch, Hz
  slide:    [-6, 6, 0],         // pitch slide, octaves per second
  vibDepth: [0, 0.5, 0],        // vibrato size (0.1 = 10% of the pitch)
  vibSpeed: [0, 30, 6],         // vibrato wobbles per second
  duty:     [0.05, 0.5, 0.5],   // square wave: how much of each cycle is "up"
  volume:   [0, 1, 0.6]
};

export const PRESETS = ["coin", "jump", "laser", "explosion", "powerup", "hit", "blip"];

export function defaults() {
  const s = { wave: "square", seed: 1 };
  for (const [k, [, , d]] of Object.entries(RANGES)) { s[k] = d; }
  return s;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

/* Clean settings from a slider, a save file or a mutation. */
export function normalize(s = {}) {
  const out = defaults();
  out.wave = WAVES.includes(s.wave) ? s.wave : out.wave;
  out.seed = Number.isInteger(s.seed) ? s.seed >>> 0 : out.seed;
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = Number(s[k]);
    if (Number.isFinite(v)) { out[k] = round(clamp(v, lo, hi), k === "freq" ? 1 : 3); }
  }
  /* Never a sound of zero length. */
  if (out.attack + out.sustain + out.decay < 0.02) { out.sustain = 0.02; }
  return out;
}

/* ---- a small seeded random generator (mulberry32) ---- */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The pitch in Hz at time t: start, slid by octaves per second,
   plus vibrato. Used by render() and to draw the pitch line. */
export function pitchAt(s, t) {
  let f = s.freq * 2 ** (s.slide * t);
  if (s.vibDepth > 0) { f *= 1 + s.vibDepth * Math.sin(2 * Math.PI * s.vibSpeed * t); }
  return clamp(f, 20, 20000);
}

/* ============================================================
   RENDER
   ============================================================ */
export function render(input, sampleRate = SAMPLE_RATE) {
  const s = normalize(input);
  const seconds = Math.min(MAX_SECONDS, s.attack + s.sustain + s.decay);
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const out = new Float32Array(n);
  const rand = rng(s.seed);

  const aEnd = s.attack * sampleRate;
  const sEnd = aEnd + s.sustain * sampleRate;
  const dLen = s.decay * sampleRate;

  let phase = 0;
  let noise = rand() * 2 - 1;
  const gain = s.volume * 0.8;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;

    const f = pitchAt(s, t);

    phase += f / sampleRate;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      noise = rand() * 2 - 1;       // noise: a new random level each cycle
    }

    let v;
    switch (s.wave) {
      case "saw":   v = 2 * phase - 1; break;
      case "sine":  v = Math.sin(2 * Math.PI * phase); break;
      case "noise": v = noise; break;
      default:      v = phase < s.duty ? 1 : -1;
    }

    /* volume shape */
    let env;
    if (i < aEnd) { env = i / aEnd; } else if (i < sEnd) { env = 1; } else { env = dLen > 0 ? Math.max(0, 1 - (i - sEnd) / dLen) : 0; }

    out[i] = v * env * gain;
  }

  /* A 2 ms fade at both ends stops clicks. */
  const fade = Math.min(Math.floor(sampleRate * 0.002), n >> 1);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    if (s.attack === 0) { out[i] *= k; }
    out[n - 1 - i] *= k;
  }
  return out;
}

/* Loudest sample, 0..1. 0 = silent. */
export function peak(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) { p = a; } }
  return p;
}

/* ============================================================
   WAV (RIFF, PCM, 16-bit, mono)
   ============================================================ */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const bytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) { v.setUint8(o + i, s.charCodeAt(i)); } };

  str(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);              // fmt chunk size
  v.setUint16(20, 1, true);               // PCM
  v.setUint16(22, 1, true);               // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);  // bytes per second
  v.setUint16(32, 2, true);               // bytes per sample frame
  v.setUint16(34, 16, true);              // bits per sample
  str(36, "data");
  v.setUint32(40, bytes, true);

  for (let i = 0; i < samples.length; i++) {
    const x = clamp(samples[i], -1, 1);
    v.setInt16(44 + i * 2, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true);
  }
  return new Uint8Array(buf);
}

/* ============================================================
   PRESETS, RANDOMIZE, MUTATE
   Each preset is a recipe with a little randomness, so pressing
   "coin" twice gives two different coins. Same seed = same sound.
   ============================================================ */
export function preset(name, seed = 1) {
  const r = rng(seed);
  const between = (a, b) => a + (b - a) * r();
  const pick = (list) => list[Math.floor(r() * list.length)];
  const s = defaults();
  s.seed = Math.floor(r() * 2 ** 31);

  switch (name) {
    case "coin":
      Object.assign(s, { wave: pick(["square", "saw"]), freq: between(700, 1300), sustain: between(0.03, 0.08),
        decay: between(0.15, 0.35), slide: between(0.5, 2.5), duty: between(0.2, 0.5) });
      break;
    case "jump":
      Object.assign(s, { wave: "square", freq: between(250, 450), sustain: between(0.05, 0.12),
        decay: between(0.12, 0.25), slide: between(1.5, 4), duty: between(0.25, 0.5) });
      break;
    case "laser":
      Object.assign(s, { wave: pick(["square", "saw", "sine"]), freq: between(900, 2200), sustain: between(0.03, 0.1),
        decay: between(0.08, 0.25), slide: between(-6, -3), duty: between(0.1, 0.4) });
      break;
    case "explosion":
      Object.assign(s, { wave: "noise", freq: between(60, 220), sustain: between(0.05, 0.25),
        decay: between(0.4, 1.1), slide: between(-1.5, 0), vibDepth: r() < 0.5 ? between(0.1, 0.4) : 0, vibSpeed: between(4, 14) });
      break;
    case "powerup":
      Object.assign(s, { wave: pick(["square", "sine"]), freq: between(200, 500), sustain: between(0.15, 0.35),
        decay: between(0.15, 0.4), slide: between(1, 3), vibDepth: between(0.05, 0.2), vibSpeed: between(10, 22), duty: between(0.3, 0.5) });
      break;
    case "hit":
      Object.assign(s, { wave: pick(["noise", "saw", "square"]), freq: between(150, 500), sustain: between(0.01, 0.05),
        decay: between(0.06, 0.18), slide: between(-5, -2), duty: between(0.2, 0.5) });
      break;
    case "blip":
      Object.assign(s, { wave: pick(["square", "sine"]), freq: between(400, 1400), sustain: between(0.02, 0.06),
        decay: between(0.02, 0.08), duty: between(0.25, 0.5) });
      break;
    default:
      return randomize(seed);
  }
  return normalize(s);
}

export function randomize(seed = 1) {
  const r = rng(seed ^ 0x9e3779b9);
  const s = { wave: WAVES[Math.floor(r() * WAVES.length)], seed: Math.floor(r() * 2 ** 31) };
  for (const [k, [lo, hi]] of Object.entries(RANGES)) { s[k] = lo + (hi - lo) * r(); }
  /* Pure random is mostly unpleasant: keep it short, loud enough and sane. */
  s.attack *= r() * 0.3;
  s.sustain *= 0.4;
  s.decay = 0.05 + s.decay * 0.4;
  s.freq = 80 * 2 ** (r() * 4.5);
  s.slide *= 0.6;
  s.vibDepth *= r() < 0.6 ? 0 : 0.6;
  s.volume = 0.5 + r() * 0.3;
  return normalize(s);
}

/* Nudge every number a little: "like this, but different". */
export function mutate(input, seed = 1) {
  const s = normalize(input);
  const r = rng(seed ^ 0x51ed270b);
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (k === "volume" || r() < 0.4) { continue; }
    s[k] += (r() * 2 - 1) * (hi - lo) * 0.06;
  }
  s.freq = normalize(input).freq * 2 ** ((r() * 2 - 1) * 0.3);
  s.seed = Math.floor(r() * 2 ** 31);
  return normalize(s);
}

/* A file name for a sound: "coin" -> "coin.wav" */
export function wavName(name) {
  const base = String(name || "sound").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${base || "sound"}.wav`;
}
