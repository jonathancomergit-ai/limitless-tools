/* ============================================================
   GIF Maker - smoke test

   1. Try a sample: 6 frames appear in the strip and the preview
      shows them (phone taps, desktop clicks / keys).
   2. Reorder: phone taps frame 1 then Later; desktop uses
      Shift + Right on the frame. The first frame changes.
   3. Make GIF: the worker packs it, a Download link appears.
   4. Download it: the file really starts with "GIF89a" and ends
      with the trailer byte 0x3B.
   5. A pretend camera (a canvas stream stands in for
      getUserMedia). Reading a frame fails mid-clip: Record
      comes back and the camera closes. Then the camera
      "unplugs" (track ended): it closes with a message.
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#drop[data-ready]")).toHaveCount(1);
  const item = (key) => page.evaluate((k) => {
    const v = window.__item[k];
    return Array.isArray(v) ? v.length : v;
  }, key);
  const firstId = () => page.evaluate(() => window.__item.frames[0].id);
  const press = (sel) => (isMobile ? page.locator(sel).tap() : page.locator(sel).click());

  /* ---- 1. the sample ---- */
  await press("#sample");
  await expect.poll(() => item("frames")).toBe(6);
  await expect(page.locator("#strip .gm-chip")).toHaveCount(6);
  await expect(page.locator("#preview-card")).toBeVisible();
  await expect(page.locator("#estimate")).toContainText(/about \d/);

  /* ---- 2. reorder ---- */
  const before = await firstId();
  if (isMobile) {
    await page.locator('#strip .gm-chip[data-pos="0"]').tap();
    await page.locator("#move-right").tap();
  } else {
    await page.locator('#strip .gm-chip[data-pos="0"]').focus();
    await page.keyboard.press("Shift+ArrowRight");
  }
  await expect.poll(firstId).not.toBe(before);

  /* ---- 3. make it ---- */
  await press("#make");
  const link = page.locator("#download");
  await expect(link).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#result-img")).toBeVisible();
  expect(await item("result")).toMatchObject({ frames: 6, name: "sample.gif" });

  /* ---- 4. download it ---- */
  const [download] = await Promise.all([page.waitForEvent("download"), press("#download")]);
  expect(download.suggestedFilename()).toBe("sample.gif");
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 6).toString("latin1")).toBe("GIF89a");
  expect(bytes[bytes.length - 1]).toBe(0x3b);

  /* ---- 5. a pretend camera: a failed frame, then an unplug ---- */
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
    }, 40);
    navigator.mediaDevices.getUserMedia = async () => {
      const s = c.captureStream(30);
      window.__fakeTracks = s.getVideoTracks();
      return s;
    };
    /* drawImage(video) throws while __breakCam is set */
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
      if (window.__breakCam && src instanceof HTMLVideoElement) { throw new Error("pretend camera fault"); }
      return draw.call(this, src, ...rest);
    };
  });
  const openCam = async () => {
    await press("#cam-open");
    await expect(page.locator("#cam-card")).toBeVisible();
    await expect(page.locator("#rec")).toBeEnabled();
    await expect.poll(() => page.evaluate(() => document.getElementById("video").videoWidth)).toBeGreaterThan(0);
  };

  await openCam();
  await page.evaluate(() => { window.__breakCam = true; });
  await press("#rec");
  await expect.poll(() => item("recording")).toBe(false);
  await expect(page.locator("#rec")).toHaveText("Record");
  await expect(page.locator("#cam-card")).toBeHidden();
  await expect(page.locator("#cam-open")).toBeEnabled();
  await expect(page.locator("#status")).toContainText("Couldn't record");
  await page.evaluate(() => { window.__breakCam = false; });

  await openCam();
  await page.evaluate(() => { for (const t of window.__fakeTracks) { t.dispatchEvent(new Event("ended")); } });
  await expect(page.locator("#cam-card")).toBeHidden();
  await expect(page.locator("#status")).toContainText("camera stopped");
  await expect(page.locator("#cam-open")).toBeEnabled();
}
