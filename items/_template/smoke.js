/* ============================================================
   ITEM TITLE - smoke test

   Runs after the standard checks pass (no errors, no outside
   requests, no sideways scroll, canvas not blank), once on the
   phone size and once on desktop.

   Gets: { page, expect, size, isMobile }
   Job:  do what a player does, then check something changed.
   Keep it under ~5 seconds. Delete this file if there is
   genuinely nothing to interact with.
   ============================================================ */

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#stage[data-ready]")).toHaveCount(1);
  const score = () => page.evaluate(() => window.__item.score);

  /* Phone: tap. Desktop: keyboard. Test BOTH ways in. */
  if (isMobile) {
    const box = await page.locator("#stage").boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await page.keyboard.press("Space");
  }

  await expect.poll(score).toBe(1);
  await expect(page.locator("#score")).toHaveText("1");
}
