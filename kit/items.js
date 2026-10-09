/* ============================================================
   Limitless Lab - items.json rules

   items.json is the list the hub turns into cards. One entry
   per folder in items/:

     {
       "slug":  "hello",                    folder name in items/
       "title": "Hello Ball",               shown on the card
       "blurb": "Grab it, fling it...",     one or two short sentences
       "tags":  ["demo", "physics"],        lowercase, 1-4 of them
       "added": "2026-10-09",               YYYY-MM-DD
       "thumb": "thumb.webp"                OPTIONAL, a file in the item folder
       "soon":  true                        OPTIONAL, planned but not built yet:
                                            a "Coming soon" card with no link and
                                            no folder. Delete it when you build it.
     }

   Pure functions only - the hub and the unit tests both use them.
   ============================================================ */

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
export const TAG_RE = /^[a-z0-9][a-z0-9 -]{0,23}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const NEW_DAYS = 21;

/* Everything wrong with one entry, as plain sentences.
   An empty list means it's fine. */
export function checkItem(item) {
  const problems = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) { return ["entry is not an object"]; }

  const name = item.slug || "(no slug)";
  if (!SLUG_RE.test(item.slug || "") || item.slug.startsWith("_")) {
    problems.push(`${name}: slug must be lowercase letters, digits and dashes`);
  }
  if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 60) {
    problems.push(`${name}: title is required (60 characters max)`);
  }
  if (typeof item.blurb !== "string" || !item.blurb.trim() || item.blurb.length > 200) {
    problems.push(`${name}: blurb is required (200 characters max)`);
  }
  if (!Array.isArray(item.tags) || item.tags.length < 1 || item.tags.length > 4 ||
      !item.tags.every((t) => typeof t === "string" && TAG_RE.test(t))) {
    problems.push(`${name}: tags must be 1-4 short lowercase words`);
  }
  if (!DATE_RE.test(item.added || "") || Number.isNaN(Date.parse(item.added))) {
    problems.push(`${name}: added must be a date like 2026-10-09`);
  }
  if (item.thumb !== undefined && !/^[a-z0-9][a-z0-9._-]*\.(webp|png|jpg|jpeg|svg)$/i.test(item.thumb)) {
    problems.push(`${name}: thumb must be a plain image file name in the item folder`);
  }
  if (item.soon !== undefined && item.soon !== true) {
    problems.push(`${name}: soon must be true, or left out`);
  }
  return problems;
}

/* Newest first; same day falls back to A-Z by title. */
export function sortItems(items) {
  return [...items].sort((a, b) =>
    b.added.localeCompare(a.added) || a.title.localeCompare(b.title));
}

/* Added in the last NEW_DAYS days? */
export function isNew(item, today = new Date(), days = NEW_DAYS) {
  const added = Date.parse(item.added + "T00:00:00Z");
  return today.getTime() - added < days * 86_400_000;
}

/* Every tag used, A-Z, no repeats. */
export function allTags(items) {
  return [...new Set(items.flatMap((i) => i.tags))].sort();
}

/* "Hello Ball" -> "HB". Used when an item has no thumbnail. */
export function initials(title) {
  const words = String(title).split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => [...w][0].toUpperCase()).join("") || "?";
}
