# Paste this into Replit's AI Agent

> Copy everything in the box below into the Replit Agent prompt after you import this repo.
> The repo already runs (`index.html` is a working cockpit). This prompt tells Replit how to
> polish it into the full styled app and wire the backend.

---

**Context:** This repo is a four-tab "Closing Cockpit" for a real-estate fix-and-flip. The data lives
in `data/ramona.json`. The working prototype is `index.html`. The backend is `server/index.js`. Read
`DECISIONS.md` and `docs/TAX_LOGIC.md` before changing any math — the tax and profit logic is correct
and verified; do not "simplify" it away.

**Build a polished web app with these four tabs, styled like a clean Google-Sheets / form UI**
(light gray background, white rounded section cards, a section header with a count pill, two-column
field grids, an orange accent, and a "Saved" indicator top-right):

1. **Investment Analysis** — only the editable inputs show; everything else is derived. A Status
   dropdown (Estimated → Acquired → Estimated Closing → Final) controls which inputs stay live; locked
   ones render read-only. Show Total Cost, Net Profit, Transfer Tax, Supplemental Tax as KPI cards.

2. **Buy-Side Closing** — lines grouped by section. Each line has: amount input, a **Category**
   dropdown and a **Sub-category** dropdown (options come from `taxonomy.categories`), and a
   **confidence badge** (color-coded by %). Hovering the badge shows the `why` text. Status = FINAL,
   11/7/2025.

3. **Sell-Side Closing** — same machine, ESTIMATED, 6/19/2026. Plus an auto-calculated **Resale Tax**
   section: Documentary Transfer Tax, County Proration, and Supplemental — each with a hover-why.

4. **QB Accounting Export** — a ledger (Type / Date / Name / Memo / Category / Sub / Amount) built from
   both closing tabs. Category/Sub/Amount are editable here too and stay in sync. A "Download .xlsx"
   button (SheetJS) writes all four tabs to one file.

**Requirements**
- Keep CA tax math exactly as in `index.html` (`transferTax`, `countyProration` 30/360, `supplemental`).
- Persist user edits (overrides) in localStorage so reopening the deal keeps changes.
- Wire the **AI Evaluate** button to `POST /api/evaluate` (already in `server/index.js`). Add
  `ANTHROPIC_API_KEY` as a Replit Secret.
- Add a per-line free-text **comment** field saved alongside the AI's evaluation.
- Make it responsive; tables scroll horizontally on narrow screens.

**Stack:** keep it simple — static front end + the existing Express server, OR port to React/Vite if
you prefer components. Do not add a database; localStorage + the JSON file is enough for v1.

**Confidence/hover is the whole point** — do not drop the badges or tooltips.
