# SFX Maker

Make retro sound effects for games: coins, jumps, lasers, explosions. Tweak them, keep favourites, save as WAV.

For game makers who need a quick "bloop" without opening an audio app. **Made on this device, nothing is uploaded.**

| | |
|---|---|
| Slug | `sfx-maker` (= the folder name) |
| Wing | Workshop |
| Save | `current` (the sound you're on), `label`, `favourites` (name + settings) |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Play | **Play** or tap the waveform | <kbd>Space</kbd> |
| Preset (coin, jump, laser, boom, power-up, hit, blip) | Tap it | <kbd>1</kbd> to <kbd>7</kbd> |
| Randomize | **Randomize** | <kbd>R</kbd> |
| Mutate (same idea, a bit different) | **Mutate** | <kbd>M</kbd> |
| Change a slider | Drag it | <kbd>Tab</kbd>, then <kbd>←</kbd> <kbd>→</kbd> |
| Save a favourite | Type a name, **Save** | <kbd>Enter</kbd> in the name box |
| Export | **Export WAV** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |

## How it works

| Part | Where |
|---|---|
| The synth: oscillator, pitch slide, vibrato, attack / sustain / decay | `synth.js` (pure maths) |
| Waves | square (with duty), saw, sine, noise |
| Noise | a seeded random generator, so the **same settings give the same samples** |
| WAV | `encodeWav`: RIFF, PCM, 16-bit, mono, 44.1 kHz |
| Playing | Web Audio `AudioBuffer`. The `AudioContext` is only made **after a tap or key**. |
| Waveform | canvas, min/max per pixel column |

- Each preset tap makes a fresh variation (like sfxr).
- Hidden tab: the sound stops and the audio context is suspended.
- Downloads are blob URLs, freed a few seconds later.

## Reduced motion

The playhead line doesn't move across the waveform. Sound still plays.

## Smoke test

1. Phone taps **Laser**. Desktop presses <kbd>4</kbd> (Boom).
2. Checks the samples aren't silent, it played, and the wave is drawn (counts accent pixels).
3. **Export WAV**: checks the file starts `RIFF` … `WAVE`.
4. Saves a favourite and checks it's listed.

## Notes

- Sounds are capped at 4 seconds.
- Pitch slider is on a log scale (40 Hz to 2400 Hz), so it feels even.
- Up to 100 favourites.
- Unit tests: `tests/unit/sfx-maker.test.js` (same settings = same samples, WAV header).
