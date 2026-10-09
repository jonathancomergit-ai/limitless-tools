/* ============================================================
   Every page, phone + desktop

   Finds the hub and every items/<slug>/ folder by itself (the
   template is skipped), then for each one, at both sizes:

     1. loads it
     2. fails on any console error or uncaught error
     3. fails on any request to another origin
        (GoatCounter is stubbed; anything else is blocked + fails)
     4. fails if the page scrolls sideways (and again at 360 px)
     5. checks each visible canvas isn't blank after 1 second
     6. saves test-results/screens/<slug>-<size>.png
     7. runs items/<slug>/smoke.js if there is one
     8. checks no cookies were set and every saved key is namespaced

   Adding an item needs NO change here.
   ============================================================ */

import { test, expect } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  SCREENS, discoverPages, readItemsJson, guard, horizontalOverflow, canvasIsBlank
} from "./helpers.js";

const pages = discoverPages();

for (const target of pages) {
  test(`${target.slug}: loads clean, fits the screen, works`, async ({ page, baseURL }, testInfo) => {
    const size = testInfo.project.name;            // "phone" | "desktop"
    const isMobile = Boolean(testInfo.project.use.isMobile);
    const origin = new URL(baseURL).origin;
    const { problems } = await guard(page, origin);

    /* ---- 1. load ---- */
    await page.goto(target.url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    if (target.slug === "hub") {
      /* Every items.json entry became a card. */
      const items = readItemsJson();
      await expect(page.locator("#grid .card")).toHaveCount(items.length);
      await expect(page.locator(".privacy-note")).toContainText("No accounts, no cookies.");
    }

    await page.waitForTimeout(1000);

    /* ---- 2 + 3. errors and outside requests so far ---- */
    expect(problems, "problems while loading").toEqual([]);

    /* ---- 4. sideways scroll ---- */
    expect(await horizontalOverflow(page), "horizontal overflow").toBeNull();

    /* ---- 5. canvas not blank ---- */
    const canvases = page.locator("canvas:visible");
    const n = await canvases.count();
    for (let i = 0; i < n; i++) {
      expect(await canvasIsBlank(page, canvases.nth(i)), `canvas #${i + 1} is blank after 1 s`).toBe(false);
    }

    /* ---- 6. screenshot for the PR ----
       Heads-up: in Chromium a fullPage shot on a phone context flips
       (hover)/(pointer) media queries to desktop values for the rest
       of the test. Never hide touch UI with those queries - kit/input.js
       uses hasTouch() instead, which this doesn't affect. */
    await page.screenshot({ path: path.join(SCREENS, `${target.slug}-${size}.png`), fullPage: true });

    /* ---- 7. the item's own smoke test ---- */
    if (target.smoke) {
      const mod = await import(pathToFileURL(target.smoke).href);
      await mod.default({ page, expect, size, isMobile });
      expect(problems, "problems during smoke.js").toEqual([]);
      expect(await horizontalOverflow(page), "horizontal overflow after smoke.js").toBeNull();
    }

    /* ---- 4b. the narrowest phone we support: 360 px ---- */
    if (isMobile) {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.waitForTimeout(150);
      expect(await horizontalOverflow(page), "horizontal overflow at 360px").toBeNull();
    }

    /* ---- 8. privacy leftovers ---- */
    expect(await page.context().cookies(), "cookies").toEqual([]);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    for (const k of keys) { expect(k, "localStorage keys must come from kit/save.js").toMatch(/^ll:[a-z0-9-]+:[a-z0-9-]+$/); }
  });
}

/* ============================================================
   The hub links to every item, and only to items that exist.
   ============================================================ */
test("hub: every card opens a real item", async ({ page }) => {
  await page.goto("/");
  const hrefs = await page.locator("#grid .card h3 a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const folders = pages.filter((p) => p.slug !== "hub").map((p) => `items/${p.slug}/`);
  expect(hrefs.sort()).toEqual(folders.sort());
});
