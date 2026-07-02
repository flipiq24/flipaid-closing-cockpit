# Left To Do — FlipAid Closing Cockpit

Last audited: 2026-06-29. Cross-referenced against `DEVELOPER_HANDOFF.md` §14 and `FINISH_THE_APP.md`.
Run the Golden Test after every task (see `CLAUDE.md` for the exact numbers).

---

## 1. Side-by-side PDF vs Parsed View (Buy/Sell tabs)
**Source:** DEVELOPER_HANDOFF.md §14.2 · FINISH_THE_APP.md Phase 2.3

### What's missing
The uploaded statement file is held in `window.__stmtFiles[side]` (in-memory only — gone on refresh). There is no two-column layout showing the original PDF next to the parsed line table.

### What to build
1. **Persist the file beyond refresh.** Upload it to the server on attach: add `POST /api/statements/:side` (multer, same setup as `/api/parse`). Store the file on disk under `uploads/<propertyId>/<side>.<ext>`. Return the served path. Save that path in `OV._src[side].filePath` so it survives reload.
2. **Serve the stored file.** `app.use('/uploads', express.static('uploads'))` in `server/index.js`.
3. **Two-column layout in `renderClosing`.** When `OV._src[side].filePath` is set, replace the full-width panel with a CSS Grid two-column layout: left column = `<iframe src="...">` (or `<embed>` for PDFs, `<img>` for images); right column = the existing line table. Use `grid-template-columns: 1fr 1fr` and collapse to single column below 900 px.
4. **Acceptance:** Upload a buy-side PDF → PDF renders on the left, parsed lines on the right, survives hard refresh.

### Key files
- `index.html` — `renderClosing()` at line 794, `applyAttach()` / `fileStmt()` at lines 673–674, `srcState()` at line 728.
- `server/index.js` — add the new upload route above the existing static middleware.

---

## 2. Strict Mode-Gated Overwrite Pipeline
**Source:** DEVELOPER_HANDOFF.md §14.3 · FINISH_THE_APP.md Phase 2.5

### What's missing
`effIA()` (line 1255) overlays actuals from any attached statement regardless of the current mode. The spec requires strict bucket-level mode gating:
- **Estimated** — no actuals feed in at all.
- **Acquired** — only buy-side actuals overwrite Purchase Cost + Lender Cost buckets.
- **Sold** — sell-side actuals overwrite Sales Cost; QB actuals overwrite Rehab/Holding.

### What to build
1. In `iaActuals()` (line 1196), pass the current `mode` and skip sides that don't apply:
   - `Estimated` → return `{}` immediately (no actuals).
   - `Acquired` → only process `buySide`; skip `sellSide`.
   - `Sold` → process both sides normally.
2. In `qbActuals()` (line 1223), only apply when `mode === 'Sold'`.
3. Update `effIA()` accordingly — it already merges, just make it call the gated versions.
4. Confirm the Golden Test still holds (mode = Sold with both sides attached must not change).
5. **Acceptance:** flip to Acquired with only the buy-side attached → Purchase + Lender reflect the statement; Sales Cost and Rehab stay as IA estimates. Flip to Sold → all three buckets update.

### Key files
- `index.html` — `iaActuals()` at line 1196, `qbActuals()` at line 1223, `effIA()` at line 1255.
- Current mode is at `effIA().mode` or `D.ia.inputs.mode`.

---

## 3. QB Category: Single-Click Highlight vs Double-Click Filter
**Source:** FINISH_THE_APP.md Phase 1.2

### What's missing
Currently `qbCatClick()` (line 1831) toggles the **filter** on single-click. The spec distinguishes two gestures:
- **Single-click** → highlight (tint) all contributing ledger rows without hiding others.
- **Double-click** → filter the ledger to show only that category; click again or press "show all ✕" to clear.

### What to build
1. Change `qbCatClick(c)` to only set `qbView.hi = c` (highlight, no filter). Re-render.
2. Add `qbCatDblClick(c)` that sets `qbView.filter = (qbView.filter === c ? '' : c)` and clears `qbView.hi`. Re-render.
3. In the totals table HTML (line 2100), add `ondblclick="qbCatDblClick('${jsq(c)}')"` alongside the existing `onclick`.
4. In the ledger rows, apply the existing tint/highlight logic to `qbView.hi` (not `qbView.filter`).
5. **Acceptance:** single-click "Rehabilitation Costs" → rehab rows are tinted, all other rows still visible. Double-click → only rehab rows shown; "show all ✕" appears and clears it.

### Key files
- `index.html` — `qbCatClick()` at line 1831, totals table render at line 2097–2100, ledger row render at line 2099/2116, `qbView` at line 1803.

---

## 4. Template-Formatted .xlsx Export (looks like MASTER IA)
**Source:** FINISH_THE_APP.md Phase 2.4

### What's missing
The current `exportXlsx()` (line 2170) dumps raw data via SheetJS `aoa_to_sheet` — no formatting, no template. The spec requires filling the actual MASTER IA Excel template so the download looks like the client's workbook (blue title, gray bands, two-column layout).

### What to build
1. Add `npm i exceljs` to `package.json` (ExcelJS supports reading a template and writing into specific cells with styles preserved).
2. Place the template file at `templates/basic_ai_form.xlsx` (obtain from client — the "Basic AI Form" sheet of the MASTER IA workbook).
3. Add `POST /api/export` in `server/index.js`:
   - Body: the IA values object (sent from the client).
   - Server reads the template with ExcelJS, writes values into the cell map below, streams the result back as `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
4. In `index.html`, change the "Export" button to POST to `/api/export` and trigger a file download.
5. **Cell map** (key → cell on "Basic AI Form" sheet):

| IA key | Cell |
|---|---|
| purchasePrice | B4 |
| dueDiligence | B5 |
| insurance | B6 |
| escrowTitlePurchase | B8 |
| proratedPropTaxPurchase | B9 |
| r.totalPurchase | B10 |
| (1st loan lines) | B13–B19 |
| r.totalLender | B30 |
| estimatedRepairs | B32 |
| r.totalRehab | B34 |
| arv | B45 |
| (resale cost lines) | B46–B53 |
| r.resaleCosts | B54 |
| r.netProfit | B56 |
| r.cashOnCashROI | B57 |
| r.cashOnCashIRR | B58 |
| r.returnOnCash | B59 |
| r.returnOnCashAnnual | B60 |
| r.loan1st | F14 |
| (loan caps) | F15–F16 |
| r.shortFunds | F21 |
| r.f25equity | F25 |
| (dev-cost summary) | E48–E52 |
| (escrow recon) | G56–G58 |

6. **Acceptance:** download opens looking like the MASTER IA template with live numbers; cell B56 = 34367.04.

### Key files
- `server/index.js` — add the new `/api/export` route.
- `index.html` — `exportXlsx()` at line 2170; swap it to call the server endpoint.
- New: `templates/basic_ai_form.xlsx`.

---

## 5. Supplemental / County Tax Accuracy
**Source:** DEVELOPER_HANDOFF.md §14.6 · docs/TAX_LOGIC.md

### What's missing
`supplemental()` uses a placeholder annual tax rate (1.10%) and derives the prior assessed value as 60% of purchase price. The actual rate for APN 0440-071-20 (San Bernardino County) is ~1.14% with bonds, and the prior assessed value needs to come from the secured bill.

### What to build
1. In `data/ramona.json` → `taxInputs`, add:
   - `"annualTaxRatePct": 1.14` (replace placeholder 1.10).
   - `"priorAssessedValue": <value from the county secured bill>`.
2. Update `supplemental()` in `index.html` to read `i.annualTaxRatePct` and `i.priorAssessedValue` from the inputs (they may already be wired — confirm the function reads `taxInputs`).
3. Expose both as editable IA fields (like other `taxInputs`) so a user can update them per deal without touching JSON.
4. Add a tooltip pointing to the county assessor portal for the APN.
5. **Acceptance:** supplemental tax matches the physical secured bill for APN 0440-071-20. Golden Test numbers are unchanged (supplemental is already factored into the Bronson baseline).

### Key files
- `data/ramona.json` — `taxInputs` block.
- `index.html` — `supplemental()` function and the IA render block that shows tax lines.

---

## 6. Test Harness (Golden Test in CI)
**Source:** DEVELOPER_HANDOFF.md §14.7

### What's missing
`computeIA()` lives inside `index.html` and cannot be imported by Node. There is no test file.

### What to build
1. Extract `computeIA()` and its helpers (`daysBetween`, `ov`, `cSum`, etc.) into a new file `src/calc.js` as a plain ES module (`export function computeIA(i){...}`).
2. In `index.html`, replace the inline definition with `<script type="module">import {computeIA} from './src/calc.js';</script>` — or keep a copy and add a note that `src/calc.js` is the canonical source (simpler to avoid a build step).
3. Add `test/golden.test.js` using Node's built-in `node:test` (no extra dep) or Vitest:
   ```js
   import { computeIA } from '../src/calc.js';
   import deal from '../data/ramona.json' assert { type: 'json' };
   const r = computeIA(deal.ia.inputs);
   assert.strictEqual(r.netProfit, 34367.04);
   assert.strictEqual(+r.cashOnCashROI.toFixed(4), 0.1191);
   // ... all Golden Test values from CLAUDE.md
   ```
4. Add `"test": "node --test test/golden.test.js"` to `package.json`.
5. **Acceptance:** `npm test` exits 0 and prints all Golden Test assertions passing. Run it in CI (add `.github/workflows/test.yml` if needed).

### Key files
- `index.html` — extract `computeIA` and helpers.
- New: `src/calc.js`, `test/golden.test.js`.
- `package.json` — add `test` script.

---

## Priority Order

| # | Task | Effort | Value |
|---|---|---|---|
| 1 | Strict mode-gated overwrite pipeline (§2 above) | Small (logic only, no new UI) | High — closes a correctness gap |
| 2 | QB single-click highlight vs double-click filter (§3) | Small (UI tweak) | Medium — client spec item |
| 3 | Test harness (§6) | Medium (refactor + new file) | High — prevents regressions |
| 4 | Side-by-side PDF view (§1) | Large (file storage + layout) | Medium — usability |
| 5 | Template .xlsx export (§4) | Large (ExcelJS + template file needed) | Medium — client request |
| 6 | Supplemental tax accuracy (§5) | Small (data entry + confirm wiring) | Low — not blocking |
