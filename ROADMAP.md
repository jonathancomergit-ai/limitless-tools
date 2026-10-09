# ROADMAP

What to build next, in order. **Take the top unticked line.**

- One line = one item = one PR.
- Tick it (`[x]`) in the same PR that adds the item.
- Every item also has to meet the rules in `CLAUDE.md` (phone test, privacy, saves).

## How to read a line

```
- [ ] `slug` - one-line pitch
  - acceptance: thing that must be true
  - acceptance: another thing
```

## Up next

Tonight's three for 🧰 Workshop, in this order.

- [x] `image-squisher` - Image Squisher: Shrink, resize and convert a pile of images at once. Everything happens on your device, nothing is uploaded.
  - acceptance: Pick or drop many images (PNG, JPG, WebP, GIF first frame); a file input works on phones
  - acceptance: Settings: max width / max height (keep aspect), format WebP / JPEG / PNG, quality slider
  - acceptance: Converted with canvas in the browser; a table shows each file with before size, after size and % saved
  - acceptance: Preview before/after for the selected file
  - acceptance: Download one, or Download all as a .zip (write a small store-only zip writer in plain JS, no libraries)
  - acceptance: Tell people the output has no hidden photo data (location etc. is stripped)
  - acceptance: Saves the settings only, never the images; Export/Import works
  - acceptance: Unit test (tests/unit): the zip writer makes a valid zip (check headers and CRC32)
  - acceptance: smoke.js: set a generated test PNG with setInputFiles, check a result row appears with a smaller or converted file

- [x] `sfx-maker` - SFX Maker: Make retro sound effects for games: coins, jumps, lasers, explosions. Tweak them and save as WAV.
  - acceptance: Preset buttons: coin, jump, laser, explosion, power-up, hit, blip; plus Randomize and Mutate
  - acceptance: Sliders: wave (square, saw, sine, noise), attack/sustain/decay, start pitch, pitch slide, vibrato, duty, volume
  - acceptance: A small synth in plain JS (items/sfx-maker/synth.js) that renders samples from the settings; plays them with Web Audio after a tap
  - acceptance: Waveform drawn on a canvas
  - acceptance: Export WAV (16-bit mono, 44.1 kHz) as a download
  - acceptance: Favourites list (name + settings) saved on the device; Export/Import works
  - acceptance: Unit test (tests/unit): the same settings give the same samples, and the WAV header is correct
  - acceptance: smoke.js: press a preset, check the samples are not silent and the waveform is drawn

- [x] `palette-lab` - Palette Lab: Build colour palettes, check text contrast, preview colour blindness and export for CSS, Godot or Aseprite.
  - acceptance: Generate 5-colour palettes (analogous, complementary, triadic, from a base colour); Space or a button regenerates; lock colours you like
  - acceptance: Edit a colour by hex or a colour picker
  - acceptance: Contrast grid: every pair's ratio with AA / AAA badges
  - acceptance: Colour-blindness preview (protanopia, deuteranopia, tritanopia)
  - acceptance: Export: copy CSS variables, JSON, GIMP/Aseprite .gpl and a Godot Color list; download as a file
  - acceptance: Saved palettes library on the device; Export/Import works
  - acceptance: Unit test (tests/unit): contrast ratio of black on white is 21, plus a few known pairs
  - acceptance: smoke.js: regenerate, check the colours changed but a locked one stayed

### Batch 2

- [x] `sprite-slicer` - Sprite Sheet Slicer: Drop in a sprite sheet, cut it into frames and preview the animation. Export the frames or a JSON map.
  - acceptance: Load a PNG (pick or drop); pixel-perfect zoom
  - acceptance: Slice by cell size or by rows x columns, with margin and spacing; optional auto-detect by transparent gaps
  - acceptance: Grid overlay; tap frames to pick them (or pick all); reorder
  - acceptance: Animation preview with an FPS slider and ping-pong option
  - acceptance: Export: frames as a .zip of PNGs (copy the store-only zip writer from items/image-squisher/zip.js into this item), plus a JSON frame map for Phaser / Godot
  - acceptance: Settings save; images never do; Export/Import works
  - acceptance: Unit test (tests/unit): grid maths with margin and spacing, and auto-detect on a small made-up image
  - acceptance: smoke.js: load a generated sheet with setInputFiles, check the frame count and that the preview plays

- [x] `icon-maker` - Icon Maker: One picture in, every icon out: favicon.ico, Apple and Android icons, and the HTML to paste in.
  - acceptance: Load one image; square crop with padding, background colour and rounded corners
  - acceptance: Outputs: favicon.ico (16, 32, 48 inside one file), 180 Apple touch icon, 192 and 512 Android, a maskable icon with a safe-zone preview
  - acceptance: Copy-paste snippets: the <link> tags and a site.webmanifest
  - acceptance: Download all as a .zip (copy the zip writer from items/image-squisher/zip.js)
  - acceptance: Settings save; images never do; Export/Import works
  - acceptance: Unit test (tests/unit): the ICO writer makes a valid header and directory for 3 sizes
  - acceptance: smoke.js: load a generated image, check the previews appear and Download all gives a download

- [x] `qr-maker` - QR Maker: Make QR codes for links, Wi-Fi or plain text, right on your device. No tracking redirects, ever.
  - acceptance: Types: link, text, Wi-Fi (network, password, security), with a live preview
  - acceptance: QR encoder written in plain JS in items/qr-maker/qr.js: byte mode, versions 1-40, error correction L/M/Q/H, mask choice
  - acceptance: Colours with a contrast warning when it may not scan; quiet-zone border; size
  - acceptance: Download PNG and SVG; copy to clipboard where supported
  - acceptance: Say clearly: the code holds exactly what you typed, with no redirect link in between
  - acceptance: Recent codes save on the device (can be turned off); Export/Import works
  - acceptance: Unit test (tests/unit): Reed-Solomon codewords match a known example, format bits are right, and a known input gives the expected version and size
  - acceptance: smoke.js: type a link, check the QR canvas is drawn and the download works
### Batch 3

Five more tools, in this order. **The CSP stays exactly as it is**: no new origins, no `media-src` change. Camera tools use `getUserMedia` + `video.srcObject` (a stream, not a URL), and nothing is uploaded or saved without the user pressing a button.

- [x] `ascii-cam` - ASCII Cam: Your camera, live, redrawn as text characters. Snap a picture and save it.
  - acceptance: "Start camera" button (no camera until pressed), front/back switch on phones; a clear message if permission is denied
  - acceptance: A "Try a sample" picture so it works with no camera (and for the smoke test)
  - acceptance: Live ASCII render on a canvas; sliders: detail (columns), contrast, brightness; character sets: classic, blocks, binary, custom
  - acceptance: Colour modes: green terminal, white on black, black on white, full colour
  - acceptance: Snap: download PNG, or copy as text; a 3-2-1 timer option
  - acceptance: Pure mapping in items/ascii-cam/ascii.js (brightness to character)
  - acceptance: Saves settings only (never pictures); Export/Import works
  - acceptance: Unit test (tests/unit): black maps to the darkest character and white to the lightest, custom sets work, output has the right rows x columns
  - acceptance: smoke.js: press Try a sample, check the ASCII output is not empty

- [x] `gif-maker` - GIF Maker: Turn a few photos or a quick camera clip into a looping GIF.
  - acceptance: Add photos (choose files, drop, or paste); reorder by drag; remove; "Try a sample" set
  - acceptance: Or record a 1-5 second camera clip (button-started, as in ascii-cam), captured as frames
  - acceptance: Settings: size, frame delay, loop, colours (64-256), dithering on/off, crop to square/16:9/original
  - acceptance: Live preview before export; shows the estimated file size
  - acceptance: A GIF89a encoder written in plain JS (items/gif-maker/gif.js: palette quantising + LZW), run in a Web Worker so the page never freezes
  - acceptance: Saves settings only; Export/Import works
  - acceptance: Unit test (tests/unit): output starts with GIF89a and ends with the trailer byte, LZW round-trips on test data, frame count is right
  - acceptance: smoke.js: Try a sample, press Make GIF, check a download link appears

- [ ] `pixel-studio` - Pixel Studio: Draw pixel art with layers and animate it frame by frame.
  - acceptance: Canvas sizes 8-128 px; tools: pencil, eraser, fill, line, rectangle, eyedropper, mirror drawing; undo/redo
  - acceptance: Pinch / scroll zoom and two-finger / space-drag pan; a pixel grid that fades out when zoomed out
  - acceptance: Palette with presets (PICO-8, Game Boy, NES-ish) and custom colours
  - acceptance: Up to 4 layers (show/hide, reorder) and up to 24 frames with onion skin and an FPS slider for the preview
  - acceptance: Export: PNG (any scale), sprite sheet + JSON, and GIF (copy the encoder from gif-maker into this folder; say so in the PR)
  - acceptance: Pure drawing logic (fill, line, undo stack) in items/pixel-studio/canvas-ops.js
  - acceptance: Saves the current project through kit/save.js; Export/Import works
  - acceptance: Unit test (tests/unit): flood fill stops at borders, line drawing hits the right pixels, undo/redo returns the exact pixels
  - acceptance: smoke.js: draw a pixel, check it changed colour, then undo and check it's back

- [ ] `thumbnail-maker` - Thumbnail Maker: Make bold YouTube and TikTok thumbnails with big outlined text, glow and stickers.
  - acceptance: Sizes: YouTube 1280x720, TikTok/Shorts 1080x1920, square 1080x1080
  - acceptance: Add your picture (file/drop/paste, never uploaded); move, scale and rotate it; background colour or gradient
  - acceptance: Text layers: the kit fonts only (Space Grotesk, Inter, JetBrains Mono), size, colour, thick outline, drop shadow, glow, tilt
  - acceptance: Built-in stickers drawn in code (arrow, circle, "NEW!", emoji-style shapes); 4-6 starter templates
  - acceptance: Drag to move any layer (touch + mouse), layer list to reorder or delete; a "safe area" guide for where YouTube puts the timestamp
  - acceptance: Export PNG/JPG at full size
  - acceptance: Saves the layout (not your picture) through kit/save.js; Export/Import works
  - acceptance: Unit test (tests/unit): layout maths (fit/cover scaling, hit-testing a rotated layer)
  - acceptance: smoke.js: pick a template, change the text, check the canvas changed

- [ ] `file-converter` - File Converter: Convert images, data and audio files between formats, all on your device.
  - acceptance: Drop/choose/paste one or many files; it detects the type and offers only the formats that make sense
  - acceptance: Images: PNG, JPG, WebP, BMP, ICO in and out; several images into one PDF (a small PDF writer in plain JS)
  - acceptance: Data: CSV, JSON, XML, YAML (simple subset) in and out, with a table preview and clear errors for bad input
  - acceptance: Audio: anything the browser can decode (MP3, OGG, M4A, WAV) to WAV
  - acceptance: Batch download as one .zip (a small zip writer, store-only, in plain JS)
  - acceptance: A clear "can't do that here" note for video and for MP3 output
  - acceptance: Pure converters in their own modules (items/file-converter/csv.js, yaml.js, pdf.js, wav.js, zip.js)
  - acceptance: Saves settings only; Export/Import works
  - acceptance: Unit test (tests/unit): CSV with quotes and commas round-trips through JSON, the WAV header is right, the PDF and ZIP start with the right magic bytes
  - acceptance: smoke.js: paste a small CSV, convert to JSON, check the output

## Ideas (not ready yet)

- (add more here)

---

## Example lines, per wing

### 🎮 Arcade

- [ ] `snake-360` - snake that fits a phone held in one hand
  - acceptance: swipe on the stage AND arrow keys both steer
  - acceptance: on-screen pad shows on touch screens only
  - acceptance: best length saves; Export/Import works
  - acceptance: smoke.js: start, turn twice, length or score changes

### 🔬 Lab

- [ ] `pendulum` - drag a pendulum and watch energy swap between height and speed
  - acceptance: live energy bars (kinetic / potential)
  - acceptance: reduced motion: starts paused with a Play button
  - acceptance: a "what's going on" panel in 5 short bullets
  - acceptance: smoke.js: drag the bob, press Play, angle changes

### 🧰 Workshop

- [ ] `image-shrink` - make images smaller, entirely in your browser
  - acceptance: pick or drop a file; nothing is uploaded (no new origins)
  - acceptance: shows before/after size in a table
  - acceptance: download button gives the new file
  - acceptance: smoke.js: load a tiny test image, output is smaller
