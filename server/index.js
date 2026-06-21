// Minimal Express backend: serves the cockpit + an AI evaluation/comment endpoint.
// In Replit: add ANTHROPIC_API_KEY as a Secret, then `npm install && npm start`.
import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';

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

// Excel serial date -> "YYYY-MM-DD" (1900 date system). Strings/ISO pass straight through.
function excelDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400 * 1000);   // 25569 = days from 1899-12-30 to 1970-01-01
    const d = new Date(ms);
    if (isNaN(d)) return String(v);
    return d.toISOString().slice(0, 10);
  }
  return String(v);
}

// Map a QuickBooks cost-category (and its class/sub) onto the MASTER IA taxonomy.
// Keeps QB transaction rows consistent with the closing tabs + IA. Names must match the taxonomy exactly.
function qbCategoryToTaxonomy(qbCat, qbSub) {
  const c = String(qbCat || '').toLowerCase().trim();
  const s = String(qbSub || '').toLowerCase().trim();
  if (c.includes('acquisition'))      return { category: 'Purchase Cost', sub: 'Purchase Price' };
  if (c.includes('rehab')) {
    if (s.includes('material'))        return { category: 'Rehabilitation Costs', sub: 'Estimated Repairs' };
    if (s.includes('labor'))           return { category: 'Rehabilitation Costs', sub: 'Estimated Repairs' };
    if (s.includes('util'))            return { category: 'Rehabilitation Costs', sub: 'Utilities' };
    return { category: 'Rehabilitation Costs', sub: 'Estimated Repairs' };
  }
  if (c.includes('interest'))          return { category: 'Lender Cost – 1st Loan', sub: 'Interest on New Loan 1st' };
  if (c.includes('holding'))           return { category: 'Misc Costs', sub: 'Miscellaneous Costs' };
  if (c.includes('settlement'))        return { category: 'Sales Cost', sub: 'Escrow and Title' };
  if (c.includes('loan') || c.includes('payoff') || c.includes('proceeds') || c.includes('holdback'))
                                       return { category: 'Financing (profit-neutral)', sub: c.includes('holdback') ? 'Construction Holdback' : (c.includes('payoff') ? 'Payoff' : 'Loan Proceeds') };
  return { category: 'Misc Costs', sub: 'Miscellaneous Costs' };
}

// Deterministically parse a QuickBooks Development-Cost workbook (XLSX) — NO AI, so the ~150-row
// transaction register never truncates the model. Returns BOTH:
//   - lines: the transaction register (Type/Date/Num/Name/Memo/Amount + taxonomy map) for the ledger
//   - summary: the authoritative category subtotals (the "Development Cost" report; total $530,403.30)
// Non-cost / computed rows (Total, Sales Price, Profit, Holdback distributions) are skipped.
function parseQbWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const lines = [];
  let summary = [];
  const SKIP_SUMMARY = /^(total|grand total|sales price|profit|holdback|amount to be dist|previously dist|remaining dist)$/i;

  wb.SheetNames.forEach(name => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false });
    if (!rows.length) return;
    // Is this the category-summary sheet? (rows of [label, , amount] with an "Acquisition"-style label and no Type header)
    const headerRow = rows.find(r => r.some(c => String(c).toLowerCase() === 'type'));
    const looksInterestWorksheet = rows.some(r => r.some(c => /days outstanding|date interest to/i.test(String(c))));

    if (!headerRow) {
      // Summary-style sheet: [label, null, amount]. Collect cost categories only.
      rows.forEach(r => {
        const label = String(r[0] == null ? '' : r[0]).trim();
        const amt = r.find((c, i) => i > 0 && typeof c === 'number');
        if (!label || typeof amt !== 'number') return;
        if (SKIP_SUMMARY.test(label)) return;
        const map = qbCategoryToTaxonomy(label, '');
        summary.push({ label, amount: amt, map });
      });
      return;
    }
    // Transaction register: locate columns from the header row.
    const col = {};
    headerRow.forEach((c, i) => { const k = String(c).toLowerCase().trim(); if (k) col[k] = i; });
    // The QB class/category sits in the trailing string columns after Amount/Balance.
    const start = rows.indexOf(headerRow) + 1;
    if (looksInterestWorksheet) return;   // ignore the interest-calculation worksheet (would double-count)
    for (let ri = start; ri < rows.length; ri++) {
      const r = rows[ri];
      const type = r[col['type']];
      const amount = r[col['amount']];
      if (typeof amount !== 'number') continue;                 // group-header / blank rows
      if (/^total\b|^grand total$/i.test(String(type || ''))) continue;  // subtotal rows
      // category + sub = the trailing string cells after the Amount column (Balance is numeric, skipped)
      const after = r.slice((col['amount'] || 0) + 1).filter(x => typeof x === 'string' && x.trim());
      const qbCat = after[0] || '';
      const qbSub = after[1] || '';
      const map = qbCategoryToTaxonomy(qbCat, qbSub);
      lines.push({
        type: String(type || ''),
        date: excelDate(r[col['date']]),
        num: r[col['num']] == null ? '' : String(r[col['num']]),
        name: r[col['name']] == null ? '' : String(r[col['name']]),
        memo: r[col['memo']] == null ? '' : String(r[col['memo']]),
        qbCategory: qbCat,
        debit: amount >= 0 ? amount : null,
        credit: amount < 0 ? -amount : null,
        map,
        confidence: 100,
        why: 'QuickBooks ' + (qbCat || 'transaction')
      });
    }
  });

  const meta = { title: 'QuickBooks Development Cost', role: 'QB', status: 'FINAL', date: '', escrowCompany: '', property: '', party: '', escrowNo: '' };
  return { meta, lines, summary };
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('.'));            // serves index.html + data/
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Prefer Replit AI Integrations (no own key needed; billed to Replit credits) when present,
// otherwise fall back to a plain ANTHROPIC_API_KEY secret. Either path enables the AI mapping
// (/api/parse), evaluate, and ask endpoints.
const client = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
  ? new Anthropic({ baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL, apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || 'integration' })
  : (process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null);

// POST /api/evaluate  { deal, ia, qb }  -> { comment }
app.post('/api/evaluate', async (req, res) => {
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
app.post('/api/ask', async (req, res) => {
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
Rules: keep the statement's section order; each line is a debit OR a credit (the other is null); copy amounts exactly as numbers; NEVER summarize, merge, or omit a line; deposits / loan proceeds / sale price are credits; charges are debits; "confidence" (0-100) is how sure the category mapping is; "why" is one short sentence.`;

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
  - SKIP computed or non-cost rows: Total, Grand Total, Sales Price, Profit, Holdback distributions, "Amount to be Dist", "Previously Dist", "Remaining Dist".
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

app.post('/api/parse', upload.single('file'), async (req, res) => {
  if (!client) return res.status(503).json({ error: 'Set ANTHROPIC_API_KEY' });
  try {
    const instr = ((req.body && req.body.side) === 'qb') ? QB_INSTRUCTIONS : PARSE_INSTRUCTIONS;
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
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log('Closing Cockpit on :' + port));
