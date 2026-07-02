// Golden Test — 4595 Bronson, mode Sold.
// These numbers must never change. Re-run after any formula edit.
// Values: CLAUDE.md "GOLDEN TEST" section.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeIA } from '../src/calc.js';

const deal = JSON.parse(readFileSync(new URL('../data/ramona.json', import.meta.url), 'utf8'));
const r = computeIA(deal.ia.inputs, deal.taxInputs);

test('Net Profit = $34,367.04', () => {
  assert.strictEqual(+r.netProfit.toFixed(2), 34367.04);
});

test('Cash ROI = 11.91%', () => {
  assert.strictEqual(+r.cashOnCashROI.toFixed(4), 0.1191);
});

test('Cash IRR = 38.29%', () => {
  assert.strictEqual(+r.cashOnCashIRR.toFixed(4), 0.3829);
});

test('Levered ROI = 48.04%', () => {
  assert.strictEqual(+r.returnOnCash.toFixed(4), 0.4804);
});

test('Levered IRR = 154.40%', () => {
  assert.strictEqual(+r.returnOnCashAnnual.toFixed(4), 1.544);
});

test('Purchase (Acquisition) Cost = $440,781.12', () => {
  assert.strictEqual(r.totalPurchase, 440781.12);
});

test('Financing (Lender) Cost = $22,457.00', () => {
  assert.strictEqual(r.totalLender, 22457);
});

test('Rehab Cost = $36,259.23', () => {
  assert.strictEqual(r.totalRehab, 36259.23);
});

test('Total Development Cost = $499,497.35', () => {
  assert.strictEqual(r.totalDevCost, 499497.35);
});

test('Sales Cost / Gross Profit to Seller = $533,864.39', () => {
  assert.strictEqual(r.grossProfit, 533864.39);
});
