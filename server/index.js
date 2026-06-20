// Minimal Express backend: serves the cockpit + an AI evaluation/comment endpoint.
// In Replit: add ANTHROPIC_API_KEY as a Secret, then `npm install && npm start`.
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('.'));            // serves index.html + data/

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

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log('Closing Cockpit on :' + port));
