# FlipAid · Closing Cockpit

A four-tab web tool for a real-estate fix-and-flip: map both closing statements into your QuickBooks
taxonomy, run the investment analysis off basic numbers you can change, and export a clean spreadsheet.
Pre-loaded with the **15620 Ramona Ave** deal.

## The four tabs
| Tab | What it does |
|---|---|
| **Investment Analysis** | Only editable inputs show. A Status dropdown (Estimated → Acquired → Estimated Closing → Final) controls what's live. KPI cards for cost, profit, transfer & supplemental tax. |
| **Buy-Side Closing** | Autumn Skye statement (FINAL, 11/7/2025). Each line has Category + Sub dropdowns, a **confidence badge**, and **hover-why**. |
| **Sell-Side Closing** | Diamond Quality statement (ESTIMATED, 6/19/2026) + an auto-calculated Resale Tax section (transfer / county proration / supplemental). |
| **QB Accounting Export** | One ledger built from both sides, fully re-mappable, with **Download .xlsx** (all four tabs). |

## Run it
**Just the front end (no install):** open `index.html` — it fetches `data/ramona.json` and runs.
In Replit it serves from `/` immediately.

**With the AI Evaluate backend:**
```bash
npm install
# add ANTHROPIC_API_KEY (Replit: Secrets tab)
npm start          # http://localhost:3000
```

## How to get this into Replit
1. This repo is on GitHub (see below).
2. In Replit: **Create Repl → Import from GitHub →** paste the repo URL.
3. Open **REPLIT_BUILD_PROMPT.md**, copy the prompt, paste it into the Replit Agent to polish the UI.
4. Add `ANTHROPIC_API_KEY` in **Secrets** for the AI Evaluate button.

## Read before changing the math
- **DECISIONS.md** — the holdback / status / tax-rate decisions baked in (all overridable in the JSON).
- **docs/TAX_LOGIC.md** — the CA transfer-tax, proration, and supplemental logic, verified line by line.

## Editing the deal
Everything lives in **`data/ramona.json`** — line items, amounts, mappings, confidence, the `why`
tooltips, tax inputs, and the IA assumptions. Change data, not code.
