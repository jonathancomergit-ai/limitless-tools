# File Converter

Convert pictures, data and sound between formats: PNG, JPG, WebP, BMP, ICO and PDF; CSV, JSON, XML and YAML; anything your browser can play to WAV. For anyone who needs "this file, but as that" without uploading it to a stranger's website.

**Your files never leave this device.** Nothing is uploaded.

| | |
|---|---|
| Slug | `file-converter` (= the folder name) |
| Wing | Workshop |
| Save | settings only: `targets` (last format you picked for each input type), `quality`, `background`, `icoSizes`, `icoSource`, `delimiter`, `jsonIndent`, `sampleRate`, `mono`. **Never your files.** |
| Added | 2026-10-09 |

## How to use

| Do this | Phone | Keyboard |
|---|---|---|
| Add files | Tap **Choose files** (or **Try a sample**) | <kbd>Tab</kbd> to it, <kbd>Enter</kbd>, or <kbd>Ctrl</kbd> + <kbd>V</kbd> |
| Paste text | Paste in the box, tap **Add to the list** | <kbd>Ctrl</kbd> + <kbd>V</kbd> in the box, <kbd>Tab</kbd>, <kbd>Enter</kbd> |
| Pick a format | Tap the **to** menu on the file | <kbd>Tab</kbd> to it, arrows |
| See a preview | Tap the file name | <kbd>Tab</kbd> to the name, <kbd>Enter</kbd> |
| Convert | **Convert all** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Download | **Download** on a file, or **Download all (.zip)** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |
| Pictures into one PDF | **N pictures → one PDF** | <kbd>Tab</kbd> to it, <kbd>Enter</kbd> |

## What converts to what

| In | Out | How |
|---|---|---|
| PNG, JPG, WebP, BMP, ICO, GIF, AVIF | PNG, JPG, WebP, BMP, ICO, PDF | Decoded with `createImageBitmap` (ICO: `ico.js` picks the biggest picture). Out: canvas `toBlob` for PNG / JPG / WebP, `bmp.js`, `ico.js`, `pdf.js`. |
| Several pictures | One PDF | One page a picture, each page the picture's size. |
| CSV, JSON, XML, YAML | Any of the others | Read into one plain JS value, written out again (`convert.js`). |
| MP3, OGG, M4A, FLAC, WAV… | WAV (16-bit) | `decodeAudioData` on an `OfflineAudioContext`, then `wav.js`. |
| Video | WAV of its sound | Same as audio. Video out: not possible (see below). |

Only formats that make sense are in each file's **to** menu. It remembers your last pick for each input type.

## Can't do that here

| What | Why |
|---|---|
| Video → video | Needs video encoders a web page can't use. |
| MP3 out | Needs an MP3 encoder; browsers don't ship one. WAV instead. |
| PDF, HEIC, Word, Excel in | Browsers can't open these by themselves. |

## The modules (pure, no DOM, unit tested)

| File | Does |
|---|---|
| `csv.js` | RFC 4180: quotes, `""`, commas and line breaks in quotes, CRLF / LF / CR, delimiter sniffing. Errors say the line. |
| `yaml.js` | A common subset: maps, lists, nesting, plain / quoted scalars, `[flow]` / `{flow}`, `\|` and `>` text, comments. YAML 1.2 types (`yes` stays text). Anchors, tags and several documents give a clear error. |
| `xml.js` | Own small parser + writer: elements, attributes, text, CDATA, entities, self-closing. Errors say the line. |
| `convert.js` | The data pipeline, table preview, settings, file names. Also finds where broken JSON breaks. |
| `pdf.js` | PDF 1.4: JPEG per page with `/DCTDecode`, correct xref offsets. |
| `wav.js` | 16-bit PCM WAV, interleaved, mono mix. |
| `ico.js` | ICO writer (PNG entries) + reader (PNG and old BMP-style entries, AND mask). |
| `bmp.js` | 24-bit BMP writer; see-through parts go on the background colour. |
| `detect.js` | Type from magic bytes, then MIME, then the name; which targets make sense. |
| `zip.js` | Store-only zip, copied from Image Squisher. |
| `worker.js` | Runs zip, WAV and PDF jobs in a module worker (falls back to the page if workers fail). |

### XML ↔ JSON

| XML | JSON |
|---|---|
| `<a>hi</a>` | `{ "a": "hi" }` |
| `<a x="1">hi</a>` | `{ "a": { "@x": 1, "#text": "hi" } }` |
| `<a/>` | `{ "a": "" }` |
| `<r><b>1</b><b>2</b></r>` | `{ "r": { "b": [1, 2] } }` |
| a top-level list | `<rows><row>…</row></rows>` |
| `"first name"` key | `<first_name>` |

Numbers and `true` / `false` are typed only when the text is exact (`"007"` stays text). One-item lists come back as a single value, and mixed text like `a <b>b</b> c` loses its order: XML is richer than JSON.

### Data → CSV

A list of objects is one row each. An object holding one list (like `<rows>`) uses that list. Anything else is one row. Nested values become JSON text in the cell.

## Reduced motion

Nothing moves. There is no animation at all.

## Smoke test

1. Pastes a 2-row CSV (a comma and `""` quotes inside fields) into the paste box. Checks it says **Looks like CSV**.
2. Adds it: phone taps **Add to the list**, desktop presses <kbd>Enter</kbd> on it. Checks the row and the table preview.
3. Picks **JSON**, presses **Convert all**.
4. Checks the output text parses to the right JSON.
5. Downloads it: the file holds the same JSON.
6. **Download all (.zip)**: the file starts with `PK\x03\x04`.

## Notes

| Case | What happens |
|---|---|
| Bad data | The row and the preview show the error, with its line number. |
| WebP out on old Safari | A clear "this browser can't make WebP" on that file. |
| Huge pictures | Scaled to fit 8192 px a side and 40 megapixels. |
| Data files | 30 MB at most. The preview shows the first 50 rows. |
| Sound sample rate | Chosen in Settings (44.1 kHz default); the browser resamples while decoding. |
| Plain `.txt` | Sniffed as CSV, JSON, XML or YAML; if it's none, the row says so. |

Unit tests: `tests/unit/file-converter.test.js` (CSV ⇄ JSON round trip, YAML and XML round trips and errors, the WAV header, PDF xref offsets, the zip, ICO and BMP headers, detection, settings).
