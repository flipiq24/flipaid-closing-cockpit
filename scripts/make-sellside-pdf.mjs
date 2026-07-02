// Generates a mock SELL-SIDE settlement statement PDF for testing the Sell-Side Closing tab
// and the side-by-side PDF viewer. Pairs with mock-buyside-settlement.xlsx (15620 Ramona Rd).
// Foots exactly: credits 457,000.00 - debits 367,000.00 = net proceeds to seller 90,000.00.
//   Run: node scripts/make-sellside-pdf.mjs   ->  mock-sellside-settlement.pdf
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';

const money = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// [label, debit, credit] — debit = seller owes, credit = seller receives. null = blank cell.
const ROWS = [
  ['section', '-- SALE PRICE --'],
  ['line', 'Sale Price', null, 445000.00],
  ['section', '-- HOLDBACK --'],
  ['line', 'Construction Holdback Release', null, 12000.00],
  ['section', '-- LOAN PAYOFF --'],
  ['line', 'Payoff – 1st Trust Deed (Principal)', 328000.00, null],
  ['line', 'Payoff Interest & Per-Diem', 7455.50, null],
  ['section', '-- COMMISSIONS --'],
  ['line', 'Listing Agent Commission (3%)', 13350.00, null],
  ["line", "Buyer's Agent Commission (3%)", 13350.00, null],
  ['section', '-- ESCROW & TITLE --'],
  ['line', 'Escrow Fee (Seller Share)', 1250.00, null],
  ["line", "Owner's Title Insurance (CLTA)", 1650.00, null],
  ['line', 'Documentary Transfer Tax', 489.50, null],
  ['line', 'Reconveyance / Recording Fees', 145.00, null],
  ['line', 'Wire / Courier Fee', 85.00, null],
  ['section', '-- PRORATIONS --'],
  ['line', 'County Property Tax Proration (seller portion)', 675.00, null],
  ['section', '-- OTHER CHARGES --'],
  ['line', 'Home Warranty (seller-paid)', 550.00, null],
  ['gap'],
  ['total', 'TOTALS', 367000.00, 457000.00],
  ['net', 'NET PROCEEDS TO SELLER AT CLOSE', null, 90000.00],
];

const HEADER = [
  ["SELLER'S FINAL SETTLEMENT STATEMENT", true],
  ['Autumn Skye Escrow Services', false],
  ['Escrow No: ASE-2024-2210', false],
  ['Property: 15620 Ramona Rd, Apple Valley, CA 92307', false],
  ['Seller: HomeStrong USA', false],
  ['Buyer: Ramona Holdings LLC', false],
  ['Closing Date: 08/20/2024', false],
];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const ink = rgb(0.09, 0.11, 0.15);
const muted = rgb(0.42, 0.45, 0.5);

const W = 612, H = 792, LEFT = 54, DEB_R = 430, CRED_R = 558;
let page = doc.addPage([W, H]);
let y = H - 56;

const right = (text, rEdge, size, f, color) => {
  const w = f.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rEdge - w, y, size, font: f, color });
};
const newPageIfNeeded = () => { if (y < 70) { page = doc.addPage([W, H]); y = H - 56; } };

// Header block
for (const [text, isBold] of HEADER) {
  page.drawText(text, { x: LEFT, y, size: isBold ? 13 : 10, font: isBold ? bold : font, color: isBold ? ink : muted });
  y -= isBold ? 20 : 14;
}
y -= 8;

// Column headings
page.drawText('DESCRIPTION', { x: LEFT, y, size: 9, font: bold, color: muted });
right('DEBIT (Seller Owes)', DEB_R, 9, bold, muted);
right('CREDIT (Seller Receives)', CRED_R, 9, bold, muted);
y -= 4;
page.drawLine({ start: { x: LEFT, y }, end: { x: CRED_R, y }, thickness: 0.7, color: muted });
y -= 16;

for (const row of ROWS) {
  newPageIfNeeded();
  const kind = row[0];
  if (kind === 'gap') { y -= 8; continue; }
  if (kind === 'section') {
    page.drawText(row[1], { x: LEFT, y, size: 9.5, font: bold, color: rgb(0.12, 0.22, 0.39) });
    y -= 16;
    continue;
  }
  const [, label, deb, cred] = row;
  const isTotalish = kind === 'total' || kind === 'net';
  const f = isTotalish ? bold : font;
  if (isTotalish) { page.drawLine({ start: { x: LEFT, y: y + 11 }, end: { x: CRED_R, y: y + 11 }, thickness: 0.7, color: ink }); }
  page.drawText(label, { x: LEFT, y, size: 10, font: f, color: ink });
  if (deb != null) right(money(deb), DEB_R, 10, f, ink);
  if (cred != null) right(money(cred), CRED_R, 10, f, ink);
  y -= kind === 'net' ? 18 : 15;
}

const bytes = await doc.save();
fs.writeFileSync('mock-sellside-settlement.pdf', bytes);
console.log('Wrote mock-sellside-settlement.pdf (' + bytes.length + ' bytes)');
