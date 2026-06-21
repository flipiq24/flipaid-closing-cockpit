# FINISH_THE_APP.md — everything left to make the Cockpit 100%

Read `CLAUDE.md` first (Golden Test, taxonomy, rules). Do the phases **in order**. After every task: restart, refresh, re-verify the Golden Test, commit + push. Check a box only when its acceptance passes.

---

## PHASE 0 — Establish ONE source of truth (do this before anything else)

The Replit workspace and GitHub `origin/master` diverged (a Replit Agent edited Replit while another agent pushed to GitHub). Neither is a strict superset. Reconcile into this workspace, then push so GitHub == workspace.

The workspace should END UP with **all** of these (verify each is present; if missing, port it in):

**From the GitHub line (`origin/master`), confirm present:**
- [ ] No green "actual" badge (`grep -n 15803d index.html` → nothing)
- [ ] Link-back mode gating (`grep -n "Stage-gate link-backs" index.html`)
- [ ] Sold-mode escrow recon ("Cash to Seller at Close")
- [ ] Deal-id boot guard (`grep -n "OV._dealId !== D.deal.id" index.html`) + `saveOV` stamps `_dealId`
- [ ] `resetOverrides` does `location.reload()` (not just render)
- [ ] Loan cap = `(purchasePrice + dueDiligence) * costLoanPct`
- [ ] `/api/parse`: closing statements use `max_tokens` ≥ 16000 + outermost-`{…}` extraction + returns `stop_reason`
- [ ] Empty-state in `renderClosing`/`renderQB` (dropzone when no lines)

**From the workspace/agent line, confirm present:**
- [ ] **QB parse is category-level** (QB report → ~7 category lines, total $530,403.30; NOT ~150 transactions)
- [ ] Taxonomy renamed **Purchase Cost** + **Sales Cost** everywhere (data.taxonomy, parser prompt, all UI labels, IA + Buy + Sell + QB)
- [ ] Mode selector shows exactly **3 modes** at the point of upload

**Acceptance:** Golden Test passes; `git fetch origin && git status` shows workspace pushed and clean; both lists above fully checked. Commit: `reconcile: single source of truth (GitHub fixes + QB/rename work)`.

---

## PHASE 1 — The QB queue (what the client just asked for)

### 1.1 — Memo → 5 independent columns
The QB ledger "Memo" is one blob like `General Journal · 11/21/2025 · 249 · Trevor Kelly · (Acquisition)`. Split into 5 columns: **Type | Date | Num | Name | Category**.
- The QB parse (`/api/parse` QB branch) must return these as separate fields per row, not one Memo string.
- Render them as 5 columns in `renderQB`.
- **Acceptance:** each QB row shows 5 distinct cells; no merged blob.

### 1.2 — Totals-by-category: interactive + colored + ordered
The category totals block (Purchase Cost, Misc Costs, Rehabilitation Costs, Lender Cost – 1st Loan, Sales Cost):
- **Single-click** a category total → highlight the contributing ledger rows.
- **Double-click** → filter the ledger to only that category (click again / a "clear" affordance to unfilter).
- **Light color per category** (one pastel per category); apply the same tint to its ledger rows.
- **Order the ledger by category, then sub-category.**
- **Acceptance:** clicking "Rehabilitation Costs $36,503.31" highlights exactly the rehab rows; double-click filters to them; colors are consistent between the totals block and the rows.

### 1.3 — Match/Source column (reconciliation)
Per QB line, show where it reconciles:
- If the line exists **only in QB** → show **`QB`**.
- If it matches a cost in **IA / Buy-Side / Sell-Side** → show that source (and ideally link to it, like the IA ↗ link-backs).
- Match on category+sub (and amount within tolerance) against the other tabs' lines.
- **Acceptance:** a QB line that corresponds to a buy-side closing line shows "Buy-Side"; a QB-only line (e.g., an internal journal) shows "QB".

### 1.4 — Red negatives
Refunds / negative amounts render in **red** (text color) wherever amounts show (QB ledger + closing tables).
- **Acceptance:** a −$273.43 refund shows red; positives unchanged.

---

## PHASE 2 — Remaining feature work

### 2.1 — Rehab → QB link-back (completes the Sold-mode link spec)
Rehab's actual comes from QB, but `gotoSource` only targets buy/sell statement lines. Make the QB ledger a link target: give QB rows anchors, teach `gotoSource` to handle `'qb'`, and add `src` to the rehab IA fields so the ↗ appears in Sold mode.
- **Acceptance:** in Sold, Estimated Repairs shows ↗ → jumps to the QB rehab rows and highlights them (persistent, like buy/sell).

### 2.2 — AI Assistant & Notes on all 4 tabs, ONE connected conversation
The Notes block (textarea + Ask AI / Find discrepancies / Post note + log) is only on IA. Add it to Buy/Sell/QB, with a **single shared conversation** across all four (a note posted on Sell-Side shows on IA). Persist server-side per deal (`GET/POST /api/notes`) or at least one shared `OV._notes` array; tag each post with its originating tab.
- **Acceptance:** post a note on QB → it appears on IA; survives refresh.

### 2.3 — Side-by-side PDF vs parsed view (Buy/Sell)
Show the uploaded statement PDF beside the parsed line table so the user can compare. Responsive two-column (collapses on narrow). Persist the file beyond refresh (upload to server / IndexedDB), since today it's only in `window.__stmtFiles`.
- **Acceptance:** upload a buy-side PDF → see PDF left, parsed lines right; they line up.

### 2.4 — Template-formatted .xlsx download (looks like MASTER IA, not loose figures)
The current export uses SheetJS `aoa_to_sheet` → unstyled dump. Instead, **fill the actual MASTER IA template** (`templates/basic_ai_form.xlsx`, the "Basic AI Form" sheet) so formatting/merges/colors are preserved. Use a styling-capable lib server-side (**ExcelJS** — `npm i exceljs`) in a new `POST /api/export`; the client posts the IA values and downloads the styled file. Cell map (key → cell): B4 purchase, B5 DD, B6 insurance, B8 escrow, B9 prorated, B10 total; B13–B19 lender; B30 total lender; B32 repairs, B34 total rehab; B45 ARV, B46–B53 resale, B54 sales-cost total; B56 net, B57–B60 metrics; F14 loan, F15/F16 caps, F21 shortfunds, F25 equity; E48–E52 dev-cost summary; G56/G57/G58 escrow recon.
- **Acceptance:** download opens looking like the screenshots (blue title, gray bands, two-column, right loan panel) with the live numbers; B56 = 34367.04.

### 2.5 — Closing → IA overwrite pipeline (the mode logic, as live data flow)
Wire mode-driven overwrite: **Acquired** = buy-side actual overwrites Purchase + Financing only; **Sold** = sell-side overwrites Sales Cost, QB overwrites Rehab/Holding. Manual values persist until an actual statement is ingested, then the actual updates it; the override layer must let the user re-edit.
- **Acceptance:** flip to Acquired with the buy-side attached → Purchase + Lender reflect the statement; rehab/sales stay estimates. Golden Test still holds.

### 2.6 — Parser: add Financing category + harden multi-format
`/api/parse` taxonomy must include **Financing (profit-neutral)** (subs Loan Proceeds / Construction Holdback / Payoff) for BOTH sides, and route loan proceeds/payoff/holdback there (not into Lender Cost). Keep the renamed categories (Purchase Cost / Sales Cost). Validate against the two Bronson statements (must reproduce the §Golden foots).
- **Acceptance:** re-parse the Bronson sell-side → holdback maps to Financing/Construction Holdback; sell-side still foots to $118,184.86.

---

## Definition of Done (the whole app, 100%)
- [ ] Phase 0 reconciled; GitHub == workspace; Golden Test exact.
- [ ] Phase 1: memo 5 columns · totals click-highlight + dbl-click-filter + colors + ordering · Match/Source · red negatives.
- [ ] Phase 2: Rehab→QB link · Notes on all tabs + shared thread · side-by-side PDF · template .xlsx export · mode overwrite pipeline · parser Financing category.
- [ ] All four tabs foot; QB total $530,403.30; escrow Diff $281.60.
- [ ] Deployed from `origin/master`; Replit Agent OFF so it can't re-diverge.
