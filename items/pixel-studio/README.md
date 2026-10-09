# Pixel Studio

Draw pixel art with layers and animate it frame by frame. Export a PNG, a sprite sheet + JSON, or a GIF. For game makers and doodlers, on a phone or a computer.

**Your art never leaves this device.** Nothing is uploaded.

| | |
|---|---|
| Slug | `pixel-studio` (= the folder name) |
| Wing | Workshop |
| Save | **the whole project**: size, layers, frames and every pixel (compact text), plus `tool`, `color`, `preset`, `custom` colours, `mirrorX`, `mirrorY`, `rectFill`, `onion`, `fps`, `scale` |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Draw | Tap or drag on the canvas | Arrows move the cursor, <kbd>Space</kbd> / <kbd>Enter</kbd> paints; hold <kbd>Space</kbd> + arrows to keep painting |
| Pick a tool | Pencil, Eraser, Fill, Line, Box, Pick | <kbd>B</kbd> <kbd>E</kbd> <kbd>G</kbd> <kbd>L</kbd> <kbd>R</kbd> <kbd>I</kbd> |
| Line / box | Drag from one end to the other | <kbd>Space</kbd> at the start, move, <kbd>Space</kbd> at the end (<kbd>Esc</kbd> cancels) |
| Mirror | **Mirror**: off → ↔ → ↕ → both | <kbd>M</kbd> |
| Undo / redo | The arrow buttons under the canvas | <kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Y</kbd> or <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> |
| Zoom | Pinch, or **−** / **+** / **Fit** | Mouse wheel (or trackpad pinch), <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> on the canvas |
| Move around | Drag with two fingers | <kbd>Space</kbd> + drag, middle-button drag; the view follows the cursor |
| Colour | Tap a swatch; **Add colour** for your own | <kbd>[</kbd> <kbd>]</kbd>, or <kbd>Tab</kbd> to a swatch |
| Frames | Tap one in the strip; Add, Copy, ← →, Delete | <kbd>,</kbd> <kbd>.</kbd> to step |
| Layers | Tap a name to draw on it, the eye to hide it; Add, Up, Down, Delete | <kbd>Tab</kbd> + <kbd>Enter</kbd> |
| Size | **New canvas or resize…** | <kbd>Tab</kbd> + <kbd>Enter</kbd> |
| Export | Pick a scale, then PNG, GIF, Sprite sheet PNG, Sheet JSON | <kbd>Tab</kbd> + <kbd>Enter</kbd> |

## What it does

| Part | How |
|---|---|
| Canvas | 8 to 128 px a side (8, 16, 24, 32, 48, 64, 96, 128 or any size between). Resize keeps the art, centred or top-left; smaller crops. |
| Tools | Pencil, eraser, 4-way flood fill, Bresenham line, box (outline or filled), eyedropper (the colour you see), mirror left/right, top/bottom or both. |
| Undo | Up to 200 steps. A stroke stores only the pixels it changed; layer, frame and size changes store snapshots (about 48 MB at most). |
| View | One `<canvas>`, smoothing off. Pinch / wheel zoom from 0.5× to 64× round your fingers or the mouse. The grid fades in from 4× to 12×. A faint checkerboard shows see-through pixels. |
| Palette | PICO-8 (16), Game Boy (4 greens), NES-ish (54), plus up to 32 colours of your own. |
| Layers | Up to 4: show/hide, up/down, add, delete. |
| Frames | Up to 24: add, copy, move, delete. Onion skin shows the frame before, faint. The preview (`kit/loop.js`) plays at 1–24 fps. |
| PNG | The current frame at 1×–32×, nearest neighbour. |
| Sprite sheet | All frames in a near-square grid + a JSON with each frame's rect, duration, fps and sizes (TexturePacker / Aseprite "array" shape). |
| GIF | `gif.js`, **copied from `items/gif-maker/gif.js`** (items can't share code outside `kit/`), run in a module worker (`gif-worker.js`). Frames are scaled up first; see-through stays see-through. Capped at 1024 px a side and about 12 M pixels over all frames so it stays quick. |
| Save | `kit/save.js`. Pixels are run-length text over the colours used; repeated cels are stored once, and a frame can be stored as "what changed since the frame before". Saved 0.6 s after you stop. Over 900 KB (imports are capped at 1 MB) it keeps the last save that fitted and tells you. |

## Reduced motion

The preview starts **paused**, with a Play button. Nothing else moves.

## Smoke test

1. Picks the PICO-8 blue swatch.
2. Phone: taps pixel (7, 8) of the starter heart. Desktop: moves the keyboard cursor there and presses <kbd>Space</kbd>. Checks it turned blue.
3. Phone: taps **Undo**. Desktop: <kbd>Ctrl</kbd> + <kbd>Z</kbd>. Checks it's red again.
4. Exports a PNG (checks the `PNG` bytes); on desktop also a GIF from the worker (checks `GIF89a`).

## Notes

| Case | What happens |
|---|---|
| Two fingers land mid-stroke | The stroke is undone and it becomes a pinch / pan. |
| Drawing on a hidden layer | It works, with a note that the layer is hidden. |
| Huge exports | PNGs and sheets stay within 8192 px a side and 40 M pixels; the scale drops and the hint says so. |
| A broken or foreign save file | Import says why and changes nothing. A broken stored save starts fresh. |

Unit tests: `tests/unit/pixel-studio.test.js` (flood fill, lines, undo / redo, mirror, compositing, resize, sheet JSON, the save format, the copied GIF encoder).
