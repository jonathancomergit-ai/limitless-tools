/* ============================================================
   Tilemap Painter - smoke test

   Starts on the sample level with the sample tileset.
   1. Picks the brick tile (number 3, gid 4): phone taps it in
      the tile picker, desktop presses ] three times.
   2. Paints three empty cells of the Decor layer, (1,1) (2,1)
      (3,1): phone taps each one; desktop clicks the first with
      the mouse, then ArrowRight + Space, ArrowRight + Enter.
   3. Undo then redo (buttons on phone, Ctrl+Z / Ctrl+Y on
      desktop), and desktop checks the F / B tool keys.
   4. Exports the Tiled map and reads the .tmj: an orthogonal
      map with the sample tileset embedded, and gid 4 in those
      three cells of the Decor layer.
   5. Phone: Map PNG starts with the PNG bytes. Desktop: the
      CSV of the layer has 3,3,3 (tile numbers count from 0).
   ============================================================ */

import fs from "node:fs";

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#stage[data-ready]")).toHaveCount(1);
  const item = (k) => page.evaluate((key) => window.__item[key], k);
  const cell = (x, y) => page.evaluate(([cx, cy]) => window.__item.cellAt(cx, cy), [x, y]);
  const BRICK = 4;
  const CELLS = [[1, 1], [2, 1], [3, 1]];

  expect(await item("hasPicture")).toBe(true);
  expect(await item("layer")).toBe(2);
  for (const [x, y] of CELLS) { expect(await cell(x, y)).toBe(0); }

  /* ---- 1. pick a tile ---- */
  if (isMobile) {
    await page.locator("#palette").scrollIntoViewIfNeeded();
    const at = await page.evaluate((g) => window.__item.tileScreenOf(g), BRICK);
    await page.locator("#palette").tap({ position: at });
  } else {
    for (let i = 0; i < 3; i++) { await page.keyboard.press("]"); }
  }
  await expect.poll(() => item("tile")).toBe(BRICK);
  await expect(page.locator("#current-name")).toHaveText("Tile 3 · brick");

  /* ---- 2. paint three cells ---- */
  const screen = (x, y) => page.evaluate(([cx, cy]) => window.__item.screenOf(cx, cy), [x, y]);
  if (isMobile) {
    await page.locator("#stage").scrollIntoViewIfNeeded();
    for (const [x, y] of CELLS) {
      await page.locator("#view").tap({ position: await screen(x, y) });
    }
  } else {
    await page.locator("#view").click({ position: await screen(1, 1) });
    await expect.poll(() => cell(1, 1)).toBe(BRICK);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
  }
  for (const [x, y] of CELLS) { await expect.poll(() => cell(x, y)).toBe(BRICK); }
  expect(await cell(4, 1)).toBe(0);

  /* ---- 3. undo / redo, tool keys ---- */
  if (isMobile) {
    await page.locator("#undo").tap();
    await expect.poll(() => cell(3, 1)).toBe(0);
    await page.locator("#redo").tap();
  } else {
    await page.keyboard.press("Control+z");
    await expect.poll(() => cell(3, 1)).toBe(0);
    await page.keyboard.press("Control+y");
    await page.keyboard.press("f");
    await expect.poll(() => item("tool")).toBe("fill");
    await page.keyboard.press("b");
    await expect.poll(() => item("tool")).toBe("brush");
  }
  await expect.poll(() => cell(3, 1)).toBe(BRICK);

  /* ---- 4. export the Tiled map and read it ---- */
  const [tmj] = await Promise.all([page.waitForEvent("download"), page.locator("#export-tmj").click()]);
  expect(tmj.suggestedFilename()).toBe("tilemap.tmj");
  const json = JSON.parse(fs.readFileSync(await tmj.path(), "utf8"));
  expect(json.type).toBe("map");
  expect(json.orientation).toBe("orthogonal");
  expect(json.infinite).toBe(false);
  expect([json.width, json.height, json.tilewidth, json.tileheight]).toEqual([20, 12, 16, 16]);
  expect(json.tilesets[0]).toMatchObject({ firstgid: 1, image: "sample-tiles.png", columns: 8, tilecount: 32, imagewidth: 128, imageheight: 64 });
  const decor = json.layers.find((l) => l.name === "Decor");
  expect(decor.type).toBe("tilelayer");
  for (const [x, y] of CELLS) { expect(decor.data[y * json.width + x]).toBe(BRICK); }
  expect(decor.data[0]).toBe(0);
  expect(json.layers.find((l) => l.name === "Sky").data[0]).toBe(9);    // sky tile (8) + 1

  /* ---- 5. another export ---- */
  if (isMobile) {
    const [png] = await Promise.all([page.waitForEvent("download"), page.locator("#export-png").click()]);
    const bytes = fs.readFileSync(await png.path());
    expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  } else {
    const [csv] = await Promise.all([page.waitForEvent("download"), page.locator("#export-csv").click()]);
    expect(csv.suggestedFilename()).toBe("tilemap-decor.csv");
    const rows = fs.readFileSync(await csv.path(), "utf8").trim().split("\n");
    expect(rows).toHaveLength(12);
    expect(rows[1].startsWith("-1,3,3,3,-1")).toBe(true);
  }
}
