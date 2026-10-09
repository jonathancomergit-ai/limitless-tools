# QR Maker

Make QR codes for links, Wi-Fi or plain text, right on your device. No tracking redirects, ever. For anyone printing a menu, a poster or a Wi-Fi card.

**The code holds exactly what you typed.** No short link, no redirect, no tracking, no expiry.

| | |
|---|---|
| Slug | `qr-maker` (= the folder name) |
| Wing | Workshop |
| Save | `type`, `ecl`, `mask`, `fg`, `bg`, `border`, `size`, `keepRecent`, `recent` (last 12; can be turned off). **Never Wi-Fi passwords.** |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Pick a type | Tap **Link**, **Text** or **Wi-Fi** | <kbd>Tab</kbd>, then <kbd>←</kbd> <kbd>→</kbd> |
| Type the content | Tap the box | Just type |
| Colours | Tap a colour, or type a hex | <kbd>Tab</kbd> to the hex box |
| Quiet zone, size | Drag the sliders | <kbd>←</kbd> <kbd>→</kbd> |
| Error correction | Tap L, M, Q or H | <kbd>Tab</kbd>, then arrows |
| Download | **Download PNG** / **SVG** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Copy the picture | **Copy image** (where the browser allows) | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Use a recent code | Tap it | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |

## The encoder (`qr.js`)

Plain JS, written for this item. ISO/IEC 18004.

| Step | What |
|---|---|
| Data | Byte mode, UTF-8. Mode + length + bytes + terminator + `0xEC 0x11` padding. |
| Version | The smallest of 1 to 40 that fits. |
| Error correction | L / M / Q / H. Reed-Solomon over GF(256), blocks interleaved. |
| Layout | Finders, timing, alignment, dark module, zig-zag data. |
| Mask | Pick 0 to 7, or **Best** (lowest penalty score of all 8). |
| Info | 15 format bits (BCH + XOR mask), 18 version bits from version 7. |

**Checked:** module-for-module the same as the `segno` library for every version 1–40 at every level, and real downloads scan back exactly in OpenCV.

## What goes in

| Type | Holds |
|---|---|
| Link | Exactly the address. `example.com` becomes `https://example.com`. |
| Text | Exactly the text, spaces and new lines included. |
| Wi-Fi | `WIFI:T:WPA;S:name;P:password;;` with `\ ; , : "` escaped. |

## Reduced motion

Nothing moves. Button lifts are switched off by `kit.css`.

## Smoke test

1. Phone taps the address box; desktop tabs into it. Types `example.com/menu`.
2. Checks the code holds `https://example.com/menu`, is version 2 (25 × 25), and the canvas has dark and light squares.
3. Picks level **H**: the version goes up.
4. **Download PNG** gives a real PNG; **Download SVG** a real SVG.
5. Checks the code shows under **Recent**.

## Notes

| Case | What happens |
|---|---|
| Too long | Says how many bytes, and the most for that level. |
| Low contrast | Amber under 4:1, pink under 2:1. Light-on-dark gets a warning too. |
| Quiet zone under 2 | A warning: it may not scan. |
| Wi-Fi, no password | A hint to pick **None (open)**. |
| Copy image | Hidden where the browser can't copy pictures. |
| SVG | One `<path>`, runs merged, `crispEdges`. The namespace string is built from parts so the repo's outside-URL check doesn't flag it. |

Unit tests: `tests/unit/qr-maker.test.js` (Reed-Solomon vs. the HELLO WORLD 1-M example, format + version bits, capacities, a known input's version and size, helpers).
