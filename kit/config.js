/* ============================================================
   Limitless Lab - wing config

   Reads ../site.config.js (the one file that differs per repo),
   checks it, and hands out a frozen copy. Also paints the wing
   onto the page: data-wing / data-accent on <html>, and fills in
   any element marked with data-slot="...".

   No DOM work happens at import time, so node tests can import
   this file too.
   ============================================================ */

import raw from "../site.config.js";

export const ACCENTS = ["hot", "cyan", "amber"];

/* ---- check + freeze ------------------------------------ */

function clean(c) {
  const wing = String(c.wing || "").toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(wing)) {
    throw new Error("site.config.js: wing must be a short lowercase id, like \"arcade\"");
  }
  return Object.freeze({
    brand:   String(c.brand || "Limitless Lab"),
    wing,
    name:    String(c.name || wing),
    emoji:   String(c.emoji || ""),
    accent:  ACCENTS.includes(c.accent) ? c.accent : "hot",
    tagline: String(c.tagline || ""),
    home:    Object.freeze({ label: String(c.home?.label || ""), url: c.home?.url || null }),
    wings:   Object.freeze((c.wings || []).map((w) => Object.freeze({ ...w })))
  });
}

export const config = clean(raw);

/* "Limitless Arcade" - used in titles and the hub heading. */
export const fullName = `Limitless ${config.name}`;

/* ---- paint the page ------------------------------------ */

/* Text each data-slot gets. Add a new slot here, then use it in
   any page as <span data-slot="name"></span>. */
const SLOTS = {
  "brand":      () => config.brand,
  "wing-name":  () => config.name,
  "wing-emoji": () => config.emoji,
  "wing-full":  () => fullName,
  "wing-label": () => `${config.emoji} ${config.name}`.trim(),
  "tagline":    () => config.tagline
};

export function applyWing(doc = document) {
  const root = doc.documentElement;
  root.dataset.wing = config.wing;
  root.dataset.accent = config.accent;

  for (const el of doc.querySelectorAll("[data-slot]")) {
    const fill = SLOTS[el.dataset.slot];
    if (fill) { el.textContent = fill(); }
  }

  /* Links that should point at the main site. */
  for (const a of doc.querySelectorAll("a[data-home]")) {
    if (config.home.url) { a.href = config.home.url; }
  }
}
