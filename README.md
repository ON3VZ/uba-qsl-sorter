# UBA QSL Sorter

Sort QSL cards for the UBA QSL bureau (Belgium) according to the official UBA sorting list.
Static web app for GitHub Pages: everything runs in the browser.

## Structure

| File | Purpose |
|---|---|
| `data/sorteerlijst.csv` | The UBA sorting list (prefix;country;bureau;remark) |
| `data/meta.json` | Version of the sorting list shown in the app |
| `index.html` | The app (Sort, Sorting list, Help) |
| `css/style.css` | Styling |
| `js/app.js` | User interface |
| `js/i18n.js` | Translations EN / NL / FR |
| `js/parsers.js` | Input: TXT, CSV, Excel, ADIF, Cabrillo |
| `js/sorter.js` | Sorting logic (no DOM) |
| `vendor/xlsx.full.min.js` | SheetJS 0.18.5 for Excel import and export (Apache 2.0) |
| `tests/sorter.test.js` | Tests (`npm test`, Node 18+) |

### Bureau column

- a packet code (e.g. `DL`, `G`, `KH6`): the card goes in that packet
- `USA`: sorted by the digit in the call (packets W1 ... W9, W0)
- `NONE`: no IARU QSL bureau, the app shows a warning
- `INVALID`: invalid prefix

## Updating the sorting list (new UBA version)

1. Open `data/sorteerlijst.csv` on github.com and click the pencil icon (Edit this file).
2. Change, add or remove rows. One row per line, fields separated by `;`.
   Ranges are written as `FROM-TO` (e.g. `DA-DR`, `KL7-KL8`). Keep the order of the PDF:
   that order also decides the order of the packets.
3. Open `data/meta.json` the same way and set the new `version` and `updated` date.
4. Click **Commit changes**. GitHub Pages publishes the new list within a few minutes.

## Running locally

The app loads `data/sorteerlijst.csv`, so it needs a web server (opening `index.html` as a file does not work):

```
python -m http.server 8000
```

Then open http://localhost:8000.
