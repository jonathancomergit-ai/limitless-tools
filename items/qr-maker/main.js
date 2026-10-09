/* ============================================================
   QR Maker - main script

   Type a link, some text or Wi-Fi details -> a QR code, live.
   The encoder (qr.js) is written here in plain JS, so nothing
   you type ever leaves the tab, and the code holds exactly
   what you typed: no short link, no redirect, no tracking.

   Sections:
     1. save      settings + recent codes (never Wi-Fi passwords)
     2. state
     3. make      form -> payload -> modules -> canvas
     4. export    PNG, SVG, copy image
     5. recent    the list of recent codes
     6. input     the forms
   ============================================================ */

import { bootItem, exposeForTests, itemSlug } from "../../kit/item.js";
import { createSave } from "../../kit/save.js";
import { mountSavePanel } from "../../kit/save-ui.js";
import { encode } from "./qr.js";
import {
  DEFAULTS, normalizeSettings, normalizeHex, payload, linkFix, linkProblem, scanCheck,
  toSvg, pngScale, addRecent, recentLabel, fileStem
} from "./codes.js";

bootItem();

const $ = (id) => document.getElementById(id);
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

/* ============================================================
   1. SAVE
   ============================================================ */
const save = createSave({
  slug: itemSlug(),
  version: 1,
  defaults: { ...DEFAULTS, recent: [] },
  validate: (d) => {
    const n = normalizeSettings(d);
    return (n.ecl === d.ecl && n.fg === d.fg && Array.isArray(d.recent)) || "That file doesn't hold QR Maker settings.";
  }
});
mountSavePanel($("save-panel"), save, {
  title: "Your settings",
  intro: "Your look settings and recent codes are saved on this device only. Wi-Fi passwords never are.",
  exportLabel: "Export settings",
  importLabel: "Import settings",
  onImport: () => { fillForm(); make(); renderRecent(); },
  onDelete: () => { fillForm(); make(); renderRecent(); }
});

/* ============================================================
   2. STATE
   ============================================================ */
const state = exposeForTests({
  settings: normalizeSettings(save.get()),
  form: { type: "link", link: "", text: "", ssid: "", password: "", security: "WPA", hidden: false },
  payload: "",
  qr: null,          // the last encode() result
  error: "",
  draws: 0,
  downloads: []      // file names, for the smoke test
});

function say(text) { $("status").textContent = text; }

/* ============================================================
   3. MAKE
   ============================================================ */
const canvas = $("qr");
const ctx = canvas.getContext("2d");

function make() {
  const s = state.settings;
  const f = state.form;
  state.payload = payload(f);
  state.error = "";
  state.qr = null;

  /* friendly warnings about the input */
  let warn = "";
  if (f.type === "link") { warn = linkProblem(state.payload); }
  if (f.type === "wifi" && !f.ssid && (f.password || f.hidden)) { warn = "Add the network name."; }
  if (f.type === "wifi" && f.ssid && f.security !== "nopass" && !f.password) { warn = "No password yet. Pick “None (open)” if the network has none."; }

  if (state.payload) {
    try {
      state.qr = encode(state.payload, { ecl: s.ecl, mask: s.mask });
    } catch (err) {
      state.error = err.code === "too-long" ? `${err.message} Try a lower error correction, or less text.` : (err.message || "Couldn't make that code.");
    }
  }
  $("input-warn").textContent = state.error || warn;
  $("input-warn").classList.toggle("is-bad", Boolean(state.error));

  $("payload").textContent = state.payload || "(nothing yet)";
  $("payload").classList.toggle("is-empty", !state.payload);
  const q = state.qr;
  $("info").textContent = q
    ? `Version ${q.version} · ${q.size}×${q.size} · level ${q.ecl} · mask ${q.mask} · ${q.bytes} ${q.bytes === 1 ? "byte" : "bytes"}`
    : "";
  for (const id of ["dl-png", "dl-svg", "copy"]) { $(id).disabled = !q; }
  const { px } = q ? pngScale(q.size, s.border, s.size) : { px: s.size };
  $("size-out").textContent = q && px !== s.size ? `${px} px` : `${s.size} px`;
  draw();
}

/* The preview: whole pixels per square, so it's always crisp. */
function draw() {
  const box = canvas.parentElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const want = Math.max(160, Math.round(box.clientWidth * dpr));
  const q = state.qr;
  const s = state.settings;

  if (!q) {
    canvas.width = canvas.height = want;
    ctx.fillStyle = color("--bg-2");
    ctx.fillRect(0, 0, want, want);
    ctx.strokeStyle = color("--line-bright");
    ctx.lineWidth = 2 * dpr;
    ctx.setLineDash([8 * dpr, 6 * dpr]);
    const m = want * 0.12;
    ctx.strokeRect(m, m, want - 2 * m, want - 2 * m);
    ctx.setLineDash([]);
    ctx.fillStyle = color("--text-faint");
    ctx.font = `600 ${Math.round(15 * dpr)}px 'Inter', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.error ? "Too long for one code" : "Type something above", want / 2, want / 2);
    canvas.classList.add("is-empty");
    state.draws += 1;
    return;
  }

  const { scale, px } = pngScale(q.size, s.border, want);
  canvas.width = canvas.height = px;
  paint(ctx, q.modules, s.border, scale);
  canvas.classList.remove("is-empty");
  canvas.setAttribute("aria-label", `QR code holding: ${state.payload.slice(0, 200)}`);
  state.draws += 1;
}

function paint(g, modules, border, scale) {
  const s = state.settings;
  const total = (modules.length + border * 2) * scale;
  g.fillStyle = s.bg;
  g.fillRect(0, 0, total, total);
  g.fillStyle = s.fg;
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) { continue; }
      let run = 1;
      while (x + run < row.length && row[x + run]) { run++; }
      g.fillRect((x + border) * scale, (y + border) * scale, run * scale, scale);
      x += run - 1;
    }
  });
}

/* ============================================================
   4. EXPORT - blob URLs, freed straight after
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
  state.downloads.push(name);
}

function pngBlob() {
  const q = state.qr;
  const s = state.settings;
  const { scale, px } = pngScale(q.size, s.border, s.size);
  const c = document.createElement("canvas");
  c.width = c.height = px;
  paint(c.getContext("2d"), q.modules, s.border, scale);
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("This browser couldn't make a PNG."))), "image/png");
  });
}

$("dl-png").addEventListener("click", async () => {
  if (!state.qr) { return; }
  try {
    const name = `${fileStem(state.form)}.png`;
    downloadBlob(await pngBlob(), name);
    say(`Downloaded ${name}.`);
    remember();
  } catch (err) { say(err.message); }
});

$("dl-svg").addEventListener("click", () => {
  if (!state.qr) { return; }
  const s = state.settings;
  const svg = toSvg(state.qr.modules, { border: s.border, fg: s.fg, bg: s.bg, px: s.size });
  const name = `${fileStem(state.form)}.svg`;
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), name);
  say(`Downloaded ${name}.`);
  remember();
});

/* Copy the picture: only where the browser can (most modern ones). */
const canCopy = typeof ClipboardItem === "function" && Boolean(navigator.clipboard?.write) && window.isSecureContext;
$("copy").hidden = !canCopy;
$("copy").addEventListener("click", async () => {
  if (!state.qr) { return; }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob() })]);
    say("Copied. Paste it into a doc, a chat or a design app.");
    remember();
  } catch {
    say("This browser wouldn't copy the picture. Download it instead.");
  }
});

/* ============================================================
   5. RECENT
   ============================================================ */
function remember() {
  if (!state.settings.keepRecent || !state.payload) { return; }
  const f = state.form;
  /* Never the Wi-Fi password: addRecent drops it, this is belt and braces. */
  const item = { type: f.type, link: f.link, text: f.text, ssid: f.ssid, security: f.security, hidden: f.hidden };
  save.set({ recent: addRecent(save.get().recent, item) });
  state.settings = normalizeSettings(save.get());
  renderRecent();
}

const recentEl = $("recent");
function renderRecent() {
  const list = state.settings.recent;
  const items = list.map((r, i) => {
    const li = document.createElement("li");
    const use = document.createElement("button");
    use.type = "button";
    use.className = "qm-recent-use";
    const tag = document.createElement("span");
    tag.className = `qm-tag is-${r.type}`;
    tag.textContent = r.type === "wifi" ? "Wi-Fi" : r.type === "link" ? "Link" : "Text";
    const label = document.createElement("span");
    label.className = "qm-recent-label";
    label.textContent = recentLabel(r);
    use.append(tag, label);
    use.addEventListener("click", () => useRecent(r));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-sm btn-ghost qm-recent-del";
    del.textContent = "✕";
    del.setAttribute("aria-label", `Remove ${recentLabel(r)}`);
    del.addEventListener("click", () => {
      const next = state.settings.recent.filter((_, j) => j !== i);
      save.set({ recent: next });
      state.settings = normalizeSettings(save.get());
      renderRecent();
      (recentEl.querySelector("button") || $("keep-recent")).focus();
    });
    li.append(use, del);
    return li;
  });
  recentEl.replaceChildren(...items);
  $("recent-empty").hidden = list.length > 0;
  $("recent-empty").textContent = state.settings.keepRecent
    ? "Codes you download or copy show up here."
    : "Off: nothing is kept.";
  $("clear-recent").disabled = !list.length;
}

function useRecent(r) {
  Object.assign(state.form, {
    type: r.type,
    link: r.link ?? state.form.link,
    text: r.text ?? state.form.text,
    ssid: r.ssid ?? state.form.ssid,
    security: r.security ?? state.form.security,
    hidden: r.hidden ?? state.form.hidden,
    password: r.type === "wifi" ? "" : state.form.password
  });
  fillInputs();
  make();
  say(r.type === "wifi" ? "Loaded. Type the Wi-Fi password again: it's never saved." : "Loaded.");
  ($(r.type === "wifi" ? "pass" : r.type) || $("out")).focus();
}

$("clear-recent").addEventListener("click", () => {
  save.set({ recent: [] });
  state.settings = normalizeSettings(save.get());
  renderRecent();
  say("Recent codes cleared.");
});
$("keep-recent").addEventListener("change", () => {
  const on = $("keep-recent").checked;
  save.set(on ? { keepRecent: true } : { keepRecent: false, recent: [] });
  state.settings = normalizeSettings(save.get());
  renderRecent();
  say(on ? "Recent codes will be kept on this device." : "Recent codes are off, and the list is cleared.");
});

/* ============================================================
   6. INPUT
   ============================================================ */
const types = [...document.querySelectorAll('input[name="type"]')];
const ecls = [...document.querySelectorAll('input[name="ecl"]')];

function panes() {
  for (const t of ["link", "text", "wifi"]) { $(`pane-${t}`).hidden = state.form.type !== t; }
  for (const r of types) { r.checked = r.value === state.form.type; }
}

function fillInputs() {
  const f = state.form;
  $("link").value = f.link;
  $("text").value = f.text;
  $("ssid").value = f.ssid;
  $("pass").value = f.password;
  $("security").value = f.security;
  $("hidden-net").checked = f.hidden;
  $("pass").disabled = f.security === "nopass";
  panes();
}

function fillForm() {
  const s = normalizeSettings(save.get());
  state.settings = s;
  state.form.type = s.type;
  for (const r of ecls) { r.checked = r.value === s.ecl; }
  $("mask").value = String(s.mask);
  $("fg").value = s.fg;
  $("fg-hex").value = s.fg;
  $("bg").value = s.bg;
  $("bg-hex").value = s.bg;
  $("border").value = String(s.border);
  $("size").value = String(s.size);
  $("keep-recent").checked = s.keepRecent;
  looks();
  fillInputs();
}

function looks() {
  const s = state.settings;
  $("border-out").textContent = `${s.border} ${s.border === 1 ? "square" : "squares"}`;
  const check = scanCheck(s.fg, s.bg);
  const scan = $("scan");
  scan.textContent = check.text + (s.border < 2 ? " A quiet zone under 2 squares can stop it scanning." : "");
  scan.className = `qm-scan is-${s.border < 2 && check.level === "ok" ? "warn" : check.level}`;
}

function set(patch) {
  save.set(patch);
  state.settings = normalizeSettings(save.get());
  looks();
  make();
}

for (const r of types) {
  r.addEventListener("change", () => {
    state.form.type = r.value;
    save.set({ type: r.value });
    state.settings = normalizeSettings(save.get());
    panes();
    make();
  });
}
$("link").addEventListener("input", () => { state.form.link = $("link").value; make(); });
$("link").addEventListener("change", () => {
  /* Show the fixed-up address once they're done typing. */
  const fixed = linkFix($("link").value);
  if (fixed && fixed !== $("link").value.trim()) { $("link").value = fixed; state.form.link = fixed; make(); }
});
$("text").addEventListener("input", () => { state.form.text = $("text").value; make(); });
$("ssid").addEventListener("input", () => { state.form.ssid = $("ssid").value; make(); });
$("pass").addEventListener("input", () => { state.form.password = $("pass").value; make(); });
$("security").addEventListener("change", () => {
  state.form.security = $("security").value;
  $("pass").disabled = state.form.security === "nopass";
  make();
});
$("hidden-net").addEventListener("change", () => { state.form.hidden = $("hidden-net").checked; make(); });
$("show-pass").addEventListener("click", () => {
  const show = $("pass").type === "password";
  $("pass").type = show ? "text" : "password";
  $("show-pass").textContent = show ? "Hide" : "Show";
  $("show-pass").setAttribute("aria-pressed", String(show));
});

for (const r of ecls) { r.addEventListener("change", () => set({ ecl: r.value })); }
$("mask").addEventListener("change", () => set({ mask: Number($("mask").value) }));
$("border").addEventListener("input", () => set({ border: Number($("border").value) }));
$("size").addEventListener("input", () => set({ size: Number($("size").value) }));

function colour(which) {
  const picker = $(which);
  const hex = $(`${which}-hex`);
  picker.addEventListener("input", () => { hex.value = picker.value; hex.classList.remove("is-bad"); set({ [which]: picker.value }); });
  hex.addEventListener("input", () => {
    const v = normalizeHex(hex.value);
    hex.classList.toggle("is-bad", !v);
    if (v) { picker.value = v; set({ [which]: v }); }
  });
  hex.addEventListener("change", () => { hex.value = state.settings[which]; hex.classList.remove("is-bad"); });
}
colour("fg");
colour("bg");
$("reset-colours").addEventListener("click", () => {
  set({ fg: "#000000", bg: "#ffffff" });
  for (const w of ["fg", "bg"]) { $(w).value = state.settings[w]; $(`${w}-hex`).value = state.settings[w]; }
});

let resizeTimer = 0;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 100); });

fillForm();
renderRecent();
make();
$("out").dataset.ready = "true";
