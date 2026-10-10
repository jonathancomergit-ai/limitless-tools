/* ============================================================
   Particle Designer - smoke test

   Phone: taps the Sparks preset, taps the preview to move the
   emitter, drags the Rate slider with a finger-sized fill.
   Desktop: presses 3 (Sparks), arrow keys on the preview move
   the emitter, Tab to Rate and End sets it to the top.
   Then checks:
   - particles are flying and the preview really shows them
   - Export JSON downloads a file with the NEW rate in it
   - the Godot scene has the new amount (rate x lifetime)
   - the sprite sheet is a real PNG of the right size
   - the GIF starts GIF89a and ends 0x3B
   - Import JSON loads an effect back in
   ============================================================ */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#stage[data-ready]")).toHaveCount(1);
  const item = () => page.evaluate(() => {
    const s = window.__item;
    return { preset: s.preset, rate: s.settings.rate, lifetime: s.settings.lifetime, shape: s.settings.shape,
      at: s.at, particles: s.particles, frames: s.frames, name: s.settings.name };
  });

  /* ---- 1. pick a preset ---- */
  if (isMobile) {
    await page.locator('[data-preset="sparks"]').tap();
  } else {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Digit3");
  }
  await expect.poll(async () => (await item()).preset).toBe("sparks");
  expect((await item()).shape).toBe("spark");

  /* Particles are flying (or, with reduced motion, shown as a still). */
  await expect.poll(async () => (await item()).particles).toBeGreaterThan(5);

  /* ---- 2. move the emitter ---- */
  const before = (await item()).at;
  const box = await page.locator("#stage").boundingBox();
  if (isMobile) {
    await page.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height * 0.3);
  } else {
    await page.locator("#stage").focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowUp");
    /* and a mouse drag */
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35, { steps: 4 });
    await page.mouse.up();
  }
  const after = (await item()).at;
  expect(after[0]).toBeLessThan(before[0] - 0.05);
  expect(after[1]).toBeLessThan(before[1] - 0.05);

  /* ---- 3. change the rate ---- */
  const rate = page.locator("#s-rate");
  if (isMobile) {
    await rate.fill("250");
  } else {
    await rate.focus();
    await page.keyboard.press("End");
  }
  const want = isMobile ? 250 : 400;
  await expect.poll(async () => (await item()).rate).toBe(want);
  await expect(page.locator('output[for="s-rate"]')).toHaveText(`${want} / s`);

  /* The preview shows them: count bright pixels on the canvas. */
  await page.waitForTimeout(400);
  const lit = await page.evaluate(() => {
    const c = document.querySelector("#stage canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] > 180 && d[i + 1] > 90) { n++; } }
    return n;
  });
  expect(lit, "bright particle pixels").toBeGreaterThan(200);

  /* ---- 4. export JSON: it has the new rate ---- */
  const [jsonDl] = await Promise.all([page.waitForEvent("download"), page.locator("#export-json").click()]);
  expect(jsonDl.suggestedFilename()).toMatch(/\.particles\.json$/);
  const json = JSON.parse(fs.readFileSync(await jsonDl.path(), "utf8"));
  expect(json.format).toBe("particle-designer");
  expect(json.rate).toBe(want);
  expect(json.shape).toBe("spark");
  expect(json.colors.length).toBeGreaterThanOrEqual(2);

  /* ---- 5. Godot scene ---- */
  const [tscnDl] = await Promise.all([page.waitForEvent("download"), page.locator("#export-godot").click()]);
  expect(tscnDl.suggestedFilename()).toMatch(/\.tscn$/);
  const tscn = fs.readFileSync(await tscnDl.path(), "utf8");
  expect(tscn.startsWith("[gd_scene")).toBe(true);
  expect(tscn).toContain('type="CPUParticles2D"');
  expect(tscn).toContain(`amount = ${Math.round(want * json.lifetime)}`);
  expect(tscn).toContain("particle_flag_align_y = true");

  /* ---- 6. sprite sheet PNG ---- */
  const [sheetDl] = await Promise.all([page.waitForEvent("download"), page.locator("#export-sheet").click()]);
  const png = fs.readFileSync(await sheetDl.path());
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  const sheet = await page.evaluate(() => window.__item.lastExport);
  expect(png.readUInt32BE(16)).toBe(sheet.width);
  expect(png.readUInt32BE(20)).toBe(sheet.height);
  expect(sheet.cols * sheet.rows).toBeGreaterThanOrEqual(24);

  /* ---- 7. GIF (desktop only: one run is enough, and it's the slow one) ---- */
  if (!isMobile) {
    const [gifDl] = await Promise.all([page.waitForEvent("download"), page.locator("#export-gif").click()]);
    const gif = fs.readFileSync(await gifDl.path());
    expect(gif.subarray(0, 6).toString("latin1")).toBe("GIF89a");
    expect(gif[gif.length - 1]).toBe(0x3b);
  }

  /* ---- 8. import JSON back in ---- */
  const file = path.join(os.tmpdir(), `pd-smoke-${Date.now()}-${isMobile ? "p" : "d"}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...json, name: "imported", rate: 33 }));
  await page.locator("#import-file").setInputFiles(file);
  await expect.poll(async () => (await item()).rate).toBe(33);
  expect((await item()).name).toBe("imported");
  fs.rmSync(file, { force: true });
}
