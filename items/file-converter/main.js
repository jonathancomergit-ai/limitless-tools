/* ============================================================
   File Converter - main script

   Add files (drop, choose, paste) -> each is detected and gets
   a "to" menu of formats that make sense -> Convert all ->
   download one by one, or all as a .zip. All in this tab:
   no upload, no server, no library.

   Sections:
     1. save       the settings (never the files)
     2. state      the list of files and their results
     3. add        file -> detected type (+ parsed data)
     4. convert    data, pictures, sound
     5. list       one row a file
     6. preview    table / picture / output text
     7. download   one file, all as .zip, pictures as one PDF
     8. input      picker, drop, paste box, settings form
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { detect, detectText, targetsFor, blockedNote, defaultTarget, FORMATS } from "./detect.js";
import {
  DEFAULTS, normalizeSettings, parseData, stringifyData, toTable,
  outputName, uniqueNames, formatBytes, baseName, icoSizesFor, fitPicture
} from "./convert.js";
import { readIco, largestEntry, dibToRgba, makeIco } from "./ico.js";
import { makeBmp, hexToRgb } from "./bmp.js";
import { runJob } from "./worker.js";

bootItem();

const $ = (id) => document.getElementById(id);
const MAX_TEXT = 30 * 1024 * 1024;      // data files bigger than this are too much for a phone
const MAX_SIDE = 8192;
const MAX_AREA = 16_777_216;           // iOS Safari's canvas limit (4096 x 4096): bigger gives no context

/* ============================================================
   1. SAVE - settings only. Files are never stored anywhere.
   ============================================================ */
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { ...DEFAULTS, icoSizes: [...DEFAULTS.icoSizes] },
  validate: (d) => {
    const n = normalizeSettings(d);
    return (n.quality === d.quality && n.background === d.background) || "That file doesn't hold File Converter settings.";
  }
});
mountSavePanel($("save-panel"), save, {
  title: "Your settings",
  intro: "Only your settings (formats you picked, quality, background, icon sizes, CSV and sound options) are saved, on this device. Your files are never stored.",
  exportLabel: "Export settings",
  importLabel: "Import settings",
  onImport: () => { fillForm(); settingsChanged(); },
  onDelete: () => { fillForm(); settingsChanged(); }
});

/* ============================================================
   2. STATE
   ============================================================ */
const state = exposeForTests({
  settings: normalizeSettings(save.get()),
  rows: [],          // { id, file, name, size, det, target, status, note, error, text, value, out, outText }
  selected: 0,       // row id in the preview
  busy: false,
  converted: 0,      // how many conversions finished (all time)
  zipped: null,      // { files, bytes } after Download all
  pdf: null          // { pages, bytes } after Pictures -> one PDF
});
let nextId = 1;

/* ---- the worker (with a same-thread fallback) ---- */
let worker = null;
let jobs = 0;
const waiting = new Map();
try {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.addEventListener("message", (e) => {
    const w = waiting.get(e.data.id);
    if (!w) { return; }
    waiting.delete(e.data.id);
    if (e.data.ok) { w.resolve(e.data.bytes); } else { w.reject(new Error(e.data.error)); }
  });
  worker.addEventListener("error", (e) => {
    e.preventDefault();
    worker = null;
    for (const w of waiting.values()) { w.retry(); }
    waiting.clear();
  });
} catch { worker = null; }

function job(op, data, transfer = []) {
  const local = () => Promise.resolve().then(() => runJob(op, data));
  if (!worker) { return local(); }
  return new Promise((resolve, reject) => {
    const id = ++jobs;
    waiting.set(id, { resolve, reject, retry: () => local().then(resolve, reject) });
    worker.postMessage({ id, op, data }, transfer);
  });
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* ============================================================
   3. ADD
   ============================================================ */
async function addFiles(list) {
  const files = [...list].filter(Boolean);
  if (!files.length) { return; }
  let firstNew = 0;
  for (const file of files) {
    const row = {
      id: nextId++, file, name: file.name || "file", size: file.size, det: null, target: "",
      status: "ready", note: "", error: "", text: null, value: undefined, out: null, outText: ""
    };
    if (!firstNew) { firstNew = row.id; }
    state.rows.push(row);
    try { await inspect(row); } catch (err) { row.status = "error"; row.error = err.message || "Couldn't read this file."; }
    row.target = defaultTarget(row.det || {}, state.settings.targets);
    if (!row.target && row.status !== "error") { row.status = "blocked"; }
    renderRow(row);
  }
  counts();
  select(firstNew);
  say(`${files.length} ${files.length === 1 ? "file" : "files"} added.`);
}

async function inspect(row) {
  if (!row.size) { row.det = { kind: "other", format: "", label: "Empty" }; throw new Error("This file is empty."); }
  const head = new Uint8Array(await row.file.slice(0, 64).arrayBuffer());
  let det = detect({ head, name: row.name, type: row.file.type });
  if (det.kind === "text" || det.kind === "data") {
    if (row.size > MAX_TEXT) { row.det = det; throw new Error("This file is too big to convert here (30 MB is the limit for data)."); }
    row.text = await row.file.text();
    const fmt = det.kind === "data" ? det.format : detectText(row.text);
    if (!fmt) {
      row.det = { kind: "other", format: "", label: "Text" };
      row.note = "Couldn't tell if this is CSV, JSON, XML or YAML. Name it .csv, .json, .xml or .yaml and add it again.";
      return;
    }
    det = { kind: "data", format: fmt, label: FORMATS[fmt].label };
    row.det = det;
    parseRow(row);
    return;
  }
  row.det = det;
  if ((det.kind === "audio" || det.kind === "video") && row.size > MAX_SOUND) { throw new Error(TOO_BIG_SOUND); }
  row.note = blockedNote(det);
}

function parseRow(row) {
  try {
    const { value } = parseData(row.text, row.det.format, { delimiter: state.settings.delimiter });
    row.value = value;
    row.error = "";
    if (row.status === "error") { row.status = "ready"; }
  } catch (err) {
    row.value = undefined;
    row.error = err.message;
    row.status = "error";
  }
}

/* ============================================================
   4. CONVERT
   ============================================================ */
async function convertRow(row) {
  if (row.status === "blocked" || !row.target) { return; }
  if (row.det.kind === "data" && row.value === undefined) { return; }   // a parse error is already showing
  row.status = "busy";
  row.error = "";
  renderRow(row);
  try {
    const kind = row.det.kind;
    if (kind === "data") { await convertData(row); } else if (kind === "image") { await convertImage(row); } else if (kind === "audio" || kind === "video") { await convertSound(row); }
    row.status = "done";
    state.converted++;
  } catch (err) {
    row.status = "error";
    row.out = null;
    row.error = err && err.message ? err.message : "Couldn't convert this one.";
  }
  renderRow(row);
  if (state.selected === row.id) { preview(); }
}

async function convertData(row) {
  const text = stringifyData(row.value, row.target, state.settings);
  const tab = row.target === "csv" && state.settings.delimiter === "tab";
  row.outText = text;
  row.out = {
    blob: new Blob([text], { type: `${FORMATS[row.target].mime};charset=utf-8` }),
    name: outputName(row.name, row.target, { tab })
  };
}

/* ---- pictures ---- */
function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/* A canvas past the device's limit gives no context (iOS Safari): say so kindly. */
function ctx2d(canvas, opts) {
  const ctx = canvas.getContext("2d", opts);
  if (!ctx) { throw new Error("This picture is too big for this device. Try a smaller one."); }
  return ctx;
}

function toBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    try { canvas.toBlob(resolve, mime, quality); } catch { resolve(null); }
  });
}

async function bitmapOf(blob) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(blob); } catch { /* try <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* Any input picture -> a canvas (see-through kept). */
async function decodePicture(row) {
  let src;
  try {
    if (row.det.format === "ico") {
      const { entries } = readIco(new Uint8Array(await row.file.arrayBuffer()));
      const best = largestEntry(entries);
      if (best.isPng) {
        src = await bitmapOf(new Blob([best.data], { type: "image/png" }));
      } else {
        const { width, height, rgba } = dibToRgba(best.data);
        const c = canvasOf(width, height);
        ctx2d(c).putImageData(new ImageData(rgba, width, height), 0, 0);
        src = c;
      }
    } else {
      src = await bitmapOf(row.file);
    }
  } catch (err) {
    throw new Error(err && /icon|too big/i.test(err.message) ? err.message : "Couldn't open this picture. It may be damaged, or a type this browser can't read.");
  }
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  if (!sw || !sh) { throw new Error("This picture has no size."); }
  const { width: w, height: h } = fitPicture(sw, sh, MAX_SIDE, MAX_AREA);
  const c = canvasOf(w, h);
  const ctx = ctx2d(c, { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) { src.close(); }
  return c;
}

/* The same picture on a solid background (for JPG / PDF). */
function flatten(canvas) {
  const c = canvasOf(canvas.width, canvas.height);
  const ctx = ctx2d(c);
  ctx.fillStyle = state.settings.background;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

async function jpegBytes(canvas) {
  const blob = await toBlob(flatten(canvas), "image/jpeg", state.settings.quality / 100);
  if (!blob) { throw new Error("This browser ran out of room making a JPG. Try a smaller picture."); }
  return new Uint8Array(await blob.arrayBuffer());
}

async function convertImage(row) {
  const canvas = await decodePicture(row);
  const t = row.target;
  const q = state.settings.quality / 100;
  let blob;
  if (t === "png") {
    blob = await toBlob(canvas, "image/png");
  } else if (t === "webp") {
    blob = await toBlob(canvas, "image/webp", q);
    if (blob && blob.type !== "image/webp") { throw new Error("This browser can't make WebP. Try PNG or JPG."); }
  } else if (t === "jpg") {
    blob = new Blob([await jpegBytes(canvas)], { type: "image/jpeg" });
  } else if (t === "bmp") {
    const data = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
    blob = new Blob([makeBmp(data, canvas.width, canvas.height, { background: hexToRgb(state.settings.background) })], { type: "image/bmp" });
  } else if (t === "ico") {
    const images = [];
    for (const size of icoSizesFor(state.settings, canvas.width, canvas.height)) {
      const c = canvasOf(size, size);
      const ctx = ctx2d(c);
      const k = Math.min(size / canvas.width, size / canvas.height);
      const w = Math.max(1, Math.round(canvas.width * k));
      const h = Math.max(1, Math.round(canvas.height * k));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(canvas, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
      const png = await toBlob(c, "image/png");
      if (!png) { throw new Error("This browser couldn't make the icon."); }
      images.push({ width: size, height: size, data: new Uint8Array(await png.arrayBuffer()) });
    }
    blob = new Blob([makeIco(images)], { type: "image/x-icon" });
    row.info = `Sizes inside: ${images.map((im) => im.width).join(", ")}`;
  } else if (t === "pdf") {
    const bytes = await jpegBytes(canvas);
    const pdf = await job("pdf", { jpegs: [bytes], title: baseName(row.name) }, [bytes.buffer]);
    blob = new Blob([pdf], { type: "application/pdf" });
  }
  if (!blob || !blob.size) { throw new Error("This browser ran out of room making it. Try a smaller picture."); }
  if (t !== "ico") { row.info = `${canvas.width} × ${canvas.height} px`; }
  canvas.width = canvas.height = 0;
  row.out = { blob, name: outputName(row.name, t) };
}

/* ---- sound ---- */
const MAX_SOUND = 150 * 1024 * 1024;    // sound and video: decoded, they grow many times over
const TOO_BIG_SOUND = "This file is too big to convert here (150 MB is the limit for sound and video).";

async function convertSound(row) {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) { throw new Error("This browser can't decode sound."); }
  if (row.size > MAX_SOUND) { throw new Error(TOO_BIG_SOUND); }
  const rate = state.settings.sampleRate;
  const ctx = new Ctx(1, 1, rate);
  let buf;
  try {
    buf = await ctx.decodeAudioData(await row.file.arrayBuffer());
  } catch {
    throw new Error(row.det.kind === "video"
      ? "No sound found in this video, or this browser can't read it."
      : "This browser can't decode this sound. It may be damaged, or a codec it doesn't have.");
  }
  const channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) { channels.push(buf.getChannelData(c).slice()); }
  const bytes = await job("wav", { channels, sampleRate: buf.sampleRate, mono: state.settings.mono }, channels.map((c) => c.buffer));
  const ch = state.settings.mono ? 1 : buf.numberOfChannels;
  row.info = `${buf.duration.toFixed(1)} s · ${ch === 1 ? "mono" : ch === 2 ? "stereo" : `${ch} channels`} · ${buf.sampleRate / 1000} kHz`;
  row.out = { blob: new Blob([bytes], { type: "audio/wav" }), name: outputName(row.name, "wav") };
}

async function convertAll() {
  if (state.busy) { return; }
  const todo = state.rows.filter((r) => r.status === "ready" || (r.status === "error" && r.det && r.det.kind !== "data"));
  if (!todo.length) { say(state.rows.some((r) => r.status === "done") ? "Everything is converted. Download below." : "Nothing to convert."); return; }
  state.busy = true;
  buttons();
  let k = 0;
  for (const row of todo) {
    if (!state.rows.includes(row)) { continue; }    // removed meanwhile
    k++;
    say(`Converting ${k} of ${todo.length}: ${row.name}…`);
    await nextFrame();                              // let the page breathe between files
    await convertRow(row);
  }
  state.busy = false;
  const done = todo.filter((r) => r.status === "done").length;
  const bad = todo.length - done;
  say(`Done: ${done} converted${bad ? `, ${bad} couldn't be` : ""}.`);
  buttons();
}

/* ============================================================
   5. LIST
   ============================================================ */
const listEl = $("list");
const rowEls = new Map();

function makeRowEl(row) {
  const li = document.createElement("li");
  li.className = "fc-row";
  li.dataset.id = String(row.id);

  const top = document.createElement("div");
  top.className = "fc-row-top";
  const name = document.createElement("button");
  name.type = "button";
  name.className = "fc-name";
  const fname = document.createElement("span");
  fname.className = "fc-fname";
  const meta = document.createElement("span");
  meta.className = "fc-meta";
  name.append(fname, meta);
  name.addEventListener("click", () => select(row.id));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn-sm btn-ghost fc-remove";
  remove.setAttribute("aria-label", `Remove ${row.name}`);
  remove.textContent = "×";
  remove.addEventListener("click", () => removeRow(row.id));
  top.append(name, remove);

  const act = document.createElement("div");
  act.className = "fc-row-act";
  const to = document.createElement("label");
  to.className = "fc-to";
  const toText = document.createElement("span");
  toText.textContent = "to";
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", `Convert ${row.name} to`);
  sel.addEventListener("change", () => {
    row.target = sel.value;
    if (row.status === "done" || (row.status === "error" && row.det.kind !== "data")) { row.status = "ready"; row.out = null; row.error = ""; }
    if (row.det && row.det.format) {
      save.set({ targets: { ...state.settings.targets, [row.det.format]: row.target } });
      state.settings = normalizeSettings(save.get());
    }
    renderRow(row);
    if (state.selected === row.id) { preview(); }
  });
  to.append(toText, sel);
  const dl = document.createElement("button");
  dl.type = "button";
  dl.className = "btn btn-sm fc-dl";
  dl.textContent = "Download";
  dl.addEventListener("click", () => {
    if (row.out) { downloadBlob(row.out.blob, row.out.name); say(`Downloaded ${row.out.name}.`); }
  });
  act.append(to, dl);

  const note = document.createElement("p");
  note.className = "fc-row-note";
  li.append(top, act, note);
  return li;
}

function renderRow(row) {
  let li = rowEls.get(row.id);
  if (!li) {
    li = makeRowEl(row);
    rowEls.set(row.id, li);
    listEl.append(li);
  }
  const det = row.det || { kind: "other", label: "?" };
  li.dataset.kind = det.kind;
  li.dataset.status = row.status;
  li.querySelector(".fc-fname").textContent = row.name;
  li.querySelector(".fc-meta").textContent = `${det.label} · ${formatBytes(row.size)}`;
  li.querySelector(".fc-name").setAttribute("aria-pressed", String(state.selected === row.id));

  const sel = li.querySelector("select");
  const targets = targetsFor(det);
  const want = targets.map((t) => `${t.value}:${t.disabled ? 1 : 0}`).join(",");
  if (sel.dataset.opts !== want) {
    sel.replaceChildren(...targets.map((t) => {
      const o = document.createElement("option");
      o.value = t.value;
      o.textContent = t.label;
      o.disabled = Boolean(t.disabled);
      return o;
    }));
    sel.dataset.opts = want;
  }
  if (!targets.length) {
    const o = document.createElement("option");
    o.textContent = "nothing";
    sel.replaceChildren(o);
    sel.dataset.opts = "";
  }
  sel.value = row.target || "";
  sel.disabled = !targets.some((t) => !t.disabled) || row.status === "busy";

  const dl = li.querySelector(".fc-dl");
  dl.disabled = !row.out;
  dl.textContent = row.out ? `Download .${row.out.name.split(".").pop()}` : "Download";

  const note = li.querySelector(".fc-row-note");
  let text = "";
  let cls = "";
  if (row.status === "busy") { text = "Converting…"; } else if (row.error) { text = row.error; cls = "is-error"; } else if (row.status === "done") { text = `Ready: ${row.out.name} · ${formatBytes(row.out.blob.size)}`; cls = "is-done"; } else if (row.note) { text = row.note; cls = "is-warn"; }
  note.textContent = text;
  note.className = `fc-row-note ${cls}`;
  buttons();
}

function removeRow(id) {
  const i = state.rows.findIndex((r) => r.id === id);
  if (i < 0) { return; }
  const [row] = state.rows.splice(i, 1);
  const li = rowEls.get(id);
  rowEls.delete(id);
  const next = listEl.children[[...listEl.children].indexOf(li) + 1] || listEl.children[[...listEl.children].indexOf(li) - 1];
  li.remove();
  if (state.selected === id) { select(state.rows[Math.min(i, state.rows.length - 1)]?.id || 0); }
  next?.querySelector(".fc-remove")?.focus();
  if (!next) { $("files").focus(); }
  say(`Removed ${row.name}.`);
  counts();
}

function counts() {
  const n = state.rows.length;
  $("count").textContent = n ? `${n} ${n === 1 ? "file" : "files"}` : "";
  $("empty").hidden = n > 0;
  buttons();
}

function buttons() {
  const anyTodo = state.rows.some((r) => r.status === "ready" || (r.status === "error" && r.det && r.det.kind !== "data"));
  $("convert-all").disabled = state.busy || !anyTodo;
  $("zip").disabled = state.busy || !state.rows.some((r) => r.out);
  $("clear").disabled = state.busy || !state.rows.length;
  const pics = state.rows.filter((r) => r.det && r.det.kind === "image" && r.status !== "error").length;
  $("pdf").hidden = pics < 1;
  $("pdf").disabled = state.busy;
  $("pdf").textContent = pics > 1 ? `${pics} pictures → one PDF` : "Picture → PDF";
}

function say(text) { $("progress").textContent = text; }

/* ============================================================
   6. PREVIEW
   ============================================================ */
let imgUrl = "";

function select(id) {
  state.selected = id;
  for (const r of state.rows) {
    rowEls.get(r.id)?.querySelector(".fc-name").setAttribute("aria-pressed", String(r.id === id));
  }
  preview();
}

function preview() {
  const row = state.rows.find((r) => r.id === state.selected);
  const card = $("preview-card");
  if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = ""; }
  if (!row) { card.hidden = true; return; }
  card.hidden = false;
  $("pre-name").textContent = row.name;
  $("pre-error").textContent = row.error || "";
  $("pre-info").textContent = row.status === "done" ? row.info || "" : row.note || "";

  /* data: a table of what was read, and the output text */
  const isData = row.det && row.det.kind === "data";
  $("pre-table").hidden = !(isData && row.value !== undefined);
  if (isData && row.value !== undefined) { drawTable(toTable(row.value, 50)); }
  const outText = isData && row.status === "done" ? row.outText : "";
  $("pre-out").hidden = !outText;
  const max = 20000;
  $("out-text").textContent = outText.length > max ? `${outText.slice(0, max)}\n…(${formatBytes(outText.length - max)} more in the file)` : outText;
  $("out-caption").textContent = row.out ? `Output: ${row.out.name}` : "Output";

  /* pictures: the result if there is one, else the original */
  const isPic = row.det && row.det.kind === "image" && row.status !== "error";
  $("pre-image").hidden = !isPic;
  if (isPic) {
    const showOut = row.out && /^image\/(png|jpeg|webp|bmp|x-icon)$/.test(row.out.blob.type);
    const blob = showOut ? row.out.blob : row.file;
    imgUrl = URL.createObjectURL(blob);
    const img = $("pre-img");
    img.src = imgUrl;
    img.alt = showOut ? `The converted picture, ${row.out.name}` : `The original picture, ${row.name}`;
    $("image-caption").textContent = showOut ? `After: ${row.out.name}` : "Before (convert to see the result)";
  }
}

function drawTable({ columns, rows, total }) {
  const table = $("table");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const c of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = c;
    hr.append(th);
  }
  thead.append(hr);
  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    for (const cell of r) {
      const td = document.createElement("td");
      td.textContent = cell.length > 200 ? `${cell.slice(0, 200)}…` : cell;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.replaceChildren(thead, tbody);
  $("table-caption").textContent = total > rows.length
    ? `Table: first ${rows.length} of ${total} rows`
    : `Table: ${total} ${total === 1 ? "row" : "rows"} · ${columns.length} ${columns.length === 1 ? "column" : "columns"}`;
}

/* ============================================================
   7. DOWNLOAD - blob URLs, freed straight after
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
  const done = state.rows.filter((r) => r.out);
  if (!done.length || state.busy) { return; }
  state.busy = true;
  buttons();
  say("Packing the zip…");
  try {
    const names = uniqueNames(done.map((r) => r.out.name));
    const entries = [];
    for (let i = 0; i < done.length; i++) {
      entries.push({ name: names[i], data: new Uint8Array(await done[i].out.blob.arrayBuffer()) });
    }
    const zip = await job("zip", { entries }, entries.map((e) => e.data.buffer));
    downloadBlob(new Blob([zip], { type: "application/zip" }), "converted-files.zip");
    state.zipped = { files: entries.length, bytes: zip.length };
    say(`Zip ready: ${entries.length} ${entries.length === 1 ? "file" : "files"}, ${formatBytes(zip.length)}.`);
  } catch (err) {
    say(err.message || "Couldn't make the zip.");
  } finally {
    state.busy = false;
    buttons();
  }
});

$("pdf").addEventListener("click", async () => {
  const pics = state.rows.filter((r) => r.det && r.det.kind === "image" && r.status !== "error");
  if (!pics.length || state.busy) { return; }
  state.busy = true;
  buttons();
  try {
    const jpegs = [];
    for (let i = 0; i < pics.length; i++) {
      say(`PDF: page ${i + 1} of ${pics.length}…`);
      await nextFrame();
      const canvas = await decodePicture(pics[i]);
      jpegs.push(await jpegBytes(canvas));
      canvas.width = canvas.height = 0;
    }
    say("PDF: putting it together…");
    const pdf = await job("pdf", { jpegs, title: pics.length === 1 ? baseName(pics[0].name) : "Pictures" }, jpegs.map((j) => j.buffer));
    const name = pics.length === 1 ? outputName(pics[0].name, "pdf") : "pictures.pdf";
    downloadBlob(new Blob([pdf], { type: "application/pdf" }), name);
    state.pdf = { pages: pics.length, bytes: pdf.length };
    say(`PDF ready: ${pics.length} ${pics.length === 1 ? "page" : "pages"}, ${formatBytes(pdf.length)}.`);
  } catch (err) {
    say(err.message || "Couldn't make the PDF.");
  } finally {
    state.busy = false;
    buttons();
  }
});

$("convert-all").addEventListener("click", convertAll);
$("clear").addEventListener("click", () => {
  if (state.busy) { return; }
  state.rows = [];
  rowEls.clear();
  listEl.replaceChildren();
  select(0);
  counts();
  say("List cleared.");
});

/* ============================================================
   8. INPUT
   ============================================================ */
const picker = $("files");
picker.addEventListener("change", () => {
  addFiles(picker.files || []);
  picker.value = "";      // so choosing the same file again still works
});

const drop = $("drop");
let depth = 0;
drop.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; drop.classList.add("is-over"); });
drop.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) { drop.classList.remove("is-over"); } });
window.addEventListener("dragover", (e) => { e.preventDefault(); });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  depth = 0;
  drop.classList.remove("is-over");
  const files = e.dataTransfer?.files;
  if (files && files.length) { addFiles(files); return; }
  const text = e.dataTransfer?.getData("text/plain");
  if (text) { pasteBox.value = text; pasteKind(); say("Text dropped in the paste box. Press Add to the list."); } else { say("That wasn't a file."); }
});

/* Paste files anywhere (Ctrl + V). Text goes to the paste box. */
window.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); return; }
  const inField = e.target && e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
  if (inField) { return; }
  const text = e.clipboardData?.getData("text/plain");
  if (text) { e.preventDefault(); pasteBox.value = text; pasteKind(); pasteBox.focus(); }
});

/* ---- the paste box ---- */
const pasteBox = $("paste-text");
let pasted = 0;
function pasteKind() {
  const t = pasteBox.value;
  const f = t.trim() ? detectText(t) : null;
  $("paste-kind").textContent = !t.trim() ? "Nothing pasted yet." : f ? `Looks like ${FORMATS[f].label}.` : "Can't tell what this is. Try CSV, JSON, XML or YAML.";
  return f;
}
pasteBox.addEventListener("input", pasteKind);
$("paste-add").addEventListener("click", () => {
  const text = pasteBox.value;
  if (!text.trim()) { $("paste-kind").textContent = "Paste some text first."; pasteBox.focus(); return; }
  const f = pasteKind();
  if (!f) { return; }
  pasted++;
  const file = new File([text], `pasted-${pasted}.${FORMATS[f].ext}`, { type: FORMATS[f].mime });
  pasteBox.value = "";
  $("paste-kind").textContent = `Added as ${file.name}.`;
  addFiles([file]);
});

/* ---- the sample: a CSV with tricky bits, a picture, some YAML ---- */
async function samplePicture() {
  const c = canvasOf(160, 120);
  const ctx = c.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim() || "#888";
  ctx.fillStyle = col("--accent");
  ctx.beginPath();
  ctx.arc(60, 60, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = col("--cyan");
  ctx.fillRect(84, 30, 60, 60);
  ctx.fillStyle = col("--bg");
  ctx.font = "700 22px sans-serif";
  ctx.fillText("Hi!", 96, 68);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}
$("sample").addEventListener("click", async () => {
  const csv = 'name,city,note\r\nAda,"London, UK","Said ""hello"""\r\nBo,Oslo,"Two\r\nlines"\r\nCy,Lima,\r\n';
  const yaml = "# A shopping list\nshop: Corner store\nopen: true\nitems:\n  - name: Apples\n    count: 6\n  - name: Bread\n    count: 1\n";
  const png = await samplePicture();
  const files = [
    new File([csv], "people.csv", { type: "text/csv" }),
    new File([yaml], "shopping.yaml", { type: "application/yaml" })
  ];
  if (png) { files.push(new File([png], "shapes.png", { type: "image/png" })); }
  await addFiles(files);
  select(state.rows[state.rows.length - files.length]?.id || 0);
});

/* ---- the settings form ---- */
const icoBoxes = [...document.querySelectorAll("#ico-sizes input")];
const delims = [...document.querySelectorAll('input[name="delim"]')];
const indents = [...document.querySelectorAll('input[name="indent"]')];

function fillForm() {
  const s = normalizeSettings(save.get());
  state.settings = s;
  $("quality").value = String(s.quality);
  $("quality-out").textContent = String(s.quality);
  $("bg").value = s.background;
  for (const b of icoBoxes) { b.checked = s.icoSizes.includes(Number(b.value)); }
  $("ico-source").checked = s.icoSource;
  for (const r of delims) { r.checked = r.value === s.delimiter; }
  for (const r of indents) { r.checked = Number(r.value) === s.jsonIndent; }
  $("rate").value = String(s.sampleRate);
  $("mono").checked = s.mono;
}

function readForm() {
  const d = delims.find((r) => r.checked);
  const ind = indents.find((r) => r.checked);
  save.set(normalizeSettings({
    ...save.get(),
    quality: Number($("quality").value),
    background: $("bg").value,
    icoSizes: icoBoxes.filter((b) => b.checked).map((b) => Number(b.value)),
    icoSource: $("ico-source").checked,
    delimiter: d ? d.value : DEFAULTS.delimiter,
    jsonIndent: ind ? Number(ind.value) : DEFAULTS.jsonIndent,
    sampleRate: Number($("rate").value),
    mono: $("mono").checked
  }));
}

/* New settings: finished files of the affected kind need doing again. */
function settingsChanged(kinds = ["image", "data", "audio", "video"]) {
  const before = state.settings;
  state.settings = normalizeSettings(save.get());
  const reparse = before.delimiter !== state.settings.delimiter;
  for (const row of state.rows) {
    if (!row.det || !kinds.includes(row.det.kind)) { continue; }
    if (row.det.kind === "data" && reparse && row.det.format === "csv") { parseRow(row); }
    if (row.status === "done") { row.status = "ready"; row.out = null; }
    if (row.status === "error" && row.det.kind === "data" && row.value !== undefined) { row.status = "ready"; row.error = ""; }
    renderRow(row);
  }
  preview();
}

$("quality").addEventListener("input", () => { $("quality-out").textContent = $("quality").value; });
$("quality").addEventListener("change", () => { readForm(); settingsChanged(["image"]); });
$("bg").addEventListener("change", () => { readForm(); settingsChanged(["image"]); });
for (const b of [...icoBoxes, $("ico-source")]) {
  b.addEventListener("change", () => {
    if (!icoBoxes.some((x) => x.checked) && !$("ico-source").checked) { b.checked = true; }   // at least one size
    readForm();
    settingsChanged(["image"]);
  });
}
for (const r of [...delims, ...indents]) { r.addEventListener("change", () => { readForm(); settingsChanged(["data"]); }); }
$("rate").addEventListener("change", () => { readForm(); settingsChanged(["audio", "video"]); });
$("mono").addEventListener("change", () => { readForm(); settingsChanged(["audio", "video"]); });

fillForm();
counts();
drop.dataset.ready = "true";
