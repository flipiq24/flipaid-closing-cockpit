// Minimal Express backend: serves the cockpit + an AI evaluation/comment endpoint.
// In Replit: add ANTHROPIC_API_KEY as a Secret, then `npm install && npm start`.
import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('.'));            // serves index.html + data/
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

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
  - "Total Purchase Cost" → subs: "Purchase Price","Due Diligence Cost","Insurance","Cash for Keys","Escrow and Title","Prorated Property Tax","Reserves","Escrow Refunds"
  - "Lender Cost – 1st Loan" → subs: "Prepaid Interest 1st","Interest on New Loan 1st","Loan Origination Fee 1st","Loan Fees & Appraisal Fee 1st","Additional 1st Payments Made","Unused 1st Payments Credit","Interest from 1st Payoff"
  - "Lender Cost – 2nd Loan" → subs: "Prepaid Interest 2nd","Interest on New Loan 2nd","Loan Origination Fee 2nd","Loan Fees 2nd","Additional 2nd Payments Made","Unused 2nd Payments Credit","Interest from 2nd Payoff"
For a SELL-side (Seller) statement, "category" must be one of:
  - "Lender Cost – 1st Loan" (subs as above; loan payoff/interest goes here)
  - "Lender Cost – 2nd Loan" (subs as above)
  - "Gross Profits" → subs: "After Repair Value","Escrow and Title","Prorated Transfer Tax","Prorated Tax","Concessions (Buyer's Help)","Buyers Agent Commissions","Listing Agents Commissions","Per Diem Adjustment","Asset Management Services","Escrow Refunds"
Title/escrow/recording fees → "Escrow and Title". Tax prorations → "Prorated Property Tax" (buy) or "Prorated Tax" (sell). New loan proceeds / loan principal → the matching Lender Cost loan category. If a line has no exact sub, pick the closest sub in the correct side's category. Never invent categories or subs outside this list.
Rules: keep the statement's section order; each line is a debit OR a credit (the other is null); copy amounts exactly as numbers; NEVER summarize, merge, or omit a line; deposits / loan proceeds / sale price are credits; charges are debits; "confidence" (0-100) is how sure the category mapping is; "why" is one short sentence.`;

app.post('/api/parse', upload.single('file'), async (req, res) => {
  if (!client) return res.status(503).json({ error: 'Set ANTHROPIC_API_KEY' });
  try {
    const content = [];
    if (req.file) {
      const b64 = req.file.buffer.toString('base64');
      const mt = req.file.mimetype || '';
      if (mt.includes('pdf')) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
      else if (mt.startsWith('image/')) content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } });
      else return res.status(415).json({ error: 'Upload a PDF or image. For XLSX/CSV, paste the text or use a link.' });
      content.push({ type: 'text', text: PARSE_INSTRUCTIONS });
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
      content.push({ type: 'text', text: PARSE_INSTRUCTIONS + '\n\nSTATEMENT TEXT:\n' + String(doc).slice(0, 60000) });
    }
    const msg = await client.messages.create({ model: 'claude-opus-4-8', max_tokens: 4000, messages: [{ role: 'user', content }] });
    const raw = msg.content.map(c => c.text || '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { return res.status(502).json({ error: 'Model did not return valid JSON', raw: raw.slice(0, 500) }); }
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log('Closing Cockpit on :' + port));
