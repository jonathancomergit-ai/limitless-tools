/* ============================================================
   Thumbnail Maker - smoke test

   1. Picks the "Top 10" template (tap on phone, click on
      desktop). Its big text layer is selected and in the field.
   2. Changes the text. The clean picture's fingerprint changes.
   3. Drags that layer: a real finger drag on the phone (touch
      events), the mouse on desktop. It moved. Desktop also
      nudges it with Shift + Arrow (10 px).
   4. Download PNG: a real 1280 x 720 PNG file.
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#canvas[data-ready]")).toHaveCount(1);
  const item = (expr) => page.evaluate(expr);

  /* ---- 1. a template ---- */
  const tpl = page.locator('.tm-tpl[data-id="top10"]');
  await tpl.scrollIntoViewIfNeeded();
  if (isMobile) { await tpl.tap(); } else { await tpl.click(); }
  await expect.poll(() => item(() => window.__item.template)).toBe("top10");
  await expect(page.locator("#t-text")).toHaveValue("TOP 10");
  const sel = await item(() => window.__item.selected);
  expect(await item(() => window.__item.layout.layers.length)).toBe(5);

  /* ---- 2. new words: the picture changes ---- */
  const before = await item(() => window.__item.hash());
  await page.locator("#t-text").fill("BEST 5");
  await expect.poll(() => item(() => window.__item.layout.layers[window.__item.selected].text)).toBe("BEST 5");
  await expect.poll(() => item(() => window.__item.hash())).not.toBe(before);
  await expect(page.locator("#layers .tm-layer[aria-pressed='true']")).toContainText("BEST 5");

  /* ---- 3. drag it ---- */
  await page.locator("#canvas").scrollIntoViewIfNeeded();
  const x0 = await item(() => window.__item.layout.layers[window.__item.selected].x);
  const c = await page.evaluate((i) => window.__item.centreOf(i), sel);
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
    });
    await touch("touchStart", c.x, c.y);
    for (let s = 1; s <= 6; s++) { await touch("touchMove", c.x + s * 10, c.y + s * 5); }
    await touch("touchEnd", c.x + 60, c.y + 30);
  } else {
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y + 30, { steps: 6 });
    await page.mouse.up();
  }
  await expect.poll(() => item(() => window.__item.layout.layers[window.__item.selected].x)).toBeGreaterThan(x0 + 40);
  expect(await item(() => window.__item.selected)).toBe(sel);

  if (!isMobile) {
    const x1 = await item(() => window.__item.layout.layers[window.__item.selected].x);
    await page.locator("#canvas").focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => item(() => window.__item.layout.layers[window.__item.selected].x)).toBe(x1 + 10);
  }

  /* ---- 4. download a PNG ----
     On slow CI machines the phone tap sometimes lands while the
     browser is still settling the CDP drag above, and no click fires
     (seen on main, never locally). So the tap is retried: it still
     has to be a real tap that starts a download. */
  const png = page.locator("#png");
  let download;
  await expect(async () => {
    await png.scrollIntoViewIfNeeded();
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 5000 }),
      isMobile ? png.tap() : png.click()
    ]);
  }).toPass({ timeout: 25000 });
  expect(download.suggestedFilename()).toBe("thumbnail-youtube-1280x720.png");
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(1280);
  expect(bytes.readUInt32BE(20)).toBe(720);
}
