# Program 2D — Special Workflow Accounting Convergence

Started: 2026-07-25

Branch: `refactor/program-2d-special-workflows`

## Scope

Program 2D covers:

1. factory payroll generation and lifecycle safety;
2. Supplier Partner non-POS offload/posting;
3. ERP container offload, edit reversal, and freight policy; and
4. rental accrual/payment posting and reversal.

No historical repair, migration, deployment, or production database command is part of this branch.

## 2D.1 — Atomic factory payroll generation — complete

### Previous failure window

`POST /api/factory/payroll/generate` previously wrote one worker at a time through the global database connection. A failure midway could leave a partial payroll batch, partially reduced advances, incomplete repayment rows, or payroll rows without matching daybook rows. Concurrent retries could also duplicate payroll rows and advance deductions.

### Protected behavior

The protected route is registered before the legacy generation route and preserves the existing array response and salary formulas.

Generation now:

1. validates the selected company and exact payroll period;
2. acquires a transaction advisory lock scoped to company and period;
3. loads existing payroll rows under the lock;
4. returns the existing batch for an exact retry;
5. creates only missing workers for a historical partial batch;
6. locks salary-deduction advances in deterministic worker/ID order;
7. writes payroll rows, advance reductions, repayment rows, and `PAYROLL_GENERATED` daybook rows in one transaction; and
8. commits the whole batch or rolls everything back.

The existing monthly, daily, per-bale, per-kilogram, and advance-cap formulas remain unchanged. Payroll mark-paid, undo, deletion, and `PAYROLL-GEN` rebuild routes remain on their existing specialized paths.

## 2D.2 — Supplier Partner non-POS offload — complete by scope

The existing SP posting transaction remains authoritative for voucher numbering, Goods OTW reversal, stock recognition, prepaid consumption, parent-agent journals, inventory, and intercompany behavior.

A guard registered before `POST /api/sp/offload` now:

1. resolves the selected Supplier Partner company;
2. acquires a company/container advisory lock for the full request;
3. rejects simultaneous posting with `SP_OFFLOAD_IN_PROGRESS`;
4. holds the container with `FOR KEY SHARE`, allowing the posting transaction to update status;
5. holds the location, SP control accounts, bank accounts, current-company ledgers, and parent-agent ledgers with `FOR SHARE`, preventing ownership or soft-delete changes while posting runs;
6. validates all referenced accounts before the legacy transaction writes;
7. returns an existing offload only for an exact compatible retry; and
8. rejects changed retries with `SP_OFFLOAD_REPLAY_MISMATCH`.

Replay matching includes offload date, location, landed total, charge type, description, prepaid ID, bank ID, ledger ID, and parent-agent ID. The replay response preserves the normal camelCase `sp_offloads` shape.

The large legacy posting route was deliberately not duplicated or superficially replaced.

## 2D.3 — ERP container offload and freight — hardened, lifecycle extraction remaining

### Protection implemented

A guard registered before `POST /api/containers/:id/offload` now:

- scopes the container to the selected company;
- serializes offload and offload-edit requests by company/container;
- accepts only `OTW` and `OFFLOADED` lifecycle states;
- validates and locks the destination location;
- locks purchase orders and PO line items used for costing;
- validates and locks all selected charge accounts before an old offload can be reversed;
- validates own-account freight against the current company;
- validates parent-agent accounts against the parent company; and
- accepts parent-paid freight accounts from the current or parent company to preserve same-company and fallback posting behavior.

Location and account rows use `FOR SHARE`, blocking concurrent soft deletion. The container uses `FOR KEY SHARE`, allowing the existing offload transaction to update status without deadlocking.

### Freight policy verified

The existing centralized PO calculator already applies the required policy:

- `supplier`: freight remains in the supplier share;
- `own`: freight is excluded from supplier payable and posted to the selected own account; and
- `parent`: freight is excluded from the supplier share and handled through parent/same-company posting rules.

Regression coverage locks these formulas.

### Remaining lifecycle boundary

The legacy edit path still performs:

1. exact inventory and voucher reversal in one transaction;
2. container status reset separately;
3. the replacement offload in another transaction; and
4. Supplier Partner follow-up journals in another transaction when applicable.

The new guard prevents concurrent edits and rejects predictable validation failures before reversal, substantially reducing the failure window. It does not make those separate write transactions atomic. Completing 2D.3 requires extracting the existing reversal, repost, and SP follow-up logic into one transaction-owned lifecycle service. No safe reusable service currently exists in the repository.

## 2D.4 — Rental payment reversal — complete by scope

Rental creation and scheduled posting already use one authoritative transaction core and a deterministic payment-group advisory lock.

The previous deletion route read one split row before its transaction and subtracted that row's amount from the monthly ledger. Concurrent deletion or deletion of one row from a split payment could therefore leave incorrect payment groups, vouchers, recognition journals, or `paid_amount` values.

A central deletion route now runs before the legacy route for ERP, Factory, and Properties rental modules. It:

1. uses the same deterministic payment-group advisory lock as scheduled posting;
2. locks all rows in the payment group in ID order;
3. deletes the complete split-payment group;
4. removes linked intercompany transfers and their vouchers;
5. soft-deletes the shared rental payment voucher only when no outside payment references it;
6. soft-deletes the related `AP-CLEAR-*` voucher;
7. soft-deletes the `ADV-REC-*` recognition journal;
8. clears recognition-journal links and advance flags;
9. resets guarantee-release state when applicable; and
10. rebuilds monthly `paid_amount` from the remaining `POSTED` payment rows.

Deleting a scheduled payment therefore cannot reduce a legitimate posted balance. Prepaid and advance flags reset when no posted payment remains for the affected month.

## Focused coverage added

- factory payroll formulas and company/period lock scoping;
- SP company/container lock scoping and exact replay compatibility;
- ERP container account collection and lifecycle lock scoping;
- supplier, own-account, and parent-paid freight totals;
- posted split-rental group deletion;
- rental recognition-voucher cleanup; and
- scheduled-payment deletion preserving remaining posted totals.

## Current status

- 2D.1 Payroll generation: complete.
- 2D.2 Supplier Partner offload: complete by scope.
- 2D.3 ERP container lifecycle: guarded and prevalidated; full transaction extraction remains.
- 2D.4 Rental reversal: complete by scope.

## Verification limitation

GitHub Actions has repeatedly failed before exposing executable steps or logs. A full build, type-check, browser test, and database-backed transaction test pass is not claimed.
