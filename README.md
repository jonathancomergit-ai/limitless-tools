# Limitless Workshop 🧰

One wing of **Limitless Lab**. Free tools for devs, creators and makers. Your files never leave your device.

## The kit

One kit, three wings, each in its own repo:

| Wing | What | Emoji | Accent |
|---|---|---|---|
| Arcade | Small HTML5 browser games | 🎮 | hot pink |
| Lab | Simulations and visual explanations ("code you can touch") | 🔬 | cyan |
| Workshop | Free tools for devs, creators and makers | 🧰 | amber |

Each repo has a **hub page** (a grid of cards from `items.json`) and one folder per item.
Plain files, no build step, so GitHub Pages serves it as-is.

## Quick start

```bash
npm ci          # once (cloud sessions do this by themselves)
npm test        # unit tests + phone/desktop browser tests
npm run serve   # play at http://127.0.0.1:4173
```

Add an item: `npm run new-item -- <slug> "<Title>"`, then follow `docs/adding-an-item.md`.

## Set up a new wing repo

1. Copy this whole folder into the new repo.
2. Edit **only** `site.config.js`: `wing`, `name`, `emoji`, `accent` (+ `tagline`).
3. Replace the list in `ROADMAP.md`.
4. Keep or delete `items/hello` (if you delete it, remove it from `items.json`).
5. `npm ci && npm test`, then push and turn on GitHub Pages.

## What's where

```
index.html          hub page (cards built from items.json)
items.json          the item list
site.config.js      the ONLY wing-specific file
kit/                shared, identical in all three repos
  kit.css             look: tokens from jonjoe1001.dev, fonts, components
  fonts/              self-hosted woff2 + SIL OFL licences
  config.js           reads site.config.js, paints wing colour + name
  canvas.js           full-size, devicePixelRatio-aware canvas
  input.js            pointer (touch + mouse), keys, on-screen pad
  loop.js             frame loop, pauses when the tab is hidden
  motion.js           prefers-reduced-motion helper
  save.js             namespaced, versioned saves (+ memory fallback)
  save-ui.js          Export / Import / Delete my data panel
  hub.js, items.js    the hub page
  item.js             item page boot
  stats.js            GoatCounter page views (off on localhost)
items/_template/    copy this for a new item
items/hello/        working example: drag-and-fling ball
tests/unit/         node --test: saves, items.json, page rules, contrast
tests/e2e/          Playwright: every page, phone + desktop, privacy
scripts/            new-item.js, kit-hash.js
```

## Privacy, and how it's proven

| Promise | Proof |
|---|---|
| No third-party requests except GoatCounter | Strict CSP `<meta>` on every page; e2e blocks + fails on any other origin |
| Fonts self-hosted | `kit/fonts/`, CSP `font-src 'self'` |
| No inline scripts | CSP has no `'unsafe-inline'`; unit test scans every page |
| No cookies | e2e asserts the cookie jar is empty |
| Saves stay on the device | `kit/save.js` only uses localStorage; export/import are local files |
| Not counted on localhost | e2e checks `stats.js` adds nothing there |
| CSP really blocks | e2e tries fetch/img/script to another origin; all refused |

Footer on every page: *No accounts, no cookies. Saves stay on your device. Cookie-free visit counts via GoatCounter.*

## Saves

- Key: `ll:<wing>:<slug>`. Value: `{ app, wing, slug, v, savedAt, data }`.
- Versioned: bump `version`, add `migrate(data, fromVersion)`.
- Storage blocked (private mode)? Falls back to memory; the panel says so.
- Hub panel exports/imports/deletes **every** save for that wing at once.

## Tests

| Run | What |
|---|---|
| `npm run test:unit` | save.js logic, items.json vs folders, page/privacy rules, colour contrast, pure helpers |
| `npm run test:e2e` | hub + every item at 390x844 (touch) and 1280x800; 360px overflow check; screenshots to `test-results/screens/` |

Playwright uses Chromium from `/opt/pw-browsers` in cloud sessions. CI installs its own.

## Fonts

Space Grotesk, Inter and JetBrains Mono, variable woff2 from the `@fontsource-variable` packages (v5.3.0).
All three are SIL Open Font License 1.1. Licence texts are in `kit/fonts/OFL-*.txt`.
