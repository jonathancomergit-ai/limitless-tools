/* ============================================================
   GIF Maker - smoke test

   1. Try a sample: 6 frames appear in the strip and the preview
      shows them (phone taps, desktop clicks / keys).
   2. Reorder: phone taps frame 1 then Later; desktop uses
      Shift + Right on the frame. The first frame changes.
   3. Make GIF: the worker packs it, a Download link appears.
   4. Download it: the file really starts with "GIF89a" and ends
      with the trailer byte 0x3B.
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#drop[data-ready]")).toHaveCount(1);
  const item = (key) => page.evaluate((k) => {
    const v = window.__item[k];
    return Array.isArray(v) ? v.length : v;
  }, key);
  const firstId = () => page.evaluate(() => window.__item.frames[0].id);
  const press = (sel) => (isMobile ? page.locator(sel).tap() : page.locator(sel).click());

  /* ---- 1. the sample ---- */
  await press("#sample");
  await expect.poll(() => item("frames")).toBe(6);
  await expect(page.locator("#strip .gm-chip")).toHaveCount(6);
  await expect(page.locator("#preview-card")).toBeVisible();
  await expect(page.locator("#estimate")).toContainText(/about \d/);

  /* ---- 2. reorder ---- */
  const before = await firstId();
  if (isMobile) {
    await page.locator('#strip .gm-chip[data-pos="0"]').tap();
    await page.locator("#move-right").tap();
  } else {
    await page.locator('#strip .gm-chip[data-pos="0"]').focus();
    await page.keyboard.press("Shift+ArrowRight");
  }
  await expect.poll(firstId).not.toBe(before);

  /* ---- 3. make it ---- */
  await press("#make");
  const link = page.locator("#download");
  await expect(link).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#result-img")).toBeVisible();
  expect(await item("result")).toMatchObject({ frames: 6, name: "sample.gif" });

  /* ---- 4. download it ---- */
  const [download] = await Promise.all([page.waitForEvent("download"), press("#download")]);
  expect(download.suggestedFilename()).toBe("sample.gif");
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 6).toString("latin1")).toBe("GIF89a");
  expect(bytes[bytes.length - 1]).toBe(0x3b);
}
