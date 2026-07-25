# Program 2D — Special Workflow Accounting Convergence

Started: 2026-07-25

Branch: `refactor/program-2d-special-workflows`

## Scope

Program 2D completes accounting convergence for:

1. factory and ERP container offload, including own-account freight;
2. Supplier Partner non-POS offload/posting;
3. factory payroll generation, payment, undo, and deletion; and
4. rental accrual/payment posting and reversal.

No historical repair, migration, deployment, or production database command is part of this branch.

## 2D.1 — Atomic factory payroll generation

### Previous failure window

`POST /api/factory/payroll/generate` previously performed these writes one worker at a time through the global database connection:

- insert `factory_payrolls` row;
- reduce one or more worker advance balances;
- insert advance repayment rows;
- insert `PAYROLL_GENERATED` daybook row; and
- continue to the next worker.

A failure midway could therefore leave a partial payroll batch, partially reduced advances, incomplete repayment rows, or payroll rows without matching daybook rows. A concurrent retry could also generate duplicate payroll rows and deduct advances again.

### Protected behavior

The protected route is registered before the legacy payroll route and preserves its array response shape and salary formulas.

Generation now:

1. validates company and exact `YYYY-MM-DD` period values;
2. opens one database transaction;
3. acquires a transaction advisory lock scoped to company + exact payroll period;
4. loads existing payroll rows for that exact period under lock;
5. returns the existing batch when all active workers already have payroll rows;
6. fills only missing workers when a historical partial batch exists;
7. locks outstanding salary-deduction advances in deterministic worker/id order;
8. inserts payroll rows, advance reductions, repayment rows, and daybook rows in the same transaction; and
9. commits the entire batch or rolls everything back.

### Formula compatibility

The following legacy calculations are preserved:

- Monthly workers use attendance-based daily salary when attendance exists, otherwise calendar-month proration.
- Daily workers use present/half-day totals when attendance exists, otherwise weekdays in the selected period.
- Per Bale workers use finalized bale count × per-bale rate.
- Per KG workers use finalized bale weight × per-kg rate.
- Overtime, bonuses, and deductions remain initialized at zero during generation.
- Salary-deduction advances are capped at gross pay and settled oldest database ID first.
- New payroll rows remain `DRAFT`.

No mark-paid, payment voucher, payroll undo, payroll delete, or `PAYROLL-GEN` rebuild behavior changed in this slice.

## 2D.2 — Supplier Partner non-POS offload in progress

### Existing strengths retained

- Voucher A, Voucher B, charge entries, offload rows, stock movements, inventory updates, and container status updates remain owned by the existing posting transaction.
- Prepaid balances continue to use row locks before consumption.
- Existing SP voucher numbering, stock-cost formulas, parent-agent entries, prepaid treatment, and intercompany logic are unchanged.

### Concurrency and replay protection implemented

A guard registered before `POST /api/sp/offload` now:

1. resolves the selected Supplier Partner company;
2. acquires a company/container advisory lock for the complete request lifetime;
3. rejects a simultaneous request with `SP_OFFLOAD_IN_PROGRESS`;
4. validates the requested location belongs to the company;
5. loads any completed offload and its persisted landed-charge allocation;
6. returns the existing offload only when date, location, total landed cost, charge types, descriptions, prepaid IDs, bank IDs, ledger IDs, and parent-agent IDs match;
7. returns `SP_OFFLOAD_REPLAY_MISMATCH` for a changed retry; and
8. preserves the normal camelCase offload response shape on replay.

The guard does not recalculate or replace any SP accounting formula. The legacy transaction continues only for an open container with no completed offload.

### Remaining SP boundary

Three bank/ledger ownership checks within the legacy posting transaction still use the global database connection rather than the transaction handle. They are read-only checks and the new guard prevents duplicate offload posting, but they should still be converted to transaction-owned reads before 2D.2 is marked complete.

## 2D.3 — ERP/factory container offload and own-account freight

Confirmed risk:

- Offload edit reversal runs in one transaction.
- Status reset is committed separately.
- The new offload is then executed through another transaction/service.
- SP follow-up journals may run in another transaction.

A failure between those stages can leave a reversed container in an intermediate state. The convergence must preserve exact inventory-value reversal and the existing own/parent/supplier freight policy:

- `own`: freight is excluded from supplier payable and posted to the selected own account;
- `parent`: subsidiary owes the parent including freight;
- `supplier`: supplier payable includes freight.

This area requires a dedicated lifecycle service rather than wrapping the current route superficially.

## 2D.4 — Rental accounting verification

The current rental payment service already provides:

- one authoritative posting core;
- transaction-owned payment, recognition journal, and ledger updates;
- advisory locking and idempotency;
- scheduled-to-posted convergence; and
- atomic advance/prepaid flags.

Program 2D should add lifecycle regression coverage and inspect deletion/reversal boundaries before changing behavior. No replacement service is currently justified.

## Focused coverage added

- monthly attendance-based payroll calculation;
- weekday fallback for daily workers;
- per-bale and per-kilogram earnings;
- advance deduction capped at gross pay;
- company/period payroll concurrency-lock scoping;
- company/container SP offload lock scoping;
- exact compatible replay matching; and
- conflict detection for changed date, location, landed total, description, or charge-account allocation.

## Verification limitation

GitHub Actions has repeatedly failed before exposing executable steps or logs. A full build, type-check, browser test, and database-backed transaction test pass is not claimed.
