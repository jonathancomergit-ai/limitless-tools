/* ============================================================
   Icon Maker - smoke test

   1. Makes a 640 x 400 PNG in the browser (not square, on
      purpose) and hands it to the file input (setInputFiles).
   2. Checks every preview appears and is drawn.
   3. Changes a setting the way a person would: phone taps
      "Fill square", desktop uses the keyboard on Corners.
      The icons are drawn again.
   4. Download all: the .zip starts with "PK" and lists every
      file, favicon.ico included.
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#drop[data-ready]")).toHaveCount(1);

  /* ---- 1. a generated picture ---- */
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 400;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#35d6f5";
    ctx.beginPath();
    ctx.arc(320, 200, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff2d78";
    ctx.fillRect(250, 130, 140, 140);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.setInputFiles("#file", { name: "logo.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });

  /* ---- 2. previews ---- */
  await expect(page.locator("#icons[data-ready]")).toBeVisible();
  await expect(page.locator("#tiles .im-tile")).toHaveCount(5);
  await expect(page.locator("#tiles canvas")).toHaveCount(7);
  const drawn = () => page.evaluate(() => [...document.querySelectorAll("#big, #tiles canvas")].every((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) { if (d[i]) { return true; } }
    return false;
  }));
  expect(await drawn()).toBe(true);
  await expect(page.locator("#tags")).toContainText('rel="apple-touch-icon"');
  await expect(page.locator("#man")).toContainText('"purpose": "maskable"');

  /* ---- 3. a setting: touch on phone, keys on desktop ---- */
  const renders = await page.evaluate(() => window.__item.renders);
  if (isMobile) {
    await page.locator('label[for="fit-cover"]').tap();
  } else {
    await page.locator("#radius").focus();
    for (let i = 0; i < 5; i++) { await page.keyboard.press("ArrowRight"); }
    await expect(page.locator("#radius-out")).toHaveText("23%");
  }
  await expect.poll(() => page.evaluate(() => window.__item.renders)).toBeGreaterThan(renders);

  /* ---- 4. download all ---- */
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#zip").click()
  ]);
  expect(download.suggestedFilename()).toBe("icons.zip");
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(bytes.includes(Buffer.from("favicon.ico"))).toBe(true);
  const files = await page.evaluate(() => window.__item.zipped.files);
  expect(files).toEqual(["favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "site.webmanifest", "head-tags.html"]);
}
