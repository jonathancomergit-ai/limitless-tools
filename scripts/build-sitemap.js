/* ============================================================
   sitemap.xml from items.json

     npm run sitemap

   Lists the hub and every item that is built (planned "soon"
   items are left out). lastmod is the item's "added" date; the
   hub's is the newest of those. The site address comes from
   site.config.js (this wing's url), so no address is typed here.

   tests/unit/sitemap.test.js fails if sitemap.xml is out of date.
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import site from "../site.config.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SITEMAP = path.join(ROOT, "sitemap.xml");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* The text sitemap.xml should hold, for this items.json. */
export function buildSitemap(items = JSON.parse(fs.readFileSync(path.join(ROOT, "items.json"), "utf8"))) {
  const wing = site.wings.find((w) => w.wing === site.wing);
  if (!wing || !wing.url) { throw new Error(`site.config.js has no url for the "${site.wing}" wing.`); }
  const base = wing.url.endsWith("/") ? wing.url : `${wing.url}/`;
  const built = items.filter((it) => !it.soon);
  const dates = built.map((it) => it.added).filter(isDate).sort();
  const urls = [
    { loc: base, lastmod: dates[dates.length - 1] },
    ...built.map((it) => ({ loc: `${base}items/${it.slug}/`, lastmod: isDate(it.added) ? it.added : undefined }))
  ];
  const lines = urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</urlset>\n`;
}

/* Run directly: write the file. Imported (by the test): do nothing. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.writeFileSync(SITEMAP, buildSitemap());
  console.log(`Wrote ${path.relative(ROOT, SITEMAP)}`);
}
