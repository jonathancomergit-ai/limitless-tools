/* ============================================================
   File Converter - smoke test

   1. Pastes a small CSV (quotes, a comma inside a field) into
      the paste box. Checks it's spotted as CSV.
   2. Adds it: phone taps the button, desktop presses Enter on it.
      One row appears, detected as CSV, with a table preview.
   3. Picks JSON in the row's "to" menu and presses Convert all.
   4. The output text is the right JSON.
   5. Downloads the file: its contents are that same JSON.
   6. Download all (.zip): the file starts with "PK".
   ============================================================ */

import fs from "node:fs";

const CSV = 'name,age,city\nAda,36,"London, UK"\nBo,7,"Says ""hi"""\n';
const WANT = [
  { name: "Ada", age: 36, city: "London, UK" },
  { name: "Bo", age: 7, city: 'Says "hi"' }
];

export default async function smoke({ page, expect, isMobile }) {
  await expect(page.locator("#drop[data-ready]")).toHaveCount(1);

  /* ---- 1. paste a CSV ---- */
  await page.locator("#paste-text").fill(CSV);
  await expect(page.locator("#paste-kind")).toHaveText("Looks like CSV.");

  /* ---- 2. add it to the list ---- */
  if (isMobile) {
    await page.locator("#paste-add").tap();
  } else {
    await page.locator("#paste-add").focus();
    await page.keyboard.press("Enter");
  }
  const row = page.locator("#list .fc-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".fc-meta")).toContainText("CSV");
  await expect(page.locator("#table tbody tr")).toHaveCount(2);
  await expect(page.locator("#table thead th")).toHaveText(["name", "age", "city"]);

  /* ---- 3. to JSON, convert ---- */
  await row.locator("select").selectOption("json");
  if (isMobile) { await page.locator("#convert-all").tap(); } else { await page.locator("#convert-all").click(); }
  await expect(row).toHaveAttribute("data-status", "done");

  /* ---- 4. the output is right ---- */
  const text = await page.locator("#out-text").textContent();
  expect(JSON.parse(text)).toEqual(WANT);

  /* ---- 5. download it ---- */
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.locator(".fc-dl").click()
  ]);
  expect(download.suggestedFilename()).toBe("pasted-1.json");
  expect(JSON.parse(fs.readFileSync(await download.path(), "utf8"))).toEqual(WANT);

  /* ---- 6. all as a zip ---- */
  const [zip] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#zip").click()
  ]);
  expect(zip.suggestedFilename()).toBe("converted-files.zip");
  const bytes = fs.readFileSync(await zip.path());
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(await page.evaluate(() => window.__item.zipped.files)).toBe(1);
}
