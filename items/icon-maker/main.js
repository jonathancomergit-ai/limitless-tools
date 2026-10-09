/* ============================================================
   Icon Maker - main script

   One picture in -> every icon a site needs out:
   favicon.ico (16, 32, 48), Apple touch 180, Android 192 and
   512, a maskable 512, plus the <link> tags and a manifest.
   All in this tab: no upload, no server, no library.

   Sections:
     1. save      the settings (never the picture)
     2. state
     3. load      file -> a source canvas, with friendly errors
     4. render    settings -> every icon canvas
     5. tiles     the previews + one-file downloads
     6. export    .ico, .zip, copy the snippets
     7. input     settings form, drop, paste
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { makeZip } from "./zip.js";
import {
  OUTPUTS, ICO_SIZES, DEFAULTS, normalizeSettings, normalizeHex, placement, cornerRadius, isClear,
  makeIco, linkTags, manifest
} from "./icon.js";

bootItem();

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

/* ============================================================
   1. SAVE - settings only. Your picture is never stored.
   ============================================================ */
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { ...DEFAULTS },
  validate: (d) => {
    const n = normalizeSettings(d);
    return (n.fit === d.fit && n.padding === d.padding && n.bg === d.bg) || "That file doesn't hold Icon Maker settings.";
  }
});
mountSavePanel($("save-panel"), save, {
  title: "Your settings",
  intro: "Only your settings are saved, on this device. Your pictures are never stored.",
  exportLabel: "Export settings",
  importLabel: "Import settings",
  onImport: () => { fillForm(); renderAll(); },
  onDelete: () => { fillForm(); renderAll(); }
});

/* ============================================================
   2. STATE
   ============================================================ */
const state = exposeForTests({
  settings: normalizeSettings(save.get()),
  name: "",        // the picture's file name
  srcW: 0,
  srcH: 0,
  renders: 0,      // how many times every icon was drawn
  ready: false,    // icons are on screen
  zipped: null
});
let src = null;    // a canvas holding the picture (at most 2048 a side)

function say(text) { $("status").textContent = text; }

/* ============================================================
   3. LOAD
   ============================================================ */
const MAX_SRC = 2048;

async function decode(file) {
  /* SVGs go through <img>: createImageBitmap can't always size them. */
  if (typeof createImageBitmap === "function" && !/svg/.test(file.type)) {
    try { return await createImageBitmap(file); } catch { /* try <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadFile(file) {
  if (!file) { return; }
  if (!file.size) { say("That file is empty."); return; }
  if (file.type && !/^image\//.test(file.type)) { say("That isn't a picture. Try a PNG, SVG, JPG or WebP."); return; }
  if (file.size > 50 * 1024 * 1024) { say("That file is over 50 MB. Try a smaller picture."); return; }
  say("Opening…");

  let img;
  try { img = await decode(file); } catch {
    say("Couldn't open that one. It may be damaged, or a type browsers can't read (like HEIC).");
    return;
  }
  /* An SVG with no width/height has no size: draw it at 1024. */
  let w = img.width || img.naturalWidth || 1024;
  let h = img.height || img.naturalHeight || 1024;
  const k = Math.min(1, MAX_SRC / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  try { ctx.drawImage(img, 0, 0, w, h); } catch {
    say("Couldn't draw that picture. Try saving it as a PNG first.");
    return;
  }
  if (img.close) { img.close(); }

  src = c;
  Object.assign(state, { name: file.name || "picture", srcW: w, srcH: h });
  $("drop").classList.add("is-loaded");
  $("drop-title").textContent = "Picture loaded";
  $("drop-sub").textContent = `${state.name} · ${w} × ${h} px`;
  document.querySelector(".im-pick").textContent = "Choose another";
  $("icons").hidden = false;
  $("snips").hidden = false;
  say("");
  if (!tilesBuilt) { buildTiles(); }
  renderAll();
}

/* A made-up logo: a spanner-ish "W" badge, in the page's colours. */
async function sampleLogo() {
  await document.fonts.ready;
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color("--accent");
  ctx.beginPath();
  ctx.arc(512, 512, 470, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color("--bg");
  ctx.font = "700 620px 'Space Grotesk', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("W", 512, 560);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

$("sample").addEventListener("click", async () => {
  const blob = await sampleLogo();
  if (!blob) { say("Couldn't make the sample in this browser."); return; }
  loadFile(new File([blob], "sample-logo.png", { type: "image/png" }));
});

/* ============================================================
   4. RENDER
   Each icon is drawn big (1024) and then halved in
   steps: one big jump down makes jaggy edges on a 16 px icon.
   ============================================================ */
function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(ctx, size, r) {
  ctx.beginPath();
  if (r <= 0) { ctx.rect(0, 0, size, size); return; }
  ctx.moveTo(r, 0);
  ctx.arcTo(size, 0, size, size, r);
  ctx.arcTo(size, size, 0, size, r);
  ctx.arcTo(0, size, 0, 0, r);
  ctx.arcTo(0, 0, size, 0, r);
  ctx.closePath();
}

/* Draw one icon at `size` straight from the source picture. */
function drawIcon(ctx, size, kind) {
  const s = state.settings;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  roundRect(ctx, size, cornerRadius(size, s, kind));
  ctx.clip();
  if (!isClear(s, kind)) {
    ctx.fillStyle = s.bg;
    ctx.fillRect(0, 0, size, size);
  }
  const p = placement(state.srcW, state.srcH, size, s, kind);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
  ctx.restore();
}

/* Into `target` (a canvas size x size): big first, then halve. */
function renderInto(target, kind) {
  const size = target.width;
  const big = 1024;
  let cur = canvasOf(big, big);
  drawIcon(cur.getContext("2d"), big, kind);
  while (cur.width / 2 >= size * 1.5) {
    const half = canvasOf(Math.round(cur.width / 2), Math.round(cur.width / 2));
    const hctx = half.getContext("2d");
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const ctx = target.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, 0, 0, size, size);
}

let renderTimer = 0;
function renderAll(now = true) {
  state.settings = normalizeSettings(save.get());
  formUi();
  snippets();
  if (!src) { return; }
  clearTimeout(renderTimer);
  const run = () => {
    renderInto($("big"), "plain");
    for (const c of document.querySelectorAll("#tiles canvas[data-kind]")) { renderInto(c, c.dataset.kind); }
    state.renders += 1;
    state.ready = true;
    $("icons").dataset.ready = "true";
    warnings();
  };
  if (now) { run(); } else { renderTimer = setTimeout(run, 60); }
}

function warnings() {
  const s = state.settings;
  const notes = [];
  if (Math.max(state.srcW, state.srcH) < 512) { notes.push(`Your picture is ${Math.max(state.srcW, state.srcH)} px: the 512 icons may look soft.`); }
  if (s.fit === "contain" && state.srcW !== state.srcH && s.transparent) { notes.push("Not square, so the see-through sides will show. Try Fill square."); }
  $("warn").textContent = notes.join(" ");
  $("count").textContent = `${OUTPUTS.length + 2} files`;
}

/* ============================================================
   5. TILES
   ============================================================ */
let tilesBuilt = false;
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text != null) { n.textContent = text; }
  return n;
}

function buildTiles() {
  tilesBuilt = true;
  const list = $("tiles");
  for (const out of OUTPUTS) {
    const li = el("li", `im-tile is-${out.kind}${out.sizes ? " is-ico" : ""}`);
    const frame = el("div", "im-frame");
    if (out.sizes) {
      /* favicon: all three at real size, in a little browser tab */
      frame.classList.add("im-tab");
      for (const size of out.sizes) {
        const c = canvasOf(size, size);
        c.dataset.kind = out.kind;
        c.dataset.size = String(size);
        c.className = `im-fav im-fav-${size}`;
        c.setAttribute("role", "img");
        c.setAttribute("aria-label", `Favicon at ${size} pixels`);
        frame.append(c);
      }
    } else {
      const c = canvasOf(out.size, out.size);
      c.dataset.kind = out.kind;
      c.setAttribute("role", "img");
      c.setAttribute("aria-label", `${out.label} icon, ${out.note}`);
      frame.append(c);
      if (out.kind === "maskable") { frame.append(el("span", "im-safe")); }
    }
    const text = el("div", "im-tile-text");
    text.append(el("strong", "", out.label), el("span", "", out.note));
    const dl = el("button", "btn btn-sm im-dl", "↓");
    dl.type = "button";
    dl.setAttribute("aria-label", `Download ${out.file}`);
    dl.title = `Download ${out.file}`;
    dl.addEventListener("click", () => downloadOne(out));
    li.append(frame, text, dl);
    list.append(li);
  }
}

/* ============================================================
   6. EXPORT - blob URLs, freed straight after
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

function pngOf(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This browser couldn't make a PNG."))), "image/png");
  });
}
async function bytesOf(canvas) { return new Uint8Array(await (await pngOf(canvas)).arrayBuffer()); }

/* Fresh canvases for files, so a download never depends on what
   is on screen at that moment. */
function fresh(size, kind) {
  const c = canvasOf(size, size);
  renderInto(c, kind);
  return c;
}

async function icoBytes() {
  const images = [];
  for (const size of ICO_SIZES) { images.push({ size, data: await bytesOf(fresh(size, "plain")) }); }
  return makeIco(images);
}

async function fileBytes(out) {
  return out.sizes ? icoBytes() : bytesOf(fresh(out.size, out.kind));
}

async function downloadOne(out) {
  if (!src) { return; }
  try {
    const data = await fileBytes(out);
    downloadBlob(new Blob([data], { type: out.sizes ? "image/x-icon" : "image/png" }), out.file);
    say(`Downloaded ${out.file}.`);
  } catch (err) {
    say(err.message || "Couldn't make that file.");
  }
}

$("zip").addEventListener("click", async () => {
  if (!src) { return; }
  const btn = $("zip");
  btn.disabled = true;
  say("Making the zip…");
  try {
    const enc = new TextEncoder();
    const entries = [];
    for (const out of OUTPUTS) { entries.push({ name: out.file, data: await fileBytes(out) }); }
    entries.push({ name: "site.webmanifest", data: enc.encode(manifest(state.settings) + "\n") });
    entries.push({ name: "head-tags.html", data: enc.encode(linkTags() + "\n") });
    const zip = makeZip(entries);
    downloadBlob(new Blob([zip], { type: "application/zip" }), "icons.zip");
    state.zipped = { files: entries.map((e) => e.name), bytes: zip.length };
    say(`Zip ready: ${entries.length} files.`);
  } catch (err) {
    say(err.message || "Couldn't make the zip. Try downloading the icons one by one.");
  } finally {
    btn.disabled = false;
  }
});

function snippets() {
  $("tags").textContent = linkTags();
  $("man").textContent = manifest(state.settings);
}

async function copy(id, what) {
  const text = $(id).textContent;
  try {
    await navigator.clipboard.writeText(text);
    $("copied").textContent = `Copied ${what}.`;
  } catch {
    /* No clipboard (old browser, or not allowed): select it instead. */
    const range = document.createRange();
    range.selectNodeContents($(id));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    $("copied").textContent = "Selected. Press Ctrl + C (or long-press, Copy).";
  }
}
$("copy-tags").addEventListener("click", () => copy("tags", "the tags"));
$("copy-man").addEventListener("click", () => copy("man", "the manifest"));

/* ============================================================
   7. INPUT
   ============================================================ */
const picker = $("file");
picker.addEventListener("change", () => {
  loadFile(picker.files && picker.files[0]);
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
  const file = e.dataTransfer?.files?.[0];
  if (file) { loadFile(file); } else { say("That wasn't a file. Drop a picture from your computer."); }
});
window.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => /^image\//.test(f.type));
  if (file) { e.preventDefault(); loadFile(file); }
});

/* ---- the settings form ---- */
const fits = [...document.querySelectorAll('input[name="fit"]')];

function fillForm() {
  const s = normalizeSettings(save.get());
  for (const r of fits) { r.checked = r.value === s.fit; }
  $("padding").value = String(s.padding);
  $("radius").value = String(s.radius);
  $("bg").value = s.bg;
  $("bg-hex").value = s.bg;
  $("transparent").checked = s.transparent;
  $("name").value = s.name;
  $("short").value = s.shortName;
  state.settings = s;
  formUi();
}

function formUi() {
  const s = state.settings;
  $("padding-out").textContent = `${s.padding}%`;
  $("radius-out").textContent = s.radius >= 50 ? "Circle" : s.radius ? `${s.radius}%` : "Square";
  $("clear-hint").hidden = !s.transparent;
}

function set(patch, now = false) {
  save.set(normalizeSettings({ ...save.get(), ...patch }));
  renderAll(now);
}

for (const r of fits) { r.addEventListener("change", () => set({ fit: r.value }, true)); }
$("padding").addEventListener("input", () => set({ padding: Number($("padding").value) }));
$("radius").addEventListener("input", () => set({ radius: Number($("radius").value) }));
$("bg").addEventListener("input", () => { $("bg-hex").value = $("bg").value; set({ bg: $("bg").value }); });
$("bg-hex").addEventListener("input", () => {
  const hex = normalizeHex($("bg-hex").value);
  $("bg-hex").classList.toggle("is-bad", !hex);
  if (hex) { $("bg").value = hex; set({ bg: hex }); }
});
$("bg-hex").addEventListener("change", () => { $("bg-hex").value = state.settings.bg; $("bg-hex").classList.remove("is-bad"); });
$("transparent").addEventListener("change", () => set({ transparent: $("transparent").checked }, true));
$("name").addEventListener("input", () => set({ name: $("name").value }));
$("short").addEventListener("input", () => set({ shortName: $("short").value }));
$("name").addEventListener("change", () => { $("name").value = state.settings.name; });
$("short").addEventListener("change", () => { $("short").value = state.settings.shortName; });

fillForm();
snippets();
drop.dataset.ready = "true";
