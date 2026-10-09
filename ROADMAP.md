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

- [ ] `sprite-slicer` - Sprite Sheet Slicer: Drop in a sprite sheet, cut it into frames and preview the animation. Export the frames or a JSON map.
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
