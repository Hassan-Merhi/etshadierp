# Program 2 — Phase 8: Rentals and Property Accounting

## Scope

This phase formalizes the existing rental/property posting boundary without changing live formulas or historical records.

## Protected invariants

1. Rental contracts, units, monthly ledger rows, cash accounts, vouchers, and payment rows must remain company- and module-scoped.
2. Scheduled payments remain non-posting until their due date; posting status is authoritative.
3. The same posting engine must own immediate payments and scheduled-to-posted transitions.
4. Advisory locking and posting-state checks must prevent duplicate vouchers or duplicate monthly-ledger effects.
5. Accrued rent payments preserve Dr Accrued Rent Payable / Cr Cash.
6. Due but unaccrued payments preserve Dr Advance Rent Paid / Cr Cash plus Dr Rent Expense / Cr Advance Rent Paid recognition.
7. Not-yet-due payments preserve Dr Prepaid Rent / Cr Cash.
8. Mixed-period payments remain one balanced cash voucher with the correct debit accounts.
9. Transaction currency, historical exchange rate, and historical USD base amounts must remain attached to the persisted accounting entries.
10. Monthly allocation uses POSTED payment rows as the authoritative paid total; scheduled rows must not make a month appear paid.
11. Earliest-outstanding allocation remains billing-day aware and must not skip an unpaid due period.
12. Shared-company rental payments must preserve owner-company and linked-company boundaries.
13. Deletion must reverse the exact linked monthly-ledger paid amount, remove the property-payment linkage, and reverse or delete only the voucher created by that payment lifecycle.
14. Repeated deletion or scheduled posting must be replay-safe and cannot move cash or monthly-ledger balances twice.
15. Property-linked Payment/Receipt vouchers remain on rental-aware cleanup paths rather than generic accounting deletion when linkage exists.
16. Accrual generation, scheduled posting, bulk payment processing, auto-transfer, contract setup, and monthly-ledger repair remain specialized rental workflows.

## Compatibility boundaries

The following behavior is intentionally preserved:

- Shops and other rental modules retain their configured expense and income account names.
- Contract billing day controls when a period becomes due.
- Future payments can be stored as SCHEDULED without affecting paid balances.
- `usedAdvanceAccount` and `usedPrepaidAccount` flags are set atomically with posting.
- Intercompany auto-transfer remains a post-commit or dedicated rental compatibility effect.
- Generic voucher routes must not reinterpret rental allocation, accrual, prepaid, advance, or shared-contract semantics.

## Completion evidence

- `server/services/rental/rentalPaymentPostingService.ts` is the authoritative payment-posting service.
- `server/routes/rental/rentalPaymentsAccrualRoutes.ts` owns payment creation, bulk processing, accrual actions, and full reversal.
- The central Payment/Receipt deletion path preserves linked `propertyPayments` and monthly-ledger cleanup for compatibility.
- The focused verifier fails closed if these ownership markers disappear.
