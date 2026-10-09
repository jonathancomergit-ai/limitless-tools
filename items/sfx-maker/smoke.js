/* ============================================================
   SFX Maker - smoke test

   Phone: taps the Laser preset. Desktop: presses 4 (Boom).
   Then checks:
   - the samples are not silent, and the sound was played
   - the waveform canvas really has the wave drawn on it
   - Export WAV gives a real RIFF/WAVE file
   - a favourite can be saved and shows in the list
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#wave[data-ready]")).toHaveCount(1);
  const item = () => page.evaluate(() => ({
    label: window.__item.label, peak: window.__item.peak, plays: window.__item.plays,
    drawn: window.__item.drawn, wave: window.__item.settings.wave
  }));
  const before = await item();

  /* ---- press a preset ---- */
  if (isMobile) {
    await page.locator('[data-preset="laser"]').tap();
    await expect.poll(async () => (await item()).label).toBe("laser");
  } else {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Digit4");
    await expect.poll(async () => (await item()).label).toBe("explosion");
    expect((await item()).wave).toBe("noise");
  }

  /* ---- not silent, played, drawn ---- */
  const after = await item();
  expect(after.peak).toBeGreaterThan(0.1);
  expect(after.plays).toBeGreaterThan(before.plays);
  expect(after.drawn).toBeGreaterThan(before.drawn);

  /* Count accent-coloured pixels on the canvas: the wave itself. */
  const lit = await page.evaluate(() => {
    const c = document.querySelector("#wave canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] > 150 && d[i + 2] < 120) { n++; } }
    return n;
  });
  expect(lit, "waveform pixels").toBeGreaterThan(500);

  /* ---- export WAV ---- */
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export").click()]);
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
  const wav = fs.readFileSync(await download.path());
  expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(wav.subarray(8, 12).toString("latin1")).toBe("WAVE");
  expect(wav.length).toBeGreaterThan(44 + 1000);

  /* ---- save a favourite ---- */
  await page.locator("#fav-name").fill("smoke test zap");
  await page.locator("#fav-name").press("Enter");
  await expect(page.locator("#favs li")).toHaveCount(1);
  await expect(page.locator("#favs")).toContainText("smoke test zap");
}
