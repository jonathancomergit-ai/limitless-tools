/* ============================================================
   Image Squisher - main script

   Pick or drop images -> each one is decoded, redrawn on a
   canvas at the new size, and encoded again. All in this tab:
   no upload, no server, no library.

   Sections:
     1. save       the settings (never the images)
     2. state      the list of files and their results
     3. squish     decode -> resize -> encode, one file at a time
     4. table      the results table + preview
     5. download   one file, or all of them as a .zip
     6. input      file picker, drag and drop, paste, settings form
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { makeZip } from "./zip.js";
import {
  FORMATS, DEFAULTS, fitSize, normalizeSettings, outputName, uniqueNames,
  formatBytes, percentSaved, looksLikeImage, zipName
} from "./squish.js";

bootItem();

const $ = (id) => document.getElementById(id);
const drop = $("drop");
const picker = $("files");
const form = {
  maxW: $("max-w"),
  maxH: $("max-h"),
  quality: $("quality"),
  qualityOut: $("quality-out"),
  qualityHint: $("quality-hint"),
  formats: [...document.querySelectorAll('input[name="format"]')],
  note: $("fmt-note")
};

/* ============================================================
   1. SAVE - settings only. Images are never stored anywhere.
   ============================================================ */
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { ...DEFAULTS },
  validate: (d) => {
    const n = normalizeSettings(d);
    return (n.format === d.format && n.quality === d.quality) || "Those settings don't look right.";
  }
});
mountSavePanel($("save-panel"), save, {
  title: "Your settings",
  intro: "Only your settings are saved, on this device. Your images are never stored.",
  exportLabel: "Export settings",
  importLabel: "Import settings",
  onImport: () => { fillForm(); resquishAll(); },
  onDelete: () => { fillForm(); resquishAll(); }
});

/* ============================================================
   2. STATE
   ============================================================ */
const state = exposeForTests({
  rows: [],          // { id, file, name, before, status, blob, after, outName, width, height, error }
  selected: null,    // row id shown in the preview
  busy: false,
  webp: null,        // can this browser encode WebP? (checked at start)
  settings: normalizeSettings(save.get())
});
let nextId = 1;
let generation = 0;  // bumped when settings change, so old work is thrown away

/* The format we'll really make: WebP falls back to JPEG if the
   browser can't encode it (older Safari). */
function effectiveFormat() {
  const f = state.settings.format;
  return f === "webp" && state.webp === false ? "jpeg" : f;
}

/* ============================================================
   3. SQUISH
   ============================================================ */

/* Decode a file into something drawImage takes. createImageBitmap
   is fast and honours phone photo rotation; <img> is the backup. */
async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* try <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/* Halve the size in steps before the last resize: one big jump
   down makes shimmering, jaggy edges. */
function resize(src, sw, sh, tw, th, opaque) {
  let cur = src;
  let w = sw;
  let h = sh;
  while (w / 2 >= tw && h / 2 >= th) {
    const step = canvasOf(Math.round(w / 2), Math.round(h / 2));
    const sctx = step.getContext("2d");
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(cur, 0, 0, step.width, step.height);
    cur = step;
    w = step.width;
    h = step.height;
  }
  const out = canvasOf(tw, th);
  const ctx = out.getContext("2d");
  if (opaque) {
    /* JPEG has no see-through: put clear areas on white, not black. */
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tw, th);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, 0, 0, tw, th);
  return out;
}

function encode(canvas, mime, quality) {
  return new Promise((resolve) => {
    try { canvas.toBlob(resolve, mime, quality); } catch { resolve(null); }
  });
}

async function squish(row, gen) {
  const s = state.settings;
  const format = effectiveFormat();
  const { mime } = FORMATS[format];

  if (!row.file.size) { throw new Error("This file is empty."); }
  if (!looksLikeImage(row.file)) { throw new Error("Not a picture this tool can read."); }

  let bmp;
  try { bmp = await decode(row.file); } catch {
    throw new Error("Couldn't open this one. It may be damaged, or a type browsers can't read (like HEIC).");
  }
  if (gen !== generation) { return; }

  const sw = bmp.width || bmp.naturalWidth;
  const sh = bmp.height || bmp.naturalHeight;
  if (!sw || !sh) { throw new Error("This picture has no size."); }
  const { width, height } = fitSize(sw, sh, s.maxWidth, s.maxHeight);

  let canvas;
  try {
    canvas = resize(bmp, sw, sh, width, height, format === "jpeg");
  } finally {
    if (bmp.close) { bmp.close(); }
  }
  const blob = await encode(canvas, mime, format === "png" ? undefined : s.quality / 100);
  canvas.width = canvas.height = 0;        // free the memory now, phones need it
  if (gen !== generation) { return; }
  if (!blob || !blob.size) { throw new Error("This browser ran out of room making it. Try a smaller max size."); }

  Object.assign(row, {
    status: "done",
    blob,
    after: blob.size,
    outType: blob.type,
    outName: outputName(row.name, blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpeg"),
    width,
    height,
    srcWidth: sw,
    srcHeight: sh,
    error: ""
  });
}

/* One at a time, so a phone never holds 20 big photos in memory. */
async function work() {
  if (state.busy) { return; }
  state.busy = true;
  await webpReady;
  const gen = generation;
  try {
    for (;;) {
      if (gen !== generation) { break; }
      const row = state.rows.find((r) => r.status === "wait");
      if (!row) { break; }
      row.status = "busy";
      progress();
      renderRow(row);
      try {
        await squish(row, gen);
      } catch (err) {
        row.status = "error";
        row.error = err.message || "Something went wrong with this one.";
      }
      if (gen !== generation) { break; }
      if (row.status === "busy") { row.status = "wait"; }
      renderRow(row);
      if (state.selected === row.id || state.selected == null) { select(row.status === "done" ? row.id : state.selected); }
      progress();
      await new Promise((r) => setTimeout(r, 0));   // let the page breathe
    }
  } finally {
    state.busy = false;
  }
  /* Settings changed mid-run: start again with the new ones. */
  if (gen !== generation) { work(); } else { progress(); summary(); }
}

function addFiles(list) {
  const files = [...(list || [])];
  if (!files.length) { return; }
  for (const file of files) {
    state.rows.push({ id: nextId++, file, name: file.name || "pasted image", before: file.size, status: "wait" });
  }
  say(`Added ${files.length} ${files.length === 1 ? "image" : "images"}.`);
  render();
  work();
}

let resquishTimer = 0;
function resquishAll() {
  state.settings = normalizeSettings(save.get());
  formatNote();
  clearTimeout(resquishTimer);
  resquishTimer = setTimeout(() => {
    generation++;
    for (const r of state.rows) {
      if (r.status !== "error") { Object.assign(r, { status: "wait", blob: null, after: null }); }
    }
    render();
    work();
  }, 250);
}

/* ============================================================
   4. TABLE + PREVIEW
   ============================================================ */
const rowsEl = $("rows");

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text != null) { n.textContent = text; }
  return n;
}

function render() {
  rowsEl.replaceChildren(...state.rows.map(buildRow));
  const any = state.rows.length > 0;
  $("table").hidden = !any;
  $("empty").hidden = any;
  $("clear").disabled = !any;
  summary();
  if (!any) { select(null); }
}

function buildRow(row) {
  const tr = el("tr");
  tr.dataset.id = row.id;
  fillRow(tr, row);
  return tr;
}

function renderRow(row) {
  const tr = rowsEl.querySelector(`tr[data-id="${row.id}"]`);
  if (tr) { fillRow(tr, row); }
  summary();
}

function fillRow(tr, row) {
  tr.className = `is-${row.status}` + (state.selected === row.id ? " is-selected" : "");
  const name = el("td", "c-name");
  const nameBtn = el("button", "sq-name", row.name);
  nameBtn.type = "button";
  nameBtn.title = row.name;
  nameBtn.setAttribute("aria-pressed", String(state.selected === row.id));
  nameBtn.disabled = row.status !== "done";
  nameBtn.addEventListener("click", () => select(row.id));
  name.append(nameBtn);

  if (row.status === "error") {
    const msg = el("td", "sq-err", row.error);
    msg.colSpan = 4;
    tr.replaceChildren(name, msg);
    return;
  }

  const before = el("td", "num", formatBytes(row.before));
  const after = el("td", "num", row.status === "done" ? formatBytes(row.after) : row.status === "busy" ? "working…" : "waiting");
  const pct = el("td", "num");
  /* Labels for the phone layout, where the header row is hidden. */
  before.dataset.label = "Before";
  after.dataset.label = "After";
  pct.dataset.label = "Saved";
  const dl = el("td", "c-dl");
  if (row.status === "done") {
    const p = percentSaved(row.before, row.after);
    const badge = el("span", "sq-pct" + (p < 0 ? " is-bigger" : ""), p < 0 ? `+${-p}%` : `${p}%`);
    if (p < 0) { badge.title = "Bigger than before. Try a lower quality, a smaller size or another format."; }
    pct.append(badge);
    const b = el("button", "btn btn-sm sq-dl", "↓");
    b.type = "button";
    b.setAttribute("aria-label", `Download ${row.outName}`);
    b.title = `Download ${row.outName}`;
    b.addEventListener("click", () => downloadBlob(row.blob, row.outName));
    dl.append(b);
  }
  tr.replaceChildren(name, before, after, pct, dl);
}

function summary() {
  const done = state.rows.filter((r) => r.status === "done");
  $("zip").disabled = !done.length || state.busy;
  if (!done.length) { $("total").textContent = ""; return; }
  const before = done.reduce((n, r) => n + r.before, 0);
  const after = done.reduce((n, r) => n + r.after, 0);
  const p = percentSaved(before, after);
  $("total").textContent = `${formatBytes(before)} → ${formatBytes(after)} · ${p >= 0 ? `${p}% smaller` : `${-p}% bigger`}`;
}

function progress() {
  const total = state.rows.length;
  const left = state.rows.filter((r) => r.status === "wait" || r.status === "busy").length;
  const box = $("progress-box");
  box.hidden = left === 0;
  $("progress").value = total ? (total - left) / total : 0;
  if (left) {
    say(`Squishing ${total - left + 1} of ${total}…`);
  } else if (total) {
    const bad = state.rows.filter((r) => r.status === "error").length;
    say(bad ? `Done. ${bad} couldn't be read.` : "Done.");
  }
}

function say(text) { $("status").textContent = text; }

/* Preview: object URLs for just the selected file, freed on change. */
let previewUrls = [];
function select(id) {
  state.selected = id;
  for (const u of previewUrls) { URL.revokeObjectURL(u); }
  previewUrls = [];
  const row = state.rows.find((r) => r.id === id && r.status === "done");
  const box = $("preview");
  for (const tr of rowsEl.children) {
    const on = Number(tr.dataset.id) === id;
    tr.classList.toggle("is-selected", on);
    const btn = tr.querySelector(".sq-name");
    if (btn) { btn.setAttribute("aria-pressed", String(on)); }
  }
  if (!row) { box.hidden = true; $("pre-before").removeAttribute("src"); $("pre-after").removeAttribute("src"); return; }
  const before = URL.createObjectURL(row.file);
  const after = URL.createObjectURL(row.blob);
  previewUrls = [before, after];
  $("pre-before").src = before;
  $("pre-after").src = after;
  $("pre-name").textContent = row.name;
  $("pre-before-cap").textContent = `${row.srcWidth}×${row.srcHeight} · ${formatBytes(row.before)}`;
  $("pre-after-cap").textContent = `${row.width}×${row.height} · ${formatBytes(row.after)}`;
  box.hidden = false;
}

/* ============================================================
   5. DOWNLOAD - blob URLs, freed straight after
   ============================================================ */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

$("zip").addEventListener("click", async () => {
  const done = state.rows.filter((r) => r.status === "done");
  if (!done.length) { return; }
  const btn = $("zip");
  btn.disabled = true;
  say("Making the zip…");
  try {
    const names = uniqueNames(done.map((r) => r.outName));
    const entries = [];
    for (let i = 0; i < done.length; i++) {
      entries.push({ name: names[i], data: new Uint8Array(await done[i].blob.arrayBuffer()) });
    }
    const zip = makeZip(entries);
    downloadBlob(new Blob([zip], { type: "application/zip" }), zipName());
    state.zipped = { files: entries.length, bytes: zip.length };
    say(`Zip ready: ${entries.length} ${entries.length === 1 ? "file" : "files"}, ${formatBytes(zip.length)}.`);
  } catch (err) {
    say(err.message || "Couldn't make the zip. Try downloading files one by one.");
  } finally {
    summary();
  }
});

$("clear").addEventListener("click", () => {
  generation++;
  state.rows = [];
  select(null);
  say("Cleared.");
  render();
  progress();
  picker.focus();
});

/* ============================================================
   6. INPUT
   ============================================================ */
picker.addEventListener("change", () => {
  addFiles(picker.files);
  picker.value = "";      // so choosing the same file again still works
});

/* Drag and drop onto the big box. A drop anywhere else on the page
   is caught too, so the browser never opens the image instead. */
let depth = 0;
drop.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; drop.classList.add("is-over"); });
drop.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) { drop.classList.remove("is-over"); } });
window.addEventListener("dragover", (e) => { e.preventDefault(); });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  depth = 0;
  drop.classList.remove("is-over");
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) { addFiles(files); } else { say("That wasn't a file. Drop image files from your computer."); }
});

/* Paste a screenshot straight in. */
window.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); addFiles(files); }
});

/* ---- the settings form ---- */
function fillForm() {
  const s = normalizeSettings(save.get());
  form.maxW.value = s.maxWidth || "";
  form.maxH.value = s.maxHeight || "";
  form.quality.value = String(s.quality);
  form.qualityOut.textContent = String(s.quality);
  for (const r of form.formats) { r.checked = r.value === s.format; }
  state.settings = s;
  formatNote();
}

function formatNote() {
  const f = state.settings.format;
  const png = effectiveFormat() === "png";
  form.quality.disabled = png;
  form.qualityHint.textContent = png
    ? "PNG keeps every pixel, so quality doesn't apply. Best for screenshots and drawings."
    : "Lower = smaller file. 70 to 85 looks great for photos.";
  if (f === "webp" && state.webp === false) {
    form.note.textContent = "This browser can't make WebP files, so you'll get JPEG instead.";
  } else if (effectiveFormat() === "jpeg") {
    form.note.textContent = "JPEG has no see-through parts: they turn white.";
  } else {
    form.note.textContent = "";
  }
}

function readForm() {
  const checked = form.formats.find((r) => r.checked);
  save.set(normalizeSettings({
    maxWidth: form.maxW.value === "" ? 0 : Number(form.maxW.value),
    maxHeight: form.maxH.value === "" ? 0 : Number(form.maxH.value),
    format: checked ? checked.value : DEFAULTS.format,
    quality: Number(form.quality.value)
  }));
  form.qualityOut.textContent = form.quality.value;
  resquishAll();
}

form.maxW.addEventListener("change", readForm);
form.maxH.addEventListener("change", readForm);
form.quality.addEventListener("input", () => { form.qualityOut.textContent = form.quality.value; });
form.quality.addEventListener("change", readForm);
for (const r of form.formats) { r.addEventListener("change", readForm); }

/* Can this browser encode WebP? A blank 2x2 canvas tells us. */
async function checkWebp() {
  const blob = await encode(canvasOf(2, 2), "image/webp", 0.8);
  state.webp = Boolean(blob && blob.type === "image/webp");
}

fillForm();
render();
const webpReady = checkWebp().catch(() => { state.webp = false; });
webpReady.then(() => {
  formatNote();
  drop.dataset.ready = "true";
});
