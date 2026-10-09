/* ============================================================
   Shared helpers for the Playwright specs.
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SCREENS = path.join(ROOT, "test-results", "screens");

/* The only outside addresses a page may ever contact. */
export const GOATCOUNTER_HOSTS = ["gc.zgo.at", "jonjoe1001.goatcounter.com"];

/* ============================================================
   DISCOVERY
   The hub, plus every folder in items/ that has an index.html.
   Folders starting with "_" (the template) are skipped.
   ============================================================ */
export function discoverPages() {
  const dir = path.join(ROOT, "items");
  const slugs = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
    .filter((d) => fs.existsSync(path.join(dir, d.name, "index.html")))
    .map((d) => d.name)
    .sort();

  return [
    { slug: "hub", url: "/", smoke: null },
    ...slugs.map((slug) => {
      const smoke = path.join(dir, slug, "smoke.js");
      return { slug, url: `/items/${slug}/`, smoke: fs.existsSync(smoke) ? smoke : null };
    })
  ];
}

export function readItemsJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "items.json"), "utf8"));
}

/* ============================================================
   GUARD
   Call before page.goto. Collects every problem into a list:
   console errors, uncaught errors, failed same-origin loads,
   and ANY request to another origin. GoatCounter is answered
   with an empty stub so nothing ever leaves the machine; every
   other outside request is blocked and reported.
   ============================================================ */
export async function guard(page, origin) {
  const problems = [];
  const outside = [];   // GoatCounter requests that were stubbed

  page.on("console", (m) => {
    if (m.type() === "error") { problems.push(`console error: ${m.text()}`); }
  });
  page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
  page.on("response", (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400) {
      problems.push(`HTTP ${r.status()} for ${r.url()}`);
    }
  });

  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) { return route.continue(); }
    if (GOATCOUNTER_HOSTS.includes(url.hostname)) {
      outside.push(url.href);
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    }
    problems.push(`request to another origin: ${url.href}`);
    return route.abort("blockedbyclient");
  });

  return { problems, outside };
}

/* ============================================================
   CHECKS
   ============================================================ */

/* Wider than the screen? Returns null if fine, or a message
   naming the elements that stick out. */
export async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    if (de.scrollWidth <= vw + 1) { return null; }
    const culprits = [];
    const name = (el) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    /* Every element that sticks out or spills, then keep only the
       innermost ones - those are the ones to fix. */
    const found = [];
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1) {
        found.push([el, `right edge ${Math.round(r.right)}px`]);
      } else if (el.clientWidth && getComputedStyle(el).overflowX === "visible" && el.scrollWidth > el.clientWidth + 1) {
        found.push([el, `content ${el.scrollWidth}px in a ${el.clientWidth}px box`]);
      }
    }
    for (const [el, why] of found) {
      if (!found.some(([other]) => other !== el && el.contains(other))) { culprits.push(`${name(el)} (${why})`); }
      if (culprits.length >= 6) { break; }
    }
    return `page is ${de.scrollWidth}px wide on a ${vw}px screen. Sticking out: ${culprits.join(", ")}`;
  });
}

/* Is a canvas showing something? Hides the canvas's siblings
   (HUD text etc.) for a moment, screenshots just the canvas,
   and counts pixels that differ from the corner colour. Works
   for 2D and WebGL alike, because it reads the screen. */
export async function canvasIsBlank(page, locator) {
  const handle = await locator.elementHandle();
  await page.evaluate((c) => {
    for (const s of c.parentElement.children) {
      if (s !== c) { s.dataset.testVis = s.style.visibility; s.style.visibility = "hidden"; }
    }
  }, handle);
  const png = await locator.screenshot({ animations: "allow" });
  await page.evaluate((c) => {
    for (const s of c.parentElement.children) {
      if (s !== c) { s.style.visibility = s.dataset.testVis || ""; delete s.dataset.testVis; }
    }
  }, handle);

  const changed = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const [r0, g0, b0] = [d[0], d[1], d[2]];
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 24) { n++; }
    }
    return n;
  }, png.toString("base64"));

  return changed < 30;   // fewer than 30 different pixels = blank
}
