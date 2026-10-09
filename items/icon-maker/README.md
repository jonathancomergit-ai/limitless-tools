# Icon Maker

One picture in, every icon out: favicon.ico, Apple and Android icons, and the HTML to paste in. For anyone putting a site or web app online.

**Your files never leave this device.** Nothing is uploaded.

| | |
|---|---|
| Slug | `icon-maker` (= the folder name) |
| Wing | Workshop |
| Save | settings only: `fit`, `padding`, `radius`, `bg`, `transparent`, `name`, `shortName`. **Never the picture.** |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Add a picture | Tap **Choose a picture** (or **Try a sample**) | <kbd>Tab</kbd> to it, <kbd>Enter</kbd>, or <kbd>Ctrl</kbd> + <kbd>V</kbd> |
| Crop | **Whole picture** or **Fill square** | <kbd>Tab</kbd> + arrows |
| Padding, corners | Drag the sliders | <kbd>←</kbd> <kbd>→</kbd> |
| Background | Tap the colour, or type a hex | <kbd>Tab</kbd> to the hex box |
| Get one icon | Tap its **↓** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Get everything | **Download all (.zip)** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Copy the HTML | **Copy** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |

## What you get

| File | Size | Notes |
|---|---|---|
| `favicon.ico` | 16, 32, 48 | One file. PNGs inside an ICO (every browser reads it). |
| `apple-touch-icon.png` | 180 | Always filled, square corners (iOS rounds it). |
| `icon-192.png`, `icon-512.png` | 192, 512 | Your padding, corners and background. |
| `icon-maskable-512.png` | 512 | Filled to the edge. Picture kept inside the 80% safe circle. |
| `site.webmanifest` | | Name, short name, icons, colours. |
| `head-tags.html` | | The three `<link>` tags. |

## How it draws

| Step | How |
|---|---|
| Read | `createImageBitmap` (SVGs via `<img>`), capped at 2048 px a side. |
| Draw | At 1024 px, then halved in steps, so 16 px icons stay clean. |
| ICO | `icon.js` `makeIco`: 6-byte header, 16-byte entry per size, then the PNGs. |
| Zip | `zip.js`, copied from Image Squisher. |

## Reduced motion

Nothing moves. Button lifts are switched off by `kit.css`.

## Smoke test

1. Makes a 640 × 400 PNG in the browser and sets it on the file input.
2. Checks all 5 tiles (7 canvases) appear and are drawn, and the snippets are filled.
3. Phone: taps **Fill square**. Desktop: <kbd>→</kbd> on **Corners**. Checks the icons redraw.
4. Clicks **Download all** and checks the zip starts with `PK` and lists all 7 files.

## Notes

| Case | What happens |
|---|---|
| Picture under 512 px | A note says the big icons may look soft. |
| Not square + see-through | A note suggests **Fill square**. |
| HEIC, broken file, not a picture | A friendly message; nothing crashes. |
| No clipboard | **Copy** selects the text and says to press Ctrl + C. |

Unit tests: `tests/unit/icon-maker.test.js` (ICO header + directory for 3 sizes, placement, safe zone, snippets).
