/* ============================================================
   ASCII Cam - smoke test

   No camera in the test browser, so it uses the sample:

   1. Press Try a sample (tap on phone, Enter on desktop).
      The ASCII output is not empty: rows of the right width
      with real characters in them.
   2. Change the look. Phone: tap the Blocks pill. Desktop:
      arrow keys on the Detail slider. The output changes.
   3. Copy as text: the clipboard, or the fallback box holding
      exactly the same text.
   4. Download PNG: a real PNG file.
   5. A pretend camera (a canvas stream stands in for
      getUserMedia): Start, frames arrive, Stop. The last frame
      is forgotten, so PNG and Copy are off again. Then the
      camera "unplugs" (track ended): it stops with a message.
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#hero[data-ready]")).toHaveCount(1);
  const item = () => page.evaluate(() => {
    const s = window.__item;
    return { text: s.text, rows: s.rows, cols: s.cols, lines: s.lines.length, inked: s.inked, copied: s.copied, png: s.png };
  });

  /* ---- 1. the sample ---- */
  expect((await item()).text).toBe("");
  if (isMobile) {
    await page.locator("#sample").tap();
  } else {
    await page.locator("#sample").focus();
    await page.keyboard.press("Enter");
  }
  await expect.poll(async () => (await item()).inked).toBe(true);
  const first = await item();
  expect(first.text.trim().length).toBeGreaterThan(0);
  expect(first.lines).toBe(first.rows);
  expect(first.text.split("\n").filter(Boolean).length).toBeGreaterThan(5);
  await expect(page.locator("#size-label")).toContainText(`${first.cols} × ${first.rows}`);

  /* ---- 2. change the look ---- */
  if (isMobile) {
    await page.locator('label[for="cs-blocks"]').tap();
    await expect.poll(async () => (await item()).text).toContain("█");
  } else {
    await page.locator("#cols").focus();
    for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowRight"); }
    await expect.poll(async () => (await item()).cols).toBe(first.cols + 16);
  }
  const second = await item();
  expect(second.text).not.toBe(first.text);

  /* ---- 3. copy as text ---- */
  await page.locator("#copy").click();
  await expect.poll(async () => (await item()).copied).not.toBe("");
  if ((await item()).copied === "fallback") {
    await expect(page.locator("#fallback")).toBeVisible();
    expect(await page.locator("#fallback-text").inputValue()).toBe(second.text);
  } else {
    await expect(page.locator("#snap-note")).toContainText("Copied");
  }

  /* ---- 4. download PNG ---- */
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#png").click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^ascii-cam-\d{8}-\d{6}\.png$/);
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect((await item()).png.width).toBe(second.cols * 12);

  /* ---- 5. a pretend camera: stop, and unplug ---- */
  await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 48;
    const g = c.getContext("2d");
    let i = 0;
    setInterval(() => {
      i += 1;
      g.fillStyle = `hsl(${(i * 20) % 360} 80% 50%)`;
      g.fillRect(0, 0, 64, 48);
      g.fillStyle = "#FFFFFF";
      g.fillRect(i % 64, 10, 12, 24);
    }, 40);
    navigator.mediaDevices.getUserMedia = async () => {
      const s = c.captureStream(30);
      window.__fakeTracks = s.getVideoTracks();
      return s;
    };
  });
  const live = () => page.evaluate(() => ({ live: window.__item.live, source: window.__item.source, lines: window.__item.lines.length, frames: window.__item.frames }));
  const startCam = async () => {
    const before = (await live()).frames;
    await page.locator("#start").click();
    await expect.poll(async () => (await live()).live).toBe(true);
    await expect.poll(async () => (await live()).frames).toBeGreaterThan(before + 2);
    await expect(page.locator("#png")).toBeEnabled();
  };

  await startCam();
  await page.locator("#start").click();                        // Stop camera
  await expect.poll(live).toMatchObject({ live: false, source: "none", lines: 0 });
  await expect(page.locator("#png")).toBeDisabled();
  await expect(page.locator("#copy")).toBeDisabled();
  await expect(page.locator("#size-label")).toHaveText("No picture yet");

  await startCam();
  await page.evaluate(() => { for (const t of window.__fakeTracks) { t.dispatchEvent(new Event("ended")); } });
  await expect.poll(live).toMatchObject({ live: false, source: "none", lines: 0 });
  await expect(page.locator("#status")).toContainText("camera stopped");
  await expect(page.locator("#start")).toHaveText("Start camera");
  await expect(page.locator("#png")).toBeDisabled();
}
