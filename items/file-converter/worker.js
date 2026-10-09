/* ============================================================
   File Converter - the heavy lifting, off the main thread

   A module worker, so the page stays smooth while it packs a
   zip, writes a long WAV or builds a PDF.

   in:  { id, op: "wav" | "zip" | "pdf", data }
   out: { id, ok: true, bytes } (bytes transferred, not copied)
        { id, ok: false, error }
   ============================================================ */

import { encodeWav, mixToMono } from "./wav.js";
import { makeZip } from "./zip.js";
import { makePdf } from "./pdf.js";

export function runJob(op, data) {
  if (op === "wav") {
    const channels = data.mono ? mixToMono(data.channels) : data.channels;
    return encodeWav(channels, data.sampleRate);
  }
  if (op === "zip") { return makeZip(data.entries); }
  if (op === "pdf") { return makePdf(data.jpegs, { title: data.title }); }
  throw new Error(`Unknown job: ${op}`);
}

/* Only wire up messages when really running as a worker. */
if (typeof self !== "undefined" && typeof window === "undefined" && typeof self.postMessage === "function") {
  self.addEventListener("message", (e) => {
    const { id, op, data } = e.data || {};
    try {
      const bytes = runJob(op, data);
      self.postMessage({ id, ok: true, bytes }, [bytes.buffer]);
    } catch (err) {
      self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
    }
  });
}
