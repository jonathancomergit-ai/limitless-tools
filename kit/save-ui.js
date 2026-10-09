/* ============================================================
   Limitless Lab - save panel (drop-in UI)

   Three buttons and a status line:

     [ Export save ]  downloads a .json file of the save
     [ Import save ]  opens a file picker, checks the file, loads it
     [ Delete my data ]  first tap arms it, second tap deletes

   Works with an item save (createSave) or the whole wing
   (createWingData) - they have the same methods.

     import { mountSavePanel } from "../../kit/save-ui.js";
     mountSavePanel(document.getElementById("save-panel"), save, {
       onImport: () => location.reload()    // simplest way to show loaded data
     });

   Everything happens in the browser. The file never goes
   anywhere: export builds it in memory, import reads it with
   FileReader. No network request is made.
   ============================================================ */

/* Hand the visitor a text file to keep. */
export function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  /* Give the browser a moment to start the download before freeing it. */
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function el(tag, props = {}, text = "") {
  const node = Object.assign(document.createElement(tag), props);
  if (text) { node.textContent = text; }
  return node;
}

export function mountSavePanel(container, store, {
  title = "Your save",
  intro = "Saved on this device only. Export it to keep a copy or move it to another browser.",
  headingLevel = 3,
  exportLabel = "Export save",
  importLabel = "Import save",
  onImport = null,
  onDelete = null
} = {}) {
  container.classList.add("save-panel");
  container.replaceChildren();

  const heading = el(`h${headingLevel}`, {}, title);
  const text = el("p", {}, store.persistent
    ? intro
    : "Saving is switched off in this browser (private mode?), so this only lasts until you close the tab. Export to keep it.");

  const actions = el("div", { className: "save-actions" });
  const exportBtn = el("button", { type: "button", className: "btn btn-sm" }, exportLabel);
  const importBtn = el("button", { type: "button", className: "btn btn-sm" }, importLabel);
  const deleteBtn = el("button", { type: "button", className: "btn btn-sm btn-danger" }, "Delete my data");
  const picker = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  picker.setAttribute("aria-hidden", "true");
  picker.tabIndex = -1;

  const status = el("p", { className: "save-status" });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  actions.append(exportBtn, importBtn, deleteBtn);
  container.append(heading, text, actions, picker, status);

  function say(message, ok = true) {
    status.textContent = message;
    status.classList.toggle("is-ok", ok);
    status.classList.toggle("is-bad", !ok);
  }

  /* ---- export ---- */
  exportBtn.addEventListener("click", () => {
    downloadText(store.filename(), store.exportText());
    say(`Downloaded ${store.filename()}`);
  });

  /* ---- import ---- */
  importBtn.addEventListener("click", () => picker.click());
  picker.addEventListener("change", async () => {
    const file = picker.files && picker.files[0];
    picker.value = "";           // so picking the same file again still fires
    if (!file) { return; }
    let textIn;
    try {
      textIn = await file.text();
    } catch {
      say("Couldn't read that file.", false);
      return;
    }
    const result = store.importText(textIn);
    if (!result.ok) { say(result.error, false); return; }
    say(result.message || "Save loaded.");
    if (onImport) { onImport(result); }
  });

  /* ---- delete: two taps, no pop-up dialog ---- */
  let armed = 0;
  function disarm() {
    clearTimeout(armed);
    armed = 0;
    deleteBtn.classList.remove("is-armed");
    deleteBtn.textContent = "Delete my data";
  }
  deleteBtn.addEventListener("click", () => {
    if (!armed) {
      deleteBtn.classList.add("is-armed");
      deleteBtn.textContent = "Tap again to delete";
      say("This can't be undone. Export first if you want a copy.", false);
      armed = setTimeout(() => { disarm(); say(""); }, 5000);
      return;
    }
    disarm();
    const result = store.clear();
    say(result.message || "Deleted.");
    if (onDelete) { onDelete(result); }
  });

  return { el: container, say };
}
