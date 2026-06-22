// Unit tests for the deterministic QuickBooks summary-row filter (server/qb-parse.js).
// Run with: npm test  (node --test, no extra dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQbSummaryLabel } from '../server/qb-parse.js';

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
