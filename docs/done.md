# Done — FlipAid Closing Cockpit

Completed 2026-06-29. All six tasks from `docs/lefttodo.md` are finished.  
Golden Test passes after every task: `npm test` → 10/10, exit 0.

---

## Task 1 — Side-by-side PDF vs Parsed View (Buy/Sell tabs)

### What changed

| File              | Change                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/index.js` | Added `import fs from 'fs'` and `import path from 'path'` at top                                                                                                                                     |
| `server/index.js` | Added `app.use('/uploads', express.static('uploads'))` after `/data` static route                                                                                                                    |
| `server/index.js` | Added `POST /api/statements/:side` — receives uploaded file (multer memory storage), writes to `uploads/<propertyId>/<side>.<ext>`, returns `{ filePath }`                                           |
| `index.html`      | Added `persistStmt(side, f)` — async upload to `/api/statements/:side`, saves path to `OV._src[side].filePath`                                                                                       |
| `index.html`      | Added `withPdfViewer(sideKey, content)` — wraps parsed table in CSS Grid two-column layout when `filePath` is set; left column is `<embed>` (PDF) or `<img>` (image), right column is the line table |
| `index.html`      | `fileStmt()` and `dropStmt()` now call `persistStmt()` after attach                                                                                                                                  |
| `index.html`      | All three `$('#panel').innerHTML` calls in `renderClosing()` wrapped with `withPdfViewer()`                                                                                                          |
| `index.html`      | Added `.stmt-split` CSS grid and `.stmt-split-doc` sticky left panel styles                                                                                                                          |

### How to manually verify

1. Open a property → Buy-Side Closing tab.
2. Click "Attach" and upload a PDF statement.
3. The panel should split: PDF on the left (scrollable), parsed line table on the right.
4. Hard-refresh the page — the PDF should still appear (path persisted in `OV._src.buySide.filePath`).
5. Repeat on Sell-Side tab with a different file.

---

## Task 2 — Strict Mode-Gated Overwrite Pipeline

### What changed

| File         | Change                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html` | `iaActuals()` — added mode check at top: returns `{}` immediately for `Estimated`; skips sell-side for `Acquired`; processes both sides for `Sold` |
| `index.html` | `qbActuals()` — added `if(mode!=='Sold') return {};` guard at top so QB actuals only apply in Sold mode                                            |

### How to manually verify

1. Open a property that has both buy- and sell-side statements attached.
2. Set mode to **Estimated** → IA fields show only template estimates (no actuals from statements).
3. Set mode to **Acquired** → Purchase Cost and Lender Cost buckets reflect buy-side actuals; Sales Cost and Rehab stay as estimates.
4. Set mode to **Sold** → all buckets update from their respective sources; Golden Test numbers hold.
5. In console: `computeIA(effIA()).netProfit` → `34367.04`.

---

## Task 3 — QB Category: Single-Click Highlight vs Double-Click Filter

### What changed

| File         | Change                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `index.html` | Added `let _qbClickTimer = null`                                                                                   |
| `index.html` | `qbCatClick(c)` — now debounced 220ms; only sets `qbView.hi = c` (highlight), does not filter                      |
| `index.html` | Added `qbCatDblClick(c)` — cancels the single-click timer, toggles `qbView.filter`, clears `qbView.hi`, re-renders |
| `index.html` | Totals table HTML — added `ondblclick="qbCatDblClick('${jsq(c)}')"` on category rows                               |
| `index.html` | Ledger rows — tint/highlight logic tied to `qbView.hi` (not `qbView.filter`); filter hides non-matching rows       |

### How to manually verify

1. Open QB Accounting tab (mode = Sold, QB file uploaded).
2. **Single-click** a category row → matching ledger rows are tinted/highlighted; all other rows still visible. Header chip shows "Highlighting: <Category>".
3. **Double-click** a category row → ledger filters to only that category; "show all ✕" button appears.
4. Click "show all ✕" or double-click again → filter clears, all rows visible.
5. Single-click a different category while another is highlighted → highlight switches; no filter applied.

---

## Task 4 — Template-Formatted .xlsx Export

### What changed

| File                         | Change                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `templates/ia_template.xlsx` | New file — copied from the client's MASTER IA workbook (`15620 Ramona Rd , Apple Valley , CA 92307 .xlsx`); sheet named `IA`                                                                                                      |
| `server/index.js`            | Added `POST /api/export` — reads `templates/ia_template.xlsx` with SheetJS (`cellStyles: true`), mutates cell `.v`/`.t` in-place (preserves `.s` style objects), deletes `.f` formula field, streams result as `.xlsx` attachment |
| `server/index.js`            | Cell map covers 40+ cells: purchase/lender/rehab/resale line items, totals, metrics (B4–B59), loan sizing (F14–F21), dev-cost summary (E47–E52), escrow recon (G56–G58)                                                           |
| `index.html`                 | `exportXlsx()` replaced — now async; POSTs IA values object to `/api/export`; triggers browser download via Blob URL                                                                                                              |

### How to manually verify

1. Open a property in any mode → click "Export" button.
2. A `.xlsx` file downloads (filename: `<address>_IA.xlsx`).
3. Open in Excel — formatting, colors, and layout should match the MASTER IA template.
4. Cell B56 (Net Profit) = `34367.04` for the Bronson baseline.
5. All totals in the template should match the on-screen IA tab values.

---

## Task 5 — Supplemental / County Tax Accuracy

### What changed

| File               | Change                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------- |
| `data/ramona.json` | `taxInputs.annualTaxRatePct` changed from `1.10` to `1.14` (San Bernardino County actual rate including bonds)                        |
| `data/ramona.json` | `taxInputs.annualTaxRateSource` updated from "PLACEHOLDER" to the actual county source note                                           |
| `index.html`       | Added `effTax()` function — `Object.assign({}, D.taxInputs, OV.\_taxOvr                                                               |     | {})`— mirrors`effIA()` pattern for per-deal tax overrides |
| `index.html`       | Added `setTaxInput(key, val)` — writes to `OV._taxOvr`, calls `saveOV()` and `render('sell')`                                         |
| `index.html`       | `resaleTaxBlock()` uses `effTax()` instead of `D.taxInputs` so per-deal overrides apply                                               |
| `index.html`       | IA tab — added editable input fields for `annualTaxRatePct` and `priorAssessedValue` with APN/county assessor helper text and tooltip |

### How to manually verify

1. Open IA tab → scroll to Supplemental Tax section.
2. Annual Tax Rate % field should show `1.14` (not 1.10).
3. Edit the rate → supplemental tax recalculates immediately; change persists on refresh.
4. Edit Prior Assessed Value → supplemental updates to `(purchasePrice - priorAssessedValue) × taxFactor`.
5. Golden Test still passes: `npm test`.

---

## Task 6 — Test Harness (Golden Test in CI)

### What changed

| File                  | Change                                                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/calc.js`         | **New file.** Pure ES module exporting `computeIA(i, taxInputs)`, `transferTax()`, `daysBetween()`, `daysInMonth()`. Identical math to `index.html`; `taxInputs` is a second parameter (defaults to CA $1.10/$1000) so Node can call it without the browser `D` global |
| `index.html`          | `computeIA(i)` signature updated to `computeIA(i, taxInputs)` — when `taxInputs` is omitted it defaults to `D.taxInputs`; `D.taxInputs.transferTaxRatePer1000` reference replaced with local `ttRate` variable. All existing callers unchanged (no second arg needed)  |
| `test/golden.test.js` | **New file.** 10 assertions using `node:test` + `node:assert/strict`. Imports `src/calc.js` and `data/ramona.json` (no server, no DB)                                                                                                                                  |
| `package.json`        | `"test"` script changed from `"node --test"` to `"node --test test/golden.test.js"`                                                                                                                                                                                    |

### Assertions (all 10 must pass)

| Test                                | Expected      |
| ----------------------------------- | ------------- |
| Net Profit                          | `34367.04`    |
| Cash ROI                            | `11.91%`      |
| Cash IRR                            | `38.29%`      |
| Levered ROI                         | `48.04%`      |
| Levered IRR                         | `154.40%`     |
| Purchase (Acquisition) Cost         | `$440,781.12` |
| Financing (Lender) Cost             | `$22,457.00`  |
| Rehab Cost                          | `$36,259.23`  |
| Total Development Cost              | `$499,497.35` |
| Sales Cost / Gross Profit to Seller | `$533,864.39` |

### How to manually verify

```
npm test
```

Expected output: `# pass 10` · `# fail 0` · exit code 0.

Also verify from the browser console on the Bronson property (mode = Sold):

```js
computeIA(effIA()).netProfit; // → 34367.04
```

---

## Golden Test baseline (4595 Bronson, mode Sold)

These are the canonical acceptance numbers. Any formula change must keep all of them exact.

| Metric                              | Value                                                     |
| ----------------------------------- | --------------------------------------------------------- |
| Net Profit                          | **$34,367.04**                                            |
| Cash ROI                            | 11.91%                                                    |
| Cash IRR                            | 38.29%                                                    |
| Levered ROI                         | 48.04%                                                    |
| Levered IRR                         | 154.40%                                                   |
| Purchase (Acquisition) Cost         | $440,781.12                                               |
| Financing (Lender) Cost             | $22,457.00                                                |
| Rehab Cost                          | $36,259.23                                                |
| Total Development Cost              | $499,497.35                                               |
| Sales Cost / Gross Profit to Seller | $533,864.39                                               |
| Buy-Side foots (Due to Buyer)       | $2,894.22 _(live data — verify in Buy-Side tab)_          |
| Sell-Side net proceeds              | $118,184.86 _(live data — verify in Sell-Side tab)_       |
| Escrow recon diff                   | $281.60 _(live data — verify in QB Escrow Recon section)_ |
| QB Development-Cost total           | $530,403.30 _(live data — verify in QB tab)_              |

Need to change

1. /api/evaluate — sends the IA data to Claude and gets back an AI evaluation/analysis of the deal.
2. /api/ask — a Q&A endpoint where users can ask Claude questions about the deal.
3. /api/parse — parses uploaded closing statements (buy/sell) or QB files using Claude to extract and categorize line items (the AI-powered document parsing feature).
