/* ============================================================
   Privacy, proven in a real browser

   1. On localhost, stats.js loads NOTHING (no GoatCounter).
   2. On a production-like address, the ONLY outside request is
      GoatCounter's count.js, and its beacon is allowed by the
      Content-Security-Policy.
   3. The CSP really blocks everything else: a fetch, an image
      and a script from another origin are all refused.
   4. Export / Import / Delete my data work, using a real file.

   Runs on the desktop project only (see playwright.config.js).

   The fake production site is served from disk by Playwright
   itself (page.route), so nothing touches the network.
   ============================================================ */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ROOT, guard } from "./helpers.js";

const FAKE = "https://arcade.limitless.example";

/* Serve the repo at FAKE, and stub GoatCounter. Records every
   outside request so the test can list them. */
async function serveFake(page) {
  const seen = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === FAKE) {
      let file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (file.endsWith(path.sep)) { file = path.join(file, "index.html"); }
      if (!fs.existsSync(file)) { return route.fulfill({ status: 404, body: "" }); }
      return route.fulfill({ path: file });
    }
    seen.push(url.href);
    if (url.hostname === "gc.zgo.at") {
      /* Pretend count.js: send one beacon the way the real one does. */
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: "navigator.sendBeacon('https://jonjoe1001.goatcounter.com/count?p=' + encodeURIComponent(location.pathname));"
      });
    }
    if (url.hostname === "jonjoe1001.goatcounter.com") {
      return route.fulfill({ status: 204, body: "" });
    }
    return route.abort("blockedbyclient");
  });
  return seen;
}

test.describe("privacy", () => {
  test("localhost: stats.js stays silent", async ({ page, baseURL }) => {
    const { problems, outside } = await guard(page, new URL(baseURL).origin);
    await page.goto("/");
    await page.waitForTimeout(500);
    expect(outside).toEqual([]);
    expect(problems).toEqual([]);
    await expect(page.locator('script[src*="gc.zgo.at"]')).toHaveCount(0);
  });

  test("live site: GoatCounter is the only outside contact", async ({ page }) => {
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") { errors.push(m.text()); } });
    const seen = await serveFake(page);

    for (const url of [`${FAKE}/`, `${FAKE}/items/_template/`]) {
      seen.length = 0;
      await page.goto(url);
      await expect.poll(() => seen.length).toBeGreaterThanOrEqual(2);
      const hosts = [...new Set(seen.map((u) => new URL(u).hostname))].sort();
      expect(hosts).toEqual(["gc.zgo.at", "jonjoe1001.goatcounter.com"]);
    }
    expect(errors, "CSP must allow the GoatCounter beacon").toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
  });

  test("CSP blocks every other origin", async ({ page }) => {
    await serveFake(page);
    await page.goto(`${FAKE}/`);
    const blocked = await page.evaluate(async () => {
      const hits = [];
      document.addEventListener("securitypolicyviolation", (e) => hits.push(e.violatedDirective));
      try { await fetch("https://evil.example/track"); } catch { /* expected */ }
      const img = new Image();
      img.src = "https://evil.example/pixel.png";
      const s = document.createElement("script");
      s.src = "https://evil.example/x.js";
      document.head.append(s);
      await new Promise((r) => setTimeout(r, 300));
      return hits.sort();
    });
    expect(blocked).toEqual(["connect-src", "img-src", "script-src-elem"]);
  });
});

test.describe("save panel", () => {
  test("export, import and delete my data", async ({ page, baseURL }) => {
    const { problems } = await guard(page, new URL(baseURL).origin);
    /* The template is a working mini item, and it is in every repo. */
    await page.goto("/items/_template/");
    await page.keyboard.press("Space");
    await expect(page.locator("#best")).not.toHaveText("0", { timeout: 5000 });
    const best = Number(await page.locator("#best").textContent());

    /* Export: a real download, with the right shape. */
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export save" }).click()
    ]);
    expect(download.suggestedFilename()).toMatch(/^limitless-[a-z0-9-]+-template-save-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await download.path();
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved).toMatchObject({ app: "limitless-lab", slug: "template", v: 1, data: { best } });

    /* Delete: two taps, then the best score is 0. */
    const del = page.getByRole("button", { name: "Delete my data" });
    await del.click();
    await expect(page.getByRole("button", { name: "Tap again to delete" })).toBeVisible();
    await page.getByRole("button", { name: "Tap again to delete" }).click();
    await expect(page.locator("#best")).toHaveText("0");

    /* Import a bad file: refused with a message. */
    const chooser1 = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import save" }).click();
    await (await chooser1).setFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{nope") });
    await expect(page.locator(".save-status")).toContainText("isn't a save file");

    /* Import the real export: the best score comes back. */
    const chooser2 = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import save" }).click();
    await (await chooser2).setFiles(file);
    await expect(page.locator(".save-status")).toContainText("Save loaded");
    await expect(page.locator("#best")).toHaveText(String(best));

    expect(problems).toEqual([]);
  });
});
