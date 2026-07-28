# Program 2 — Phase 8 Complete

Program 2 Phase 8 is complete for the current rental and property-accounting boundary.

Completed:

- immediate and scheduled rental payment posting ownership;
- accrued, due-unaccrued, prepaid, and mixed-period accounting preservation;
- billing-day-aware earliest-outstanding allocation;
- POSTED-payment authority for monthly paid totals;
- company, module, contract, unit, cash-account, and shared-contract boundaries;
- transaction-currency and historical-rate preservation;
- advisory-lock and posting-state replay protection;
- rental-aware full reversal and property-payment cleanup;
- monthly-ledger paid-amount reversal;
- generic Payment/Receipt deletion compatibility for linked property payments;
- specialized accrual, bulk payment, auto-transfer, monthly-ledger, contract, and repair boundaries;
- focused fail-closed static verification.

Verification command:

```bash
node scripts/verify-program2-phase8-rentals.mjs
```

This completion slice adds documentation and static verification only. It changes no live rent amount, billing day, allocation, accrued/prepaid/advance formula, cash balance, monthly-ledger value, currency rate, contract, database schema, permission, or user interface.

The verifier was not executed locally. TypeScript, tests, build, database-backed rental execution, deployment, and production behavior are not claimed as passed.
