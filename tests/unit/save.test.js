/* ============================================================
   kit/save.js - unit tests (node --test)
   Every test passes its own storage, so nothing leaks between them.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APP, MAX_IMPORT_BYTES, createSave, createWingData, memoryStorage, pickStorage,
  keyFor, cleanData, checkEnvelope
} from "../../kit/save.js";

const fixedNow = () => new Date("2026-10-09T12:00:00Z");
const make = (opts = {}) => createSave({ slug: "demo", wing: "arcade", storage: memoryStorage(), now: fixedNow, defaults: { best: 0 }, ...opts });

/* ---- basics ------------------------------------------------ */

test("starts from defaults and returns copies", () => {
  const save = make({ defaults: { best: 0, list: [1] } });
  const a = save.get();
  a.list.push(2);
  assert.deepEqual(save.get(), { best: 0, list: [1] });
});

test("set merges and persists under a namespaced key", () => {
  const storage = memoryStorage();
  const save = make({ storage, defaults: { best: 0, name: "x" } });
  save.set({ best: 5 });
  assert.deepEqual(save.get(), { best: 5, name: "x" });

  const raw = JSON.parse(storage.getItem("ll:arcade:demo"));
  assert.equal(raw.app, APP);
  assert.equal(raw.wing, "arcade");
  assert.equal(raw.slug, "demo");
  assert.equal(raw.v, 1);
  assert.equal(raw.savedAt, "2026-10-09T12:00:00.000Z");
  assert.deepEqual(raw.data, { best: 5, name: "x" });

  /* A fresh instance reads it back. */
  assert.equal(make({ storage }).get().best, 5);
});

test("update takes a function", () => {
  const save = make({ defaults: { levels: [] } });
  save.update((d) => { d.levels.push(3); return d; });
  assert.deepEqual(save.get().levels, [3]);
});

test("onChange fires on set and clear", () => {
  const save = make();
  const seen = [];
  save.onChange((d) => seen.push(d.best));
  save.set({ best: 2 });
  save.clear();
  assert.deepEqual(seen, [2, 0]);
});

test("wings and items never share keys", () => {
  assert.equal(keyFor("arcade", "hello"), "ll:arcade:hello");
  const storage = memoryStorage();
  make({ storage, wing: "arcade" }).set({ best: 1 });
  make({ storage, wing: "lab" }).set({ best: 2 });
  assert.equal(make({ storage, wing: "arcade" }).get().best, 1);
  assert.equal(make({ storage, wing: "lab" }).get().best, 2);
});

test("bad slugs are refused", () => {
  assert.throws(() => make({ slug: "Bad Slug" }));
  assert.throws(() => make({ slug: "_template" }));
  assert.throws(() => make({ slug: "" }));
});

/* ---- storage blocked --------------------------------------- */

test("works in memory when storage throws on access", () => {
  const storage = pickStorage(() => { throw new Error("SecurityError"); });
  assert.equal(storage.isMemory, true);
  const save = make({ storage });
  assert.equal(save.persistent, false);
  save.set({ best: 9 });
  assert.equal(save.get().best, 9);
});

test("falls back to memory when a write throws (quota full)", () => {
  const broken = {
    length: 0, key: () => null, getItem: () => null, removeItem() {},
    setItem() { throw new Error("QuotaExceededError"); }
  };
  const save = make({ storage: broken });
  assert.equal(save.persistent, true);
  save.set({ best: 4 });
  assert.equal(save.get().best, 4);
  assert.equal(save.persistent, false);
});

test("pickStorage keeps working storage", () => {
  const real = memoryStorage();
  delete real.isMemory;
  assert.equal(pickStorage(() => real), real);
  assert.equal(pickStorage(() => undefined).isMemory, true);
});

test("corrupt stored data falls back to defaults", () => {
  const storage = memoryStorage();
  storage.setItem("ll:arcade:demo", "{not json");
  assert.deepEqual(make({ storage }).get(), { best: 0 });
  storage.setItem("ll:arcade:demo", JSON.stringify({ app: "other", data: { best: 3 } }));
  assert.deepEqual(make({ storage }).get(), { best: 0 });
});

/* ---- versions + migration ---------------------------------- */

test("migrate upgrades an old save on load", () => {
  const storage = memoryStorage();
  make({ storage }).set({ best: 7 });
  const v2 = make({
    storage, version: 2, defaults: { best: 0, stars: 0 },
    migrate: (d, from) => ({ ...d, stars: from === 1 ? d.best * 10 : 0 })
  });
  assert.deepEqual(v2.get(), { best: 7, stars: 70 });
});

test("a save from a newer version still loads", () => {
  const storage = memoryStorage();
  make({ storage, version: 3 }).set({ best: 8 });
  assert.equal(make({ storage, version: 1 }).get().best, 8);
});

/* ---- export / import --------------------------------------- */

test("export then import round-trips", () => {
  const a = make();
  a.set({ best: 12 });
  const text = a.exportText();
  assert.equal(a.filename(), "limitless-arcade-demo-save-2026-10-09.json");

  const b = make();
  const result = b.importText(text);
  assert.equal(result.ok, true);
  assert.equal(b.get().best, 12);
});

test("import refuses garbage, other items, other wings, newer versions", () => {
  const save = make();
  const good = JSON.parse(make().exportText());
  const cases = [
    ["", /empty/],
    ["{nope", /valid JSON/],
    ["[]", /isn't a Limitless Lab save/],
    [JSON.stringify({ ...good, app: "someone-else" }), /isn't a Limitless Lab save/],
    [JSON.stringify({ ...good, slug: "other" }), /for "other"/],
    [JSON.stringify({ ...good, wing: "lab" }), /lab wing/],
    [JSON.stringify({ ...good, v: 2 }), /newer version/],
    [JSON.stringify({ ...good, v: "1" }), /version/],
    [JSON.stringify({ ...good, data: [1, 2] }), /no data/],
    ["x".repeat(MAX_IMPORT_BYTES + 1), /too big/]
  ];
  for (const [text, msg] of cases) {
    const r = save.importText(text);
    assert.equal(r.ok, false, `should refuse: ${text.slice(0, 40)}`);
    assert.match(r.error, msg);
  }
  assert.equal(save.get().best, 0, "nothing was written");
});

test("import runs the item's validate()", () => {
  const save = make({ validate: (d) => (Number.isInteger(d.best) && d.best >= 0) || "Best must be a whole number." });
  const env = JSON.parse(make().exportText());
  env.data.best = -3;
  const r = save.importText(JSON.stringify(env));
  assert.equal(r.ok, false);
  assert.equal(r.error, "Best must be a whole number.");
});

test("import migrates an older file", () => {
  const old = make();
  old.set({ best: 2 });
  const v2 = make({ version: 2, defaults: { best: 0, extra: 0 }, migrate: (d) => ({ ...d, extra: 1 }) });
  assert.equal(v2.importText(old.exportText()).ok, true);
  assert.deepEqual(v2.get(), { best: 2, extra: 1 });
});

test("cleanData strips prototype tricks and non-JSON values", () => {
  const evil = JSON.parse('{"a":1,"__proto__":{"polluted":true},"nested":{"constructor":{"x":1},"ok":[1,null,"s"]}}');
  const clean = cleanData(evil);
  assert.deepEqual(clean, { a: 1, nested: { ok: [1, null, "s"] } });
  assert.equal({}.polluted, undefined);
  assert.equal(cleanData(Number.NaN), null);
  assert.equal(cleanData(() => 1), null);
});

test("checkEnvelope refuses deeply nested data", () => {
  let deep = {};
  const top = deep;
  for (let i = 0; i < 40; i++) { deep.x = {}; deep = deep.x; }
  const r = checkEnvelope({ app: APP, wing: "arcade", slug: "demo", v: 1, data: top }, { wing: "arcade", slug: "demo", version: 1 });
  assert.equal(r.ok, false);
});

/* ---- delete ----------------------------------------------- */

test("clear removes the key and resets to defaults", () => {
  const storage = memoryStorage();
  const save = make({ storage });
  save.set({ best: 3 });
  save.clear();
  assert.equal(storage.getItem("ll:arcade:demo"), null);
  assert.deepEqual(save.get(), { best: 0 });
});

/* ---- the whole wing (hub panel) ---------------------------- */

test("wing data exports, clears and re-imports only its own wing", () => {
  const storage = memoryStorage();
  make({ storage, slug: "one" }).set({ best: 1 });
  make({ storage, slug: "two" }).set({ best: 2 });
  make({ storage, slug: "one", wing: "lab" }).set({ best: 99 });
  storage.setItem("unrelated", "keep me");

  const wing = createWingData({ wing: "arcade", storage, now: fixedNow });
  assert.deepEqual(wing.slugs().sort(), ["one", "two"]);
  assert.equal(wing.filename(), "limitless-arcade-all-saves-2026-10-09.json");

  const text = wing.exportText();
  const bundle = JSON.parse(text);
  assert.equal(bundle.kind, "wing");
  assert.deepEqual(Object.keys(bundle.saves).sort(), ["one", "two"]);

  wing.clear();
  assert.deepEqual(wing.slugs(), []);
  assert.equal(storage.getItem("unrelated"), "keep me");
  assert.notEqual(storage.getItem("ll:lab:one"), null, "other wings untouched");

  const r = wing.importText(text);
  assert.equal(r.ok, true);
  assert.equal(r.message, "Loaded 2 saves.");
  assert.equal(make({ storage, slug: "two" }).get().best, 2);
});

test("wing import accepts a single item file and refuses other wings", () => {
  const storage = memoryStorage();
  const item = make({ storage: memoryStorage(), slug: "solo" });
  item.set({ best: 4 });
  const wing = createWingData({ wing: "arcade", storage });
  assert.equal(wing.importText(item.exportText()).ok, true);
  assert.equal(make({ storage, slug: "solo" }).get().best, 4);

  const labWing = createWingData({ wing: "lab", storage });
  assert.match(labWing.importText(item.exportText()).error, /arcade wing/);
});
