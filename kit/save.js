/* ============================================================
   Limitless Lab - saves

   The ONLY way an item stores anything. Saves live in this
   browser's localStorage and never leave the device: no server,
   no cookies, no sync. People can move a save themselves with
   Export / Import (a JSON file), or wipe it with Delete.

   Item save, in an item's main.js:

     import { createSave } from "../../kit/save.js";
     const save = createSave({
       slug: "hello",                   // the item's folder name
       version: 1,                      // bump when the shape changes
       defaults: { best: 0 }
     });
     save.get().best;                   // read  (always a fresh copy)
     save.set({ best: 12 });            // write (merged into the save)

   Changing the shape later:

     createSave({ slug, version: 2, defaults,
       migrate: (data, fromVersion) => ({ ...data, newThing: 0 }) });

   How it is stored (one key per item):

     key    ll:<wing>:<slug>             e.g. ll:arcade:hello
     value  { app, wing, slug, v, savedAt, data }

   The wing is in the key because all three wings might end up
   on the same web address, and must never read each other's saves.

   If storage is blocked (private mode, strict settings) every
   save quietly falls back to memory: the item still works, it
   just forgets when the tab closes. save.persistent says which.
   ============================================================ */

import { config } from "./config.js";

export const APP = "limitless-lab";
export const MAX_IMPORT_BYTES = 1_000_000;   // 1 MB is plenty for a save
const MAX_DEPTH = 24;

/* ============================================================
   STORAGE: real localStorage, or memory if that is blocked
   ============================================================ */

/* A tiny stand-in with the same methods as localStorage. */
export function memoryStorage() {
  const map = new Map();
  return {
    isMemory: true,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear()
  };
}

/* Try the real thing; if even touching it throws, use memory.
   `get` is a function because just READING window.localStorage
   throws a SecurityError when site data is blocked. */
export function pickStorage(get = () => globalThis.localStorage) {
  try {
    const s = get();
    if (!s) { return memoryStorage(); }
    const probe = "ll:__probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

/* One shared store per page, so the hub's "Delete my data" and an
   item's save see the same memory store when storage is blocked. */
let shared = null;
export function defaultStorage() {
  if (!shared) { shared = pickStorage(); }
  return shared;
}

/* ============================================================
   SMALL PURE HELPERS (all unit tested)
   ============================================================ */

export function keyFor(wing, slug) { return `ll:${wing}:${slug}`; }
export function prefixFor(wing)    { return `ll:${wing}:`; }

export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) &&
         (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

/* A deep copy that only keeps JSON-safe values, and drops keys that
   could poison object prototypes. Imported files are untrusted, so
   everything that comes in goes through here. */
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export function cleanData(value, depth = 0) {
  if (depth > MAX_DEPTH) { throw new Error("Save is nested too deeply."); }
  if (value === null || typeof value === "string" || typeof value === "boolean") { return value; }
  if (typeof value === "number") { return Number.isFinite(value) ? value : null; }
  if (Array.isArray(value)) { return value.map((v) => cleanData(v, depth + 1)); }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (BAD_KEYS.has(k) || v === undefined || typeof v === "function") { continue; }
      out[k] = cleanData(v, depth + 1);
    }
    return out;
  }
  return null;   // functions, symbols, dates etc. never get stored
}

function today(now) {
  return now().toISOString().slice(0, 10);
}

/* Parse JSON text from a file, with friendly errors. */
function parseText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "That file is empty." };
  }
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: "That file is too big to be a save." };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "That file isn't a save file (it isn't valid JSON)." };
  }
}

/* Check one item envelope. Returns { ok, data } or { ok:false, error }.
   Does NOT write anything. */
export function checkEnvelope(env, { wing, slug, version, migrate = null, validate = null }) {
  if (!isPlainObject(env) || env.app !== APP) {
    return { ok: false, error: "That file isn't a Limitless Lab save." };
  }
  if (env.wing !== wing) {
    return { ok: false, error: `That save is from the ${env.wing || "unknown"} wing, not this one.` };
  }
  if (env.slug !== slug) {
    return { ok: false, error: `That save is for "${env.slug}", not "${slug}".` };
  }
  if (!Number.isInteger(env.v) || env.v < 1) {
    return { ok: false, error: "That save has no valid version number." };
  }
  if (env.v > version) {
    return { ok: false, error: "That save was made by a newer version. Reload the page and try again." };
  }
  if (!isPlainObject(env.data)) {
    return { ok: false, error: "That save has no data in it." };
  }

  let data;
  try {
    data = cleanData(env.data);
    if (env.v < version && migrate) { data = cleanData(migrate(data, env.v)); }
  } catch (err) {
    return { ok: false, error: `That save couldn't be read (${err.message}).` };
  }

  if (validate) {
    const verdict = validate(data);
    if (verdict !== true) {
      return { ok: false, error: typeof verdict === "string" ? verdict : "That save has unexpected data in it." };
    }
  }
  return { ok: true, data };
}

/* ============================================================
   ONE ITEM'S SAVE
   ============================================================ */
export function createSave({
  slug,
  version = 1,
  defaults = {},
  migrate = null,
  validate = null,
  wing = config.wing,
  storage = defaultStorage(),
  now = () => new Date()
} = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || "")) {
    throw new Error("createSave needs a slug like \"hello\" (lowercase, digits, dashes).");
  }

  const key = keyFor(wing, slug);
  const base = cleanData(defaults);
  const listeners = new Set();
  let store = storage;
  let data = load();

  /* ---- read from storage ---- */
  function load() {
    let text = null;
    try { text = store.getItem(key); } catch { store = memoryStorage(); }
    if (text == null) { return structuredClone(base); }

    const parsed = parseText(text);
    if (!parsed.ok) { return structuredClone(base); }   // corrupt: start fresh, don't crash

    const env = parsed.value;
    /* A save from a newer version (an old cached page): read what we
       can rather than throw it away. */
    const asVersion = isPlainObject(env) && env.v > version ? env.v : version;
    const checked = checkEnvelope(env, { wing, slug, version: asVersion, migrate });
    return checked.ok ? { ...structuredClone(base), ...checked.data } : structuredClone(base);
  }

  /* ---- write to storage ---- */
  function write() {
    const text = JSON.stringify(envelope());
    try {
      store.setItem(key, text);
    } catch {
      /* Full or blocked mid-session: keep going in memory. */
      store = memoryStorage();
      store.setItem(key, text);
    }
    for (const fn of listeners) { fn(save.get()); }
  }

  function envelope() {
    return { app: APP, wing, slug, v: version, savedAt: now().toISOString(), data };
  }

  const save = {
    key,
    slug,
    wing,
    version,
    label: "this save",
    get persistent() { return !store.isMemory; },

    /* Always a copy - changing it does nothing until you set() it. */
    get() { return structuredClone(data); },

    /* Shallow-merge a patch: set({ best: 3 }) keeps every other field. */
    set(patch) {
      data = { ...data, ...cleanData(patch) };
      write();
      return save.get();
    },

    /* For bigger changes: update(d => { d.levels.push(3); return d; }) */
    update(fn) {
      const next = fn(save.get());
      data = cleanData(isPlainObject(next) ? next : data);
      write();
      return save.get();
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /* ---- the three buttons (see kit/save-ui.js) ---- */
    filename() { return `limitless-${wing}-${slug}-save-${today(now)}.json`; },

    exportText() { return JSON.stringify(envelope(), null, 2); },

    /* Check a file's text without saving it. */
    check(text) {
      const parsed = parseText(text);
      if (!parsed.ok) { return parsed; }
      return checkEnvelope(parsed.value, { wing, slug, version, migrate, validate });
    },

    importText(text) {
      const result = save.check(text);
      if (!result.ok) { return result; }
      data = { ...structuredClone(base), ...result.data };
      write();
      return { ok: true, message: "Save loaded." };
    },

    clear() {
      try { store.removeItem(key); } catch { /* nothing to remove */ }
      data = structuredClone(base);
      for (const fn of listeners) { fn(save.get()); }
      return { ok: true, message: "Save deleted." };
    }
  };

  return save;
}

/* ============================================================
   EVERY SAVE IN THIS WING (the hub's data panel)
   Same export / import / clear shape as an item save, so the
   same UI drives both.
   ============================================================ */
export function createWingData({
  wing = config.wing,
  storage = defaultStorage(),
  now = () => new Date()
} = {}) {
  const prefix = prefixFor(wing);

  function keys() {
    const out = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(prefix)) { out.push(k); }
      }
    } catch { /* storage blocked: nothing to list */ }
    return out;
  }

  function bundle() {
    const saves = {};
    for (const k of keys()) {
      try {
        const env = JSON.parse(storage.getItem(k));
        if (isPlainObject(env) && env.app === APP) { saves[k.slice(prefix.length)] = cleanData(env); }
      } catch { /* skip a corrupt entry */ }
    }
    return { app: APP, kind: "wing", wing, v: 1, savedAt: now().toISOString(), saves };
  }

  const wingData = {
    wing,
    label: "all saves",
    get persistent() { return !storage.isMemory; },
    keys,
    slugs: () => keys().map((k) => k.slice(prefix.length)),

    filename() { return `limitless-${wing}-all-saves-${today(now)}.json`; },
    exportText() { return JSON.stringify(bundle(), null, 2); },

    /* Accepts a whole-wing bundle, or one item's save file. */
    check(text) {
      const parsed = parseText(text);
      if (!parsed.ok) { return parsed; }
      const v = parsed.value;
      if (!isPlainObject(v) || v.app !== APP) {
        return { ok: false, error: "That file isn't a Limitless Lab save." };
      }
      if (v.wing !== wing) {
        return { ok: false, error: `That save is from the ${v.wing || "unknown"} wing, not this one.` };
      }

      const list = v.kind === "wing" ? Object.entries(isPlainObject(v.saves) ? v.saves : {}) : [[v.slug, v]];
      const good = {};
      for (const [slug, env] of list) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(String(slug))) { continue; }
        /* The hub can't know each item's current version, so it
           accepts any version and lets the item migrate on load. */
        const checked = checkEnvelope(env, { wing, slug, version: Number.isInteger(env?.v) ? env.v : 0 });
        if (!checked.ok) { return { ok: false, error: `${slug}: ${checked.error}` }; }
        good[slug] = { app: APP, wing, slug, v: env.v, savedAt: String(env.savedAt || ""), data: checked.data };
      }
      if (!Object.keys(good).length) { return { ok: false, error: "That file has no saves in it." }; }
      return { ok: true, saves: good };
    },

    importText(text) {
      const result = wingData.check(text);
      if (!result.ok) { return result; }
      for (const [slug, env] of Object.entries(result.saves)) {
        try { storage.setItem(keyFor(wing, slug), JSON.stringify(env)); } catch { /* blocked */ }
      }
      const n = Object.keys(result.saves).length;
      return { ok: true, message: `Loaded ${n} save${n === 1 ? "" : "s"}.` };
    },

    clear() {
      const all = keys();
      for (const k of all) {
        try { storage.removeItem(k); } catch { /* already gone */ }
      }
      return { ok: true, message: all.length ? "All saves for this wing deleted." : "There was nothing saved." };
    }
  };

  return wingData;
}
