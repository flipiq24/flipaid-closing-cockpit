# FlipAid · Closing Cockpit

## Overview
A four-tab web tool for real-estate fix-and-flip deals. It maps both buy-side and
sell-side closing statements into a QuickBooks taxonomy, runs investment analysis,
applies California tax logic, and exports a spreadsheet. Pre-loaded with the
**15620 Ramona Ave** deal.

## Architecture
- **Auth & accounts:** Email + password (scrypt-hashed, no bcrypt dep) with a
  Postgres-backed session cookie. `login.html` handles sign in / sign up.
- **Portfolio:** `portfolio.html` is the landing page after login — groups and
  properties scoped per user. Each property stores the full deal-data blob.
- **Backend:** Express server (`server/index.js`, ES modules). `server/db.js`
  owns the Postgres pool, schema, password hashing and the Bronson seed;
  `server/routes.js` owns auth + portfolio + property REST API. AI endpoints
  (`/api/evaluate`, `/api/ask`, `/api/parse`) and all HTML pages require a session.
- **Frontend cockpit:** `index.html` (vanilla JS) opens ONE property via
  `?id=<propertyId>`, loads the deal template from `data/ramona.json`, overlays
  that property's saved overrides, and renders the four tabs. Edits persist
  server-side (debounced PATCH); localStorage holds only the per-property undo
  stack. Uses the `xlsx` CDN for export.
- **Data model:**
  - `data/ramona.json` is the shared deal TEMPLATE — line items, amounts,
    mappings, tooltips, tax inputs, IA assumptions. Edit data, not code.
  - Per-property edits live in Postgres (`properties.data` JSONB = the `OV`
    overrides blob). New users are seeded the **4595 Bronson** deal with an empty
    blob, so it reproduces the golden IA numbers from the template untouched.

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
