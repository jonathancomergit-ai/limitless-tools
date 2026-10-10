/* ============================================================
   Pixel Studio - smoke test

   1. Picks the PICO-8 blue swatch.
   2. Draws one pixel in the middle of the starter heart:
      phone taps it, desktop moves the keyboard cursor there
      and presses Space. Checks it turned blue.
   3. Undo: phone taps the Undo button, desktop Ctrl+Z.
      Checks the pixel is back to the heart's red.
   4. Exports a PNG (and on desktop a GIF, made in the worker)
      and checks the files' magic bytes.
   5. Desktop: a keyboard Line half done (Space, arrows), then a
      mouse click. One Undo must leave no trace of the preview.
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#stage[data-ready]")).toHaveCount(1);
  const pixel = (x, y) => page.evaluate(([px, py]) => window.__item.pixelAt(px, py), [x, y]);

  const X = 7;
  const Y = 8;
  const before = await pixel(X, Y);
  expect(before).toBe("#ff004d");

  /* ---- 1. a colour ---- */
  await page.locator('.ps-swatch[data-color="#29adff"]').click();
  await expect.poll(() => page.evaluate(() => window.__item.color)).toBe("#29adff");

  /* ---- 2. draw one pixel ---- */
  if (isMobile) {
    await page.locator("#stage").scrollIntoViewIfNeeded();
    const at = await page.evaluate(([px, py]) => window.__item.screenOf(px, py), [X, Y]);
    await page.locator("#art").tap({ position: at });
  } else {
    await page.locator("#stage").focus();
    const cur = await page.evaluate(() => ({ ...window.__item.cursor }));
    for (let i = cur.x; i > X; i--) { await page.keyboard.press("ArrowLeft"); }
    for (let i = cur.y; i < Y; i++) { await page.keyboard.press("ArrowDown"); }
    await page.keyboard.press("Space");
  }
  await expect.poll(() => pixel(X, Y)).toBe("#29adff");
  expect(await page.evaluate(() => window.__item.canUndo)).toBe(true);

  /* ---- 3. undo ---- */
  if (isMobile) {
    await page.locator("#undo").tap();
  } else {
    await page.keyboard.press("Control+z");
  }
  await expect.poll(() => pixel(X, Y)).toBe(before);

  /* ---- 4. export ---- */
  const [png] = await Promise.all([page.waitForEvent("download"), page.locator("#export-png").click()]);
  expect(png.suggestedFilename()).toMatch(/^pixel-art-16x16.*\.png$/);
  const pngBytes = fs.readFileSync(await png.path());
  expect(pngBytes.subarray(1, 4).toString("latin1")).toBe("PNG");

  if (!isMobile) {
    const [gif] = await Promise.all([page.waitForEvent("download"), page.locator("#export-gif").click()]);
    const gifBytes = fs.readFileSync(await gif.path());
    expect(gifBytes.subarray(0, 6).toString("latin1")).toBe("GIF89a");
  }

  /* ---- 5. keyboard line in progress, then a mouse click ---- */
  if (!isMobile) {
    const row = () => Promise.all([8, 9, 10, 11].map((x) => pixel(x, Y)));
    const clean = await row();
    const far = await pixel(2, 2);
    await page.locator('.ps-tool[data-tool="line"]').click();
    await page.locator("#stage").focus();
    await page.evaluate(([x, y]) => { window.__item.cursor = { x, y }; }, [X, Y]);
    await page.keyboard.press("Space");                       // start set
    for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowRight"); }
    await expect.poll(row).toEqual(["#29adff", "#29adff", "#29adff", "#29adff"]);
    const at = await page.evaluate(() => window.__item.screenOf(2, 2));
    await page.locator("#art").click({ position: at });
    await expect.poll(() => pixel(2, 2)).toBe("#29adff");
    expect(await row()).toEqual(clean);                       // the preview is gone
    await page.keyboard.press("Control+z");
    await expect.poll(() => pixel(2, 2)).toBe(far);
    expect(await row()).toEqual(clean);
  }
}
