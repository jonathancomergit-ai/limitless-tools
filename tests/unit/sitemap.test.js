/* ============================================================
   sitemap.xml must match items.json

   Fails when an item is added (or a "soon" one is built) and
   the sitemap wasn't rebuilt. Fix: npm run sitemap
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSitemap, SITEMAP } from "../../scripts/build-sitemap.js";

test("sitemap.xml is up to date with items.json (run: npm run sitemap)", () => {
  assert.ok(fs.existsSync(SITEMAP), "sitemap.xml is missing. Run: npm run sitemap");
  const onDisk = fs.readFileSync(SITEMAP, "utf8").replace(/\r\n/g, "\n");   // Windows checkouts may add \r
  assert.equal(onDisk, buildSitemap(), "sitemap.xml is stale. Run: npm run sitemap");
});

test("sitemap: hub first, built items only, lastmod from added", () => {
  const xml = buildSitemap([
    { slug: "a-tool", added: "2026-01-02" },
    { slug: "later", soon: true },
    { slug: "b-tool", added: "2026-03-04" }
  ]);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 3);
  assert.match(locs[0], /\/limitless-tools\/$/);
  assert.match(locs[1], /\/limitless-tools\/items\/a-tool\/$/);
  assert.match(locs[2], /\/limitless-tools\/items\/b-tool\/$/);
  assert.doesNotMatch(xml, /later/);
  const mods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  assert.deepEqual(mods, ["2026-03-04", "2026-01-02", "2026-03-04"]);
});
