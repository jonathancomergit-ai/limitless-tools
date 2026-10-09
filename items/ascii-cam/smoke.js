/* ============================================================
   ASCII Cam - smoke test

   No camera in the test browser, so it uses the sample:

   1. Press Try a sample (tap on phone, Enter on desktop).
      The ASCII output is not empty: rows of the right width
      with real characters in them.
   2. Change the look. Phone: tap the Blocks pill. Desktop:
      arrow keys on the Detail slider. The output changes.
   3. Copy as text: the clipboard, or the fallback box holding
      exactly the same text.
   4. Download PNG: a real PNG file.
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#hero[data-ready]")).toHaveCount(1);
  const item = () => page.evaluate(() => {
    const s = window.__item;
    return { text: s.text, rows: s.rows, cols: s.cols, lines: s.lines.length, inked: s.inked, copied: s.copied, png: s.png };
  });

  /* ---- 1. the sample ---- */
  expect((await item()).text).toBe("");
  if (isMobile) {
    await page.locator("#sample").tap();
  } else {
    await page.locator("#sample").focus();
    await page.keyboard.press("Enter");
  }
  await expect.poll(async () => (await item()).inked).toBe(true);
  const first = await item();
  expect(first.text.trim().length).toBeGreaterThan(0);
  expect(first.lines).toBe(first.rows);
  expect(first.text.split("\n").filter(Boolean).length).toBeGreaterThan(5);
  await expect(page.locator("#size-label")).toContainText(`${first.cols} × ${first.rows}`);

  /* ---- 2. change the look ---- */
  if (isMobile) {
    await page.locator('label[for="cs-blocks"]').tap();
    await expect.poll(async () => (await item()).text).toContain("█");
  } else {
    await page.locator("#cols").focus();
    for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowRight"); }
    await expect.poll(async () => (await item()).cols).toBe(first.cols + 16);
  }
  const second = await item();
  expect(second.text).not.toBe(first.text);

  /* ---- 3. copy as text ---- */
  await page.locator("#copy").click();
  await expect.poll(async () => (await item()).copied).not.toBe("");
  if ((await item()).copied === "fallback") {
    await expect(page.locator("#fallback")).toBeVisible();
    expect(await page.locator("#fallback-text").inputValue()).toBe(second.text);
  } else {
    await expect(page.locator("#snap-note")).toContainText("Copied");
  }

  /* ---- 4. download PNG ---- */
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#png").click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^ascii-cam-\d{8}-\d{6}\.png$/);
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect((await item()).png.width).toBe(second.cols * 12);
}
