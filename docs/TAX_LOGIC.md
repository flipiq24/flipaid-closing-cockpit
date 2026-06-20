# California tax logic (verified against the two statements)

## Documentary transfer tax (county)
`transferTax = salePrice × $1.10 / $1,000`
- Sell side: $460,000 × 1.10/1000 = **$506.00** — matches the statement exactly.
- Apple Valley adds **no** city transfer tax. County base only.

## Property tax proration — 30/360 day-count
CA fiscal year Jul 1 – Jun 30, two installments (1st = Jul–Dec, 2nd = Jan–Jun).
The escrows used a 30/360 day-count. Verified:
- Buy side: $1,562.40 semi-annual ÷ 180 × **54 days** (11/7 → 1/1) = **$468.72** exact.
- Sell side: ÷ 180 × **12 days** (6/18 → 6/30) = **$104.16** exact.

`countyProration = semiAnnualBill / 180 × days`

## Supplemental vs. County — why we split them
- **County** = the regular ad-valorem proration above (the existing bill, split by days).
- **Supplemental** = the reassessment bite when ownership/value changes:
  `(purchasePrice − priorAssessedValue) × annualRate × monthFactor`
  A **second** supplemental bill applies when the reassessment spans two fiscal years (closings in
  roughly months Jan–May). This is what the old workbook's V24:X35 factor table modeled.
- We split them because on this deal the supplemental is **most of the remaining margin** — the
  workbook reported $9,367 profit with the note "Need Supplemental Tax EST from Tony."

## Inputs you must confirm
- `annualTaxRatePct` — placeholder 1.10%. 92307 effective ~1.14% with bonds. Pull the TRA rate off the
  secured bill for **APN 0440-071-20, San Bernardino County**.
- `priorAssessedValue` — needed for the supplemental base. Defaults to 60% of purchase until entered.

> The county portals (mytaxcollector / assessor) are JavaScript lookup apps that can't be queried by
> APN through automated tools — the exact current secured bill has to be read off the county site or
> the physical bill once and pasted into `data/ramona.json`.
