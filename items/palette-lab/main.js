/* ============================================================
   Palette Lab - main script

   The maths lives in color.js. This file builds the page:
   swatches with locks, the generator, the contrast grid, the
   colour-blind rows, exports and the saved library.

   Colours are painted with CSS custom properties set from JS
   (el.style.setProperty), which the Content-Security-Policy
   allows. There is no style="" in the HTML.

   Sections:
     1. save
     2. state
     3. swatches + generator
     4. contrast grid
     5. colour blindness
     6. export
     7. library
     8. keys
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createKeys } from "../../kit/input.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import {
  normalizeHex, contrast, grade, inkFor, simulate, generate, MODES, EXPORTS
} from "./color.js";

bootItem();

const $ = (id) => document.getElementById(id);
const MAX_LIBRARY = 200;
const STARTER = ["#1b1f3b", "#3d4a8c", "#e2516b", "#ffb347", "#fff4d6"];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text != null) { n.textContent = text; }
  return n;
}
const paint = (node, hex) => { node.style.setProperty("--c", hex); node.style.setProperty("--ink", inkFor(hex)); };

/* ============================================================
   1. SAVE
   ============================================================ */
const isPalette = (p) => Array.isArray(p) && p.length === 5 && p.every((c) => normalizeHex(c));
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { palette: STARTER, locks: [false, false, false, false, false], mode: "analogous", base: "#3d8bfd", format: "css", library: [] },
  validate: (d) => (isPalette(d.palette) && Array.isArray(d.library) && d.library.length <= 1000 &&
    d.library.every((x) => x && typeof x.name === "string" && isPalette(x.colors))) || "That file doesn't hold Palette Lab palettes."
});
mountSavePanel($("save-panel"), save, {
  title: "Your palettes",
  intro: "Your palette and saved library stay on this device. Export to back them up or move them.",
  onImport: () => { load(); renderAll(); },
  onDelete: () => { load(); renderAll(); }
});

/* ============================================================
   2. STATE - window.__item for smoke.js
   ============================================================ */
const state = exposeForTests({ palette: [], locks: [], mode: "analogous", base: "#3d8bfd", format: "css", library: [], generated: 0 });

function load() {
  const d = save.get();
  state.palette = isPalette(d.palette) ? d.palette.map(normalizeHex) : [...STARTER];
  state.locks = [0, 1, 2, 3, 4].map((i) => Boolean(d.locks && d.locks[i]));
  state.mode = MODES.includes(d.mode) ? d.mode : "analogous";
  state.base = normalizeHex(d.base) || "#3d8bfd";
  state.format = Object.hasOwn(EXPORTS, d.format) ? d.format : "css";
  state.library = (d.library || []).filter((x) => x && typeof x.name === "string" && isPalette(x.colors))
    .map((x) => ({ name: x.name.slice(0, 40), colors: x.colors.map(normalizeHex) }));
}

let saveTimer = 0;
function store() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save.set({
    palette: state.palette, locks: state.locks, mode: state.mode, base: state.base, format: state.format, library: state.library
  }), 150);
}

function say(t) { $("status").textContent = t; }

/* ============================================================
   3. SWATCHES + GENERATOR
   ============================================================ */
const swatches = [];   // { li, hex, picker, lock }

for (let i = 0; i < 5; i++) {
  const li = el("li", "pl-swatch");
  const face = el("div", "pl-face");

  const num = el("span", "pl-num", String(i + 1));
  num.setAttribute("aria-hidden", "true");
  const hexLabel = el("label", "sr-only", `Colour ${i + 1} hex code`);
  hexLabel.htmlFor = `hex-${i}`;
  const hex = Object.assign(el("input", "pl-hex"), { id: `hex-${i}`, type: "text", maxLength: 7, spellcheck: false, autocomplete: "off" });
  hex.setAttribute("autocapitalize", "off");
  face.append(num, hexLabel, hex);

  const tools = el("div", "pl-tools");
  const pickWrap = el("label", "pl-pick");
  const picker = Object.assign(el("input"), { type: "color" });
  pickWrap.append(picker, el("span", "sr-only", `Pick colour ${i + 1}`));
  const lock = el("button", "pl-lock");
  lock.type = "button";
  tools.append(pickWrap, lock);

  li.append(face, tools);
  $("swatches").append(li);

  const commit = (value) => {
    const h = normalizeHex(value);
    if (!h) { hex.classList.add("is-bad"); say(`"${value}" isn't a hex colour. Try something like #ffc93c.`); return; }
    hex.classList.remove("is-bad");
    state.palette[i] = h;
    say("");
    renderAll();
    store();
  };
  hex.addEventListener("change", () => commit(hex.value));
  hex.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(hex.value); hex.select(); } });
  picker.addEventListener("input", () => commit(picker.value));
  lock.addEventListener("click", () => toggleLock(i));

  swatches.push({ li, hex, picker, lock });
}

function toggleLock(i) {
  state.locks[i] = !state.locks[i];
  renderSwatches();
  store();
  say(state.locks[i] ? `Colour ${i + 1} locked. Generate keeps it.` : `Colour ${i + 1} unlocked.`);
}

function renderSwatches() {
  state.palette.forEach((c, i) => {
    const s = swatches[i];
    paint(s.li, c);
    if (document.activeElement !== s.hex) { s.hex.value = c; }
    s.picker.value = c;
    const on = state.locks[i];
    s.li.classList.toggle("is-locked", on);
    s.lock.setAttribute("aria-pressed", String(on));
    s.lock.setAttribute("aria-label", `Lock colour ${i + 1}`);
    s.lock.replaceChildren(el("span", "pl-lock-icon", on ? "■" : "□"), el("span", "pl-lock-text", on ? "Locked" : "Lock"));
  });
}

/* ---- harmony buttons ---- */
const MODE_LABELS = { analogous: "Analogous", complementary: "Complement", triadic: "Triadic", base: "From base" };
const modeInputs = MODES.map((m) => {
  const input = Object.assign(el("input"), { type: "radio", name: "mode", id: `mode-${m}`, value: m });
  const label = Object.assign(el("label", null, MODE_LABELS[m]), { htmlFor: `mode-${m}` });
  input.addEventListener("change", () => {
    if (!input.checked) { return; }
    state.mode = m;
    $("base-box").hidden = m !== "base";
    regenerate();
  });
  $("modes").append(input, label);
  return input;
});

$("base").addEventListener("input", () => {
  state.base = normalizeHex($("base").value) || state.base;
  regenerate();
});

function regenerate() {
  if (state.locks.every(Boolean)) { say("Every colour is locked. Unlock one to change it."); return; }
  state.palette = generate({ mode: state.mode, palette: state.palette, locks: state.locks, base: state.base });
  state.generated++;
  renderAll();
  store();
  const kept = state.locks.filter(Boolean).length;
  say(kept ? `New palette. Kept ${kept} locked.` : "New palette.");
}
$("generate").addEventListener("click", regenerate);

/* ============================================================
   4. CONTRAST GRID - row colour as text, on the column colour
   ============================================================ */
function badge(ratio) {
  const g = grade(ratio);
  if (g.aaa) { return el("b", "pl-badge is-aaa", "AAA"); }
  if (g.aa) { return el("b", "pl-badge is-aa", "AA"); }
  if (g.aaLarge) { return el("b", "pl-badge is-big", "Big"); }
  return el("b", "pl-badge is-fail", "✕");
}

function renderGrid() {
  const grid = $("grid");
  const caption = grid.querySelector("caption");
  const head = el("thead");
  const hr = el("tr");
  const corner = el("th", "pl-corner");
  corner.append(el("span", "sr-only", "Text colour, then background"));
  hr.append(corner);
  state.palette.forEach((c, j) => {
    const th = el("th", "pl-chip");
    th.scope = "col";
    paint(th, c);
    th.append(el("span", "sr-only", `on ${c}`), el("span", "pl-chip-n", String(j + 1)));
    hr.append(th);
  });
  head.append(hr);

  const body = el("tbody");
  state.palette.forEach((text, i) => {
    const tr = el("tr");
    const th = el("th", "pl-chip");
    th.scope = "row";
    paint(th, text);
    th.append(el("span", "sr-only", `Text ${text}`), el("span", "pl-chip-n", String(i + 1)));
    tr.append(th);
    state.palette.forEach((bg, j) => {
      const td = el("td", "pl-cell");
      if (i === j) {
        td.classList.add("is-same");
        td.append(el("span", "sr-only", "same colour"));
      } else {
        const r = contrast(text, bg);
        td.style.setProperty("--bg", bg);
        td.style.setProperty("--fg", text);
        td.append(el("span", "pl-aa", "Aa"), el("span", "pl-ratio", r.toFixed(1)), badge(r));
        td.title = `${text} on ${bg}: ${r.toFixed(2)}:1`;
      }
      tr.append(td);
    });
    body.append(tr);
  });
  grid.replaceChildren(caption, head, body);
}

/* ============================================================
   5. COLOUR BLINDNESS
   ============================================================ */
const CVD_ROWS = [
  { type: null, name: "Normal vision", note: "" },
  { type: "protanopia", name: "Protanopia", note: "no red cones, about 1 in 100 men" },
  { type: "deuteranopia", name: "Deuteranopia", note: "no green cones, about 1 in 100 men" },
  { type: "tritanopia", name: "Tritanopia", note: "no blue cones, rare" }
];

function renderCvd() {
  $("cvd").replaceChildren(...CVD_ROWS.map((row) => {
    const box = el("div", "pl-cvd-row");
    const label = el("p", "pl-cvd-label");
    label.append(el("strong", null, row.name));
    if (row.note) { label.append(" ", el("span", null, row.note)); }
    const strip = el("div", "pl-strip");
    strip.setAttribute("role", "img");
    const colours = state.palette.map((c) => (row.type ? simulate(c, row.type) : c));
    strip.setAttribute("aria-label", `${row.name}: ${colours.join(", ")}`);
    for (const c of colours) {
      const s = el("span");
      paint(s, c);
      strip.append(s);
    }
    box.append(label, strip);
    return box;
  }));
}

/* ============================================================
   6. EXPORT
   ============================================================ */
const FORMAT_HINTS = {
  css: "CSS custom properties. Paste into your stylesheet.",
  json: "Plain JSON. Handy for scripts and other tools.",
  gpl: "GIMP palette (.gpl). Opens in Aseprite, GIMP, Krita and Inkscape.",
  godot: "A GDScript constant. Paste into a Godot 3 or 4 script."
};
const formatButtons = Object.entries(EXPORTS).map(([key, f]) => {
  const b = el("button", "pl-fmt", f.label);
  b.type = "button";
  b.setAttribute("role", "radio");
  b.addEventListener("click", () => { state.format = key; renderExport(); store(); });
  $("formats").append(b);
  return [key, b];
});

const exportText = () => EXPORTS[state.format].make(state.palette);

function renderExport() {
  for (const [key, b] of formatButtons) {
    b.setAttribute("aria-checked", String(key === state.format));
    b.tabIndex = key === state.format ? 0 : -1;
  }
  $("code").textContent = exportText();
  $("format-hint").textContent = FORMAT_HINTS[state.format];
}

/* Arrow keys move between the format buttons, like radio buttons. */
$("formats").addEventListener("keydown", (e) => {
  const keys = Object.keys(EXPORTS);
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) { return; }
  e.preventDefault();
  state.format = keys[(keys.indexOf(state.format) + step + keys.length) % keys.length];
  renderExport();
  store();
  formatButtons.find(([k]) => k === state.format)[1].focus();
});

$("copy").addEventListener("click", async () => {
  const text = exportText();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    /* Older browsers: select the text so it can be copied by hand. */
    const range = document.createRange();
    range.selectNodeContents($("code"));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  $("copy").textContent = ok ? "Copied!" : "Selected: copy it";
  setTimeout(() => { $("copy").textContent = "Copy"; }, 1600);
});

$("download").addEventListener("click", () => {
  const f = EXPORTS[state.format];
  const url = URL.createObjectURL(new Blob([exportText()], { type: f.mime }));
  const a = el("a");
  a.href = url;
  a.download = `palette.${f.ext}`;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});

/* ============================================================
   7. LIBRARY
   ============================================================ */
function renderLibrary() {
  $("library").replaceChildren(...state.library.map((p, i) => {
    const li = el("li");
    const load = el("button", "pl-lib-load");
    load.type = "button";
    load.setAttribute("aria-label", `Load ${p.name}`);
    const strip = el("span", "pl-mini");
    for (const c of p.colors) { const s = el("span"); paint(s, c); strip.append(s); }
    load.append(strip, el("span", "pl-lib-name", p.name));
    load.addEventListener("click", () => {
      state.palette = [...p.colors];
      renderAll();
      store();
      say(`Loaded ${p.name}.`);
    });
    const del = el("button", "btn btn-sm btn-ghost pl-lib-del", "✕");
    del.type = "button";
    del.setAttribute("aria-label", `Delete ${p.name}`);
    del.addEventListener("click", () => {
      state.library.splice(i, 1);
      renderLibrary();
      store();
      $("lib-status").textContent = `Deleted ${p.name}.`;
      ($("library").querySelector(".pl-lib-load") || $("lib-name")).focus();
    });
    li.append(load, del);
    return li;
  }));
  $("lib-empty").hidden = state.library.length > 0;
}

$("lib-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("lib-name").value.trim().slice(0, 40) || `Palette ${state.library.length + 1}`;
  const same = state.library.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  if (same !== -1) {
    state.library[same] = { name, colors: [...state.palette] };
    $("lib-status").textContent = `Updated ${name}.`;
  } else {
    if (state.library.length >= MAX_LIBRARY) { $("lib-status").textContent = "The library is full. Delete one first."; return; }
    state.library.unshift({ name, colors: [...state.palette] });
    $("lib-status").textContent = `Saved ${name}.`;
  }
  $("lib-name").value = "";
  renderLibrary();
  store();
});

/* ============================================================
   8. KEYS - Space regenerates, 1-5 lock
   ============================================================ */
const keyMap = { regen: ["Space"] };
for (let i = 0; i < 5; i++) { keyMap[`lock${i}`] = [`Digit${i + 1}`, `Numpad${i + 1}`]; }
const keys = createKeys(keyMap);
keys.on("regen", regenerate);
for (let i = 0; i < 5; i++) { keys.on(`lock${i}`, () => toggleLock(i)); }

/* ---- go ---- */
function renderAll() {
  for (const r of modeInputs) { r.checked = r.value === state.mode; }
  $("base-box").hidden = state.mode !== "base";
  $("base").value = state.base;
  renderSwatches();
  renderGrid();
  renderCvd();
  renderExport();
  renderLibrary();
}

load();
renderAll();
$("swatches").dataset.ready = "true";
