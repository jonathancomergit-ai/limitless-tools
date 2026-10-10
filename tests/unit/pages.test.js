/* ============================================================
   Privacy + page rules, checked by reading the files

   A fast first line of defence; the Playwright suite then
   proves the same things in a real browser. For every page:

   - the exact Content-Security-Policy <meta>, before anything loads
   - no inline <script>, <style>, style="" or onclick=""
   - nothing loaded from another origin (links to click are fine)
   - kit/stats.js included once, deferred
   - hub footers carry the privacy note

   And for every .js / .css file:
   - no outside URLs except GoatCounter (and plain links in site.config.js)
   - no cookies, no eval, no beacons/sockets
   - items only store data through kit/save.js
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKIP = new Set(["node_modules", ".git", "test-results", "playwright-report", "tests", ".github", ".claude", "docs"]);

export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://gc.zgo.at",
  "connect-src 'self' https://jonjoe1001.goatcounter.com",
  "img-src 'self' data: blob: https://jonjoe1001.goatcounter.com",
  "style-src 'self'",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

const PRIVACY_NOTE = "No accounts, no cookies.</strong> Saves stay on your device. Cookie-free visit counts via GoatCounter.";

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(d.name)) { continue; }
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { walk(p, out); } else { out.push(p); }
  }
  return out;
}

const files = walk(ROOT);
const rel = (p) => path.relative(ROOT, p);
const html = files.filter((f) => f.endsWith(".html"));
const code = files.filter((f) => /\.(js|css)$/.test(f));
const squash = (s) => s.replace(/\s+/g, " ");

test("there are pages to check", () => {
  assert.ok(html.some((f) => rel(f) === "index.html"));
  assert.ok(html.some((f) => rel(f) === path.join("items", "_template", "index.html")));
});

for (const file of html) {
  const name = rel(file);
  /* HTML comments can mention <style> etc. without breaking a rule. */
  const src = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");

  test(`${name}: exact CSP meta, first thing in <head>`, () => {
    const m = src.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*>/i);
    assert.ok(m, "no CSP <meta>");
    assert.equal(m[1], CSP);
    const firstLoad = src.search(/<(link|script)\b/i);
    assert.ok(m.index < firstLoad, "CSP must come before any <link> or <script>");
  });

  test(`${name}: no inline scripts, styles or handlers`, () => {
    for (const tag of src.match(/<script\b[^>]*>/gi) || []) {
      assert.match(tag, /\bsrc="/, `inline script: ${tag}`);
    }
    assert.doesNotMatch(src, /<style\b/i, "<style> block (put it in a .css file)");
    assert.doesNotMatch(src, /\sstyle\s*=/i, "style=\"\" attribute (use a class)");
    assert.doesNotMatch(src, /\son[a-z]+\s*=/i, "onclick-style handler (use addEventListener)");
    assert.doesNotMatch(src, /javascript:/i, "javascript: URL");
    assert.doesNotMatch(src, /<(iframe|object|embed)\b/i, "embedded third-party frame");
  });

  test(`${name}: loads nothing from another origin`, () => {
    /* src= on anything, and href= on <link>, are things the browser
       fetches. <a href> is just a link to click, so it's allowed. */
    const loads = [
      ...[...src.matchAll(/\ssrc="([^"]*)"/gi)].map((m) => m[1]),
      ...[...src.matchAll(/<link\b[^>]*\shref="([^"]*)"/gi)].map((m) => m[1]),
      ...[...src.matchAll(/\saction="([^"]*)"/gi)].map((m) => m[1])
    ];
    for (const url of loads) {
      assert.doesNotMatch(url, /^(https?:)?\/\//i, `outside load: ${url}`);
    }
  });

  test(`${name}: includes kit/stats.js once, deferred`, () => {
    const tags = src.match(/<script\b[^>]*kit\/stats\.js[^>]*>/gi) || [];
    assert.equal(tags.length, 1);
    assert.match(tags[0], /\bdefer\b/);
  });

  test(`${name}: has the privacy note in the footer`, () => {
    const footer = src.match(/<footer[\s\S]*<\/footer>/i);
    assert.ok(footer, "no <footer>");
    assert.ok(squash(footer[0]).includes(PRIVACY_NOTE), "privacy note missing or reworded");
  });

  test(`${name}: has lang, viewport and a title`, () => {
    assert.match(src, /<html lang="[a-z-]+"/i);
    assert.match(src, /<meta name="viewport" content="width=device-width, initial-scale=1/);
    assert.doesNotMatch(src, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\D|$)/i, "never block pinch-zoom");
    assert.match(src, /<title>[^<]+<\/title>/);
  });
}

/* ---- JS and CSS ------------------------------------------- */

const ALLOWED_HOSTS = new Set(["gc.zgo.at", "jonjoe1001.goatcounter.com"]);

for (const file of code) {
  const name = rel(file);
  /* Strip comments so a URL in an explanation doesn't count. */
  const src = fs.readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  test(`${name}: no outside URLs`, () => {
    for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (ALLOWED_HOSTS.has(host)) { continue; }
      /* site.config.js holds plain links (home page, other wings) that
         become <a href>s - clicked, never fetched. */
      if (name === "site.config.js") { continue; }
      /* The sitemap's XML namespace is a name, never fetched. */
      if (name === path.join("scripts", "build-sitemap.js") && host === "www.sitemaps.org") { continue; }
      if (/smoke\.js$/.test(name) || /^playwright\.config\.js$/.test(name)) { continue; }
      assert.fail(`outside URL in ${name}: ${m[0]}`);
    }
  });

  if (file.endsWith(".css")) {
    test(`${name}: CSS loads only local files`, () => {
      assert.doesNotMatch(src, /@import/i, "@import");
      for (const m of src.matchAll(/url\(\s*["']?([^"')]+)/gi)) {
        assert.doesNotMatch(m[1], /^(https?:)?\/\//i, `outside url(): ${m[1]}`);
      }
    });
  }

  if (file.endsWith(".js") && !/smoke\.js$/.test(name) && !name.startsWith("playwright")) {
    test(`${name}: no cookies, eval, beacons or sockets`, () => {
      assert.doesNotMatch(src, /document\.cookie/, "cookies");
      assert.doesNotMatch(src, /\beval\s*\(|new Function\s*\(/, "eval");
      assert.doesNotMatch(src, /sendBeacon|new WebSocket|EventSource|XMLHttpRequest/, "network side-channel");
    });
  }

  if (name.startsWith("items") && file.endsWith(".js") && !/smoke\.js$/.test(name)) {
    test(`${name}: stores data only through kit/save.js`, () => {
      assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/, "use kit/save.js instead");
    });
  }
}

/* ---- fonts ------------------------------------------------- */

test("kit.css fonts are all present, with their OFL licences", () => {
  const css = fs.readFileSync(path.join(ROOT, "kit", "kit.css"), "utf8");
  const fonts = [...css.matchAll(/url\("(fonts\/[^"]+\.woff2)"\)/g)].map((m) => m[1]);
  assert.ok(fonts.length >= 3);
  for (const f of fonts) { assert.ok(fs.existsSync(path.join(ROOT, "kit", f)), `${f} missing`); }
  for (const family of ["inter", "space-grotesk", "jetbrains-mono"]) {
    const lic = fs.readFileSync(path.join(ROOT, "kit", "fonts", `OFL-${family}.txt`), "utf8");
    assert.match(lic, /SIL Open Font License, Version 1\.1/);
  }
});
