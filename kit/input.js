/* ============================================================
   Limitless Lab - input: pointer, keyboard, on-screen pad

   Three helpers, one idea: an item reads ACTIONS ("left",
   "action", "pause"), never raw keys or touches, so the same
   code works on a phone, a laptop and a keyboard-only setup.

   1. pointer(el, { down, move, up })
      Mouse, touch and pen through one set of callbacks. x and y
      are CSS pixels inside el - the same units kit/canvas.js
      draws in. The pointer is "captured", so a drag that leaves
      the canvas still ends properly.

   2. createKeys(map)
      Keyboard state by action name:
        keys.isDown("left")      held right now?
        keys.wasPressed("action") pressed since you last asked? (once)
        keys.on("pause", fn)     call fn on each press
      Only mapped keys are blocked from scrolling the page, and
      never while typing in a text box or holding Ctrl/Cmd/Alt.

   3. buttonBar(container, buttons, keys)
      The on-screen pad for phones. Each button just presses the
      same action a key would, so the game needs no extra code.
      Shown on touch screens only (or everywhere with always: true).
   ============================================================ */

/* ============================================================
   KEY MAP
   ============================================================ */

/* KeyboardEvent.code values, so WASD works on any layout. */
export const DEFAULT_KEYS = Object.freeze({
  left:   ["ArrowLeft", "KeyA"],
  right:  ["ArrowRight", "KeyD"],
  up:     ["ArrowUp", "KeyW"],
  down:   ["ArrowDown", "KeyS"],
  action: ["Space", "Enter"],
  pause:  ["KeyP", "Escape"]
});

/* Which action a key code belongs to, or null. Pure - unit tested. */
export function actionFor(code, map = DEFAULT_KEYS) {
  for (const [action, codes] of Object.entries(map)) {
    if (codes.includes(code)) { return action; }
  }
  return null;
}

/* True when the keyboard is busy typing into something. */
export function isTyping(target) {
  if (!target || !target.closest) { return false; }
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

/* Space and Enter "click" whatever has focus - leave those alone. */
const CLICK_KEYS = ["Space", "Enter", "NumpadEnter"];
export function isClickable(target) {
  if (!target || !target.closest) { return false; }
  return Boolean(target.closest("button, a[href], summary, [role='button']"));
}

/* ============================================================
   1. POINTER
   ============================================================ */
export function pointer(el, { down = null, move = null, up = null } = {}) {
  const active = new Map();   // pointerId -> latest point

  function point(e) {
    const r = el.getBoundingClientRect();
    return {
      id: e.pointerId,
      type: e.pointerType || "mouse",   // "mouse" | "touch" | "pen"
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      button: e.button,
      primary: e.isPrimary,
      time: e.timeStamp,
      event: e
    };
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) { return; }   // left click only
    const p = point(e);
    active.set(e.pointerId, p);
    try { el.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    if (down) { down(p); }
    e.preventDefault();
  }

  function onMove(e) {
    const p = point(e);
    if (active.has(e.pointerId)) { active.set(e.pointerId, p); }
    if (move) { move(p, active.has(e.pointerId)); }   // second arg: is it held down?
  }

  function onUp(e) {
    if (!active.has(e.pointerId)) { return; }
    const p = point(e);
    p.cancelled = e.type === "pointercancel";
    active.delete(e.pointerId);
    if (up) { up(p); }
  }

  /* A long press on a phone would otherwise pop up a menu. */
  function noMenu(e) { e.preventDefault(); }

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("contextmenu", noMenu);

  return {
    active,
    destroy() {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("contextmenu", noMenu);
    }
  };
}

/* ============================================================
   2. KEYBOARD
   ============================================================ */
export function createKeys(map = DEFAULT_KEYS, { target = window } = {}) {
  const held = new Set();       // actions held down right now
  const pressed = new Set();    // actions pressed since last wasPressed()
  const listeners = new Map();  // action -> Set of fns
  const sources = new Map();    // action -> how many things hold it (key + pad)
  const keyHeld = new Set();    // physical key codes held right now

  function press(action) {
    const n = sources.get(action) || 0;
    sources.set(action, n + 1);
    if (n === 0) {
      held.add(action);
      pressed.add(action);
      for (const fn of listeners.get(action) || []) { fn(action); }
    }
  }

  function release(action) {
    const n = (sources.get(action) || 0) - 1;
    if (n <= 0) {
      sources.delete(action);
      held.delete(action);
    } else {
      sources.set(action, n);
    }
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) { return; }
    /* Space/Enter on a focused button or link must still click it. */
    if (CLICK_KEYS.includes(e.code) && isClickable(e.target)) { return; }
    const action = actionFor(e.code, map);
    if (!action) { return; }
    e.preventDefault();               // stop arrows/space scrolling the page
    if (e.repeat || keyHeld.has(e.code)) { return; }
    keyHeld.add(e.code);
    press(action);
  }

  function onKeyUp(e) {
    if (!keyHeld.has(e.code)) { return; }
    keyHeld.delete(e.code);
    const action = actionFor(e.code, map);
    if (action) { release(action); }
  }

  /* Alt-tabbing away mid-press would leave a key stuck down. */
  function clear() {
    held.clear();
    pressed.clear();
    sources.clear();
    keyHeld.clear();
  }
  function onHidden() { if (document.hidden) { clear(); } }

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", onHidden);

  return {
    isDown: (action) => held.has(action),
    wasPressed(action) {
      const was = pressed.has(action);
      pressed.delete(action);
      return was;
    },
    on(action, fn) {
      if (!listeners.has(action)) { listeners.set(action, new Set()); }
      listeners.get(action).add(fn);
      return () => listeners.get(action).delete(fn);
    },
    press,
    release,
    /* A quick press-and-let-go, for keyboard clicks on pad buttons. */
    tap(action) { press(action); setTimeout(() => release(action), 90); },
    clear,
    destroy() {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onHidden);
    }
  };
}

/* ============================================================
   3. ON-SCREEN BUTTON PAD
   ============================================================ */

/* Does this device have a touch screen? */
export function hasTouch() {
  return (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
         (typeof matchMedia === "function" && matchMedia("(any-pointer: coarse)").matches);
}

/* buttons: [{ action: "left", label: "◀", name: "Move left", wide: false }] */
export function buttonBar(container, buttons, keys, { always = false, label = "Game controls" } = {}) {
  const bar = document.createElement("div");
  bar.className = "pad" + (always ? " is-always" : "") + (hasTouch() ? " is-touch" : "");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", label);

  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pad-btn" + (b.wide ? " is-wide" : "");
    btn.textContent = b.label;
    btn.setAttribute("aria-label", b.name || b.action);
    btn.dataset.action = b.action;

    let down = false;
    const start = (e) => {
      e.preventDefault();
      if (down) { return; }
      down = true;
      btn.classList.add("is-down");
      try { btn.setPointerCapture(e.pointerId); } catch { /* fine */ }
      keys.press(b.action);
    };
    const end = () => {
      if (!down) { return; }
      down = false;
      btn.classList.remove("is-down");
      keys.release(b.action);
    };

    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", end);
    btn.addEventListener("lostpointercapture", end);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
    /* Enter/Space on a focused pad button: detail is 0 for keyboard clicks. */
    btn.addEventListener("click", (e) => { if (e.detail === 0) { keys.tap(b.action); } });

    bar.append(btn);
  }

  /* A touch on a device we guessed wrong about: show the pad then. */
  const onFirstTouch = (e) => {
    if (e.pointerType !== "touch") { return; }
    bar.classList.add("is-touch");
    window.removeEventListener("pointerdown", onFirstTouch, true);
  };
  window.addEventListener("pointerdown", onFirstTouch, true);

  container.append(bar);
  return {
    el: bar,
    destroy() { bar.remove(); window.removeEventListener("pointerdown", onFirstTouch, true); }
  };
}
