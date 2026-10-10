/* ============================================================
   Easing Curve Editor - smoke test

   1. Drags handle 1 up and to the right.
      Phone: a real touch drag. Desktop: a mouse drag.
   2. Checks the CSS output changed, is a cubic-bezier() with
      the new numbers, and the browser accepts it as CSS.
   3. Desktop: nudges the handle with the arrow key.
      Phone: taps Bounce, checks the CSS becomes a valid linear().
   4. Pins the curve (phone: tap, desktop: P): two lanes race.
   5. Switches to GDScript and checks the function is there.
   ============================================================ */

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#editor[data-ready]")).toHaveCount(1);
  const code = () => page.locator("#code").textContent();
  const item = () => page.evaluate(() => ({
    p: [...window.__item.curve.p], kind: window.__item.curve.kind, name: window.__item.curve.name, drags: window.__item.drags
  }));
  const validCss = (value) => page.evaluate((v) => CSS.supports("transition-timing-function", v), value);

  const cssBefore = await code();
  const before = await item();
  expect(cssBefore).toContain("cubic-bezier(0.25, 0.1, 0.25, 1)");

  /* ---- 1. drag handle 1 ---- */
  await page.locator("#h1").scrollIntoViewIfNeeded();
  const box = await page.locator("#h1").boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const to = { x: x + 45, y: y - 70 };

  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
    await touch("touchStart", [{ x, y }]);
    /* Paced like a finger, which stops before it lifts. (A
       zero-time flick makes Chrome eat the next tap as a fling stop.) */
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", [{ x: x + (to.x - x) * i / 8, y: y + (to.y - y) * i / 8 }]);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
    await touch("touchEnd", []);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  }
  await expect.poll(async () => (await item()).drags).toBe(before.drags + 1);

  /* ---- 2. the CSS followed ---- */
  const after = await item();
  expect(after.kind).toBe("bezier");
  expect(after.name).toBe("Custom");
  expect(after.p[0]).toBeGreaterThan(before.p[0]);
  expect(after.p[1]).toBeGreaterThan(before.p[1]);
  const cssAfter = await code();
  expect(cssAfter).not.toBe(cssBefore);
  const value = cssAfter.match(/cubic-bezier\([^)]*\)/)[0];
  expect(value).toBe(`cubic-bezier(${after.p.join(", ")})`);
  expect(await validCss(value)).toBe(true);
  await expect(page.locator("#value")).toHaveText(value);

  /* ---- 3. keyboard nudge / bounce ---- */
  if (isMobile) {
    await page.locator('[data-preset="bounce"]').tap();
    await expect(page.locator("#code")).toContainText("linear(0, ");
    const lin = (await code()).match(/linear\(0, [^)]*\)/)[0];   // not the "linear() needs..." comment
    expect(await validCss(lin)).toBe(true);
    await expect(page.locator("#dirs-box")).toBeVisible();
  } else {
    await expect(page.locator("#h1")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect.poll(async () => (await item()).p[1]).toBeCloseTo(after.p[1] + 0.01, 5);
    expect(await code()).not.toBe(cssAfter);
  }

  /* ---- 4. pin: two lanes race ---- */
  await expect(page.locator(".ee-lane")).toHaveCount(1);
  if (isMobile) {
    await page.locator("#pin").tap();
  } else {
    await page.keyboard.press("KeyP");
  }
  await expect(page.locator("#pin")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".ee-lane")).toHaveCount(2);
  await expect(page.locator(".ee-box")).toHaveCount(2);

  /* ---- 5. GDScript ---- */
  await page.locator('[data-format="gd"]').click();
  await expect(page.locator("#code")).toContainText("func ease_curve(t: float) -> float:");
  await expect(page.locator("#code")).toContainText("set_trans(Tween.TRANS_");
}
