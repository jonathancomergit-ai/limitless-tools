/* ============================================================
   Thumbnail Maker - smoke test

   1. Picks the "Top 10" template (tap on phone, click on
      desktop). Its big text layer is selected and in the field.
   2. Changes the text. The clean picture's fingerprint changes.
   3. Drags that layer: a real finger drag on the phone (touch
      events), the mouse on desktop. It moved. Desktop also
      nudges it with Shift + Arrow (10 px).
   4. Download PNG: a real 1280 x 720 PNG file.
   5. Your picture (made in the page, set on the file input):
      - a slow pick then a quick one: the quick one stays.
      - template, new picture, Undo: the picture keeps its shape.
      - a 5000 px wide one is shrunk to 4096 at load.
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#canvas[data-ready]")).toHaveCount(1);
  const item = (expr) => page.evaluate(expr);

  /* ---- 1. a template ---- */
  const tpl = page.locator('.tm-tpl[data-id="top10"]');
  await tpl.scrollIntoViewIfNeeded();
  if (isMobile) { await tpl.tap(); } else { await tpl.click(); }
  await expect.poll(() => item(() => window.__item.template)).toBe("top10");
  await expect(page.locator("#t-text")).toHaveValue("TOP 10");
  const sel = await item(() => window.__item.selected);
  expect(await item(() => window.__item.layout.layers.length)).toBe(5);

  /* ---- 2. new words: the picture changes ---- */
  const before = await item(() => window.__item.hash());
  await page.locator("#t-text").fill("BEST 5");
  await expect.poll(() => item(() => window.__item.layout.layers[window.__item.selected].text)).toBe("BEST 5");
  await expect.poll(() => item(() => window.__item.hash())).not.toBe(before);
  await expect(page.locator("#layers .tm-layer[aria-pressed='true']")).toContainText("BEST 5");

  /* ---- 3. drag it ---- */
  await page.locator("#canvas").scrollIntoViewIfNeeded();
  const x0 = await item(() => window.__item.layout.layers[window.__item.selected].x);
  const c = await page.evaluate((i) => window.__item.centreOf(i), sel);
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
    });
    await touch("touchStart", c.x, c.y);
    for (let s = 1; s <= 6; s++) { await touch("touchMove", c.x + s * 10, c.y + s * 5); }
    await touch("touchEnd", c.x + 60, c.y + 30);
  } else {
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y + 30, { steps: 6 });
    await page.mouse.up();
  }
  await expect.poll(() => item(() => window.__item.layout.layers[window.__item.selected].x)).toBeGreaterThan(x0 + 40);
  expect(await item(() => window.__item.selected)).toBe(sel);

  if (!isMobile) {
    const x1 = await item(() => window.__item.layout.layers[window.__item.selected].x);
    await page.locator("#canvas").focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => item(() => window.__item.layout.layers[window.__item.selected].x)).toBe(x1 + 10);
  }

  /* ---- 4. download a PNG ---- */
  const png = page.locator("#png");
  await png.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    isMobile ? png.tap() : png.click()
  ]);
  expect(download.suggestedFilename()).toBe("thumbnail-youtube-1280x720.png");
  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(1280);
  expect(bytes.readUInt32BE(20)).toBe(720);

  /* ---- 5. your picture ---- */
  await page.evaluate(() => {
    const real = window.createImageBitmap.bind(window);
    window.createImageBitmap = async (src, ...rest) => {
      if (src && src.name === "slow.png") { await new Promise((r) => setTimeout(r, 600)); }
      return real(src, ...rest);
    };
    window.__pick = async (name, w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#33AA77";
      g.fillRect(0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: "image/png" }));
      const input = document.getElementById("file");
      input.files = dt.files;
      input.dispatchEvent(new Event("change"));
    };
  });
  const photo = () => item(() => {
    const l = window.__item.layout.layers.find((x) => x.kind === "photo");
    const p = window.__item.photo;
    return l && p ? { pw: l.pw, ph: l.ph, w: p.width, h: p.height } : null;
  });

  /* a slow pick, then a quick one: the quick one wins */
  await page.evaluate(async () => { await window.__pick("slow.png", 300, 200); await window.__pick("quick.png", 200, 300); });
  await expect.poll(photo).toEqual({ pw: 200, ph: 300, w: 200, h: 300 });
  await page.waitForTimeout(800);
  expect(await photo()).toEqual({ pw: 200, ph: 300, w: 200, h: 300 });

  /* template, another picture, Undo: no stretching */
  const tpl2 = page.locator('.tm-tpl[data-id="reaction"]');
  await tpl2.scrollIntoViewIfNeeded();
  if (isMobile) { await tpl2.tap(); } else { await tpl2.click(); }
  await expect.poll(() => item(() => window.__item.template)).toBe("reaction");
  await page.evaluate(() => window.__pick("wide.png", 300, 200));
  await expect.poll(photo).toEqual({ pw: 300, ph: 200, w: 300, h: 200 });
  const undo = page.locator("#undo");
  if (isMobile) { await undo.tap(); } else { await undo.click(); }
  await expect(undo).toBeHidden();
  expect(await photo()).toEqual({ pw: 300, ph: 200, w: 300, h: 200 });

  /* a big one is shrunk at load */
  await page.evaluate(() => window.__pick("big.png", 5000, 1000));
  await expect.poll(photo).toEqual({ pw: 4096, ph: 819, w: 4096, h: 819 });
  await expect(page.locator("#drop-sub")).toContainText("5000 × 1000");
}
