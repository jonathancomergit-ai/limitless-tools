# Easing Curve Editor

Drag a curve to shape how things speed up and slow down, see it live, then copy it as CSS, GDScript or JavaScript.

For game makers and web makers. **Everything happens on this device.**

| | |
|---|---|
| Slug | `easing-editor` (= the folder name) |
| Wing | Workshop |
| Save | `curve`, `pinned` (the curve you race against), `duration`, `loop`, `format` |
| Added | 2026-10-10 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Shape the curve | Drag a round handle | <kbd>Tab</kbd> to a handle, arrow keys (<kbd>Shift</kbd> = steps of 0.1) |
| Exact numbers | Type in x1 / y1 / x2 / y2 | <kbd>Tab</kbd> to a box, type |
| Pick a preset | Tap it | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Bounce / elastic direction | In / Out / In-out | <kbd>Tab</kbd>, arrows |
| Play the previews | **Play** | <kbd>Space</kbd> |
| Loop on / off | **Loop** | <kbd>L</kbd> |
| Pin to race | **Pin to race** | <kbd>P</kbd> |
| Copy | Pick CSS / GDScript / JS, **Copy** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |

## What's on the page

| Part | What it shows |
|---|---|
| Curve | Time left to right, progress bottom to top. The lighter box is 0 to 1; above and below it is overshoot. |
| Handles | `x` stays 0 to 1 (a CSS rule). `y` can go from -0.75 to 1.75, for curves that overshoot. |
| See it move | A ball, a growing box and a fade. Faint dots show the ball at each tenth of the time. |
| Pinned | A cyan copy of a curve. It races the current one in every preview, and shows dashed on the graph. |
| Presets | `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out` (the CSS keywords), back in / out / in-out, bounce, elastic. |

## Copy as

| Format | What you get |
|---|---|
| CSS | A custom property, `--ease-<name>: cubic-bezier(...)`, and a `transition` that uses it. Bounce and elastic can't be a cubic-bezier, so they come out as `linear()`. |
| GDScript | Godot 4. The closest `set_trans()` + `set_ease()` (and how far off it is), plus `ease_curve(t)`, the exact curve, for `set_custom_interpolator()` (Godot 4.3+) or anywhere else. |
| JS | A plain function `ease...(t)`. For Bezier curves, also the `el.animate()` easing string. |

## How it works

All maths is in `ease.js`:

| Thing | How |
|---|---|
| Bezier solver | Finds where the curve's x equals the time (Newton's method, then halving the gap if that wanders), then returns y. |
| Bounce, elastic, Tween curves | The same equations Godot uses (Robert Penner's), so `TRANS_BOUNCE` really matches. |
| Closest Godot easing | Tries every `TRANS_*` with `EASE_IN`, `EASE_OUT` and `EASE_IN_OUT` and keeps the one with the smallest biggest gap. |
| `linear()` | Samples the curve 600 times (plus each bounce's floor hit), then keeps only the points needed to stay within 0.0015 of it. |

## Reduced motion

The previews never play by themselves. They wait for **Play** (or Loop). Without reduced motion, they play once after each change.

## Smoke test

1. Drags handle 1 (phone: real touch drag, desktop: mouse drag).
2. Checks the CSS changed to the new `cubic-bezier()` and the browser accepts it.
3. Desktop: arrow key nudges the handle. Phone: taps Bounce, checks a valid `linear()`.
4. Pins the curve, checks two lanes race.
5. Switches to GDScript, checks `ease_curve()` and `set_trans()` are there.

## Notes

- Previews move by setting CSS custom properties from JS (`el.style.setProperty`). The CSP allows that. There is no `style=""` in the HTML.
- The handles are drawn on a canvas. Two invisible buttons sit on top of them for keyboard focus.
- `linear()` needs Chrome 113, Firefox 112 or Safari 17.2 and up. The CSS output says so.
- Unit tests: `tests/unit/easing-editor.test.js`.
