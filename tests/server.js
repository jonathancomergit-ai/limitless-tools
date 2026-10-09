/* ============================================================
   Tiny static server for tests and local play.

     npm run serve            -> http://127.0.0.1:4173
     PORT=8080 npm run serve  -> another port

   Serves the repo folder exactly like GitHub Pages would:
   folder/ -> folder/index.html, and folder -> folder/ redirect.
   No dependencies; refuses anything outside the repo.
   ============================================================ */

import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".ico":  "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt":  "text/plain; charset=utf-8",
  ".md":   "text/plain; charset=utf-8",
  ".mp3":  "audio/mpeg",
  ".ogg":  "audio/ogg",
  ".wav":  "audio/wav"
};

/* Folders that exist in the repo but are never part of the site. */
const PRIVATE = /^\/(node_modules|\.git|\.github|\.claude|test-results|playwright-report)(\/|$)/;

function send(res, code, text) {
  res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    return send(res, 400, "Bad request");
  }
  if (PRIVATE.test(urlPath)) { return send(res, 404, "Not found"); }

  let file = path.join(ROOT, urlPath);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { return send(res, 403, "Forbidden"); }

  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      if (!urlPath.endsWith("/")) {
        res.writeHead(301, { location: urlPath + "/" });
        return res.end();
      }
      file = path.join(file, "index.html");
      info = await stat(file);
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-store"
    });
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, "Not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT} at http://${HOST}:${PORT}/`);
});
