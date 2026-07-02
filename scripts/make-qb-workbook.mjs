// Generates a mock QuickBooks "Development Cost" workbook (.xlsx) for the QB Accounting tab.
// QB is parsed DETERMINISTICALLY in code (server/qb-parse.js) — no AI, no API key — and reads:
//   1) a Summary sheet (no "Type" header; rows = [label, , amount])  -> authoritative category totals
//   2) a Transaction Register sheet (has a "Type" header; Category/Class trail the Amount column) -> ledger
// Pairs with the 15620 Ramona Rd mocks. Summary totals foot to $375,632.98 and the register foots
// to the same figure, so the authoritative totals and the ledger agree.
//   Run: node scripts/make-qb-workbook.mjs   ->  mock-qb-development-cost.xlsx
import * as XLSX from 'xlsx';

// --- Summary sheet: cost categories only (Financing is profit-neutral, excluded from dev cost). ---
// Labels are chosen so server/qb-parse.js maps them onto the taxonomy:
//   Acquisition->Purchase Cost, Rehab*->Rehabilitation Costs, Holding->Misc, Interest->Lender 1st,
//   Settlement->Sales Cost.
const summary = [
  ['4595-style Development Cost Report'],
  ['Property: 15620 Ramona Rd, Apple Valley, CA 92307'],
  [],
  ['Category', 'Class', 'Amount'],
  ['Acquisition', '', 320218.25],
  ['Rehab Materials', '', 21500.00],
  ['Rehab Labor', '', 12800.00],
  ['Rehab Utilities', '', 1959.23],
  ['Holding', '', 3200.00],
  ['Interest Charges', '', 7455.50],
  ['Settlement Charges', '', 8500.00],
  [],
  ['Total Costs', '', 375632.98],   // label the parser's summary-row filter recognizes & skips (not "development cost")
];

// --- Transaction register: detailed ledger rows the tab can highlight / filter (task 3). ---
// Category & Class come AFTER the Amount column (the parser reads the trailing string cells).
// Register foots to the same 375,632.98 and each category's rows sum to its Summary total.
const register = [
  ['Type', 'Date', 'Num', 'Name', 'Memo', 'Amount', 'Category', 'Class'],
  ['Bill',  '2024-02-15', '1001', 'Autumn Skye Escrow',  'Purchase of property',   320218.25, 'Acquisition', 'Land & Building'],
  ['Check', '2024-03-02', '2001', 'Home Depot',          'Framing & drywall',        8200.00, 'Rehab',       'Materials'],
  ['Check', '2024-03-10', '2002', 'Ferguson',            'Plumbing fixtures',        6300.00, 'Rehab',       'Materials'],
  ['Check', '2024-04-05', '2003', 'Floor & Decor',       'Flooring & tile',          7000.00, 'Rehab',       'Materials'],
  ['Check', '2024-03-18', '2004', 'ABC Framing Crew',    'Labor - framing',          7800.00, 'Rehab',       'Labor'],
  ['Check', '2024-04-01', '2005', 'Cool Air HVAC',       'Labor - HVAC install',     5000.00, 'Rehab',       'Labor'],
  ['Bill',  '2024-03-01', '3001', 'SoCal Edison',        'Power during rehab',       1959.23, 'Rehab',       'Utilities'],
  ['Bill',  '2024-04-15', '4001', 'City Property Mgmt',  'Holding costs',            3200.00, 'Holding',     ''],
  ['Bill',  '2024-08-20', '5001', 'Private Lender LLC',  'Interest & per-diem',      7455.50, 'Interest',    ''],
  ['Bill',  '2024-08-20', '6001', 'Diamond Quality Escrow', 'Escrow & settlement',   8500.00, 'Settlement',  ''],
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary),  'Development Cost Summary');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(register), 'Transaction Register');
XLSX.writeFile(wb, 'mock-qb-development-cost.xlsx');

// Sanity check the two views agree.
const catSum = {};
register.slice(1).forEach(r => { catSum[r[6]] = (catSum[r[6]] || 0) + r[5]; });
const regTotal = Object.values(catSum).reduce((a, b) => a + b, 0);
const sumTotal = summary.filter(r => typeof r[2] === 'number' && !/^total/i.test(r[0] || ''))
  .reduce((a, r) => a + r[2], 0);
console.log('Wrote mock-qb-development-cost.xlsx');
console.log('Summary cost total:', sumTotal.toFixed(2), '| Register total:', regTotal.toFixed(2));
console.log('Register by category:', catSum);
