# FlipAid Closing Cockpit — Developer Handoff

**Repo:** `flipiq24/flipaid-closing-cockpit`  ·  **Canonical branch:** `master`  ·  **Last verified commit:** `83c292e`

This document is everything a developer needs to finish this app to 100%. Read sections 1–6 before touching code. Section 12 (the Golden Test) is the acceptance bar — **any change must keep those numbers exact.** Section 14 is the remaining work.

---

## 1. What this app is

A **four-tab "Closing Cockpit"** for real-estate fix-and-flip deals. One deal at a time. The four tabs:

1. **Investment Analysis (IA)** — the underwriting model. A faithful port of the client's "MASTER IA" Excel workbook. Decides whether to buy and projects profit. Every field from the Excel is present; nothing is summarized or hidden.
2. **Buy-Side Closing** — the purchase settlement statement (HUD-1/ALTA), normalized into a line table with Category / Sub-category dropdowns + confidence scores.
3. **Sell-Side Closing** — the resale settlement statement, same structure. Works for **any escrow company** (they differ in format; we normalize to one schema).
4. **QB Accounting** — the QuickBooks ledger view used to reconcile actual costs.

**The core idea (the whole point of the app):** the IA starts as an **estimate**; as the deal progresses, **actual** closing/QB data flows in and reconciles against the estimate. Mode drives this: `Estimated → Acquired → Sold`. See §9.

**Non-negotiable product rules** (the client is emphatic about these):
- **Never summarize or hide fields.** The IA must show every line from the Excel.
- **All fields are editable except auto-computed totals** (totals are read-only and recompute).
- **The math must match the Excel 100%.** Do not change a formula without re-running the Golden Test (§12).

---

## 2. Tech stack & how to run

- **Frontend:** a single file, `index.html` (~100 KB). Vanilla JS, no framework, **no build step**. All state, render, and the calc engine live here.
- **Backend:** `server/index.js` — Express (ESM). Serves the static site and three AI endpoints. Node 20.
- **Data:** `data/ramona.json` — the current deal (named "ramona" for legacy reasons; it currently holds the **4595 Bronson** deal).
- **AI:** `@anthropic-ai/sdk`. Requires env var **`ANTHROPIC_API_KEY`**.

### Run locally
```bash
npm install
ANTHROPIC_API_KEY=sk-... npm start      # node server/index.js, serves on PORT (default in code)
```
Open the served URL. The app `fetch`es `./data/ramona.json` at boot.

### Run on Replit
`.replit` runs `PORT=5000 npm start` and exposes port 5000 → 80. The webview is the app. Set `ANTHROPIC_API_KEY` in Replit Secrets.

> There is **no compile/bundle**. Editing `index.html` or `data/ramona.json` + refreshing the page is the full dev loop. `boot()` only re-fetches data; **a hard refresh (Ctrl-Shift-R) is required to load changed JS.**

---

## 3. Repo layout

```
index.html              # the entire frontend (UI + state + calc engine)
server/index.js         # Express server + /api/evaluate, /api/ask, /api/parse
data/ramona.json        # the current deal (IA inputs, buy/sell statements, taxonomy, tax inputs)
docs/                   # this handoff + TAX_LOGIC.md
scripts/post-merge.sh   # Replit post-merge hook
package.json            # start = node server/index.js  (type: module)
.replit                 # Replit run config (PORT=5000 npm start)
```

---

## 4. ⚠️ CRITICAL: GitHub ↔ Replit sync (read this first)

This is the #1 source of pain on this project. **GitHub `origin/master` is the single source of truth.** A Replit AI Agent has historically auto-committed and **force-pushed over good commits**, causing the app to silently regress (old labels, broken math) while appearing "updated."

**Rules:**
1. **Treat GitHub `origin/master` as canonical.** Do all real work against it.
2. **Stop / disable the Replit Agent** before syncing. If it runs, it can clobber GitHub.
3. To make Replit match GitHub:
   ```bash
   # git is not on Replit's shell PATH — wrap it:
   nix-shell -p git --run "git fetch origin && git reset --hard origin/master && git log --oneline -1"
   ```
   The printed commit **must** match the intended HEAD. Then hard-refresh the webview.
4. If you see `index.lock` errors: `rm -f .git/index.lock` then retry.
5. Never `git reset --hard` when local has unpushed work you want. Recover with `git reflog` if you do.

**How to know you're on a stale build:** the IA Net Profits metrics are labeled **Cash ROI / Cash IRR / Levered ROI / Levered IRR** in the canonical build. If you see "Cash-on-Cash ROI / ROI (incl. finance cost)", you're on an old/agent build.

---

## 5. Data model — `data/ramona.json`

Top-level keys: `deal`, `taxonomy`, `taxInputs`, `buySide`, `sellSide`, `ia`.

```jsonc
{
  "deal":   { "id", "address", "apn", "county", "status", "_statusOptions", "notes", "mode" },
  "taxonomy": { /* category → [sub-categories] map used by the dropdowns; see §10 */ },
  "taxInputs": { "transferTaxRatePer1000": 1.10, "semiAnnualBill": 2783.27, ... },

  "buySide":  { "title","escrowCompany","status","date","closingDate","property","party","role","escrowNo","lines":[ ... ] },
  "sellSide": { /* same shape as buySide */ },
  // each line: { "label" (or "desc"), "debit", "credit", "category", "sub", "conf" }

  "ia": {
    "address", "modeOptions": ["Estimated","Acquired","Sold"], "financingOptions",
    "inputs": { /* ALL IA fields — see §7. This is the object computeIA() consumes. */ }
  }
}
```

**Key point about `ia.inputs`:** it holds raw inputs (e.g. `purchasePrice`, `interestRate1st`, `arv`) **and** override keys prefixed `ov_` (e.g. `ov_escrowTitleResale`) and `customLines`. `computeIA()` reads from this object (via `effIA()`, §7).

---

## 6. App state & persistence

- **`D`** (global) = the parsed `ramona.json`, loaded once by `boot()`. **Module-scoped (not on `window`)** — to inspect it in console use the helper fns (`effIA()`, `computeIA(effIA())`), not `window.D`.
- **`OV`** (global) = user overrides, persisted to **localStorage** (key `LS`). Saved via `saveOV()`. Structure:
  - `OV._ia` — IA input overrides (mirrors edits to `D.ia.inputs`).
  - `OV._src[side]` — attached statement (file/link) per side (`buySide`/`sellSide`/`qb`).
  - `OV._add[side]` — user-added closing lines per side.
  - `OV._qbManual` — manual QB ledger rows.
  - `OV[lineKey]` — per-line edits (`{debit, credit, category, sub, ...}`).
  - `OV._modeAck` — which mode-change prompts have been dismissed.

> Persistence is **client-side only** today. There is no DB. Multi-device / shared notes will need a server store (see §14.1).

---

## 7. The calc engine — `computeIA(i)`

`computeIA(i)` is a **pure function**: input the IA inputs object, output a result object `r` with every derived figure. It is a line-by-line port of the MASTER IA Excel; **Excel cell refs are in the code comments** (e.g. `// B10`, `// F14`, `// B55`).

- **`effIA()`** returns the effective inputs = `D.ia.inputs` merged with `iaActuals()` (values derived from an attached/parsed statement). Always render with `r = computeIA(effIA())`.
- **Override layer:** `ov(key, computedDefault)` returns `i['ov_'+key]` if the user set it, else the computed default. This is how derived line items become hand-editable while totals still recompute.
- **Custom lines:** `cSum('purchase'|'rehab'|'lender1'|'lender2'|'gross'|'reserves')` sums user-added lines into the right bucket.

### Formula map (must stay exact — see §12)

| Result (`r.`) | Excel | Formula |
|---|---|---|
| `days` / `months` | F6 / E2 | `daysBetween(coeDate,eomDate)` / `days/30` |
| `totalPurchase` | B10 | purchasePrice+dueDiligence+insurance+cashForKeys+escrowTitlePurchase+proratedPropTaxPurchase+cSum('purchase') |
| `loan1st` | F14 | `overrideLoanAmt ?? min(0.75×ARV, 0.90×allInCost)`; allInCost = totalPurchase+repairs+utilities+cSum('rehab') |
| `moPayment` | F17 | loan1st × interestRate1st / 12 |
| `shortFunds` | F21 | loan1st − repairs − loan1st×points1st − estLoanFees1st − **additional1stPayments** |
| `cashInclPayments` | F9 | moPayment × (months × 1.25) |
| `cashToClose` | F10 | totalPurchase − shortFunds |
| `totalLender` | B30 | Σ 1st-loan lines (B13–B19) + Σ 2nd-loan lines (B23–B29) |
| `totalRehab` | B34 | estimatedRepairs + utilitiesRehab |
| `miscLessInterest` | E50 | roiAdjustments + miscellaneousCosts + supplemental + hoaMonthly×months + cSum('rehab') |
| `resaleCosts` | B46–B52 | escrowTitleResale+transferTaxResale+proratedTaxResale+concessions+buyersComm+listingComm+perDiem+assetMgmt+cSum('gross') |
| `grossProfit` | B53 | ARV − resaleCosts |
| `totAcq / hardMoney / rehabCost` | E47/E48/E49 | totalPurchase / totalLender / totalRehab |
| `totalDevCost` | E51 | totAcq + hardMoney + rehabCost + miscLessInterest |
| **`netProfit`** | **B55** | **grossProfit − totAcq − hardMoney − rehabCost − miscLessInterest** |
| `cashOnCashROI` ("Cash ROI") | B56 | (netProfit + totalLender) / (totAcq + rehabCost) |
| `cashOnCashIRR` ("Cash IRR") | B57 | cashROI / days × 360 |
| `f25equity` | F25 | cashInclPayments + cashToClose + estimatedRepairs×0.25 |
| `returnOnCash` ("Levered ROI") | B58 | netProfit / f25equity |
| `returnOnCashAnnual` ("Levered IRR") | B59 | leveredROI / days × 360 |
| `cashOutEscrow` | G56 | grossProfit − loan1st − add'l1st − unused1st − int1stPayoff − (totalCashAndReserves + loan2nd) |

**Escrow recon "Cash to Seller at Close" (MASTER IA G55):** `grossProfit − loan1st + holdback − additional1stPayments + unused1stCredit`, where `holdback` = the sell-side "Construction Holdback Release" credit. Rendered in Net Profits only when `mode==='Sold'` (see §9).

> **Sign note / known wart:** in this deal `unused1stCredit` is stored as **−240** so the lender formula (`− unused1stCredit`) *adds* 240 to match the Excel, which treats B18 as a positive addition. If you generalize the parser, fix this sign convention rather than copying the hack.

---

## 8. The four tabs (render functions)

`render(tab)` dispatches on `tab ∈ {ia, buy, sell, qb}`. `renderActive()` re-renders the current tab.

- **`renderIA()`** — builds the IA sheet: Total Purchase, Lender Cost, Rehab, Gross Profits (resale lines left, **Total Development Cost** summary right, bottom-aligned so its total lines up with "Gross Profit to Seller"), **Net Profits** (Net Profit + the 4 metrics in the value column, + the Sold-mode escrow-recon box on the right), and the AI Assistant & Notes block. `renderSumBand()` draws the sticky summary strip at the top.
- **`renderClosing(sideKey, tabKey)`** — the universal settlement-statement renderer for both buy & sell. Groups lines into sections, each line has Description / Debits / Credits / Category / Sub-category / Confidence. Foots to a balancing line ("Due to Buyer" / "Net proceeds to Seller"). Upload/drop a statement via `uploadCard` → `applyAttach` → `tryParse` (server parse).
- **`renderQB()`** — the QuickBooks ledger + reconciliation (`qbRecon()`). Manual rows via `qbManual()`. **Note:** uploading a file on the QB tab must attach as side `'qb'` and must NOT switch the view to the sell-side statement (this was a bug; keep it fixed).
- **Source links:** `srcLink(meta, val)` renders the `↗` arrow next to IA fields that map to a closing line (`meta.src = ['buySide'|'sellSide', lineIndex]`). `gotoSource(side, idx)` switches tabs, scrolls to the line, and applies a **persistent** yellow highlight (`.hilite`) that stays until you jump to another source. Do not reintroduce a timeout that clears it.

---

## 9. Mode state-machine (Estimated → Acquired → Sold)

`D.ia.inputs.mode` ∈ `modeOptions`. This is the **central logic** of the app:

- **Estimated** — manual inputs + Excel formulas. Pure projection.
- **Acquired** — the buy-side actual closing overwrites **Total Purchase + Financing only**. Rehab & gross profit stay estimates.
- **Sold** — the sell-side closing overwrites **Gross Profits**; QuickBooks overwrites **Rehab/Holding**. The **escrow reconciliation** appears in Net Profits (Cash to Seller at Close vs Sell-Side from escrow + Diff).

**Important — current limitation:** the mode-based **display** is built (effIA/iaActuals merge actuals from an attached statement; the Sold-mode recon renders). But the full **auto-overwrite pipeline as a live data flow is NOT complete** — see §14.3. Today, "manual values stay until an actual closing statement with real data is ingested, then the actual updates it" is only partially wired.

`maybeModePrompt()` / `showModePrompt()` nudge the user to upload the relevant statement when mode changes.

---

## 10. Taxonomy (Category / Sub-category)

`taxCats()` returns the category → sub-category map (from `data.taxonomy`, IA-aligned). Categories:
`Total Purchase Cost`, `Lender Cost – 1st Loan`, `Lender Cost – 2nd Loan`, `Rehabilitation Costs`, `Misc Costs`, `Gross Profits`, **`Financing (profit-neutral)`** (loan proceeds / payoff / holdback — nets to zero, never hits profit).

Side filter: buy-side shows Purchase + Loans + Financing; sell-side shows Loans + Gross Profits + Financing. `dontMapCat` / `dontMapSub` provide a "Don't Map" option (used e.g. to avoid double-counting taxes). Each closing line carries a **confidence score** (`conf`) shown as a colored badge (`badge()`).

CA tax logic (`resaleTaxBlock()`, `transferTax()`, `countyProration()`, `supplemental()`) is documented in `docs/TAX_LOGIC.md`.

---

## 11. Server / AI endpoints (`server/index.js`)

- `app.use(express.static('.'))` — serves `index.html` + `data/`.
- **`POST /api/evaluate`** — sends the deal to Claude for an evaluation/comments.
- **`POST /api/ask`** — the "Ask AI" / "Find discrepancies" assistant. Body includes `{deal, ia, qb, question}`. The AI **never mutates the form** — it answers; the user applies changes.
- **`POST /api/parse`** (multer `upload.single('file')`) — receives an uploaded statement (PDF/image/doc), sends to Claude, returns normalized lines. **This is where the multi-company parser lives — see §14.4.**

All three require `ANTHROPIC_API_KEY`. Model: use the latest Claude (e.g. `claude-opus-4-8` or `claude-sonnet-4-6`).

---

## 12. 🎯 THE GOLDEN TEST — 4595 Bronson (acceptance bar)

The app currently carries the **4595 Bronson** closed deal as the reference. It was reconciled to the client's workbook **"4595 Bronson … (7).xlsx"** to the penny. **After ANY change, these must still hold (mode = Sold):**

**Investment Analysis**
| Figure | Value |
|---|---|
| Total Acquisition Cost | $440,781.12 |
| Financing Costs | $22,457.00 |
| Rehab Costs | $36,259.23 |
| Miscellaneous Costs | $0.00 |
| Total Development Cost | $499,497.35 |
| Gross Profit to Seller | $533,864.39 |
| **Net Profit** | **$34,367.04** |
| Cash ROI | 11.91% |
| Cash IRR | 38.29% |
| Levered ROI | 48.04% |
| Levered IRR | 154.40% |

**Buy-Side Closing:** credits $483,545.45 − debits $480,651.23 = **Due to Buyer $2,894.22**

**Sell-Side Closing:** credits $590,000.00 (sale $563,000 + Construction Holdback Release $27,000) − debits $471,815.14 = **Net Proceeds $118,184.86**

**Escrow Reconciliation (Net Profits, Sold mode):** Cash to Seller at Close **$118,466.46** · Sell-Side from escrow **$118,184.86** · **Diff $281.60**

> If a refactor breaks any of these, it's wrong. These numbers are the contract.

---

## 13. How to verify a change

No test runner exists yet (add one — see §14.7). Until then:

1. Load the app, set deal mode to **Sold**, open the IA tab.
2. Check the figures in §12 to the penny.
3. In the browser console you can compute headlessly:
   ```js
   const r = computeIA(effIA());
   console.log(r.netProfit, r.cashOnCashROI, r.returnOnCash);   // 34367.04, 0.1191, 0.4804
   ```
4. Check buy/sell foot, and the escrow recon box.

---

## 14. Remaining work to reach 100%

In rough priority order. Each is scoped so it can be picked up cold.

### 14.1 AI Assistant & Notes on all four tabs, with ONE connected conversation
- Today the **AI Assistant & Notes** block (textarea + Ask AI / Find discrepancies / Post note + posts log) renders only at the bottom of the **IA** tab (built in `renderIA`; posts via the log; see `renderLog()` and `askAI()`/`findDiscrepancies()`).
- **Required:** render the same block at the bottom of **Buy-Side, Sell-Side, and QB** tabs too, and make the **conversation/notes log shared across all four tabs** (one thread — a note posted on Sell-Side shows on IA). 
- **Implementation:** extract the block into a reusable `renderNotes(tabKey)` and append it in `renderClosing` and `renderQB`. Store posts in a single array keyed by deal (not per tab). Each post: `{ts, tab, author:'user'|'ai', text}`. Persist server-side per deal so it survives refresh and is the same on every tab (extend `server/index.js` with `GET/POST /api/notes`), or at minimum a single `OV._notes` array in localStorage. Show the originating tab as a small label on each post.

### 14.2 Side-by-side PDF vs. system view (Buy/Sell tabs)
- The uploaded statement file is held in `window.__stmtFiles[side]` (and attach metadata in `OV._src[side]`).
- **Required:** in Buy-Side/Sell-Side tabs, show the **original PDF on one side and the parsed system line-table on the other**, so the user can compare. Use an `<iframe>`/`<embed>` (or pdf.js for images/robustness) for the file next to the existing table; make it a responsive two-column layout that collapses on narrow screens. Persist the file (currently it's only in memory — survives until refresh); to keep it after refresh, upload to the server and store a path, or use IndexedDB.

### 14.3 Complete the closing → IA overwrite **pipeline** (the core logic)
- Today actuals merge via `iaActuals()`/`effIA()` for display, and the Sold recon renders, but the **mode-driven overwrite is not a full live data flow.**
- **Required:** wire it explicitly:
  - **Acquired:** buy-side actual overwrites **Total Purchase + Financing** (only), leaving rehab & gross as estimates.
  - **Sold:** sell-side actual overwrites **Gross Profits**; QB overwrites **Rehab/Holding**.
  - Rule: *manual values persist until an actual statement with real data is ingested, then the actual updates it* — and the override layer must let the user re-edit.
- Keep the Golden Test (§12) passing throughout.

### 14.4 Format-agnostic statement parser (multi-company)
- `POST /api/parse` must reliably turn **any** escrow company's statement (First American, Diamond Quality, etc. — they differ in headers/layout) into the **same normalized line schema** (`{label, debit, credit}` + suggested `category`/`sub`/`conf`).
- Add a `normalizeLines()` step and strong parse instructions; the prior version of this was lost in a sync incident and needs rebuilding. Validate against the two statements in the Bronson deal (must reproduce the §12 foots).

### 14.5 "Match / Source" reconciliation indicator (requested feature)
- Per value, show its **source** (IA / Buy-Side / Sell-Side / QB) and whether the sources **agree** (✓ 100%) or differ (flag + the $ difference). Purpose: prove QB ↔ IA ↔ Buy ↔ Sell stay consistent and that closing data fed back into the IA.
- The client did **not** want this as decorative "green bubbles." Design as a compact per-line tag and/or a single reconciliation panel — confirm the exact UI with the client before building.

### 14.6 Supplemental / county tax accuracy
- `supplemental()` uses a placeholder rate + prior-assessed value. Wire real county assessor data per APN (tooltip already references the county source). Not blocking, but needed for new deals.

### 14.7 Add a real test harness
- Add a tiny Node test (or Vitest) that imports the calc logic and asserts the §12 numbers. Right now `computeIA` lives inside `index.html`; consider extracting it to a small ES module imported by both the page and the test, so the Golden Test runs in CI.

---

## 15. Conventions & gotchas

- **Single file, no build.** Don't introduce a bundler unless you also update `.replit`, `package.json`, and the run docs. Keep `computeIA` readable and comment Excel cell refs.
- **Don't change a formula without re-running §12.** The client has repeatedly (and correctly) rejected silent math changes.
- **The 4 metrics are exactly four:** Cash ROI, Cash IRR, Levered ROI, Levered IRR — single % column, rendered under the Net Profit dollar value. Do not add a 5th or duplicate columns.
- **Transfer tax lives once** — as a sell-side cost in Gross Profits (`r.transferTaxResale`), not in Total Purchase.
- **Holdback** ($27k on Bronson) is **Financing (profit-neutral)**, shown as a "Construction Holdback Release" credit on the sell-side. Never display the credits subtotal ($590k) as a "sale price" — the sale price is $563,000.
- **CRLF:** git may warn `LF will be replaced by CRLF`. Harmless on Windows; ignore.
- **localStorage key `LS`** holds all overrides — clearing it resets user edits (there's a "Reset overrides" control in the IA toolbar).
- **`D` is not on `window`** — debug via `effIA()` / `computeIA(effIA())`.

---

## 16. Definition of Done

- [ ] §12 Golden Test passes to the penny (IA, buy, sell, escrow recon).
- [ ] AI Notes block on all four tabs; one shared, persisted conversation (§14.1).
- [ ] Side-by-side PDF vs parsed view on Buy/Sell (§14.2).
- [ ] Mode pipeline (Estimated→Acquired→Sold) overwrites the correct buckets live, manual-until-actual (§14.3).
- [ ] `/api/parse` normalizes any escrow company's statement to one schema; reproduces Bronson foots (§14.4).
- [ ] Match/Source indicator (UI confirmed with client) (§14.5).
- [ ] Test harness asserting the Golden Test (§14.7).
- [ ] Deployed on Replit from `origin/master`; agent disabled so it can't clobber.

---

*Generated as a handoff for finalizing the FlipAid Closing Cockpit. Questions on intent or the Excel math: the MASTER IA workbook and "4595 Bronson … (7).xlsx" are the source of truth.*
