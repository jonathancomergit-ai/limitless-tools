/* ============================================================
   items.json and the items/ folders - unit tests

   The hub is built from items.json, so a typo there means a
   broken card. These tests keep the list and the folders in
   step: every entry has a folder, every folder has an entry.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkItem, sortItems, isNew, allTags, initials } from "../../kit/items.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const items = JSON.parse(fs.readFileSync(path.join(ROOT, "items.json"), "utf8"));
const folders = fs.readdirSync(path.join(ROOT, "items"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
  .map((d) => d.name);

/* ---- the real items.json ---------------------------------- */

test("items.json is a list of valid entries", () => {
  assert.ok(Array.isArray(items));
  for (const item of items) { assert.deepEqual(checkItem(item), [], JSON.stringify(item)); }
});

test("items.json slugs are unique", () => {
  const slugs = items.map((i) => i.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("every items.json entry has a folder with index.html, main.js and README.md", () => {
  for (const { slug, thumb, soon } of items) {
    if (soon) { continue; }
    for (const f of ["index.html", "main.js", "README.md"]) {
      assert.ok(fs.existsSync(path.join(ROOT, "items", slug, f)), `items/${slug}/${f} is missing`);
    }
    if (thumb) { assert.ok(fs.existsSync(path.join(ROOT, "items", slug, thumb)), `items/${slug}/${thumb} is missing`); }
  }
});

test("a built item is no longer marked soon", () => {
  for (const { slug, soon } of items) {
    if (soon) { assert.ok(!folders.includes(slug), `items/${slug}/ exists, so delete "soon": true from its items.json entry`); }
  }
});

test("every items/ folder is listed in items.json", () => {
  const listed = new Set(items.map((i) => i.slug));
  for (const f of folders) { assert.ok(listed.has(f), `items/${f}/ is not in items.json`); }
});

test("no template placeholders left in a listed item", () => {
  for (const { slug, soon } of items) {
    if (soon) { continue; }
    for (const f of ["index.html", "main.js", "README.md", "smoke.js"]) {
      const file = path.join(ROOT, "items", slug, f);
      if (!fs.existsSync(file)) { continue; }
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(text, /ITEM TITLE|ONE LINE ABOUT THE ITEM|TODO/, `items/${slug}/${f} still has a placeholder or TODO`);
    }
  }
  for (const i of items) { assert.doesNotMatch(i.blurb, /Describe it in one line|TODO/, `${i.slug}: blurb is still the placeholder`); }
});

test("the template is complete", () => {
  for (const f of ["index.html", "main.js", "README.md", "smoke.js"]) {
    assert.ok(fs.existsSync(path.join(ROOT, "items", "_template", f)), `items/_template/${f} is missing`);
  }
});

/* ---- kit/items.js helpers --------------------------------- */

test("checkItem names every problem", () => {
  assert.deepEqual(checkItem({ slug: "ok", title: "OK", blurb: "Fine.", tags: ["demo"], added: "2026-01-02" }), []);
  const bad = checkItem({ slug: "Bad Slug", title: "", blurb: "", tags: [], added: "yesterday", thumb: "../x.png" });
  assert.equal(bad.length, 6);
  assert.deepEqual(checkItem(null), ["entry is not an object"]);
  assert.deepEqual(checkItem({ slug: "ok", title: "OK", blurb: "Fine.", tags: ["demo"], added: "2026-01-02", soon: true }), []);
  assert.equal(checkItem({ slug: "ok", title: "OK", blurb: "Fine.", tags: ["demo"], added: "2026-01-02", soon: "yes" }).length, 1);
  assert.equal(checkItem({ slug: "_template", title: "T", blurb: "B", tags: ["a"], added: "2026-01-01" }).length, 1);
});

test("sortItems: newest first, then A-Z", () => {
  const sorted = sortItems([
    { title: "B", added: "2026-01-01" },
    { title: "A", added: "2026-01-01" },
    { title: "C", added: "2026-02-01" }
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ["C", "A", "B"]);
});

test("isNew, allTags, initials", () => {
  const today = new Date("2026-10-09T10:00:00Z");
  assert.equal(isNew({ added: "2026-10-01" }, today), true);
  assert.equal(isNew({ added: "2026-08-01" }, today), false);
  assert.deepEqual(allTags([{ tags: ["b", "a"] }, { tags: ["a", "c"] }]), ["a", "b", "c"]);
  assert.equal(initials("Hello Ball"), "HB");
  assert.equal(initials("orbit"), "O");
  assert.equal(initials(""), "?");
});
