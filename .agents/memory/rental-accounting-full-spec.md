---
name: Rental accounting full spec
description: All 17 sections + 11 follow-up fixes implemented. Fixes cover: expected_amount for future months, paymentDate vs asOfDate classification, payer companyId on payments, asOfDate propagation through accrual service, sequential shop processing, detail endpoint with per-row backend fields, frontend split payment sections, shops summary non-negative outstanding, repair script (B/D/E/F), reconciliation Type D/E + balance fields, Admin-only reconciliation endpoint.
---

## What was built

Full rental payment accounting overhaul across 17 sections.

## Key architecture decisions

### SCHEDULED/POSTED state machine
- `createRentalPaymentGroup` in `rentalPaymentPostingService.ts` always creates SCHEDULED rows first, then immediately calls `postGroupCore` if paymentDate <= clientDate.
- `scheduleFuturePayment: boolean` flag (default false) is required for future-dated payments — without it, the route returns 400.
- Vouchers are only created during `postGroupCore`, never during SCHEDULED row creation.

### Billing-day-aware outstanding
- `ensureMonthlyLedgerRows(contractId, asOfDate?)` now uses `getDuePeriods(startDate, billingDay, asOf)` — creates rows only for periods whose billing date has arrived.
- Outstanding computation in `/api/*/rental/units` uses POSTED `property_payments` sum (not `paidAmount` cache) and `getRentalPeriodDueDate` per contract for accurate expected amounts.
- `scheduledAmount`, `prepaidCredit`, `billingDay`, `nextBillingDate` now returned in units endpoint response.

### Repair script (6 types A–F) — updated
- `scripts/repair-rental-payment-accounting.ts` covers A=future POSTED→SCHEDULED, B=wrong-entry (now rebuilds Dr-AP/Cr-Cash entries), C=paid_amount cache drift, D=boolean flag repair (uses `true` not accrual_voucher_id), E=deleted-voucher orphan (clears dangling accrual_voucher_id), F=DB-level posting (status+ledger; vouchers need app re-run).
- Type D bug was: `CASE WHEN $1 THEN accrual_voucher_id` assigned integer to boolean column — fixed to `true`.
- Type E only flags rows where accrual_voucher_id references a deleted or missing voucher record.
- Type F now updates posting_status + paid_amount; call `/api/erp/rental/post-scheduled` afterwards for full voucher creation.

### Reconciliation service — updated
- `server/services/rental/rentalReconciliationService.ts` — `runRentalReconciliation(companyId, module, asOf)`.
- Endpoint: `GET /api/*/rental/reconciliation?asOf=YYYY-MM-DD` — **Admin/Developer role required** (enforced in `rentalRouteFactory.ts`).
- Type D: only flags rows whose `accrual_voucher_id` references deleted/missing voucher (not all unpaid accruals).
- Type E: uses `MAKE_DATE` + real last-day-of-month calc (not `LEAST(..., 28)`).
- Response now includes `balances` object: `{totalExpectedAsOf, totalPostedPaid, totalScheduledPending, totalAccrualPayablePosted, netOutstanding}`.

### Other fixes
- `accountRoutes.ts` line ~285: `balEndDate` now defaults to `getClientDate(req)` so future vouchers are excluded from account balances.
- `employeeNetPositionRoutes.ts` lines 292 & 778: changed `lte(vouchers.voucherDate, asOf)` to `sql\`COALESCE(effectiveDate, voucherDate) <= asOf\``.
- `GET /api/*/rental/payments`: now includes `postingStatus`, `paymentGroupId`, `postedAt`; accepts `?status=` filter.

### Frontend (PropertyRentalPage.tsx)
- `Unit` type extended with `scheduledAmount`, `prepaidCredit`, `billingDay`, `nextBillingDate`, `totalPaid`.
- `PaymentForm` and `BulkPaymentDialog` both have `scheduleFuturePayment` Switch (auto-shown when paymentDate > today).
- Unit table has 2 new columns: Scheduled amount + Next Billing date.
- Statement tab: `isPrepaid` badge (+credit) for months where paid > expected.

## Tests
- `tests/rental-payment-accounting-reconciliation.test.ts` — 20 scenarios covering SCHEDULED/POSTED state machine, reconciliation detection, repair dry-run, idempotency.

**Why:** Rental payments were being posted immediately regardless of date, causing wrong accounting for future-dated payments and incorrect outstanding balances.
