# Tilemap Painter

Load a tileset, paint a level on a grid with layers, and export it for Tiled or Godot. For game makers, on a phone or a computer.

**Your tileset never leaves this device.** Nothing is uploaded.

| | |
|---|---|
| Slug | `tilemap-painter` (= the folder name) |
| Wing | Workshop |
| Save | **the map**: size and every layer (name, shown, tiles as run-length text); **the tileset settings**: file name, picture size, `tileW`, `tileH`, `spacing`, `margin`; the **picture** only if its PNG is under 300 KB (else you're asked to add it again); and `tool`, `tile`, `grid` |
| Added | 2026-10-10 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Paint | Tap or drag on the map | Arrows move the map under the cursor, <kbd>Space</kbd> / <kbd>Enter</kbd> paints; hold <kbd>Space</kbd> + arrows to keep painting |
| Pick a tool | Brush, Box, Fill, Eraser, Pick | <kbd>B</kbd> <kbd>R</kbd> <kbd>F</kbd> <kbd>E</kbd> <kbd>I</kbd> |
| Box | Drag from corner to corner | <kbd>Space</kbd> at one corner, move, <kbd>Space</kbd> at the other (<kbd>Esc</kbd> cancels) |
| Choose a tile | Tap it under **Tiles** | <kbd>[</kbd> <kbd>]</kbd> anywhere, or arrows on the tile picker |
| Undo / redo | The arrow buttons under the map | <kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Y</kbd> or <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> |
| Zoom | Pinch, or **−** / **+** / **Fit** | Mouse wheel (or trackpad pinch), <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> on the map |
| Move around | Drag with two fingers | Arrows (<kbd>Shift</kbd> = 4 tiles), <kbd>Space</kbd> + drag, middle-button drag |
| Grid | **Grid** | <kbd>G</kbd> |
| Layers | Tap a name to paint on it, the eye to hide it; Add, Up, Down, Delete | <kbd>Tab</kbd> + <kbd>Enter</kbd> |
| Tileset | **Choose a tileset**, drop or paste a picture; **Use the sample** | <kbd>Tab</kbd> + <kbd>Enter</kbd> |
| Export / open | Tiled map, CSV, Map PNG, Tileset PNG; **Open a .tmj made here** (or drop it) | <kbd>Tab</kbd> + <kbd>Enter</kbd> |

## What it does

| Part | How |
|---|---|
| Sample | 32 tiles of 16 × 16 px (grass, water, bricks, coins, a chest…) drawn in code by `sample.js`, plus a 20 × 12 starter level on 3 layers (Sky, Ground, Decor). Works the moment it opens. |
| Tileset | Any picture up to 4096 px a side, read with `createImageBitmap` (or `<img>`). Tile size 4–256 px, spacing and margin 0–64 px (Tiled's meaning). Up to 4096 tiles; left-over pixels are pointed out. |
| Map | 1 to 256 tiles a side, and at most 4096 px a side as a picture. Resize keeps the top-left; **New empty map** starts over. Both can be undone. |
| Tools | Brush (fills the gaps of a fast drag), filled box, 4-way flood fill on the chosen layer, eraser, eyedropper (the top tile you can see). |
| Layers | Up to 8: add, delete, up / down, show / hide. Hidden layers are left out of the view and the Map PNG, but are still exported (hidden) to Tiled. |
| Undo | Up to 200 steps. A stroke stores only the cells it changed; layer, size and import changes store whole maps. |
| View | One canvas. The visible layers live in a 1:1 picture that's patched cell by cell, then scaled with smoothing off. Fit snaps to whole device pixels. The grid shows once tiles are 6 px or more. |
| No picture | If the tileset picture isn't here (too big to save, or a .tmj that names another file), each tile shows as a colour from its number until you add it. |

## Exports

| File | What's in it |
|---|---|
| `tilemap.tmj` | A Tiled JSON map: `orientation: orthogonal`, `renderorder: right-down`, finite, one `tilelayer` per layer (bottom first), and **one embedded tileset** (`firstgid: 1`) whose `image` is the picture's **file name**. Cells are gids: **0 = empty, tile n = n + 1**. Opens in Tiled 1.x. |
| `tilemap-<layer>.csv` | The chosen layer, one line per row, like Tiled's own CSV export: tile numbers **from 0, −1 = empty**. |
| `tilemap.png` | The visible layers at 1 px per pixel. |
| Tileset PNG | The tileset picture under the name the .tmj uses (`sample-tiles.png` for the sample). |

**Keep the .tmj and the tileset picture in one folder**, or Tiled can't find the tiles.

**Open a .tmj made here** reads it back: tile size, spacing, margin and every tile layer. It also opens most Tiled maps: groups are opened up, flipped tiles come in unflipped, plain base64 layers work. Not: infinite maps, compressed layers, external `.tsx` tilesets, isometric or hex maps. It says which. If the .tmj names a different picture, it asks you to add it.

## Godot 4

Godot 4 doesn't read Tiled files by itself. Two ways in:

**A. With an importer add-on (easiest)**

1. In Godot: **AssetLib** → search **YATI** (Yet Another Tiled Importer) → Download → Install.
2. **Project → Project Settings → Plugins** → enable it.
3. Copy `tilemap.tmj` **and** the tileset PNG into one folder of your project.
4. Godot imports the .tmj as a scene with a `TileMapLayer` per layer. Drag it into your level.

**B. By hand, with the CSV**

1. Add a `TileMapLayer` node. In **Tile Set**, make a **New TileSet** with your tile size.
2. In the **TileSet** panel, drag in the tileset PNG as an **Atlas**. Set **Texture Region Size** = tile size, **Separation** = spacing, **Margins** = margin.
3. Put the CSV in the project and fill the layer from it:

```gdscript
extends TileMapLayer

@export_file("*.csv") var csv_path := "res://tilemap-ground.csv"
@export var columns := 8   # tiles across your tileset picture

func _ready() -> void:
    var rows := FileAccess.get_file_as_string(csv_path).strip_edges().split("\n")
    for y in rows.size():
        var cells := rows[y].split(",")
        for x in cells.size():
            var id := int(cells[x])
            if id >= 0:
                set_cell(Vector2i(x, y), 0, Vector2i(id % columns, id / columns))
```

One `TileMapLayer` and one CSV per layer.

## Reduced motion

Nothing animates in this tool. The one smooth scroll (the current-tile button jumping to **Tiles**) is instant when reduced motion is on.

## Smoke test

1. Picks the brick tile: phone taps it in the picker, desktop presses <kbd>]</kbd> three times.
2. Paints three empty Decor cells: phone taps them; desktop clicks one, then <kbd>→</kbd> <kbd>Space</kbd>, <kbd>→</kbd> <kbd>Enter</kbd>.
3. Undo + redo (buttons / <kbd>Ctrl</kbd> + <kbd>Z</kbd>, <kbd>Ctrl</kbd> + <kbd>Y</kbd>); desktop checks <kbd>F</kbd> and <kbd>B</kbd>.
4. Exports `tilemap.tmj` and reads it: orthogonal, finite, the sample tileset embedded with `firstgid: 1`, and gid 4 in those three cells.
5. Phone: the Map PNG has PNG bytes. Desktop: the layer CSV has `3,3,3` in row 2.

## Notes

| Case | What happens |
|---|---|
| Two fingers land mid-stroke | The stroke is undone and it becomes a pinch / pan. |
| Painting on a hidden layer | It works, with a note that the layer is hidden. |
| Tile size made bigger than the map allows | Refused, with the biggest map size that would fit. |
| Tileset shrinks under a painted map | Cells past the last tile show as colours and are written as empty in the .tmj. |
| A broken or foreign save / .tmj | It says why and changes nothing. |

Unit tests: `tests/unit/tilemap-painter.test.js` (flood fill, tileset grid, the .tmj shape and reading it back, CSV round-trip, undo / redo and its cap, layers, resize, the save format).
