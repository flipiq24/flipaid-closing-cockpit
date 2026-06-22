# CLAUDE.md — FlipAid Closing Cockpit (read this first, every session)

You are the **single** implementer for this app. Do all work **in this Replit workspace**, commit, and push to `origin/master`. **One source of truth — never let another agent edit in parallel.** If the Replit Agent is on, stop it.

## What this app is
A multi-user fix-and-flip platform: a per-user **portfolio** of deals (grouped properties), each opened in a four-tab **"Closing Cockpit"** — one deal at a time in the cockpit view:
1. **Investment Analysis (IA)** — the underwriting model; a faithful port of the client's MASTER IA Excel.
2. **Buy-Side Closing** — purchase settlement statement → normalized line table (Category/Sub + confidence).
3. **Sell-Side Closing** — resale settlement statement, same structure, any escrow company.
4. **QB Accounting** — QuickBooks ledger, reconciled to the closing tabs.

Core idea: IA starts as an **estimate**; actual closing/QB data flows in and reconciles. Mode drives it: **Estimated → Acquired → Sold** (exactly 3 modes).

## Stack
- `index.html` — the cockpit frontend (vanilla JS, no build). UI + state + the calc engine `computeIA()`. Opens ONE property via `?id=<propertyId>`.
- `login.html` / `portfolio.html` — auth screen and the post-login landing page (groups + properties, scoped per user).
- `server/index.js` — Express entry; serves the site + the AI endpoints `/api/evaluate`, `/api/ask`, `/api/parse` (Claude via `@anthropic-ai/sdk`; needs `ANTHROPIC_API_KEY`). The QB branch of `/api/parse` lives in `server/qb-parse.js`.
- `server/db.js` — Postgres pool, schema, scrypt password hashing, and the 4595 Bronson seed.
- `server/routes.js` — auth + portfolio + property REST API (`/api/properties/:id`, etc.). All HTML pages and AI endpoints require a session.
- `data/ramona.json` — the shared deal **TEMPLATE** (4595 Bronson). Per-property edits are stored server-side in Postgres (`properties.data` JSONB = the `OV` overrides blob), overlaid on this template at load.
- Deps of note: `pg` + `connect-pg-simple` + `express-session` (auth/sessions), `multer` (statement uploads), `xlsx` (export).
- Run: `npm start` (PORT=5000 on Replit). No bundler. Edit + refresh.

## 🎯 GOLDEN TEST — the acceptance bar (4595 Bronson, mode Sold). Any change must keep these exact:
| | |
|---|---|
| Net Profit | **$34,367.04** |
| Cash ROI / Cash IRR | 11.91% / 38.29% |
| Levered ROI / Levered IRR | 48.04% / 154.40% |
| Purchase (Acquisition) Cost | $440,781.12 |
| Financing (Lender) Cost | $22,457.00 |
| Rehab Cost | $36,259.23 |
| Total Development Cost | $499,497.35 |
| Sales Cost / Gross Profit to Seller | $533,864.39 |
| Buy-Side foots to (Due to Buyer) | $2,894.22 |
| Sell-Side net proceeds (credits $590,000 incl. $27k holdback − debits $471,815.14) | $118,184.86 |
| Escrow recon (Net Profits, Sold) | Cash to Seller at Close $118,466.46 · from escrow $118,184.86 · **Diff $281.60** |
| QB Development-Cost total (category-level) | $530,403.30 |

Verify headlessly in console: `computeIA(effIA()).netProfit` → `34367.04`.

## Taxonomy (canonical names — renamed per client; must match across IA + Buy + Sell + QB)
- **Purchase Cost** (was "Total Purchase Cost")
- **Lender Cost – 1st Loan**
- **Lender Cost – 2nd Loan**
- **Rehabilitation Costs**
- **Misc Costs**
- **Sales Cost** (was "Gross Profits")
- **Financing (profit-neutral)** → subs: Loan Proceeds, Construction Holdback, Payoff (loan proceeds/payoff/holdback go here; nets to zero, never hits profit)

## Hard rules (the client is emphatic)
1. **Never summarize or hide fields.** IA shows every line from the Excel.
2. **Totals are read-only `(auto)`; everything else editable.**
3. **IA math matches the Excel 100%** — re-run the Golden Test after any formula touch.
4. **QB "Development Cost" report maps at the CATEGORY level**, NOT line-by-line. The file has a Summary of category totals — use it. Reproducing ~150 transactions truncates the model (`stop_reason: max_tokens`). Closing statements (buy/sell) ARE line-by-line.
5. **No green "actual" badges.** Fields render uniformly.
6. **Link-backs (↗) are stage-gated by mode:** Estimated = none; Acquired = Purchase + Lender; Sold = + Sales Cost (+ Rehab when wired to QB).
7. **Overrides (`OV`) persist server-side per property** — debounced PATCH to `/api/properties/:id` (Postgres `properties.data` JSONB), so edits survive logout/login and follow the user across devices. localStorage holds ONLY the per-property undo/history stack. Each property loads `data/ramona.json` as its template and overlays its own saved overrides — never let one property's edits bleed onto another.
8. Loan cap F16 = `(Purchase + Due Diligence) × 90%` (Excel). Transfer tax booked once (sell-side Sales Cost). Holdback ($27k) = Financing; never call the $590k credits subtotal a "sale price."
9. Metrics are exactly four: Cash ROI, Cash IRR, Levered ROI, Levered IRR — single % column under the Net Profit value.

## Workflow
- Edit files → restart app (`npm start`) → refresh Webview → verify Golden Test.
- Commit + push every working change: `git add -A && git commit -m "..." && git push origin master`.
- Remaining work and full specs: **`docs/FINISH_THE_APP.md`**.
