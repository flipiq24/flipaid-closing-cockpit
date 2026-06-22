// Deterministic QuickBooks Development-Cost workbook parser (no AI — the ~150-row transaction
// register would truncate the model, per CLAUDE.md rule #4). Pure functions, unit-testable.
import * as XLSX from 'xlsx';

// SINGLE source of truth for QB computed / non-cost SUMMARY rows that must never enter the
// ledger. These are recomputed roll-ups or profit-distribution waterfall rows — emitting them
// would double-count the real cost categories. MUST stay in lockstep with the labels the
// QB_INSTRUCTIONS prompt asks the AI to skip (server/index.js): Total(s)/Subtotal/Grand Total
// (incl. "Total Costs/Expenses/Income/Profit"), Sales/Selling Price, Profit (incl. Net/Gross),
// Net/Gross Income, Holdback distributions, partner/owner Distributions, "Amount to be
// Dist(ributed)", "Previously Dist", "Remaining Dist".
// Anchored so genuine cost categories (Acquisition, Holding, Construction Holdback, Loan Proceeds,
// Interest Charges, Settlement Charges, …) are preserved untouched — the leading qualifier (e.g.
// "Construction" Holdback) prevents a match because the whole label must match start-to-end.
export const QB_SUMMARY_ROW_RE = /^(?:(?:grand\s+|sub\s*)?totals?(?:\s+(?:costs?|expenses?|income|profits?|distributions?|proceeds))?|(?:net\s+|gross\s+|total\s+)?profits?|(?:net|gross)\s+income|(?:sales?|selling)\s+price|holdbacks?(?:\s+distributions?)?|(?:partner|partners|partnership)\s+distributions?|distributions?(?:\s+to\s+(?:partners?|members?|owners?))?|(?:amount\s+to\s+be|previously|remaining)\s+dist(?:ributed|ribution)?s?)\s*:?\s*$/i;
export function isQbSummaryLabel(label) {
  return QB_SUMMARY_ROW_RE.test(String(label == null ? '' : label).trim());
}

// Excel serial date -> "YYYY-MM-DD" (1900 date system). Strings/ISO pass straight through.
export function excelDate(v) {
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
export function qbCategoryToTaxonomy(qbCat, qbSub) {
  const c = String(qbCat || '').toLowerCase().trim();
  const s = String(qbSub || '').toLowerCase().trim();
  if (c.includes('acquisition'))      return { category: 'Purchase Cost', sub: 'Purchase Price' };
  if (c.includes('rehab')) {
    if (s.includes('util'))            return { category: 'Rehabilitation Costs', sub: 'Utilities' };
    return { category: 'Rehabilitation Costs', sub: 'Estimated Repairs' };  // materials / labor / other
  }
  if (c.includes('interest'))          return { category: 'Lender Cost – 1st Loan', sub: 'Interest on New Loan 1st' };
  if (c.includes('holding'))           return { category: 'Misc Costs', sub: 'Miscellaneous Costs' };
  if (c.includes('settlement'))        return { category: 'Sales Cost', sub: 'Escrow and Title' };
  if (c.includes('loan') || c.includes('payoff') || c.includes('proceeds') || c.includes('holdback'))
                                       return { category: 'Financing (profit-neutral)', sub: c.includes('holdback') ? 'Construction Holdback' : (c.includes('payoff') ? 'Payoff' : 'Loan Proceeds') };
  return { category: 'Misc Costs', sub: 'Miscellaneous Costs' };
}

// Parse a QB Development-Cost workbook buffer. Returns:
//   - lines:   the transaction register (Type/Date/Num/Name/Memo/Amount + taxonomy map) for the ledger
//   - summary: the authoritative category subtotals (the "Development Cost" report; total $530,403.30)
// Non-cost / computed rows (Total, Sales Price, Profit, Holdback distributions) are skipped; the
// interest-calculation worksheet is ignored so amounts are never double-counted.
export function parseQbWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const lines = [];
  const summary = [];

  wb.SheetNames.forEach(name => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false });
    if (!rows.length) return;
    const headerRow = rows.find(r => r.some(c => String(c).toLowerCase() === 'type'));
    const looksInterestWorksheet = rows.some(r => r.some(c => /days outstanding|date interest to/i.test(String(c))));

    if (!headerRow) {
      // Summary-style sheet: [label, null, amount]. Collect cost categories only.
      rows.forEach(r => {
        const label = String(r[0] == null ? '' : r[0]).trim();
        const amt = r.find((c, i) => i > 0 && typeof c === 'number');
        if (!label || typeof amt !== 'number') return;
        if (isQbSummaryLabel(label)) return;
        summary.push({ label, amount: amt, map: qbCategoryToTaxonomy(label, '') });
      });
      return;
    }
    if (looksInterestWorksheet) return;   // ignore interest-calc worksheet (would double-count)
    // Transaction register: locate columns from the header row.
    const col = {};
    headerRow.forEach((c, i) => { const k = String(c).toLowerCase().trim(); if (k) col[k] = i; });
    const start = rows.indexOf(headerRow) + 1;
    for (let ri = start; ri < rows.length; ri++) {
      const r = rows[ri];
      const type = r[col['type']];
      const amount = r[col['amount']];
      if (typeof amount !== 'number') continue;                          // group-header / blank rows
      if (isQbSummaryLabel(type)) continue;                              // subtotal / computed roll-up rows
      // category + sub = the trailing string cells after the Amount column (Balance is numeric, skipped)
      const after = r.slice((col['amount'] || 0) + 1).filter(x => typeof x === 'string' && x.trim());
      const qbCat = after[0] || '';
      const qbSub = after[1] || '';
      if (isQbSummaryLabel(qbCat)) continue;                            // computed/non-cost category rows
      lines.push({
        type: String(type || ''),
        date: excelDate(r[col['date']]),
        num: r[col['num']] == null ? '' : String(r[col['num']]),
        name: r[col['name']] == null ? '' : String(r[col['name']]),
        memo: r[col['memo']] == null ? '' : String(r[col['memo']]),
        qbCategory: qbCat,
        debit: amount >= 0 ? amount : null,
        credit: amount < 0 ? -amount : null,
        map: qbCategoryToTaxonomy(qbCat, qbSub),
        confidence: 100,
        why: 'QuickBooks ' + (qbCat || 'transaction')
      });
    }
  });

  const meta = { title: 'QuickBooks Development Cost', role: 'QB', status: 'FINAL', date: '', escrowCompany: '', property: '', party: '', escrowNo: '' };
  return { meta, lines, summary };
}
