/* ============================================================
   Limitless Lab - item page boot

   The first line of every item's main.js:

     import { bootItem } from "../../kit/item.js";
     const { config } = bootItem();

   It paints the wing colour and name onto the page (back link,
   tab title) so the item's own HTML can stay wing-neutral and
   be copied between repos unchanged.

   exposeForTests(state) lets the item's smoke.js peek at it.
   ============================================================ */

import { config, fullName, applyWing } from "./config.js";

/* Hand a live state object to the smoke test (items/<slug>/smoke.js),
   which can then read it with page.evaluate(() => window.__item.score).
   Read-only by convention; it has no effect on visitors. */
export function exposeForTests(state) {
  window.__item = state;
  return state;
}

/* This item's slug = its folder name: /items/hello/ -> "hello".
   A leading underscore is dropped, so the template still works. */
export function itemSlug(path = location.pathname) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length && /\.html?$/.test(parts[parts.length - 1])) { parts.pop(); }
  return (parts.pop() || "item").replace(/^_+/, "").toLowerCase();
}

export function bootItem({ title = null } = {}) {
  applyWing();
  const name = title || document.querySelector("h1")?.textContent?.trim() || "Item";
  document.title = `${name} - ${fullName}`;
  return { config, fullName };
}
