# ASCII Cam

Your camera, live, redrawn as text characters. Snap a picture as a PNG, or copy it as text.

**Nothing leaves this device.** No upload, no recording.

| | |
|---|---|
| Slug | `ascii-cam` (= the folder name) |
| Wing | Workshop |
| Save | settings only: `cols`, `contrast`, `brightness`, `charset`, `custom`, `colour`, `invert`, `timer`. **Never a picture.** |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Start / stop the camera | Tap **Start camera** / **Stop camera** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Front / back camera | Tap **Switch camera** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| No camera? | Tap **Try a sample** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Detail, contrast, brightness | Drag the sliders | <kbd>←</kbd> <kbd>→</kbd> on a slider |
| Characters, colours | Tap a pill | Arrows in the group |
| Snap | **Download PNG** or **Copy as text** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| 3-2-1 timer | Tick **3-2-1 timer first**; tap the number to cancel | <kbd>Space</kbd> on the box; <kbd>Esc</kbd> cancels |

## What it does

| Step | How |
|---|---|
| Camera | `getUserMedia`, only after the button. `facingMode` user / environment. |
| Read | Each frame drawn into a tiny canvas (`willReadFrequently`), 3 × 3 pixels a cell. |
| Map | `ascii.js`: average → luma → contrast + brightness → a character. |
| Draw | One character a cell on the canvas, in JetBrains Mono (the kit font). |
| Loop | `kit/loop.js`, about 30 frames a second while the camera runs. |
| PNG | Redrawn at 12 × 24 px a cell, `canvas.toBlob`. |
| Text | `navigator.clipboard.writeText`. Blocked? A box with the text to select, and **Download .txt**. |

### Darkest and lightest

Every set is ordered by **ink**: a space first, the fullest character last.

| Colours | Black becomes | White becomes |
|---|---|---|
| Green terminal, white on black, full colour | space (no light) | `@` / `█` (most light) |
| Black on white | `@` / `█` (most ink) | space (paper) |
| **Invert** | flips it once more | |

### Character sets

| Set | Characters, light ink first |
|---|---|
| Classic | ` .:-=+*#%@` |
| Blocks | ` ░▒▓█` |
| Binary | ` 10` |
| Custom | Whatever you type, up to 64 (emoji work). Empty = Classic. |

Characters are about twice as tall as wide, so rows = columns × height ÷ width × ½.

## Camera rules

| Case | What happens |
|---|---|
| Permission denied | A clear message: how to allow it, or try the sample. |
| No camera / busy / not https | Its own message. Nothing crashes. |
| Switch camera | Shown on touch screens, or when 2+ cameras are listed. |
| Tab hidden | The camera **stops** (the light goes off). Back again: it restarts. |
| Stop camera | Stops every track. The last frame stays on screen. |

## Reduced motion

No decorative animation. The 3-2-1 shows plain numbers (no pulse).

## Smoke test

1. Phone: taps **Try a sample**. Desktop: <kbd>Enter</kbd> on it. Checks the text is not empty and has the right rows.
2. Phone: taps **Blocks** (checks for `█`). Desktop: <kbd>→</kbd> × 4 on Detail (checks +16 columns). The text changed.
3. **Copy as text**: the clipboard, or the fallback box with the same text.
4. **Download PNG**: checks the file is a real PNG, 12 px a column wide.

Unit tests: `tests/unit/ascii-cam.test.js` (black / white mapping in every mode, custom sets, rows × cols, contrast, brightness, settings).
