/* ============================================================
   Image Squisher - smoke test

   1. Makes a real 1200x900 PNG in the browser and hands it to
      the file input (setInputFiles).
   2. Waits for its result row: the output must be smaller, or a
      different format.
   3. Changes a setting the way a person would: phone taps JPEG,
      desktop uses the keyboard on the quality slider. The row
      re-squishes.
   4. Download all: the .zip really starts with "PK".
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#drop[data-ready]")).toHaveCount(1);

  /* ---- 1. a generated test PNG ---- */
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 1200, 900);
    g.addColorStop(0, "#ff2d78");
    g.addColorStop(1, "#35d6f5");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1200, 900);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 80% 60%)`;
      ctx.fillRect((i * 97) % 1200, (i * 53) % 900, 30, 30);
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.setInputFiles("#files", { name: "test-card.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });

  /* ---- 2. a result row ---- */
  const row = () => page.evaluate(() => {
    const r = window.__item.rows[0];
    return r && { status: r.status, before: r.before, after: r.after, type: r.outType, w: r.width };
  });
  await expect.poll(async () => (await row())?.status, { timeout: 10_000 }).toBe("done");
  const first = await row();
  expect(first.after < first.before || first.type !== "image/png").toBe(true);
  await expect(page.locator("#rows tr")).toHaveCount(1);
  await expect(page.locator("#rows .sq-pct")).toBeVisible();
  await expect(page.locator("#preview")).toBeVisible();

  /* ---- 3. change a setting: touch on phone, keys on desktop ---- */
  if (isMobile) {
    await page.locator('label[for="fmt-jpeg"]').tap();
    await expect.poll(async () => (await row())?.type, { timeout: 10_000 }).toBe("image/jpeg");
  } else {
    await page.locator("#quality").focus();
    for (let i = 0; i < 30; i++) { await page.keyboard.press("ArrowLeft"); }
    await expect(page.locator("#quality-out")).toHaveText("50");
    await expect.poll(async () => {
      const r = await row();
      return r?.status === "done" && r.after < first.after;
    }, { timeout: 10_000 }).toBe(true);
  }

  /* ---- 4. download all as a zip ---- */
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#zip").click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^squished-images-\d{4}-\d{2}-\d{2}\.zip$/);
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
}
