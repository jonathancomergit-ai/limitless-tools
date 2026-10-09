/* ============================================================
   GIF Maker - the encoding worker

   Runs gif.js off the main thread, so the page never freezes
   while a big GIF is packed.

   In:   { id, width, height, colors, dither, loop,
           frames: [{ data: ArrayBuffer (RGBA), delay: ms }] }
         The frame buffers are transferred, not copied.
   Out:  { id, type: "progress", done, total }   one per frame
         { id, type: "done", bytes: ArrayBuffer } transferred back
         { id, type: "error", message }
   ============================================================ */

import { encodeGif } from "./gif.js";

self.addEventListener("message", (e) => {
  const job = e.data || {};
  const { id } = job;
  try {
    const frames = (job.frames || []).map((f) => ({ data: new Uint8ClampedArray(f.data), delay: f.delay }));
    self.postMessage({ id, type: "progress", done: 0, total: frames.length });
    const bytes = encodeGif({
      width: job.width,
      height: job.height,
      frames,
      colors: job.colors,
      dither: job.dither,
      loop: job.loop,
      onProgress: (done, total) => self.postMessage({ id, type: "progress", done, total })
    });
    self.postMessage({ id, type: "done", bytes: bytes.buffer }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ id, type: "error", message: (err && err.message) || "Couldn't make the GIF." });
  }
});
