/* ============================================================
   Pixel Studio - GIF worker

   Runs off the main thread so the page never freezes.

   In:  { width, height, scale, delay, frames: [ArrayBuffer] }
        each frame = width x height packed colours (Uint32),
        already flattened (visible layers only).
   Out: { type: "progress", done, total }
        { type: "done", bytes }        (the whole .gif)
        { type: "error", message }

   Each frame is scaled up (nearest neighbour, so pixels stay
   sharp squares) BEFORE it's encoded.
   ============================================================ */

import { encodeGif } from "./gif.js";
import { scaleUp } from "./canvas-ops.js";

self.addEventListener("message", (e) => {
  const { width, height, scale, delay, frames } = e.data || {};
  try {
    const k = Math.max(1, Math.round(scale) || 1);
    const big = frames.map((buf) => ({
      data: new Uint8ClampedArray(scaleUp(new Uint32Array(buf), width, height, k).buffer),
      delay
    }));
    const bytes = encodeGif({
      width: width * k,
      height: height * k,
      frames: big,
      colors: 256,
      dither: false,
      loop: 0,
      onProgress: (done, total) => self.postMessage({ type: "progress", done, total })
    });
    self.postMessage({ type: "done", bytes }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", message: err && err.message ? err.message : "Couldn't make the GIF." });
  }
});
