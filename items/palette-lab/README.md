# Palette Lab

Build colour palettes, check text contrast, preview colour blindness and export for CSS, Godot or Aseprite.

For game makers, web makers and pixel artists. **Everything happens on this device.**

| | |
|---|---|
| Slug | `palette-lab` (= the folder name) |
| Wing | Workshop |
| Save | `palette`, `locks`, `mode`, `base`, `format`, `library` (saved palettes) |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| New palette | **Generate** | <kbd>Space</kbd> |
| Lock a colour | Tap its **Lock** | <kbd>1</kbd> to <kbd>5</kbd> |
| Edit a colour | Tap the hex, or the round picker | <kbd>Tab</kbd> to it, type, <kbd>Enter</kbd> |
| Pick a harmony | Tap Analogous / Complement / Triadic / From base | <kbd>Tab</kbd>, arrows |
| Export | **Copy** or **Download file** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Save to library | Name it, **Save** | <kbd>Enter</kbd> in the name box |

## What's on the page

| Part | What it shows |
|---|---|
| Swatches | 5 colours, dark to light. Locked ones get a white frame. |
| Text contrast | Every pair, as "Aa" text. Ratio + badge: **AAA** 7+, **AA** 4.5+, **Big** 3+ (large text only), ✕ fails. |
| Colour blindness | The palette as seen with protanopia, deuteranopia and tritanopia. |
| Export | CSS variables, JSON, GIMP/Aseprite `.gpl`, Godot `const PALETTE = [Color(...)]`. |
| Saved palettes | Your library, on this device. |

## How it works

All maths is in `color.js`:

| Thing | How |
|---|---|
| Contrast | WCAG 2 relative luminance. Black on white = 21:1. |
| Harmonies | Made in **OKLCH**, so lightness steps look even. Hue offsets per harmony. Out-of-screen colours lose chroma until they fit. |
| HSL | `rgbToHsl` / `hslToRgb` helpers. |
| Colour blindness | Machado, Oliveira & Fernandes (2009) matrices, severity 1.0, in linear RGB. |

## Reduced motion

Nothing animates. Button lifts are switched off by `kit.css`.

## Smoke test

1. Locks colour 2 (phone: tap, desktop: <kbd>2</kbd>).
2. Regenerates (phone: tap Generate, desktop: <kbd>Space</kbd>).
3. Checks 3+ colours changed and colour 2 stayed.
4. Checks 20 contrast pairs, 4 colour-blind rows and the export text.

## Notes

- Colours are painted with CSS custom properties set from JS (`el.style.setProperty`). The CSP allows that. There is no `style=""` in the HTML.
- Library holds up to 200 palettes.
- Unit tests: `tests/unit/palette-lab.test.js`.
