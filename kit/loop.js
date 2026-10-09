/* ============================================================
   Limitless Lab - game / simulation loop

   One requestAnimationFrame loop with the boring parts done:

   - dt is in SECONDS and capped (maxStep), so coming back to a
     tab never makes everything teleport.
   - Pauses by itself when the tab is hidden, and picks up again
     when it comes back - but only if IT paused it. If the player
     pressed pause, it stays paused.
   - While paused there is no frame loop at all, so a background
     tab costs no battery.

   Use it like this:

     import { startLoop } from "../../kit/loop.js";
     const loop = startLoop({
       update(dt) { ...move things... },
       draw()     { ...paint the canvas... },
       onPauseChange(paused, reason) { ...show/hide "Paused"... }
     });
     loop.toggle();   // pause button
   ============================================================ */

export function startLoop({
  update = () => {},
  draw = () => {},
  onPauseChange = null,
  maxStep = 1 / 20,       // never step more than 50 ms at once
  startPaused = false
} = {}) {
  let frame = 0;
  let last = 0;
  let pausedBy = null;    // null = running, otherwise "user" or "hidden"

  function tick(now) {
    frame = requestAnimationFrame(tick);
    const dt = last ? Math.min((now - last) / 1000, maxStep) : 0;
    last = now;
    update(dt);
    draw();
  }

  function run() {
    if (frame) { return; }
    last = 0;
    frame = requestAnimationFrame(tick);
  }

  function halt() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function setPaused(reason) {
    const was = pausedBy;
    pausedBy = reason;
    if (reason) { halt(); } else { run(); }
    if (onPauseChange && Boolean(was) !== Boolean(reason)) {
      onPauseChange(Boolean(reason), reason || was);
    }
  }

  /* ---- pause when the tab is hidden ---- */
  function onVisibility() {
    if (document.hidden) {
      if (!pausedBy) { setPaused("hidden"); }
    } else if (pausedBy === "hidden") {
      setPaused(null);
    }
  }
  document.addEventListener("visibilitychange", onVisibility);

  const loop = {
    get paused() { return Boolean(pausedBy); },
    pause()  { if (!pausedBy) { setPaused("user"); } },
    resume() { if (pausedBy) { setPaused(null); } },
    toggle() { if (pausedBy) { loop.resume(); } else { loop.pause(); } },
    /* Advance exactly one frame while paused (handy for "step" buttons). */
    step(dt = 1 / 60) { update(dt); draw(); },
    stop() { halt(); document.removeEventListener("visibilitychange", onVisibility); }
  };

  /* Always paint one frame so a paused start isn't a blank stage. */
  draw();
  if (startPaused) { setPaused("user"); }
  else if (document.hidden) { pausedBy = "hidden"; }
  else { run(); }

  return loop;
}
