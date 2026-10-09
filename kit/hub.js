/* ============================================================
   Limitless Lab - hub page

   Builds the hub from items.json:
     1. paints the wing (name, emoji, colour) from site.config.js
     2. turns every item into a card, newest first
     3. adds tag filter chips when there's more than one tag
     4. mounts the "Your data" panel for every save in this wing
     5. links to the other wings in the footer
     6. fills the wing switcher in the header (Arcade / Lab / Workshop)

   To add an item you never touch this file: make the folder in
   items/ and add one entry to items.json.
   ============================================================ */

import { config, fullName, applyWing } from "./config.js";
import { checkItem, sortItems, isNew, allTags, initials } from "./items.js";
import { createWingData } from "./save.js";
import { mountSavePanel } from "./save-ui.js";

/* ---- tiny DOM helper -------------------------------------- */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) { continue; }
    if (k === "class") { node.className = v; } else { node.setAttribute(k, v === true ? "" : v); }
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

/* ============================================================
   1. WING
   ============================================================ */
applyWing();
document.title = `${fullName} - ${config.brand}`;

/* ============================================================
   2. CARDS
   ============================================================ */
function card(item, today) {
  const href = `items/${item.slug}/`;

  const art = h("div", { class: "card-art", "aria-hidden": "true" });
  if (item.thumb && !item.soon) {
    art.append(h("img", { src: `items/${item.slug}/${item.thumb}`, alt: "", width: "640", height: "360", loading: "lazy" }));
  } else {
    art.append(h("span", { class: "initials" }, initials(item.title)));
  }

  const tags = h("ul", { class: "tags", "aria-label": "Tags" });
  if (item.soon) { tags.append(h("li", { class: "tag is-soon" }, "Coming soon")); }
  else if (isNew(item, today)) { tags.append(h("li", { class: "tag is-new" }, "New")); }
  for (const t of item.tags) { tags.append(h("li", { class: "tag" }, t)); }

  /* A planned item: same card, but no link and nothing to open yet. */
  if (item.soon) {
    return h("article", { class: "card is-soon", "data-tags": item.tags.join("|") },
      art,
      h("div", { class: "card-body" },
        tags,
        h("h3", {}, item.title),
        h("p", {}, item.blurb),
        h("div", { class: "card-meta" },
          h("span", { class: "note" }, "Being built")
        )
      )
    );
  }

  return h("article", { class: "card", "data-tags": item.tags.join("|") },
    art,
    h("div", { class: "card-body" },
      tags,
      h("h3", {}, h("a", { href }, item.title)),
      h("p", {}, item.blurb),
      h("div", { class: "card-meta" },
        h("span", { class: "note" }, `Added ${item.added}`),
        h("span", { class: "note", "aria-hidden": "true" }, "Open →")
      )
    )
  );
}

/* ============================================================
   3. FILTER CHIPS
   ============================================================ */
function filters(items, grid) {
  const tags = allTags(items);
  const bar = document.getElementById("filters");
  if (!bar || tags.length < 2) { return; }

  const chips = [];
  function pick(tag) {
    for (const c of chips) { c.setAttribute("aria-pressed", String(c.dataset.tag === tag)); }
    for (const el of grid.children) {
      el.hidden = tag !== "" && !el.dataset.tags.split("|").includes(tag);
    }
  }
  for (const tag of ["", ...tags]) {
    const chip = h("button", { type: "button", class: "chip", "aria-pressed": String(tag === ""), "data-tag": tag },
      tag || "All");
    chip.addEventListener("click", () => pick(tag));
    chips.push(chip);
    bar.append(chip);
  }
  bar.hidden = false;
}

async function loadItems() {
  const grid = document.getElementById("grid");
  const count = document.getElementById("item-count");
  try {
    const res = await fetch("items.json", { cache: "no-cache" });
    if (!res.ok) { throw new Error(`items.json: HTTP ${res.status}`); }
    const list = await res.json();
    if (!Array.isArray(list)) { throw new Error("items.json must be a list"); }

    /* A broken entry is skipped (and shouted about in the console,
       which makes the Playwright test fail) rather than breaking
       the whole hub for visitors. */
    const good = [];
    for (const item of list) {
      const problems = checkItem(item);
      if (problems.length) { console.error("items.json:", problems.join("; ")); } else { good.push(item); }
    }

    const items = sortItems(good);
    const today = new Date();
    grid.replaceChildren(...items.map((i) => card(i, today)));
    if (count) { count.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`; }
    if (!items.length) {
      grid.replaceChildren(h("p", { class: "empty" }, "Nothing here yet. The first one is on its way."));
    }
    filters(items, grid);
  } catch (err) {
    console.error(err);
    grid.replaceChildren(h("p", { class: "empty" }, "Couldn't load the list. Try reloading the page."));
  }
}

/* ============================================================
   4. YOUR DATA
   ============================================================ */
const panel = document.getElementById("data-panel");
if (panel) {
  mountSavePanel(panel, createWingData(), {
    title: "Your data",
    headingLevel: 2,
    exportLabel: "Export all saves",
    importLabel: "Import saves",
    intro: `Every ${config.name} save lives on this device only. Export them all to one file, bring them back, or wipe the lot.`
  });
}

/* ============================================================
   5. OTHER WINGS
   ============================================================ */
const wingLinks = document.getElementById("wing-links");
if (wingLinks) {
  for (const w of config.wings) {
    if (!w.url || w.wing === config.wing) { continue; }
    wingLinks.append(h("a", { href: w.url }, `${w.emoji} ${w.name}`.trim()));
  }
  if (config.home.url) {
    wingLinks.append(h("a", { href: config.home.url }, config.home.label || "Home"));
  }
}

/* ============================================================
   6. WING SWITCHER
   One tap to hop between wings from the (sticky) header. The
   current wing is marked with aria-current and its own colour.
   ============================================================ */
const WING_ACCENT = { arcade: "hot", lab: "cyan", workshop: "amber" };
const wingSwitch = document.getElementById("wing-switch");
if (wingSwitch) {
  for (const w of config.wings) {
    if (!w.url) { continue; }
    const here = w.wing === config.wing;
    const attrs = { href: here ? "./" : w.url, "data-accent": WING_ACCENT[w.wing] || "hot" };
    if (here) { attrs["aria-current"] = "page"; }
    wingSwitch.append(h("a", attrs,
      h("span", { "aria-hidden": "true" }, w.emoji || ""), ` ${w.name}`));
  }
  if (!wingSwitch.children.length) { wingSwitch.hidden = true; }
}

loadItems();
