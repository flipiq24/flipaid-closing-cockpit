// Minimal Express backend: serves the cockpit + an AI evaluation/comment endpoint.
// In Replit: add ANTHROPIC_API_KEY as a Secret, then `npm install && npm start`.
import express from 'express';
import multer from 'multer';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { parseQbWorkbook, isQbSummaryLabel } from './qb-parse.js';
import { pool, ensureSchema, getSessionSecret } from './db.js';
import { buildRouter, requireAuth } from './routes.js';

// Turn a spreadsheet (XLSX/XLS) or CSV buffer into plain CSV text the model can read.
// QuickBooks and most closing-statement exports are XLSX/CSV, so this is the QB happy path.
function spreadsheetToText(buf, mt, name) {
  const isCsv = (mt || '').includes('csv') || /\.csv$/i.test(name || '');
  if (isCsv && !/\.xlsx?$/i.test(name || '')) return buf.toString('utf8');
  const wb = XLSX.read(buf, { type: 'buffer' });
  return wb.SheetNames
    .map(n => `# Sheet: ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n]))
    .join('\n\n');
}

const app = express();
app.use(express.json({ limit: '8mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// The real session handler is built in start() once the DB-derived secret is ready, but it MUST
// run before any route that reads req.session. So mount a stable slot here (registration order =
// execution order in Express); it delegates to the real middleware as soon as start() assigns it.
let sessionMiddleware = null;
app.use((req, res, next) => {
  if (!sessionMiddleware) return res.status(503).json({ error: 'Server is still starting up. Please retry.' });
  return sessionMiddleware(req, res, next);
});

// Static assets only — the deal template (data/ramona.json). The HTML pages are served
// through gated routes below so the cockpit/portfolio require a valid session.
app.use('/data', express.static('data'));

// requireAuthPage: gate a full HTML page behind a session; redirect to /login if signed out.
function requireAuthPage(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}
const sendFile = name => (req, res) => res.sendFile(name, { root: '.' });

// Prefer Replit AI Integrations (no own key needed; billed to Replit credits) when present,
// otherwise fall back to a plain ANTHROPIC_API_KEY secret. Either path enables the AI mapping
// (/api/parse), evaluate, and ask endpoints.
const client = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
  ? new Anthropic({ baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL, apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || 'integration' })
  : (process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null);

// POST /api/evaluate  { deal, ia, qb }  -> { comment }
app.post('/api/evaluate', requireAuth, async (req, res) => {
  if (!client) return res.status(503).json({ error: 'Set ANTHROPIC_API_KEY' });
  const { deal, ia, qb } = req.body;
  try {
    const msg = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content:
`You are a fix-and-flip underwriting reviewer. Evaluate this deal and the mapping.
Be blunt about margin risk and any line that looks mis-bucketed.

Deal: ${JSON.stringify(deal)}
Investment Analysis inputs: ${JSON.stringify(ia)}
QB ledger (mapped closing lines): ${JSON.stringify(qb)}

Return 4-6 sentences: profit health, the riskiest assumption, and any mapping you'd double-check.`
      }]
    });
    res.json({ comment: msg.content.map(c => c.text || '').join('') });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/ask  { deal, ia, qb, question }  -> { answer }
// Smart assistant: answers questions and runs calculations on the deal.
// It NEVER edits the form — the user reads the answer and changes numbers manually.
app.post('/api/ask', requireAuth, async (req, res) => {
  if (!client) return res.status(503).json({ error: 'Set ANTHROPIC_API_KEY' });
  const { deal, ia, qb, question } = req.body;
  if (!question || !String(question).trim()) return res.status(400).json({ error: 'Empty question' });
  try {
    const msg = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content:
`You are a fix-and-flip deal assistant. Answer the user's question and run any calculations they ask for.
Use the deal data below as the source of truth. Show the numbers and how you got them.
Do NOT instruct any system to change the form — you only answer. The user will edit the inputs themselves based on your answer. Keep it concise and practical.

Deal: ${JSON.stringify(deal)}
Investment Analysis inputs: ${JSON.stringify(ia)}
QB ledger (mapped closing lines): ${JSON.stringify(qb)}

Question: ${question}`
      }]
    });
    res.json({ answer: msg.content.map(c => c.text || '').join('') });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/parse  (multipart: file[+side]  OR  json: {side, link, text})
// Parses a settlement statement (PDF/image/Google-Doc/pasted text) into the universal line schema.
// Deterministic safety net: a PURE subtotal / total SUMMARY row (label is exactly
// "Subtotal(s)", "Total(s)", or "Grand Total(s)", optional trailing colon) is a recomputed
// roll-up that would double-count the lines above it. We ASK the AI to omit these (below), but
// if it doesn't, we drop them here so they never enter stored data. MUST stay in lockstep with
// the frontend `isSummaryRow` rule in index.html. Genuine balancing lines ("Due To Buyer",
// "Net proceeds", "Funds to close") carry more than the bare word and are NOT dropped.
const SUMMARY_ROW_RE = /^(sub-?totals?|grand\s+totals?|totals?)\s*:?\s*$/i;
function isSummaryLabel(label) {
  return SUMMARY_ROW_RE.test(String((label || '')).trim());
}

const PARSE_INSTRUCTIONS = `Extract this real-estate settlement / closing statement into JSON for a universal viewer.
Return ONLY valid JSON (no prose, no markdown fences), shaped EXACTLY as:
{ "meta": { "title": string, "escrowCompany": string, "status": "FINAL" | "ESTIMATED", "date": "YYYY-MM-DD", "closingDate": "YYYY-MM-DD", "property": string, "party": string, "role": "Buyer" | "Seller", "escrowNo": string },
  "lines": [ { "label": "<exact line text>", "debit": number|null, "credit": number|null, "section": "<UPPERCASE section header exactly as printed>", "map": { "category": string, "sub": string }, "confidence": number, "why": string } ] }
Map every line to ONE Category + Sub-category from the MASTER IA taxonomy below. Use ONLY these exact strings.
For a BUY-side (Buyer) statement, "category" must be one of:
  - "Purchase Cost" → subs: "Purchase Price","Due Diligence Cost","Insurance","Cash for Keys","Escrow and Title","Prorated Property Tax","Reserves","Escrow Refunds"
  - "Lender Cost – 1st Loan" → subs: "Prepaid Interest 1st","Interest on New Loan 1st","Loan Origination Fee 1st","Loan Fees & Appraisal Fee 1st","Additional 1st Payments Made","Unused 1st Payments Credit","Interest from 1st Payoff"
  - "Lender Cost – 2nd Loan" → subs: "Prepaid Interest 2nd","Interest on New Loan 2nd","Loan Origination Fee 2nd","Loan Fees 2nd","Additional 2nd Payments Made","Unused 2nd Payments Credit","Interest from 2nd Payoff"
For a SELL-side (Seller) statement, "category" must be one of:
  - "Lender Cost – 1st Loan" (subs as above; loan payoff/interest goes here)
  - "Lender Cost – 2nd Loan" (subs as above)
  - "Sales Cost" → subs: "After Repair Value","Escrow and Title","Prorated Transfer Tax","Prorated Tax","Concessions (Buyer's Help)","Buyers Agent Commissions","Listing Agents Commissions","Per Diem Adjustment","Asset Management Services","Escrow Refunds"
Title/escrow/recording fees → "Escrow and Title". Tax prorations → "Prorated Property Tax" (buy) or "Prorated Tax" (sell). New loan proceeds / loan principal → the matching Lender Cost loan category. If a line has no exact sub, pick the closest sub in the correct side's category. Never invent categories or subs outside this list.
SKIP pure subtotal / total SUMMARY rows — lines whose label is just "Subtotal", "Subtotals", "Total", "Totals", or "Grand Total". They are recomputed roll-ups of the lines above and would double-count those amounts; do NOT emit them as lines. This does NOT apply to genuine balancing lines like "Due To Buyer", "Net proceeds", or "Funds to close" — those carry more than the bare word and must be kept (or omitted as today for the footing to compute).
Rules: keep the statement's section order; each REAL line is a debit OR a credit (the other is null); copy amounts exactly as numbers; copy every genuine line — NEVER summarize or merge real charges, but DO omit the pure subtotal/total summary rows described above; deposits / loan proceeds / sale price are credits; charges are debits; "confidence" (0-100) is how sure the category mapping is; "why" is one short sentence.`;

// QB Accounting upload: a QuickBooks export/ledger, mapped across the FULL taxonomy
// (purchase, both loans, rehab, misc, gross profits, financing) rather than one side.
const QB_INSTRUCTIONS = `Extract this QuickBooks accounting export / development-cost report into JSON for a universal viewer.
Return ONLY valid JSON (no prose, no markdown fences), shaped EXACTLY as:
{ "meta": { "title": string, "escrowCompany": string, "status": "FINAL" | "ESTIMATED", "date": "YYYY-MM-DD", "closingDate": "YYYY-MM-DD", "property": string, "party": string, "role": "QB", "escrowNo": string },
  "lines": [ { "label": "<category name>", "debit": number|null, "credit": number|null, "section": "<UPPERCASE section header exactly as printed>", "map": { "category": string, "sub": string }, "confidence": number, "why": string } ] }
This is a QuickBooks property ledger and usually contains a SUMMARY of category subtotals AND one or more detailed transaction registers (and sometimes an interest-calculation worksheet). Produce a CATEGORY-LEVEL ledger, NOT a copy of every transaction:
  - If a summary of category totals is present, emit ONE line per COST category subtotal (e.g. Acquisition, Rehab Materials, Rehab Labor, Rehab Other, Holding, Interest Charges, Settlement Charges), using the summary's amount and the category name as the label.
  - If there is no summary, group the detailed register by its QuickBooks category / class column and emit ONE line per category with the summed amount. Use the main register only; IGNORE any interest-calculation or "Days Outstanding" worksheet so amounts are never double-counted.
  - NEVER emit individual transactions, checks, deposits, or credit-card charges as separate lines.
  - SKIP computed or non-cost rows: Total / Subtotal / Grand Total (including "Total Costs", "Total Expenses", "Total Income", "Total Profit"), Sales Price / Selling Price, Profit (including "Net Profit", "Gross Profit"), Net/Gross Income, Holdback distributions, partner/owner Distributions ("Distribution to Partners"), "Amount to be Dist", "Previously Dist", "Remaining Dist". Do NOT skip genuine cost categories like "Construction Holdback" or "Holding".
Map every category line to ONE Category + Sub-category from the FULL MASTER taxonomy below. Use ONLY these exact strings:
  - "Purchase Cost" → "Purchase Price","Due Diligence Cost","Insurance","Cash for Keys","Escrow and Title","Prorated Property Tax","Reserves","Escrow Refunds"
  - "Lender Cost – 1st Loan" → "Prepaid Interest 1st","Interest on New Loan 1st","Loan Origination Fee 1st","Loan Fees & Appraisal Fee 1st","Additional 1st Payments Made","Unused 1st Payments Credit","Interest from 1st Payoff"
  - "Lender Cost – 2nd Loan" → "Prepaid Interest 2nd","Interest on New Loan 2nd","Loan Origination Fee 2nd","Loan Fees 2nd","Additional 2nd Payments Made","Unused 2nd Payments Credit","Interest from 2nd Payoff"
  - "Rehabilitation Costs" → "Estimated Repairs","Utilities"
  - "Misc Costs" → "ROI Adjustments","Miscellaneous Costs","Supplemental Taxes","Utilities","HOA","Additional Interest Reserve 1st","Additional Interest Reserve 2nd"
  - "Sales Cost" → "After Repair Value","Escrow and Title","Prorated Transfer Tax","Prorated Tax","Concessions (Buyer's Help)","Buyers Agent Commissions","Listing Agents Commissions","Per Diem Adjustment","Asset Management Services","Escrow Refunds"
  - "Financing (profit-neutral)" → "Loan Proceeds","Construction Holdback","Payoff"
If a category has no exact sub, pick the closest sub in the most appropriate category. Never invent categories or subs outside this list.
Rules: emit ONE line per cost category (typically 5-10 lines total), never one per transaction; each line is a debit OR a credit (the other is null); costs / charges are debits, income / proceeds / refunds are credits; copy the subtotal amounts exactly as numbers; "confidence" (0-100) is how sure the category mapping is; "why" is one short sentence naming the source category.`;

app.post('/api/parse', requireAuth, upload.single('file'), async (req, res) => {
  const side = req.body && req.body.side;
  // QB Development-Cost workbooks (XLSX/XLS) are parsed DETERMINISTICALLY (no AI): the transaction
  // register would truncate the model (rule #4), so we read it in code. Gives the 5-column register
  // rows + the authoritative category Summary. Needs no API key. CSV/PDF/image QB still use the AI.
  if (side === 'qb' && req.file && /\.(xlsx|xls)$/i.test(req.file.originalname || '')) {
    try {
      const out = parseQbWorkbook(req.file.buffer);
      if (!out.lines.length && !out.summary.length) return res.status(422).json({ error: 'No QuickBooks transactions or category summary found in that workbook.' });
      return res.json(out);
    } catch (e) { return res.status(422).json({ error: 'Could not read that QuickBooks workbook: ' + String(e) }); }
  }
  if (!client) return res.status(503).json({ error: 'Set ANTHROPIC_API_KEY' });
  try {
    const instr = (side === 'qb') ? QB_INSTRUCTIONS : PARSE_INSTRUCTIONS;
    const content = [];
    if (req.file) {
      const mt = req.file.mimetype || '';
      const nm = req.file.originalname || '';
      const isSheet = mt.includes('sheet') || mt.includes('excel') || mt.includes('csv')
        || /\.(xlsx|xls|csv)$/i.test(nm);
      if (mt.includes('pdf')) {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.file.buffer.toString('base64') } });
        content.push({ type: 'text', text: instr });
      } else if (mt.startsWith('image/')) {
        content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: req.file.buffer.toString('base64') } });
        content.push({ type: 'text', text: instr });
      } else if (isSheet) {
        let sheetText;
        try { sheetText = spreadsheetToText(req.file.buffer, mt, nm); }
        catch (e) { return res.status(422).json({ error: 'Could not read that spreadsheet — try saving it as CSV.' }); }
        if (!sheetText || !sheetText.trim()) return res.status(422).json({ error: 'The spreadsheet appears to be empty.' });
        content.push({ type: 'text', text: instr + '\n\nSTATEMENT TEXT:\n' + sheetText.slice(0, 60000) });
      } else {
        return res.status(415).json({ error: 'Upload a PDF, image, XLSX, or CSV.' });
      }
    } else {
      const { link, text } = req.body || {};
      let doc = text;
      if (!doc && link) {
        let url = link;
        const m = String(link).match(/document\/d\/([\w-]+)/);   // Google Doc -> plain-text export (must be publicly viewable)
        if (m) url = `https://docs.google.com/document/d/${m[1]}/export?format=txt`;
        const r = await fetch(url);
        if (!r.ok) return res.status(400).json({ error: 'Could not fetch link — make sure it is publicly viewable.' });
        doc = await r.text();
      }
      if (!doc) return res.status(400).json({ error: 'Provide a file, a public link, or pasted text.' });
      content.push({ type: 'text', text: instr + '\n\nSTATEMENT TEXT:\n' + String(doc).slice(0, 60000) });
    }
    const msg = await client.messages.create({ model: 'claude-opus-4-8', max_tokens: 16000, messages: [{ role: 'user', content }] });
    const text = msg.content.map(c => c.text || '').join('').trim();
    // Robust extraction: grab the outermost {…} so leading prose or a stray ``` fence can't break JSON.parse.
    const first = text.indexOf('{'), last = text.lastIndexOf('}');
    const raw = (first !== -1 && last !== -1 && last > first) ? text.slice(first, last + 1) : text;
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      // stop_reason === 'max_tokens' means the model was truncated mid-JSON — raise max_tokens.
      return res.status(502).json({ error: 'Model did not return valid JSON', stop_reason: msg.stop_reason, raw: text.slice(0, 2000) });
    }
    // Deterministic guarantee: drop the computed / non-cost SUMMARY rows the AI may have emitted
    // despite the instruction above, so they never enter stored data and double-count amounts.
    // Closing statements use the bare subtotal/total rule; QB ledgers also drop the computed rows
    // QB_INSTRUCTIONS lists (Sales Price, Profit, distribution waterfall) via the shared qb-parse
    // rule — keeping the AI path in lockstep with the deterministic workbook path.
    if (parsed && Array.isArray(parsed.lines)) {
      const drop = (side === 'qb') ? isQbSummaryLabel : isSummaryLabel;
      parsed.lines = parsed.lines.filter(l => !drop(l && l.label));
    }
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- page routes (gated) + server startup ----
async function start() {
  await ensureSchema();
  const secret = await getSessionSecret();
  const PgStore = connectPgSimple(session);
  // Assign into the slot mounted at the top so it runs ahead of every route (incl. the AI endpoints).
  sessionMiddleware = session({
    store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 days
  });

  // Auth + portfolio + property API (defined in routes.js).
  app.use(buildRouter());

  // HTML pages.
  app.get('/login', sendFile('login.html'));
  app.get(['/', '/portfolio'], requireAuthPage, sendFile('portfolio.html'));
  app.get('/cockpit', requireAuthPage, sendFile('index.html'));
  // Prevent the static cockpit HTML from being reachable unauthenticated.
  app.get('/index.html', requireAuthPage, sendFile('index.html'));

  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => console.log('FlipAid on :' + port));
}

start().catch(e => { console.error('Startup failed:', e); process.exit(1); });
