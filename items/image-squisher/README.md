# Image Squisher

Shrink, resize and convert a pile of images at once. For anyone who needs smaller pictures for a website, an email or a game.

**Your files never leave this device.** Nothing is uploaded.

| | |
|---|---|
| Slug | `image-squisher` (= the folder name) |
| Wing | Workshop |
| Save | settings only: `maxWidth`, `maxHeight`, `format`, `quality`. **Never the images.** |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Add images | Tap **Choose images** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Add by dragging | - | Drop files on the big box |
| Paste a screenshot | - | <kbd>Ctrl</kbd> + <kbd>V</kbd> |
| Compare before / after | Tap a file name | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Change quality | Drag the slider | <kbd>←</kbd> <kbd>→</kbd> |
| Download one | Tap **↓** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Download all | **Download all (.zip)** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |

## What it does

| Step | How |
|---|---|
| Read | `createImageBitmap` (phone photos come out the right way up). `<img>` as a backup. |
| Resize | Canvas, halving in steps for clean edges. Keeps the shape. Never enlarges. |
| Encode | `canvas.toBlob` as WebP, JPEG or PNG. |
| Zip | `zip.js`: a tiny store-only zip writer (CRC-32, local headers, central directory, end record). |

- Files are done **one at a time**, with a progress bar. A phone never holds 20 photos at once.
- Changing a setting re-squishes everything with the new one.
- **No hidden photo data.** The picture is redrawn, so EXIF (location, camera, date) is left behind.
- Downloads are blob URLs, freed a few seconds later.

## Reduced motion

Nothing moves on its own. Button lifts are switched off by `kit.css`.

## Smoke test

1. Makes a 1200×900 PNG in the browser and sets it on the file input.
2. Checks a row appears and the file got smaller (or changed format).
3. Phone: taps **JPEG**. Desktop: presses <kbd>←</kbd> on the quality slider. Checks the row updates.
4. Clicks **Download all** and checks the file starts with `PK`.

## Notes

| Case | What happens |
|---|---|
| Browser can't make WebP (older Safari) | A note says so. JPEG is used. |
| JPEG and see-through parts | They turn white (JPEG has no transparency). |
| HEIC, PDF, a broken file | That row says it couldn't be read. The rest carry on. |
| Huge images | Capped at 8192 px a side and 40 megapixels, so phones don't crash. |
| Output bigger than input | Shown as **+%** in pink. Try lower quality or another format. |
| GIF | First frame only. |

Unit tests: `tests/unit/image-squisher.test.js` (CRC-32, zip headers, entry count, sizes, names).
