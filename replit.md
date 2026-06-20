# FlipAid · Closing Cockpit

## Overview
A four-tab web tool for real-estate fix-and-flip deals. It maps both buy-side and
sell-side closing statements into a QuickBooks taxonomy, runs investment analysis,
applies California tax logic, and exports a spreadsheet. Pre-loaded with the
**15620 Ramona Ave** deal.

## Architecture
- **Backend:** Minimal Express server (`server/index.js`, ES modules) that serves
  the static frontend and one AI endpoint (`POST /api/evaluate`).
- **Frontend:** A single static `index.html` (vanilla JS) that fetches
  `data/ramona.json` and renders the four tabs. Uses the `xlsx` CDN for export.
- **Data:** All deal data lives in `data/ramona.json` — line items, amounts,
  mappings, confidence, tooltips, tax inputs, IA assumptions. Edit data, not code.

## Replit Setup
- Workflow **Start application** runs `PORT=5000 npm start`, serving the app on
  port 5000 (webview).
- The server binds `0.0.0.0` and reads `PORT` from the environment.
- Deployment: autoscale, run command `npm start`.

## Optional: AI Evaluate
The "AI Evaluate & Comment" button calls `/api/evaluate`, which requires the
`ANTHROPIC_API_KEY` secret. Without it, the endpoint returns 503 and the rest of
the app works normally.

## Reference Docs
- `DECISIONS.md` — holdback / status / tax-rate decisions baked into the data.
- `docs/TAX_LOGIC.md` — CA transfer-tax, proration, and supplemental logic.

## User preferences
(none recorded yet)
