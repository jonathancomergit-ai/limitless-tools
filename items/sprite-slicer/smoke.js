/* ============================================================
   Sprite Sheet Slicer - smoke test

   1. Makes a real sheet in the browser: 4 x 2 cells of 24 px,
      a 2 px margin and 2 px spacing, the last cell left empty.
      Hands it to the file input (setInputFiles).
   2. Types the cell size, margin and spacing. Expects 7 frames
      (the empty one is left out) on a 4 x 2 grid.
   3. The preview plays: the shown frame keeps changing.
   4. Unpicks frame 1: phone taps it, desktop uses Space on the
      sheet. 6 frames left.
   5. Download frames: the .zip really starts with "PK".
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#drop[data-ready]")).toHaveCount(1);
  const item = (key) => page.evaluate((k) => {
    const v = window.__item[k];
    return Array.isArray(v) ? v.length : v;
  }, key);

  /* ---- 1. a generated sheet ---- */
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 2 * 2 + 4 * 24 + 3 * 2;    // 106
    c.height = 2 * 2 + 2 * 24 + 1 * 2;   // 54
    const ctx = c.getContext("2d");
    for (let i = 0; i < 7; i++) {
      const x = 2 + (i % 4) * 26;
      const y = 2 + Math.floor(i / 4) * 26;
      ctx.fillStyle = `hsl(${i * 50} 80% 60%)`;
      ctx.fillRect(x + 4, y + 4 + (i % 3), 16, 14);
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.setInputFiles("#file", { name: "test-sheet.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
  await expect(page.locator("#sheet-card")).toBeVisible();
  await expect(page.locator("#drop-sub")).toContainText("106 × 54");

  /* ---- 2. slice by cell size ---- */
  await page.locator("#cell-w").fill("24");
  await page.locator("#cell-h").fill("24");
  await page.locator("#margin").fill("2");
  await page.locator("#spacing").fill("2");
  await expect.poll(() => item("frames")).toBe(7);
  await expect(page.locator("#count")).toContainText("7 frames · 4 × 2");
  await expect(page.locator("#order .ss-chip")).toHaveCount(7);

  /* ---- 3. the preview plays ---- */
  const before = await item("steps");
  await expect.poll(() => item("steps"), { timeout: 5000 }).toBeGreaterThan(before + 2);
  await expect(page.locator("#frame-label")).toContainText("of 7");

  /* ---- 4. unpick frame 1: tap on phone, keys on desktop ---- */
  if (isMobile) {
    const zoom = await item("zoom");
    await page.locator("#sheet").tap({ position: { x: 14 * zoom, y: 14 * zoom } });
  } else {
    await page.locator("#sheet").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
  }
  await expect.poll(() => item("order")).toBe(6);
  await expect(page.locator("#order .ss-chip")).toHaveCount(6);

  /* ---- 5. download the frames ---- */
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#zip").click()
  ]);
  expect(download.suggestedFilename()).toBe("test-sheet-frames.zip");
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(await page.evaluate(() => window.__item.zipped.files)).toBe(6 + 2);
}
