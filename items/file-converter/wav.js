/* ============================================================
   File Converter - WAV writer (16-bit PCM)

   The browser decodes the sound (MP3, OGG, M4A, ...) into
   Float32 samples, one array a channel, from -1 to 1. This
   turns them into the plainest sound file there is:

     "RIFF" <size> "WAVE"
     "fmt " 16  PCM=1  channels  rate  bytes/s  block align  16 bits
     "data" <size>  then samples, interleaved: L R L R ...

   All numbers little-endian. Pure functions, no DOM: unit
   tested in tests/unit/file-converter.test.js.
   ============================================================ */

export const MAX_WAV_BYTES = 0xffffffff - 44;

/* Average channels into one (for "mono"). */
export function mixToMono(channels) {
  if (channels.length === 1) { return [channels[0]]; }
  const len = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(len);
  for (const c of channels) { for (let i = 0; i < len; i++) { out[i] += c[i]; } }
  for (let i = 0; i < len; i++) { out[i] /= channels.length; }
  return [out];
}

/* channels: [Float32Array, ...] (same length), sampleRate: e.g. 44100. */
export function encodeWav(channels, sampleRate) {
  if (!Array.isArray(channels) || !channels.length) { throw new Error("No sound to save."); }
  const rate = Math.round(sampleRate);
  if (!(rate >= 1 && rate <= 768000)) { throw new Error("That sample rate doesn't look right."); }
  const ch = channels.length;
  const frames = Math.min(...channels.map((c) => c.length));
  const blockAlign = ch * 2;
  const dataSize = frames * blockAlign;
  if (dataSize > MAX_WAV_BYTES) { throw new Error("That sound is too long for one WAV file (4 GB)."); }

  const out = new Uint8Array(44 + dataSize);
  const v = new DataView(out.buffer);
  const tag = (p, s) => { for (let i = 0; i < 4; i++) { out[p + i] = s.charCodeAt(i); } };
  tag(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);                 // fmt chunk size
  v.setUint16(20, 1, true);                  // PCM
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * blockAlign, true);  // bytes a second
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true);                 // bits a sample
  tag(36, "data");
  v.setUint32(40, dataSize, true);

  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      let s = channels[c][i];
      s = s > 1 ? 1 : s < -1 ? -1 : s || 0;   // clamp, and NaN -> 0
      v.setInt16(p, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      p += 2;
    }
  }
  return out;
}
