# Sprite Sheet Slicer

Drop in a sprite sheet, cut it into frames and preview the animation. Export the frames or a JSON map. For game makers using Phaser, Godot or anything that eats PNGs.

**Your files never leave this device.** Nothing is uploaded.

| | |
|---|---|
| Slug | `sprite-slicer` (= the folder name) |
| Wing | Workshop |
| Save | settings only: `mode`, `cellW`, `cellH`, `cols`, `rows`, `margin`, `spacing`, `skipEmpty`, `fps`, `pingpong`, `zoom`, `mapFormat`. **Never the sheet.** |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Load a sheet | Tap **Choose a sheet** (or **Try a sample**) | <kbd>Tab</kbd> to it, <kbd>Enter</kbd>, or <kbd>Ctrl</kbd> + <kbd>V</kbd> |
| Cut it | Cell size, Rows × cols or Auto | <kbd>Tab</kbd> + arrows |
| Pick / unpick a frame | Tap it on the sheet | Arrows on the sheet, then <kbd>Space</kbd> |
| Zoom (pixel perfect) | **−** / **+** / **Fit** | <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> on the sheet |
| Reorder | Tap a frame in **Frame order**, then **Earlier** / **Later** | <kbd>Shift</kbd> + <kbd>←</kbd> <kbd>→</kbd>, <kbd>Delete</kbd> removes |
| Speed / ping-pong | Slider, checkbox | <kbd>←</kbd> <kbd>→</kbd>, <kbd>Space</kbd> |
| Download | **Download frames (.zip)** or **JSON map** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |

## What it does

| Step | How |
|---|---|
| Read | `createImageBitmap`, drawn on a canvas, pixels read once. |
| Cut by size | Cells of W × H, with a margin round the sheet and spacing between cells. |
| Cut by count | Columns × rows: the cell size is worked out. |
| Auto | Empty rows split the sheet into bands; empty columns split bands into sprites; each is trimmed. |
| Empty | See-through, or the colour of the top-left pixel (old "magic pink" sheets). |
| Preview | `kit/loop.js`. Every frame scaled the same, feet on one line. |
| Zip | `zip.js`, copied from Image Squisher. `frames/<name>_00.png`…, the JSON map, and the sheet. |

### JSON maps

| For | Shape |
|---|---|
| Phaser 3 | JSON Hash atlas: `this.load.atlas("hero", "hero.png", "hero.json")` |
| Godot | `{ texture, size, animation: { name, speed, loop, pingpong }, frames: [{ name, region: [x, y, w, h] }] }` — build `AtlasTexture`s / `SpriteFrames` from it in a script. |

## Reduced motion

The preview starts **paused**, with a Play button. Nothing else moves.

## Smoke test

1. Makes a 106 × 54 sheet in the browser (4 × 2 cells of 24 px, 2 px margin and spacing, one cell empty) and sets it on the file input.
2. Types the cell size, margin and spacing. Checks **7 frames · 4 × 2**.
3. Checks the preview keeps changing frame.
4. Phone: taps frame 1. Desktop: <kbd>Space</kbd> on the sheet. Checks 6 are left.
5. Clicks **Download frames** and checks the file starts with `PK`.

## Notes

| Case | What happens |
|---|---|
| Pixels left over | A note says how many, so you can fix the size, margin or spacing. |
| Sprite in pieces (e.g. a detached shadow) | Auto sees two sprites. Use a grid instead. |
| Changing the cut | Picks every frame again, in reading order. |
| Huge sheets | Up to 8192 px a side and 4096 × 4096 pixels in all. |
| Not a picture, broken file | A friendly message; nothing crashes. |

Unit tests: `tests/unit/sprite-slicer.test.js` (grid maths, auto-detect, ping-pong, maps, the zip).
