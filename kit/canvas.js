/* ============================================================
   Limitless Lab - full-size canvas

   Makes a canvas fill its box (usually .stage) and stay sharp:

   - The CSS size comes from the page layout (kit.css .stage).
   - The real pixel size is CSS size x devicePixelRatio, so lines
     are crisp on phones and retina screens. Capped at maxDpr
     (default 2) - a 3x phone would otherwise push 9x the pixels
     for a difference nobody can see.
   - For 2D, the context is pre-scaled, so you always draw in CSS
     pixels: (0,0) top-left, (view.width, view.height) bottom-right.
   - Re-measures when the box changes size (rotate, resize, the
     address bar sliding away) and when the window moves to a
     screen with a different pixel ratio.

   Use it like this:

     import { createCanvas } from "../../kit/canvas.js";
     const view = createCanvas(document.getElementById("stage"), {
       onResize: () => draw()          // redraw after a size change
     });
     view.ctx.fillRect(0, 0, view.width, view.height);

   onResize(view) runs after every size change, starting just
   after createCanvas returns - never during it.

   Pass { context: "webgl2" } (or "webgl", or null for none) to
   get a different context. WebGL is NOT pre-scaled: call
   gl.viewport(0, 0, view.canvas.width, view.canvas.height).
   ============================================================ */

/* ---- pure maths (unit tested) --------------------------- */

/* The backing-store size for a CSS box. Always at least 1x1,
   because a 0x0 canvas throws on some browsers. */
export function backingSize(cssWidth, cssHeight, devicePixelRatio = 1, maxDpr = 2) {
  const scale = Math.max(1, Math.min(devicePixelRatio || 1, maxDpr));
  return {
    scale,
    width:  Math.max(1, Math.round(cssWidth * scale)),
    height: Math.max(1, Math.round(cssHeight * scale))
  };
}

/* ---- the helper ----------------------------------------- */

export function createCanvas(target, options = {}) {
  const {
    context = "2d",
    contextOptions = {},
    maxDpr = 2,
    onResize = null
  } = options;

  /* Accept either the canvas itself or the box to put one in. */
  let canvas = target instanceof HTMLCanvasElement ? target : target.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    target.prepend(canvas);
  }
  const box = target instanceof HTMLCanvasElement ? (canvas.parentElement || canvas) : target;

  const ctx = context ? canvas.getContext(context, contextOptions) : null;

  const view = {
    canvas,
    ctx,
    width: 1,      // CSS pixels - draw in these
    height: 1,
    dpr: 1,        // the scale actually used (after the maxDpr cap)
    resize,
    destroy
  };

  function resize(notify = true) {
    const rect = box.getBoundingClientRect();
    const size = backingSize(rect.width, rect.height, window.devicePixelRatio, maxDpr);
    const changed = canvas.width !== size.width || canvas.height !== size.height;

    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = size.scale;

    if (changed) {
      canvas.width = size.width;     // this also wipes the canvas
      canvas.height = size.height;
    }
    /* Setting width resets the 2D transform, so always re-apply. */
    if (ctx && context === "2d") {
      ctx.setTransform(size.scale, 0, 0, size.scale, 0, 0);
    }
    if (notify && onResize) { onResize(view); }
    return view;
  }

  /* ---- watch the box ---- */
  let observer = null;
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(() => resize());   // also fires once right away
    observer.observe(box);
  } else {
    window.addEventListener("resize", resize);
  }

  /* ---- watch the pixel ratio (dragging to another monitor) ---- */
  let dprQuery = null;
  function watchDpr() {
    if (dprQuery) { dprQuery.removeEventListener("change", onDprChange); }
    dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener("change", onDprChange);
  }
  function onDprChange() { resize(); watchDpr(); }
  watchDpr();

  function destroy() {
    if (observer) { observer.disconnect(); } else { window.removeEventListener("resize", resize); }
    if (dprQuery) { dprQuery.removeEventListener("change", onDprChange); }
  }

  /* Measure now, quietly: onResize only ever runs AFTER this
     function has returned, so the caller's `view` already exists. */
  resize(false);
  if (!observer) { setTimeout(resize, 0); }
  return view;
}
