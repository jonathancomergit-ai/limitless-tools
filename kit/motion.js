/* ============================================================
   Limitless Lab - reduced motion

   Some people ask their phone or computer to "reduce motion"
   (it can make them feel sick or dizzy). CSS animations are
   switched off for them in kit.css. Canvas items have to check
   for themselves, with this:

     import { reducedMotion, onMotionChange } from "../../kit/motion.js";
     if (reducedMotion()) { ...no screen shake, no trails, start paused... }

   What "reduced" should mean, by wing:
     Arcade    no screen shake, flashes, trails or parallax
     Lab       simulations start paused, with a Play button
     Workshop  no decorative animation at all
   ============================================================ */

const QUERY = "(prefers-reduced-motion: reduce)";

function media() {
  return typeof matchMedia === "function" ? matchMedia(QUERY) : null;
}

/* true if the visitor asked for less motion. */
export function reducedMotion() {
  const m = media();
  return m ? m.matches : false;
}

/* Calls fn(isReduced) whenever the setting changes.
   Returns a function that stops listening. */
export function onMotionChange(fn) {
  const m = media();
  if (!m) { return () => {}; }
  const handler = (e) => fn(e.matches);
  m.addEventListener("change", handler);
  return () => m.removeEventListener("change", handler);
}
