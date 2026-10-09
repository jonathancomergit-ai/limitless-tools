/* ============================================================
   QR Maker - smoke test

   1. Types a link: phone taps the box and types, desktop tabs
      in with the keyboard. Checks the code holds exactly the
      address (https:// added), and the QR canvas is drawn.
   2. Changes the error correction to H: the code gets bigger.
   3. Download PNG: a real PNG file. Download SVG: a real SVG.
   4. The code shows up under Recent.
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#out[data-ready]")).toHaveCount(1);
  const qr = () => page.evaluate(() => window.__item.qr && { v: window.__item.qr.version, size: window.__item.qr.size });

  /* ---- 1. type a link ---- */
  if (isMobile) {
    await page.locator("#link").tap();
  } else {
    await page.locator('label[for="type-link"]').click();
    await page.keyboard.press("Tab");
    await expect(page.locator("#link")).toBeFocused();
  }
  await page.keyboard.type("example.com/menu");
  await expect(page.locator("#payload")).toHaveText("https://example.com/menu");
  await expect.poll(qr).toEqual({ v: 2, size: 25 });

  /* the canvas really has dark and light squares on it */
  const counts = await page.evaluate(() => {
    const c = document.getElementById("qr");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    let light = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] < 60) { dark++; } else if (d[i] > 200) { light++; } }
    return { dark, light };
  });
  expect(counts.dark).toBeGreaterThan(1000);
  expect(counts.light).toBeGreaterThan(1000);

  /* ---- 2. error correction H: more squares ---- */
  if (isMobile) { await page.locator('label[for="ecl-h"]').tap(); } else { await page.locator('label[for="ecl-h"]').click(); }
  await expect.poll(async () => (await qr()).v).toBeGreaterThan(2);
  await expect(page.locator("#info")).toContainText("level H");

  /* ---- 3. downloads ---- */
  const [png] = await Promise.all([page.waitForEvent("download"), page.locator("#dl-png").click()]);
  expect(png.suggestedFilename()).toBe("qr-example.com.png");
  const bytes = fs.readFileSync(await png.path());
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  const [svg] = await Promise.all([page.waitForEvent("download"), page.locator("#dl-svg").click()]);
  expect(svg.suggestedFilename()).toBe("qr-example.com.svg");
  const text = fs.readFileSync(await svg.path(), "utf8");
  expect(text).toContain("<svg");
  expect(text).toContain("<path");

  /* ---- 4. recent ---- */
  await expect(page.locator("#recent li")).toHaveCount(1);
  await expect(page.locator("#recent")).toContainText("https://example.com/menu");
}
