# GIF Maker

Turn a few photos or a quick camera clip into a looping GIF, right in your browser.

**Your photos never leave this device.** Nothing is uploaded.

| | |
|---|---|
| Slug | `gif-maker` (= the folder name) |
| Wing | Workshop |
| Save | settings only: `size`, `delay`, `loop`, `loopCount`, `colors`, `dither`, `crop`, `clipSeconds`. **Never the photos or clips.** |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Add photos | Tap **Choose photos** (or **Try a sample**) | <kbd>Tab</kbd> to it, <kbd>Enter</kbd>, or <kbd>Ctrl</kbd> + <kbd>V</kbd> to paste |
| Record a clip | **Record clip**, pick 1-5 s, **Record** | <kbd>Tab</kbd> to the buttons, <kbd>Enter</kbd> |
| Reorder | Drag a frame sideways, or tap it then **Earlier** / **Later** | <kbd>Shift</kbd> + <kbd>←</kbd> <kbd>→</kbd> on a frame |
| Remove a frame | Tap it, then **Remove** | <kbd>Delete</kbd> on a frame |
| Settings | Tap the pills, drag the sliders | <kbd>Tab</kbd>, then arrows |
| Make + save | **Make GIF**, then **Download** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |

## What it does

| Step | How |
|---|---|
| Add | File input (`multiple`), drop anywhere, or paste. Each photo is kept at most 960 px a side, in memory only. |
| Sample | 6 frames of a bouncing ball, drawn in code on a canvas. |
| Camera | `getUserMedia` + `video.srcObject`, only after a button press. One frame every frame-delay, so it plays at real speed. Tracks stop when the clip is done, on Close, and when the tab is hidden. |
| Crop | Original (the first frame's shape), Square or 16:9. Other shapes are cut from the middle, never stretched. |
| Size | 160 / 240 / 320 / 480 / 640 px on the longest side. |
| Preview | `kit/loop.js`, at the real output size. Follows the loop setting (stops after Once / N times). |
| Estimate | A small copy (128 px) is encoded in a worker and scaled up. Shown as "about". |
| Encode | `gif.js` in `gif-worker.js` (a module Web Worker). Frames are transferred, not copied; a progress bar shows each frame. **Cancel** stops the worker. |
| Result | Shown as an `<img>` (blob URL) with the real size, plus a **Download** link. |

### The encoder (`gif.js`)

| Part | How |
|---|---|
| Colours | Exact if few enough; otherwise median cut over a sample. 64-256 colours, one table for every frame. |
| Dithering | Floyd-Steinberg, on or off. |
| LZW | GIF variable-width codes, 12 bits max, clear code when the table is full. |
| Loop | Netscape block: forever = 0, "N times" = N - 1 repeats, Once = no block. |
| See-through | Pixels under 50% alpha get index 0. |

Pure and DOM-free, so Pixel Studio can copy it as-is. `readGif()` + `lzwDecode()` are there for tests.

## Reduced motion

The preview starts **paused**, with a Play button. Nothing else moves.

## Smoke test

1. Taps / clicks **Try a sample**. Checks 6 frames and an "about" size.
2. Phone: taps frame 1, then **Later**. Desktop: <kbd>Shift</kbd> + <kbd>→</kbd>. Checks the order changed.
3. Presses **Make GIF**. Checks the Download link appears.
4. Downloads it. Checks it starts with `GIF89a` and ends with `0x3B`.

## Notes

| Case | What happens |
|---|---|
| Camera blocked / missing / busy / not https | A plain message; photos and the sample still work. |
| Over 100 frames | The extra ones are skipped, with a note. |
| Delay under 50 ms + a long clip | A clip holds 60 frames at most, so it is spaced out a little. |
| Settings change after Make GIF | A note says to press Make GIF again. |
| Not a picture, broken file | Skipped, with a note. |

Unit tests: `tests/unit/gif-maker.test.js` (header + trailer, LZW round-trips past 4096 codes, frame count, loop, delay, colour limit, dithering, crop / size / order / estimate maths).
