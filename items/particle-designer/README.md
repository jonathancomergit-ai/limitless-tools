# Particle Designer

Design sparks, smoke, fire and magic effects with sliders, watch them live, then export them for your game.

For game makers who want an effect **without** fiddling in the engine first. **Made on this device, nothing is uploaded.**

| | |
|---|---|
| Slug | `particle-designer` (= the folder name) |
| Wing | Workshop |
| Save | `effect` (all the settings below), `at` (emitter spot, 0-1), `bg` (preview colour), `sheet` (frame size, frames, fps, see-through) |
| Added | 2026-10-10 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Preset (fire, smoke, sparks, magic, rain, explosion) | Tap it | <kbd>1</kbd> to <kbd>6</kbd> |
| Move the emitter | Drag or tap the preview | <kbd>Tab</kbd> to the preview, arrows (<kbd>Shift</kbd> = 40 px steps) |
| Burst | **Burst** | <kbd>B</kbd>, or <kbd>Space</kbd> / <kbd>Enter</kbd> on the preview |
| Pause / play | **Pause** | <kbd>P</kbd> |
| Change a setting | Drag a slider, tap Shape / Blend | <kbd>Tab</kbd>, then <kbd>←</kbd> <kbd>→</kbd> |
| Colours over life | Colour swatch, "At" and "Opacity" sliders, **Add colour**, ✕ | <kbd>Tab</kbd> to them |
| Background | The colour swatch under the preview | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Export / import | Tap the buttons | <kbd>Tab</kbd>, <kbd>Enter</kbd> |

## The settings

| Setting | Range | What it does |
|---|---|---|
| Rate | 0-400 / s | A steady stream |
| Burst | 0-300 | That many at once |
| Burst every | 0-5 s | Repeat the burst (0 = once, at the start or on **Burst**) |
| Lifetime | 0.1-6 s | How long each one lives |
| Lifetime random | 0-100% | Up to this much shorter |
| Emit area width / height | 0-600 / 0-400 px | Born anywhere in this box (0 × 0 = a point) |
| Speed min / max | 0-1000 px/s | Start speed, picked between the two |
| Direction | -180° to 180° | 0 = right, -90 = up, 90 = down |
| Spread | 0-180° | Either side of the direction |
| Gravity / Wind | ±1000 px/s² | Down (+) or up (-) / right (+) or left (-) |
| Drag | 0-1000 px/s² | Speed lost each second, never below 0 |
| Size at birth / at end, size random | px, 0-100% | A straight line from one to the other, each up to "random" smaller |
| Shape | circle, square, spark | Spark is a streak that points the way it moves (¼ as wide as long) |
| Blend | normal, additive | Additive adds light: good for fire and magic |
| Colour over life | 2-5 stops | Colour + opacity at a point of the life; blended in a straight line between stops |

## Exports

| Button | File | Notes |
|---|---|---|
| JSON | `<name>.particles.json` | The format below. **Import JSON** reads it back. |
| Scene (.tscn) | `<name>.tscn` | A Godot 4 `CPUParticles2D`. **Copy** puts the same text on the clipboard. |
| Sprite sheet PNG | `<name>-sheet-<size>px-<cols>x<rows>.png` | Square frames (64 / 128 / 256 px), left to right, top to bottom. See-through or on your background. |
| GIF | `<name>-<size>px.gif` | Same frames, on your background colour, loops forever. |

The sheet and GIF are a fixed clip: the same every time (seed 1). A stream is run for one lifetime first so it's full; a burst-only effect starts on its burst. The clip is zoomed to fit the frame (never more than 2×). A stream doesn't loop perfectly: the last frame doesn't flow into the first.

### JSON format

```json
{
  "format": "particle-designer",
  "version": 1,
  "name": "fire",
  "rate": 110, "burst": 0, "burstEvery": 0,
  "lifetime": 0.9, "lifetimeRandom": 0.4,
  "areaWidth": 34, "areaHeight": 6,
  "speedMin": 40, "speedMax": 95,
  "direction": -90, "spread": 14,
  "gravity": -70, "wind": 0, "drag": 20,
  "sizeStart": 28, "sizeEnd": 6, "sizeRandom": 0.4,
  "shape": "circle",
  "blend": "add",
  "colors": [
    { "at": 0, "color": "#fff3b0", "alpha": 1 },
    { "at": 0.25, "color": "#ffb52e", "alpha": 0.9 }
  ]
}
```

- Units: pixels, seconds, degrees. Names as in the settings table.
- `format` must be `"particle-designer"`. A newer `version` is refused.
- On import every number is clamped to its range, unknown keys are dropped, colour stops are sorted.

### Godot 4 mapping (`CPUParticles2D`)

**To use it:** save the text as `fire.tscn` in your project (or use the download), then drag it into a scene or instance it. Every resource is inside the file: no images needed.

| Here | Godot | Exact? |
|---|---|---|
| Rate + Lifetime | `amount = round(rate × lifetime)`, `lifetime` | Yes (rounded) |
| Lifetime random | `lifetime_randomness` | Yes, same formula |
| Burst | A node with `amount = burst`, `explosiveness = 1.0` | Yes |
| Burst every = once | `one_shot = true` | Yes |
| Burst every > 0 | not exported | **No**: Godot repeats a burst once per `lifetime`. Restart it from code (`restart()`) for another timing. |
| Rate **and** Burst | The stream node, plus a child node called `Burst` | Yes |
| Emit area | `emission_shape = 3` (rectangle), `emission_rect_extents` = half the width / height | Yes |
| Direction, Spread | `direction` (a unit vector), `spread` | Yes |
| Speed min / max | `initial_velocity_min` / `_max` | Yes |
| Gravity, Wind | `gravity = Vector2(wind, gravity)` | Yes (Godot's default 980 down is replaced) |
| Drag | `damping_min` = `damping_max` | Yes: same step order as Godot (gravity, damping, move) |
| Size | A 64 px white texture; `scale_amount_max` = biggest size ÷ 64, `scale_amount_min` = that × (1 - size random), `scale_amount_curve` = a straight line | Yes |
| Shape | `GradientTexture2D`: circle = radial, 64 × 64; square = solid, 64 × 64; spark = radial, 16 × 64, plus `particle_flag_align_y = true` | Close: the circle's edge is a little soft in Godot |
| Colour over life | `color_ramp` = a `Gradient` with the same stops | Yes (both blend in sRGB) |
| Blend additive | `material` = `CanvasItemMaterial`, `blend_mode = 1` (add) | Yes |
| Emitter spot, background | not exported | Move the node where you want it |

- The random numbers differ from Godot's, so it won't be the same particles, just the same effect.
- Godot spreads a stream evenly over each `lifetime`; here a steady rate does the same.
- Want a texture of your own? Replace `texture` and set `scale_amount_min` / `_max` to *size ÷ your texture's height*.

## How it works

| Part | Where |
|---|---|
| Settings, presets, simulation, drawing, JSON, Godot | `particles.js` (pure, unit tested) |
| Random | mulberry32, seeded: **same seed, same particles** |
| Preview | `kit/loop.js` + `kit/canvas.js`. Pauses itself when the tab is hidden. Up to 2,500 particles. |
| GIF | `gif.js` + `gif-worker.js`, **copied** from GIF Maker (kit/ stays the same) |
| Sheet | One canvas, each frame clipped to its cell, `toBlob("image/png")` |
| Saving | `kit/save.js`, 0.3 s after the last change. Export / Import / Delete in the save panel. |

## Reduced motion

The preview **starts paused** (Play to start it). While paused, every change shows a still of the effect in full flow, so you can still design without anything moving. No other animation.

## Smoke test

1. Phone taps **Sparks**; desktop presses <kbd>3</kbd>.
2. Moves the emitter: phone taps the preview; desktop uses <kbd>Shift</kbd> + arrows, then a mouse drag.
3. Changes **Rate** (phone: sets it to 250; desktop: <kbd>End</kbd> = 400). Checks the readout and that bright particles are on the canvas.
4. **Export JSON**: checks the file has the new rate.
5. **Scene (.tscn)**: checks `amount = rate × lifetime` and the spark alignment.
6. **Sprite sheet**: checks the PNG header and its size. Desktop also makes a **GIF** (`GIF89a` … `0x3B`).
7. **Import JSON** with rate 33: checks it's loaded.

## Notes

- Unit tests: `tests/unit/particle-designer.test.js` (same seed = same particles, JSON round-trip, colour gradient, Godot scene shape and mapping).
- Rain is wide (600 px): on a narrow preview it runs off the sides, which is the idea.
