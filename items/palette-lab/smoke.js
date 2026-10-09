/* ============================================================
   Palette Lab - smoke test

   1. Locks colour 2. Phone: taps its lock. Desktop: presses 2.
   2. Regenerates. Phone: taps Generate. Desktop: presses Space.
   3. Checks: the palette changed, but colour 2 stayed put.
   4. Checks the contrast grid has all 20 pairs, and the
      colour-blind rows and the export text are there.
   ============================================================ */

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#swatches[data-ready]")).toHaveCount(1);
  const palette = () => page.evaluate(() => [...window.__item.palette]);
  const before = await palette();

  /* ---- 1. lock colour 2 ---- */
  if (isMobile) {
    await page.locator(".pl-lock").nth(1).tap();
  } else {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Digit2");
  }
  await expect(page.locator(".pl-lock").nth(1)).toHaveAttribute("aria-pressed", "true");

  /* ---- 2. regenerate ---- */
  if (isMobile) {
    await page.locator("#generate").tap();
  } else {
    await page.keyboard.press("Space");
  }
  await expect.poll(() => page.evaluate(() => window.__item.generated)).toBe(1);

  /* ---- 3. changed, but the locked one stayed ---- */
  const after = await palette();
  expect(after[1]).toBe(before[1]);
  const changed = after.filter((c, i) => c !== before[i]).length;
  expect(changed).toBeGreaterThanOrEqual(3);
  await expect(page.locator("#hex-1")).toHaveValue(before[1]);

  /* ---- 4. the rest of the page followed ---- */
  await expect(page.locator(".pl-cell:not(.is-same)")).toHaveCount(20);
  await expect(page.locator(".pl-cvd-row")).toHaveCount(4);
  await expect(page.locator("#code")).toContainText(after[0]);
}
