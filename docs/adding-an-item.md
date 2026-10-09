# Adding an item

About 10 steps. Each one is short.

## 1. Pick the item

- Open `ROADMAP.md`.
- Take the **top unticked** line. Note its slug and acceptance list.

## 2. Make a branch

```bash
git checkout main && git pull
git checkout -b item/<slug>
```

## 3. Make the folder

```bash
npm run new-item -- <slug> "<Title>" --tags game,puzzle --blurb "One short line."
```

This:

| Does | Where |
|---|---|
| Copies the template | `items/<slug>/` |
| Puts your title in | `index.html`, `README.md`, `main.js`, `smoke.js` |
| Adds a card to the hub | `items.json` |

Slug rules: lowercase, digits, dashes. Example: `orbit-sim`.

## 4. Build it

Work in `items/<slug>/main.js`. The template already runs. Use the kit:

| Need | Import from | Use |
|---|---|---|
| Wing colours + title | `kit/item.js` | `bootItem()` (first line) |
| A sharp canvas | `kit/canvas.js` | `createCanvas(stage, { onResize })` |
| A frame loop | `kit/loop.js` | `startLoop({ update(dt), draw() })` |
| Touch + mouse | `kit/input.js` | `pointer(el, { down, move, up })` |
| Keyboard | `kit/input.js` | `createKeys()` then `keys.isDown("left")` |
| Phone buttons | `kit/input.js` | `buttonBar(slot, buttons, keys)` |
| Less motion | `kit/motion.js` | `reducedMotion()` |
| Saving | `kit/save.js` | `createSave({ slug, version, defaults })` |
| Save buttons | `kit/save-ui.js` | `mountSavePanel(el, save)` |
| Test access | `kit/item.js` | `exposeForTests(state)` |

No canvas (a Workshop tool)? Delete the `.stage`, the `pad-slot` and the Pause button in `index.html`. Put a form in `.item-info`.

Need extra CSS? Make `items/<slug>/item.css` and link it in `index.html`. **No `<style>` and no `style=""`.**

## 5. Phone first

- Design for **360px wide**, then check desktop.
- Every control needs a touch way **and** a keyboard way.
- Tap targets: at least 48px (`.pad-btn` and `.btn` already are).
- Never hide touch UI with `@media (hover)` or `(pointer)`. Use `hasTouch()` from `kit/input.js`.

## 6. Reduced motion

| Wing | When `reducedMotion()` is true |
|---|---|
| 🎮 Arcade | No screen shake, flashes, trails or parallax |
| 🔬 Lab | Start paused, with a Play button |
| 🧰 Workshop | No decorative animation at all |

## 7. Write the smoke test

Edit `items/<slug>/smoke.js`. It gets `{ page, expect, size, isMobile }`.

1. Wait for `#stage[data-ready]` (or your own ready sign).
2. Do what a player does: **tap on phone**, **keys on desktop**.
3. Check something changed: a score, a readout, an output file.

Read state with `page.evaluate(() => window.__item.score)`.

## 8. Fill in the words

- `items/<slug>/README.md`: what it is, how to play, what it saves.
- `items.json`: a real blurb (200 characters max) and 1 to 4 tags.
- The how-to table in `index.html`.
- **Remove every `TODO`.** The tests fail while one is left.

## 9. Test

```bash
npm test
```

All green? Now **look** at the pictures:

- `test-results/screens/<slug>-phone.png`
- `test-results/screens/<slug>-desktop.png`
- `test-results/screens/hub-phone.png`

Ugly or cramped on the phone? Fix it, test again.

## 10. Open the PR

```bash
git add -A && git commit -m "Add <slug>: <one line>"
git push -u origin item/<slug>
```

- Tick the line in `ROADMAP.md` in the same PR.
- Use the PR shape in `CLAUDE.md` (what it is, how to play, screenshots, checks).

## When a test fails

| Message says | Usually means | Fix |
|---|---|---|
| `request to another origin` | Something loads from another site | Copy the file into the repo, or drop it |
| `Refused to ... Content Security Policy` | Inline script/style, or an outside URL | Move it into a `.js` / `.css` file |
| `horizontal overflow` | Something is wider than the phone | It names the element. Add `max-width: 100%` or wrap text |
| `canvas ... is blank` | Nothing drawn after 1 second | Draw a first frame straight away |
| `HTTP 404` | A wrong file path | Check `../../kit/...` paths |
| `localStorage keys must come from kit/save.js` | Stored data directly | Use `createSave` |
| `still has a placeholder or TODO` | Template text left over | Fill it in |
