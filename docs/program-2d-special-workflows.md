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

A failure midway could therefore leave:

- a partial payroll batch;
- some workers' advances deducted without the rest of the batch;
- repayment rows for only part of the batch; or
- payroll rows without matching daybook rows.

A concurrent retry could also generate duplicate payroll rows and deduct advances again.

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

## Remaining 2D map

### 2D.2 — Supplier Partner non-POS offload

Current strengths:

- Voucher A, Voucher B, charge entries, offload rows, stock movements, inventory updates, and container status updates are largely inside one transaction.
- Prepaid balances use row locks before consumption.

Confirmed gap:

- Container existence/status and location are checked before the transaction.
- Two simultaneous offload requests can both observe `status = open` and enter the posting transaction.
- Some bank/ledger ownership validation inside the transaction still reads through the global `db` connection instead of the transaction handle.

Required work:

- lock the SP container row before status validation;
- revalidate location and posting accounts within the transaction;
- return the existing offload on safe replay or reject an incompatible duplicate;
- preserve all SP voucher numbering, prepaid, parent-agent, stock, and intercompany rules.

### 2D.3 — ERP/factory container offload and own-account freight

Confirmed risk:

- Offload edit reversal runs in one transaction;
- status reset is committed separately;
- the new offload is then executed through another transaction/service;
- SP follow-up journals may run in another transaction.

A failure between those stages can leave a reversed container in an intermediate state. The convergence must preserve exact inventory-value reversal and the existing own/parent/supplier freight policy:

- `own`: freight is excluded from supplier payable and posted to the selected own account;
- `parent`: subsidiary owes the parent including freight;
- `supplier`: supplier payable includes freight.

This area requires a dedicated lifecycle service rather than wrapping the current route superficially.

### 2D.4 — Rental accounting verification

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
- advance deduction capped at gross pay; and
- company/period concurrency-lock scoping.

## Verification limitation

GitHub Actions has repeatedly failed before exposing executable steps or logs. A full build, type-check, browser test, and database-backed transaction test pass is not claimed.
