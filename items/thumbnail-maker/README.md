# Thumbnail Maker

Make bold YouTube and TikTok thumbnails: big outlined text, glow, stickers and your own picture. Download a full-size PNG or JPG.

**Your picture never leaves this device.** It isn't uploaded, and it isn't saved.

| | |
|---|---|
| Slug | `thumbnail-maker` (= the folder name) |
| Wing | Workshop |
| Save | the layout only: `layout` (size, background, every layer's text, font, colours, effects, place, size and tilt) and `guides`. For your picture only its spot is kept (place, scale, tilt, its width × height). **Never the picture.** |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Pick a size | **YouTube** / **TikTok / Shorts** / **Square** | <kbd>Tab</kbd> + arrows |
| Start from a template | Tap one (then **Undo** if you change your mind) | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Add your picture | **Choose a picture**, or drop it on the page | <kbd>Ctrl</kbd> + <kbd>V</kbd> pastes one |
| Pick a layer | Tap it on the thumbnail | Tap it in **Layers** (<kbd>Tab</kbd>, <kbd>Enter</kbd>, <kbd>↑</kbd> <kbd>↓</kbd>) |
| Move it | Drag it | Arrows on the thumbnail (<kbd>Shift</kbd> = 10 px) |
| Size and tilt | Two fingers, or the **Size** / **Tilt** sliders | <kbd>+</kbd> <kbd>−</kbd> and <kbd>,</kbd> <kbd>.</kbd> |
| Forward / back | **Forward** / **Back** | <kbd>]</kbd> / <kbd>[</kbd> |
| Hide / delete | **Hide** / **Delete** | <kbd>Delete</kbd> |
| Change words | Type in the **Text** field | same |
| Download | **Download PNG** / **Download JPG** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |

## What it does

| Part | How |
|---|---|
| Sizes | YouTube 1280 × 720, TikTok / Shorts 1080 × 1920, Square 1080 × 1080. The canvas is always full size; CSS shrinks it to fit. Switching size moves every layer with it. |
| Your picture | `createImageBitmap`, kept in memory. **Fit** shows all of it, **Cover** fills the frame. |
| Background | One colour, or a 2-colour gradient with an angle (CSS angles: 90° = left to right). |
| Text | Space Grotesk, Inter or JetBrains Mono (the kit fonts, nothing from outside). Fill, thick round outline drawn under the fill, size, tilt. Several lines are fine. |
| Effects | Drop shadow and glow (a coloured blur), on any layer. |
| Stickers | Arrow, circle, NEW! burst, shocked face, fire, star, heart, tick, cross. All drawn with canvas paths, no emoji font. |
| Templates | Big reveal, Top 10, Tutorial, Reaction, Versus, Shorts hook. Your picture stays. |
| Picking | Each layer is a rotated box; a tap picks the top-most one under the finger. |
| Safe area | YouTube: the video length box, bottom right. Shorts: the top bar, the side buttons, the title and caption. Only in the editor, never in the file. |
| Export | The same drawing, again, without the selection box or guide. `canvas.toBlob` → a download. |

Files: `layout.js` (pure maths), `templates.js` (data), `stickers.js` (sticker drawings), `render.js` (drawing), `main.js` (the page).

## Reduced motion

Nothing moves on its own. No animation at all.

## Smoke test

1. Taps (phone) or clicks (desktop) the **Top 10** template. Checks its text is in the Text field.
2. Types **BEST 5**. Checks the picture's fingerprint changed.
3. Drags that text: a real touch drag on the phone, the mouse on desktop. Checks it moved. Desktop also nudges it 10 px with <kbd>Shift</kbd> + <kbd>→</kbd>.
4. Clicks **Download PNG**. Checks the file is a 1280 × 720 PNG.

## Notes

| Case | What happens |
|---|---|
| Coming back later | Your layout is back. The picture's spot shows "Add your picture again"; add it and it lands in the same place. |
| A different picture in that spot | It keeps the same shown width. |
| Template over your work | **Undo** brings the last layout back. |
| Many layers | Up to 30. |
| Imported layout files | Every field is checked and clamped; unknown layers are dropped. |
| Safe-area boxes | Rough, on the safe side. The apps change their screens now and then. |

Unit tests: `tests/unit/thumbnail-maker.test.js` (fit / cover, rotated hit-testing at 0°, 45°, 90°, bounds, reorder, resize, gradient line, guides, layout checking, templates).
