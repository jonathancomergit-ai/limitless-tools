/* ============================================================
   SFX Maker - unit tests
   The synth is deterministic, and the WAV header is right.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  render, encodeWav, preset, randomize, mutate, normalize, peak, defaults, wavName,
  PRESETS, WAVES, RANGES, SAMPLE_RATE
} from "../../items/sfx-maker/synth.js";

const text = (bytes, start, len) => String.fromCharCode(...bytes.subarray(start, start + len));

test("the same settings always give the same samples", () => {
  for (const name of PRESETS) {
    const s = preset(name, 42);
    const a = render(s);
    const b = render(structuredClone(s));
    assert.equal(a.length, b.length, name);
    assert.deepEqual(a, b, `${name} rendered differently twice`);
  }
  /* Noise too: it comes from the seed, not Math.random. */
  const noisy = { ...defaults(), wave: "noise", seed: 7 };
  assert.deepEqual(render(noisy), render(noisy));
  assert.notDeepEqual(render(noisy), render({ ...noisy, seed: 8 }));
});

test("presets and randomize are repeatable by seed, and differ between seeds", () => {
  assert.deepEqual(preset("coin", 3), preset("coin", 3));
  assert.notDeepEqual(preset("coin", 3), preset("coin", 4));
  assert.deepEqual(randomize(9), randomize(9));
  assert.deepEqual(mutate(preset("jump", 1), 5), mutate(preset("jump", 1), 5));
  assert.notDeepEqual(mutate(preset("jump", 1), 5), preset("jump", 1));
});

test("every preset makes a real, non-silent sound inside the -1..1 range", () => {
  for (const name of PRESETS) {
    for (const seed of [1, 2, 3]) {
      const s = render(preset(name, seed));
      const p = peak(s);
      assert.ok(p > 0.1, `${name}/${seed} is too quiet (${p})`);
      assert.ok(p <= 1, `${name}/${seed} clips`);
      assert.ok(s.length > SAMPLE_RATE * 0.02, `${name} is too short`);
    }
  }
  for (let seed = 1; seed < 30; seed++) { assert.ok(peak(render(randomize(seed))) > 0.05, `randomize(${seed}) is silent`); }
});

test("length follows attack + sustain + decay", () => {
  const s = render({ ...defaults(), attack: 0.1, sustain: 0.2, decay: 0.3 });
  assert.equal(s.length, Math.round(0.6 * SAMPLE_RATE));
  assert.equal(peak(render({ ...defaults(), volume: 0 })), 0);
});

test("normalize clamps junk to safe values", () => {
  const n = normalize({ wave: "kazoo", freq: 99999, slide: -50, duty: 2, volume: "loud", seed: -1 });
  assert.equal(n.wave, "square");
  assert.equal(n.freq, RANGES.freq[1]);
  assert.equal(n.slide, RANGES.slide[0]);
  assert.equal(n.duty, RANGES.duty[1]);
  assert.equal(n.volume, RANGES.volume[2]);
  assert.ok(Number.isInteger(n.seed) && n.seed >= 0);
  assert.ok(normalize({ attack: 0, sustain: 0, decay: 0 }).sustain > 0, "never zero length");
  for (const w of WAVES) { assert.equal(normalize({ wave: w }).wave, w); }
});

test("WAV header: RIFF, PCM, 16-bit mono, 44.1 kHz", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
  const wav = encodeWav(samples);
  const v = new DataView(wav.buffer);

  assert.equal(text(wav, 0, 4), "RIFF");
  assert.equal(v.getUint32(4, true), wav.length - 8);
  assert.equal(text(wav, 8, 4), "WAVE");
  assert.equal(text(wav, 12, 4), "fmt ");
  assert.equal(v.getUint32(16, true), 16);
  assert.equal(v.getUint16(20, true), 1, "PCM");
  assert.equal(v.getUint16(22, true), 1, "mono");
  assert.equal(v.getUint32(24, true), 44100, "44.1 kHz");
  assert.equal(v.getUint32(28, true), 44100 * 2, "byte rate");
  assert.equal(v.getUint16(32, true), 2, "block align");
  assert.equal(v.getUint16(34, true), 16, "16-bit");
  assert.equal(text(wav, 36, 4), "data");
  assert.equal(v.getUint32(40, true), samples.length * 2);
  assert.equal(wav.length, 44 + samples.length * 2);

  /* The samples themselves, clipped to the 16-bit range. */
  const pcm = [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true));
  assert.deepEqual(pcm, [0, 16384, -16384, 32767, -32768, 32767]);
});

test("wavName makes a safe file name", () => {
  assert.equal(wavName("Big Coin!!"), "big-coin.wav");
  assert.equal(wavName(""), "sound.wav");
  assert.equal(wavName("../../etc"), "etc.wav");
});
