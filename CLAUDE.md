# CLAUDE.md: rules for this repo

This repo is one wing of **Limitless Lab** (Arcade 🎮, Lab 🔬 or Workshop 🧰).
The wing is set in `site.config.js`. You add **items**, one at a time.

## About the owner

- The owner is dyslexic and a visual learner.
- Write short steps. Use tables and lists. One idea per line.
- No walls of text. Bold the one thing that matters.

## Git

- **Never push to `main`.** Work on a branch: `item/<slug>`.
- **One PR per item.** Don't bundle two items.
- **Run `npm test` before every push.** It must pass.
- Don't force-push over someone else's work.

## Planned items

- Planned items sit in `items.json` with `"soon": true`. The hub shows them as **Coming soon** cards.
- To build one: `npm run new-item -- <slug> "<Title>"`. It turns the soon entry into a real one.
- A tested rule: once `items/<slug>/` exists, `"soon"` must be gone.

## Every item must

| Rule | How it's checked |
|---|---|
| Pass the phone test (390px, touch) and desktop (1280px) | `npm test` |
| Work at 360px wide, no sideways scroll | `npm test` |
| Work with touch AND mouse AND keyboard | your `smoke.js` |
| Have no console errors | `npm test` |
| Have a `smoke.js` that plays it and checks something changed | `npm test` |
| Be listed in `items.json` | `npm test` |
| Have a filled-in `README.md` (no TODO left) | `npm test` |
| Respect reduced motion (`kit/motion.js`) | you |
| Pause when the tab is hidden (`kit/loop.js` does it) | you |

## Privacy (hard rules)

- **No new origins.** Nothing loads from another website. No CDNs, no fonts, no APIs.
- Only GoatCounter is allowed, and only through `kit/stats.js`.
- **No inline scripts.** No `<script>` without `src`, no `onclick=""`.
- **No inline styles.** No `<style>`, no `style=""`. Put CSS in `item.css`.
- Keep the Content-Security-Policy `<meta>` line exactly as the template has it.
- **No uploads.** Tools process files in the browser (FileReader, canvas, workers).
- No cookies. No accounts. No tracking.
- **Saves only through `kit/save.js`.** Never touch `localStorage` directly.
- Every item page shows the save panel (`mountSavePanel`) if it saves anything.

## kit/

- `kit/` must stay **identical in all three repos**.
- Don't change it for one item. Use the item's own folder instead.
- If you really must change `kit/`:
  - say so in **bold** at the top of the PR,
  - explain why,
  - run `npm run kit:hash` and put the new hash in the PR.

## PR description

Use this shape:

```
## What it is
One line.

## How to play / use it
| Do this | Phone | Keyboard |
|---|---|---|

## Screenshots
- test-results/screens/<slug>-phone.png
- test-results/screens/<slug>-desktop.png
- test-results/screens/hub-phone.png

## Checks
- [ ] npm test passes
- [ ] kit/ unchanged (or: changed, because ...)
```

## Handy commands

| Command | What it does |
|---|---|
| `npm run new-item -- <slug> "<Title>" --tags a,b --blurb "..."` | Makes a new item from the template |
| `npm test` | Unit tests + phone/desktop browser tests |
| `npm run serve` | Plays the site at http://127.0.0.1:4173 |
| `npm run kit:hash` | Fingerprint of `kit/` to compare repos |

## Don't

- Don't run `playwright install`. Chromium is already at `/opt/pw-browsers`.
- Don't add npm dependencies to the site. No build step. Plain ES modules only.
- Don't add background images, sprites or decorative backdrops.

Step-by-step guide: `docs/adding-an-item.md`. What to build next: `ROADMAP.md`.
