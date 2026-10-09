/* ============================================================
   Fingerprint of kit/

     npm run kit:hash

   Prints one short hash of every file in kit/. Run it in all
   three repos: the same hash means kit/ is identical everywhere.
   A different hash means one repo's kit/ has drifted - copy the
   newest kit/ across (and say so in the PR).
   ============================================================ */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "kit");

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]))
    .sort();
}

const all = crypto.createHash("sha256");
for (const f of files(KIT)) {
  const rel = path.relative(KIT, f).split(path.sep).join("/");
  const h = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  all.update(`${rel}:${h}\n`);
  if (process.argv.includes("--list")) { console.log(`${h.slice(0, 12)}  ${rel}`); }
}
console.log(`kit/ ${all.digest("hex").slice(0, 16)}`);
