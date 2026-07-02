// Canonical calculation engine — port of MASTER IA Excel formulas.
// Imported by test/golden.test.js and can be imported by index.html via <script type="module">.

export function transferTax(price, ratePer1000){
  return +(price * ratePer1000 / 1000).toFixed(2);
}

export function daysBetween(a, b){
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// Actual calendar days in the month of a YYYY-MM-DD date (parsed manually to avoid TZ drift).
export function daysInMonth(dateStr){
  const p = ('' + (dateStr || '')).split('-');
  const y = +p[0], m = +p[1];
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

// Port of every MASTER IA formula. Returns all derived values.
// taxInputs: object with transferTaxRatePer1000 (defaults to CA $1.10/$1000).
export function computeIA(i, taxInputs = {}) {
  const ttRate = (taxInputs.transferTaxRatePer1000 != null) ? taxInputs.transferTaxRatePer1000 : 1.1;
  const r = {};
  // override layer: any derived line item can be hand-edited (stored as ov_<key>); totals always recompute
  const ov = (k, c) => (i['ov_' + k] != null && i['ov_' + k] !== '') ? +i['ov_' + k] : c;
  // user-added custom cost lines per section (sum into the relevant total)
  const cSum = (sec) => ((i.customLines && i.customLines[sec]) || []).reduce((a, l) => a + (+l.amount || 0), 0);

  r.days   = daysBetween(i.coeDate, i.eomDate);              // F6
  r.months = r.days / 30;                                    // E2
  // TOTAL PURCHASE
  r.totalPurchase = i.purchasePrice + i.dueDiligence + i.insurance + i.cashForKeys + i.escrowTitlePurchase + i.proratedPropTaxPurchase + cSum('purchase'); // B10
  // loan sizing
  r.arvLoanPct  = (i.arvLoanPct == null  || i.arvLoanPct === '')  ? 0.75 : +i.arvLoanPct;
  r.costLoanPct = (i.costLoanPct == null || i.costLoanPct === '') ? 0.90 : +i.costLoanPct;
  r.pct75ARV  = i.arv * r.arvLoanPct;                        // F15
  r.pct90Cost = (i.purchasePrice + (+i.dueDiligence || 0)) * r.costLoanPct; // F16
  r.loan1st   = (i.overrideLoanAmt != null && i.overrideLoanAmt !== '') ? +i.overrideLoanAmt : Math.min(r.pct75ARV, r.pct90Cost); // F14
  r.moPayment = r.loan1st * i.interestRate1st / 12;          // F17
  r.dayInMonth = daysInMonth(i.coeDate);
  const coeDay = +('' + (i.coeDate || '')).split('-')[2] || 0;
  r.oddDays = coeDay ? (r.dayInMonth - coeDay) : 0;
  r.proratedPayment = (r.moPayment / r.dayInMonth) * (r.oddDays || 0); // F20
  r.shortFunds = r.loan1st - i.estimatedRepairs - (r.loan1st * i.points1st) - i.estLoanFees1st - (+i.additional1stPayments || 0); // F21
  r.cashInclPayments = r.moPayment * (r.months * 1.25);      // F9
  r.cashToClose = r.totalPurchase - r.shortFunds;            // F10
  // 1st loan line items
  r.prepaidInt1st    = ov('prepaidInt1st',    r.proratedPayment);              // B13
  r.intOnNewLoan1st  = ov('intOnNewLoan1st',  r.moPayment * r.months);         // B14
  r.loanOrig1st      = ov('loanOrig1st',      r.loan1st * i.points1st);        // B15
  r.loanFeesAppr1st  = ov('loanFeesAppr1st',  i.estLoanFees1st);               // B16
  r.lender1st = r.prepaidInt1st + r.intOnNewLoan1st + r.loanOrig1st + r.loanFeesAppr1st + (+i.additional1stPayments || 0) - (+i.unused1stCredit || 0) + (+i.interestFrom1stPayoff || 0) + cSum('lender1');
  // 2nd loan
  r.intOnNewLoan2nd = ov('intOnNewLoan2nd', (+i.loan2ndAmount || 0) * (+i.interestRate2nd || 0) / 12 * r.months); // B24
  r.loanOrig2nd     = ov('loanOrig2nd',     (+i.loan2ndAmount || 0) * (+i.points2nd || 0));  // B25
  r.loanFees2nd     = ov('loanFees2nd',     (+i.loanFees2nd || 0) || (+i.estLoanFees2nd || 0));
  r.lender2nd = (+i.prepaidInt2nd || 0) + r.intOnNewLoan2nd + r.loanOrig2nd + r.loanFees2nd + (+i.additional2ndPayments || 0) - (+i.unused2ndCredit || 0) + (+i.interestFrom2ndPayoff || 0) + cSum('lender2');
  r.totalLender = r.lender1st + r.lender2nd;                 // B30
  r.isCash = /cash/i.test(i.financingType || '');
  if (r.isCash) {
    r.lender1st = 0; r.lender2nd = 0; r.totalLender = 0;
    r.loan1st = 0; r.moPayment = 0; r.proratedPayment = 0; r.shortFunds = 0;
    r.cashInclPayments = 0;
    r.cashToClose = r.totalPurchase;
  }
  r.reserves = (i.reserves == null || i.reserves === '') ? 5000 : +i.reserves;
  r.totalCashAndReserves = r.cashInclPayments + r.cashToClose + r.reserves + cSum('reserves');
  // rehab
  r.totalRehab = (+i.estimatedRepairs || 0) + (+i.utilitiesRehab || 0);        // B34
  // supplemental tax
  r.supplemental = ov('supplemental', (i.taxFactorW23 == null || i.taxFactorW23 === '') ? 0
    : (i.purchasePrice - (i.taxAssessedValue == null || i.taxAssessedValue === '' ? i.purchasePrice * 0.60 : +i.taxAssessedValue)) * (+i.taxFactorW23));
  // misc costs
  r.miscLessInterest = (+i.roiAdjustments || 0) + (+i.miscellaneousCosts || 0) + r.supplemental + ((+i.hoaMonthly || 0) * r.months) + cSum('rehab');
  r.loan2ndSuggested = r.cashInclPayments + r.cashToClose + i.estimatedRepairs * 0.25;
  // resale / gross profit
  r.escrowTitleResale = ov('escrowTitleResale', i.arv * i.escrowTitleResalePct);       // B46
  r.transferTaxResale = ov('transferTaxResale', transferTax(i.arv, ttRate));            // sell-side documentary transfer tax
  r.proratedTaxResale = ov('proratedTaxResale', i.purchasePrice * i.proratedTaxResaleRate / 12 * r.months); // B47
  r.concessions = ov('concessions', i.arv * i.concessionsPct);    // B48
  r.buyersComm  = ov('buyersComm',  i.arv * i.buyersAgentPct);    // B49
  r.listingComm = ov('listingComm', i.arv * i.listingAgentPct);   // B50
  r.perDiem     = (+i.perDiemAdjustment || 0);                    // B51
  r.assetMgmt   = ov('assetMgmt',   i.arv * i.assetMgmtPct);      // B52
  r.resaleCosts = r.escrowTitleResale + r.transferTaxResale + r.proratedTaxResale + r.concessions + r.buyersComm + r.listingComm + r.perDiem + r.assetMgmt + cSum('gross');
  r.grossProfit = i.arv - r.resaleCosts;                          // B53
  // development cost
  r.totAcq = r.totalPurchase; r.hardMoney = r.totalLender; r.rehabCost = r.totalRehab; // E47,E48,E49
  r.totalDevCost = r.totAcq + r.hardMoney + r.rehabCost + r.miscLessInterest;          // E51
  // net
  r.netProfit = r.grossProfit - r.totAcq - r.hardMoney - r.rehabCost - r.miscLessInterest; // B55
  r.roi = (r.netProfit + r.totalLender) / (r.totAcq + r.rehabCost);                   // B56
  r.irr = r.days > 0 ? Math.pow(1 + r.roi, 365 / r.days) - 1 : 0;                    // B57
  r.irrLinear = r.days > 0 ? r.roi / r.days * 360 : 0;
  // four metrics
  r.cashOnCashROI    = (r.totAcq + r.rehabCost) > 0 ? (r.netProfit + r.totalLender) / (r.totAcq + r.rehabCost) : 0; // B56
  r.cashOnCashIRR    = r.days > 0 ? r.cashOnCashROI / r.days * 360 : 0;               // B57
  r.f25equity        = r.cashInclPayments + r.cashToClose + (+i.estimatedRepairs || 0) * 0.25; // F25
  r.returnOnCash     = r.f25equity > 0 ? r.netProfit / r.f25equity : 0;               // B58
  r.returnOnCashAnnual = r.days > 0 ? r.returnOnCash / r.days * 360 : 0;              // B59
  // cash out of escrow (MASTER IA G56)
  r.cashOutEscrow = r.grossProfit - r.loan1st - (+i.additional1stPayments || 0) - (+i.unused1stCredit || 0)
    - (+i.interestFrom1stPayoff || 0) - (r.totalCashAndReserves + (+i.loan2ndAmount || 0)); // G56
  return r;
}
