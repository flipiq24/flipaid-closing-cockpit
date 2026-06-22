// Unit tests for the deterministic QuickBooks summary-row filter (server/qb-parse.js).
// Run with: npm test  (node --test, no extra dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { isQbSummaryLabel, parseQbWorkbook, qbCategoryToTaxonomy } from '../server/qb-parse.js';

// Labels that MUST be dropped — computed roll-ups, profit lines, and the
// profit-distribution waterfall. Casing / punctuation / pluralisation vary on purpose.
const DROP = [
  // Totals & subtotals
  'Total', 'Totals', 'total', 'Total:', '  Total  ',
  'Grand Total', 'Grand Totals', 'GRAND TOTAL',
  'Subtotal', 'Subtotals', 'Sub Total', 'Sub Totals',
  'Total Cost', 'Total Costs', 'Total Expense', 'Total Expenses',
  'Total Income', 'Total Profit', 'Total Distributions', 'Total Proceeds',
  // Sales / selling price
  'Sales Price', 'Sale Price', 'Selling Price', 'sales price:',
  // Profit lines
  'Profit', 'Profits', 'Net Profit', 'Gross Profit', 'NET PROFIT',
  // Income lines
  'Net Income', 'Gross Income',
  // Holdback distribution waterfall (bare holdback is a computed roll-up here)
  'Holdback', 'Holdbacks', 'Holdback Distribution', 'Holdback Distributions',
  // Partner / owner distributions
  'Distribution', 'Distributions', 'Distribution to Partners',
  'Distributions to Partners', 'Distribution to Members', 'Distribution to Owners',
  'Partner Distribution', 'Partner Distributions', 'Partnership Distribution',
  // Explicit waterfall steps
  'Amount to be Distributed', 'Amount to be Dist', 'Amount to be Distribution',
  'Previously Distributed', 'Previously Dist',
  'Remaining Distribution', 'Remaining Distributions', 'Remaining Dist',
];

// Labels that MUST be preserved — genuine cost / financing categories. Several are
// deliberately close to a drop pattern (e.g. "Construction Holdback" vs "Holdback").
const KEEP = [
  'Acquisition', 'Holding', 'Construction Holdback',
  'Interest Charges', 'Settlement Charges', 'Loan Proceeds', 'Payoff',
  'Rehab Materials', 'Rehab Labor', 'Rehab Other', 'Utilities',
  'Purchase Price', 'Escrow and Title', 'Sales Cost',
  'Total Acquisition', 'Total Acquisition Cost',   // qualified roll-up, not a bare total — keep
  'Net Proceeds', 'Loan Origination Fee',
  '', '   ',                                        // empty / whitespace are not summary rows
];

test('isQbSummaryLabel drops computed / non-cost summary rows', () => {
  for (const label of DROP) {
    assert.equal(isQbSummaryLabel(label), true, `expected DROP for: "${label}"`);
  }
});

test('isQbSummaryLabel preserves genuine cost categories', () => {
  for (const label of KEEP) {
    assert.equal(isQbSummaryLabel(label), false, `expected KEEP for: "${label}"`);
  }
});

test('isQbSummaryLabel tolerates null / undefined / non-string input', () => {
  assert.equal(isQbSummaryLabel(null), false);
  assert.equal(isQbSummaryLabel(undefined), false);
  assert.equal(isQbSummaryLabel(0), false);
  assert.equal(isQbSummaryLabel(530403.3), false);
});

// ---------------------------------------------------------------------------
// qbCategoryToTaxonomy — every branch maps onto the MASTER IA taxonomy.
// ---------------------------------------------------------------------------
test('qbCategoryToTaxonomy maps each QB category to the expected Category/Sub', () => {
  assert.deepEqual(qbCategoryToTaxonomy('Acquisition', ''),
    { category: 'Purchase Cost', sub: 'Purchase Price' });
  assert.deepEqual(qbCategoryToTaxonomy('Rehab', 'Materials'),
    { category: 'Rehabilitation Costs', sub: 'Estimated Repairs' });
  assert.deepEqual(qbCategoryToTaxonomy('Rehab', 'Utilities'),
    { category: 'Rehabilitation Costs', sub: 'Utilities' });
  assert.deepEqual(qbCategoryToTaxonomy('Interest Charges', ''),
    { category: 'Lender Cost – 1st Loan', sub: 'Interest on New Loan 1st' });
  assert.deepEqual(qbCategoryToTaxonomy('Holding', ''),
    { category: 'Misc Costs', sub: 'Miscellaneous Costs' });
  assert.deepEqual(qbCategoryToTaxonomy('Settlement Charges', ''),
    { category: 'Sales Cost', sub: 'Escrow and Title' });
  assert.deepEqual(qbCategoryToTaxonomy('Loan Proceeds', ''),
    { category: 'Financing (profit-neutral)', sub: 'Loan Proceeds' });
  assert.deepEqual(qbCategoryToTaxonomy('Construction Holdback', ''),
    { category: 'Financing (profit-neutral)', sub: 'Construction Holdback' });
  assert.deepEqual(qbCategoryToTaxonomy('Loan Payoff', ''),
    { category: 'Financing (profit-neutral)', sub: 'Payoff' });
  assert.deepEqual(qbCategoryToTaxonomy('Whatever Else', ''),
    { category: 'Misc Costs', sub: 'Miscellaneous Costs' });
});

// ---------------------------------------------------------------------------
// parseQbWorkbook — end-to-end on a synthetic workbook buffer (built with xlsx).
// Confirms: summary rows are dropped, genuine cost categories kept, the
// interest-calculation worksheet ignored, and taxonomy mapping is applied.
// ---------------------------------------------------------------------------
function buildWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  // 1) Development-Cost SUMMARY sheet: [label, null, amount]. No "Type" header,
  //    so it is parsed as a summary sheet. Total/Profit rows must be dropped.
  const summary = XLSX.utils.aoa_to_sheet([
    ['Acquisition', null, 100000],
    ['Rehab Materials', null, 50000],
    ['Interest Charges', null, 5000],
    ['Settlement Charges', null, 3000],
    ['Total Costs', null, 158000],   // summary roll-up — DROP
    ['Profit', null, 20000],         // profit line — DROP
  ]);
  XLSX.utils.book_append_sheet(wb, summary, 'Development Cost');

  // 2) Transaction REGISTER sheet: header row contains "Type"; category/sub are
  //    the trailing string cells after Amount (Balance is numeric, skipped).
  const register = XLSX.utils.aoa_to_sheet([
    ['Type', 'Date', 'Num', 'Name', 'Memo', 'Amount', 'Balance'],
    ['Bill', 45000, '1001', 'Title Co', 'closing', 100000, 100000, 'Acquisition', ''],
    ['Check', 45010, '200', 'Home Depot', 'lumber', 25000, 125000, 'Rehab', 'Materials'],
    ['Check', 45011, '201', 'PG&E', 'power', 500, 125500, 'Rehab', 'Utilities'],
    ['Bill', 45020, '300', 'Lender', 'interest', 4000, 129500, 'Interest Charges', ''],
    ['Total', '', '', '', '', 158000, 0, 'Total', ''],  // computed roll-up — DROP
    ['Acquisition', '', '', '', '', '', '', '', ''],     // group header (no amount) — DROP
  ]);
  XLSX.utils.book_append_sheet(wb, register, 'Register');

  // 3) Interest-CALCULATION worksheet: has a "Type" header AND an interest-calc
  //    marker ("Date Interest To"/"Days Outstanding"), so it must be ignored
  //    entirely — its 9999 amount must never be double-counted into the ledger.
  const interest = XLSX.utils.aoa_to_sheet([
    ['Type', 'Loan', 'Date Interest To', 'Days Outstanding', 'Rate', 'Amount'],
    ['Calc', 'Loan 1', 45000, 90, 0.1, 9999],
  ]);
  XLSX.utils.book_append_sheet(wb, interest, 'Interest Calc');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('parseQbWorkbook keeps genuine cost categories and drops summary rows', () => {
  const { summary } = parseQbWorkbook(buildWorkbookBuffer());
  const labels = summary.map(s => s.label);

  assert.deepEqual(labels,
    ['Acquisition', 'Rehab Materials', 'Interest Charges', 'Settlement Charges']);
  assert.ok(!labels.includes('Total Costs'), 'summary roll-up must be dropped');
  assert.ok(!labels.includes('Profit'), 'profit line must be dropped');

  const byLabel = Object.fromEntries(summary.map(s => [s.label, s]));
  assert.equal(byLabel['Acquisition'].amount, 100000);
  assert.deepEqual(byLabel['Acquisition'].map,
    { category: 'Purchase Cost', sub: 'Purchase Price' });
  assert.deepEqual(byLabel['Settlement Charges'].map,
    { category: 'Sales Cost', sub: 'Escrow and Title' });
});

test('parseQbWorkbook maps register transactions and drops computed rows', () => {
  const { lines } = parseQbWorkbook(buildWorkbookBuffer());

  // 4 genuine transactions; the Total roll-up and the amount-less group header drop.
  assert.equal(lines.length, 4);
  assert.ok(lines.every(l => l.type !== 'Total'), 'computed Total row must be dropped');

  const acq = lines.find(l => l.qbCategory === 'Acquisition');
  assert.deepEqual(acq.map, { category: 'Purchase Cost', sub: 'Purchase Price' });
  assert.equal(acq.debit, 100000);
  assert.equal(acq.credit, null);

  const materials = lines.find(l => l.name === 'Home Depot');
  assert.deepEqual(materials.map, { category: 'Rehabilitation Costs', sub: 'Estimated Repairs' });

  const utilities = lines.find(l => l.name === 'PG&E');
  assert.deepEqual(utilities.map, { category: 'Rehabilitation Costs', sub: 'Utilities' });

  const interest = lines.find(l => l.qbCategory === 'Interest Charges');
  assert.deepEqual(interest.map,
    { category: 'Lender Cost – 1st Loan', sub: 'Interest on New Loan 1st' });
});

test('parseQbWorkbook ignores the interest-calculation worksheet (no double-count)', () => {
  const { lines, summary } = parseQbWorkbook(buildWorkbookBuffer());
  const amounts = [...lines.map(l => l.debit), ...summary.map(s => s.amount)];
  assert.ok(!amounts.includes(9999), 'interest-calc amount must never enter the ledger');
});
