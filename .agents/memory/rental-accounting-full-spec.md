---
name: Rental accounting full spec
description: All 17 sections of the rental accounting spec implemented; key architecture decisions and file locations.
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

### Repair script (6 types A–F)
- `scripts/repair-rental-payment-accounting.ts` covers: A=future POSTED→SCHEDULED, B=wrong-entry shop voucher flagging, C=paid_amount cache drift, D=flag drift, E=orphan accruals, F=overdue SCHEDULED.
- Type E (orphan accruals) correctly shows existing unmatched accruals — not a bug.
- Type F repair is advisory — triggers via app's scheduler, not inline.

### Reconciliation service
- `server/services/rental/rentalReconciliationService.ts` — `runRentalReconciliation(companyId, module, asOf)`.
- Endpoint: `GET /api/*/rental/reconciliation?asOf=YYYY-MM-DD` — registered in `rentalRouteFactory.ts`.

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
