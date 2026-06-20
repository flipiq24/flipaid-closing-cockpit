# Decisions baked in (override any of these in data/ramona.json)

These were the three open questions. I resolved each with the correct default so the build isn't
blocked. None of them are hard-coded in logic — they're **data inputs** you can change.

## 1. The $63,000 Kiavi construction holdback → Financing, profit-neutral
A construction holdback is part of the $371,000 loan that the lender keeps and releases as rehab
draws. It is **not** extra cash in, and **not** profit. The rehab work it funds is already a cost
line. So:
- Loan proceeds ($371K) = Financing in. Not income.
- Holdback ($63K) = Financing, released against rehab. **Profit-neutral.**
- Rehab spend (budget, then QB actuals) = the real cost that hits profit.
- Payoff ($371K) on the sell side = Financing out. Not an expense.

This is why the IA "Total Cost" excludes loan/holdback/payoff — counting them would double-count rehab
or invent a phantom loss. **If your accounting treats the holdback differently, change it in the
mapping (set those lines' category) and the math re-rolls.**

## 2. What happens to estimates at Final status
Status drives which IA inputs stay live:
- **Estimated** — everything editable (assumptions).
- **Acquired** — buy-side numbers lock; you still tune rehab/hold/sale.
- **Estimated Closing** — sell-side estimate locks; rehab + sale still editable.
- **Final** — rehab estimate is **replaced by QB construction actuals**; only ARV + commission stay live.

## 3. Tax rate
- **Transfer tax**: $1.10 / $1,000, county base, no city add for Apple Valley. Verified exact against
  the sell-side statement ($460,000 → $506.00). **High confidence.**
- **Proration**: 30/360 day-count to match the escrows. Verified exact ($1,562.40/180 × days).
- **Annual rate for proration + supplemental**: placeholder **1.10%**. The 92307 effective rate runs
  ~1.14% with bonds. **Confirm the TRA rate off the actual secured bill for APN 0440-071-20.** The
  tooltip surfaces the APN + county so whoever opens it knows where the number came from.
- **Supplemental**: `(purchase − prior assessed) × annual rate × month factor`, with a second bill when
  the reassessment spans two fiscal years. `priorAssessedValue` is unknown — defaults to 60% of
  purchase until you enter the real assessed value from the county.

> On Ramona the reported profit was **$9,367** and the supplemental tax is most of what's left of it.
> That's why County vs. Supplemental is split into separate lines — so you can see the bite.
