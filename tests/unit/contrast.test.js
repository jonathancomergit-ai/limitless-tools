/* ============================================================
   WCAG AA contrast for the kit's colour tokens

   Reads the real values from kit/kit.css, so if someone tweaks
   a colour and drops below AA, this fails.
     4.5 : 1  normal text
     3   : 1  large text and UI borders
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const css = fs.readFileSync(path.join(ROOT, "kit", "kit.css"), "utf8");
const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
const tokens = Object.fromEntries([...root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["bg", "bg-2", "surface", "surface-2"];

test("text colours pass 4.5:1 on every surface", () => {
  for (const fg of ["text", "text-dim", "text-faint", "hot", "cyan", "amber", "green"]) {
    for (const bg of SURFACES) {
      const r = ratio(tokens[fg], tokens[bg]);
      assert.ok(r >= 4.5, `--${fg} on --${bg} is ${r.toFixed(2)}:1`);
    }
  }
});

test("dark text on each accent button passes 4.5:1", () => {
  for (const accent of ["hot", "cyan", "amber"]) {
    const r = ratio(tokens.bg, tokens[accent]);
    assert.ok(r >= 4.5, `--bg on --${accent} is ${r.toFixed(2)}:1`);
  }
});

test("form borders pass 3:1", () => {
  assert.ok(ratio(tokens["line-field"], tokens.surface) >= 3);
});
