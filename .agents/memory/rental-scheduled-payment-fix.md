---
name: Rental Scheduled Payment Fix
description: Future-dated rental payments must be SCHEDULED (no voucher, no ledger) until their paymentDate arrives; plus billing-day corrections and SQL placeholder fix.
---

## The Bug
A payment dated 2026-07-20 (billing day 20, today 2026-07-16) was posted immediately:
- Created a voucher `Dr Rent Expense / Cr Cash` for the full amount
- Incremented `property_monthly_ledger.paid_amount` immediately
- This inflated Cash by the payment amount 4 days early

## Core Fix: SCHEDULED Payment Flow
In `POST /payments` (and bulk), if `paymentDate > getClientDate(req)`:
- Create `property_payments` rows with `posting_status='SCHEDULED'`
- Same `payment_group_id` for all split rows
- **No voucher created**, **no ledger paid_amount updated**
- Return `{ scheduled: true, paymentDate, paymentGroupId, allocations, message }`

When `paymentDate` arrives, `postDueScheduledRentalPayments()` posts the voucher atomically.

## New Schema Columns (property_payments)
- `posting_status text NOT NULL DEFAULT 'POSTED'` — SCHEDULED / POSTED / VOID
- `payment_group_id text` — groups all split rows of one payment transaction
- `posted_at timestamp` — when SCHEDULED → POSTED transition happened

Migration applied via direct ALTER TABLE (idempotent).

## New Files
- `server/services/rental/rentalPeriodService.ts` — `getRentalBillingDay`, `getRentalPeriodDueDate`, `isRentalPeriodDue`, `isPaymentEffective`, `getDuePeriods`
- `server/services/rental/rentalPaymentPostingService.ts` — `postDueScheduledRentalPayments()` — finds SCHEDULED groups with paymentDate <= asOfDate, posts atomically (advisory lock + idempotency)
- `scripts/repair-rental-payment-accounting.ts` — dry-run/apply repair for retroactive future-dated payments

## New API Endpoints (on each module's urlPrefix)
- `GET /payments/scheduled` — returns SCHEDULED groups for UI display
- `POST /payments/post-scheduled` — manually triggers posting of due SCHEDULED groups
- `DELETE /payments/scheduled/:groupId` — cancels a SCHEDULED group (pre-posting only)

## isRentalPeriodDue — Key Rule
July billing-day 20 is NOT due on July 16. NEVER use `year/month <= now` alone.
Use `asOfDate >= getRentalPeriodDueDate(year, month, billingDay)`.

## SQL Placeholder Fix (accounting.ts)
`getVoucherEntriesByLedger` had broken raw SQL: `v.voucher_date >= ${params.length}` (missing `$`).
Fixed to: `" AND COALESCE(v.effective_date, v.voucher_date) >= $" + params.length`
**Use string concatenation** in `new_string` for `$N` placeholders — the Edit tool strips `$` in template literals.
This was causing 500 errors in accounting/reports/workflow/permissions tests (now fixed).

## Period Filter
Added `"month_to_date"` preset to PeriodPreset type and `Accounts.tsx` now defaults to it.
Month-to-date = fromDate: 1st of month, toDate: today (not month-end).

## ensureMonthlyLedgerRows Protection
Before deleting the current-month's zero-paid ledger row (when today < billingDay),
check that no SCHEDULED payment references it via `sql\`${propertyPayments.postingStatus} = 'SCHEDULED'\``.

## Page-Load Auto-Posting
`rentalUnitsContractsRoutes.ts` GET /units now calls `postDueScheduledRentalPayments()` 
fire-and-forget alongside `postRentAccrualForCompany()` on SHOP page loads.

## Repair Script Usage
```
DATABASE_URL=postgres://... npx tsx scripts/repair-rental-payment-accounting.ts --dry-run
DATABASE_URL=postgres://... npx tsx scripts/repair-rental-payment-accounting.ts --apply --confirm=REPAIR_RENTAL_ACCOUNTING
```
Script accepts `DATABASE_URL` or `RENDER_DATABASE_URL` env var.

## Test Files
- `tests/rental-billing-day-as-of.test.ts` — 20 tests all passing; covers getRentalBillingDay, getRentalPeriodDueDate, isRentalPeriodDue, isPaymentEffective, getMonthRange, getDuePeriods

## Correct Shop Accounting on Post
When posting SCHEDULED shop payments, each allocation is classified:
- Due + prior accrual → Dr Accrued Rent Payable (settles liability)
- Due + no prior accrual → Dr Rent Expense (direct recognition)
- Not-yet-due → Dr Prepaid Rent (prepaid asset)
All allocations Cr Cash for the total.
