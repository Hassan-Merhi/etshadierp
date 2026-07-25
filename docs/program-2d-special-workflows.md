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

`POST /api/factory/payroll/generate` is protected by a company/period transaction advisory lock. Exact retries return the existing batch, historical partial batches create only missing workers, and payroll rows, advance reductions, repayment rows, and `PAYROLL_GENERATED` daybook rows commit together.

The existing monthly, daily, per-bale, per-kilogram, and advance-cap formulas remain unchanged. Specialized mark-paid, undo, deletion, and `PAYROLL-GEN` rebuild routes remain on their existing paths.

## 2D.2 — Supplier Partner non-POS offload — complete by scope

The existing SP posting transaction remains authoritative for voucher numbering, Goods OTW reversal, stock recognition, prepaid consumption, parent-agent journals, inventory, and intercompany behavior.

A guard registered before `POST /api/sp/offload` now:

1. resolves the selected Supplier Partner company;
2. acquires a company/container advisory lock for the full request;
3. rejects simultaneous posting with `SP_OFFLOAD_IN_PROGRESS`;
4. holds the container with `FOR KEY SHARE`, allowing the posting transaction to update status;
5. holds the location, SP control accounts, bank accounts, current-company ledgers, and parent-agent ledgers with `FOR SHARE`;
6. validates all referenced accounts before posting;
7. returns an existing offload only for an exact compatible retry; and
8. rejects changed retries with `SP_OFFLOAD_REPLAY_MISMATCH`.

Replay matching includes offload date, location, landed total, charge type, description, prepaid ID, bank ID, ledger ID, and parent-agent ID.

## 2D.3 — Atomic ERP container offload and freight — complete

### Active route ownership

The concurrency guard and central lifecycle route are registered before the legacy container-offload route for both:

- `POST /api/containers/:id/offload`; and
- `PATCH /api/containers/:id/offload`.

The active POST and PATCH paths no longer execute the old reverse-commit-reset-repost sequence. The older route remains available only for reverse-offload and unrelated compatibility endpoints.

### One transaction-owned lifecycle

The central service now commits the following as one database transaction:

1. selected-company and lifecycle-state validation;
2. destination, purchase-order, line-item, and account validation;
3. exact reversal of stored offload quantities and values when editing;
4. legacy value reconstruction only when historical offload-item rows are unavailable;
5. deletion of prior offload charge vouchers and SP follow-up journals;
6. inventory cost corrections;
7. destination inventory quantity, value, and moving-average updates;
8. container status, offload date, and duty synchronization;
9. purchase-voucher description synchronization;
10. duties, office, transport, transfer, and additional-charge vouchers;
11. the replacement `container_offloads` record;
12. exact `container_offload_items` snapshots; and
13. Supplier Partner OTW reversal, stock recognition, settlement, and parent-agent journals.

Any failure rolls back the reversal and replacement together. An edited container can no longer be left reversed, reset to OTW, or missing its replacement accounting because a later stage failed.

### State protection

The lifecycle refuses to post when:

- the container belongs to another company;
- the state is not `OTW` or `OFFLOADED`;
- PATCH is used for a container that is not offloaded;
- an offloaded container is missing its offload record;
- an OTW container already has an offload record;
- multiple offload records exist;
- the destination, purchase orders, line items, or posting accounts are invalid; or
- no positive stock quantity is available.

The request guard serializes POST and PATCH by company/container and locks all source ownership rows for the complete request.

### Freight policy preserved

The centralized PO calculator remains the source of truth:

- `supplier`: freight remains in the supplier share;
- `own`: freight is excluded from supplier payable and posted to the selected own account; and
- `parent`: freight is excluded from the supplier share and handled through parent/same-company posting rules.

Regression coverage locks these formulas. The offload lifecycle does not rewrite purchase-voucher freight allocation.

### Parent-company schema alignment

The database and existing routes already use `companies.parent_company_id`. Program 2D adds that existing column to the Drizzle `companies` definition so the atomic lifecycle can resolve the configured parent company transactionally. This is a TypeScript schema alignment only; no database migration was run.

### Derived post-commit synchronization

Sales-item cost synchronization remains a non-fatal derived update after the accounting and inventory transaction commits. A failure there is logged and does not roll back a valid offload.

## 2D.4 — Rental payment reversal — complete by scope

Rental creation and scheduled posting already use one authoritative transaction core and a deterministic payment-group advisory lock.

A central deletion route now runs before the legacy route for ERP, Factory, and Properties rental modules. It:

1. uses the same payment-group advisory lock as scheduled posting;
2. locks and deletes the complete split-payment group;
3. removes linked intercompany transfers and their vouchers;
4. soft-deletes the shared rental payment voucher only when no outside payment references it;
5. soft-deletes related `AP-CLEAR-*` and `ADV-REC-*` vouchers;
6. clears recognition links and obsolete advance/prepaid flags;
7. resets guarantee-release state when applicable; and
8. rebuilds monthly `paid_amount` from the remaining `POSTED` rows.

Deleting a scheduled payment cannot reduce a legitimate posted balance.

## Focused coverage added

- factory payroll formulas and company/period lock scoping;
- SP company/container lock scoping and exact replay compatibility;
- ERP container account collection and lifecycle lock scoping;
- supplier, own-account, and parent-paid freight totals;
- posted split-rental group deletion;
- rental recognition-voucher cleanup; and
- scheduled-payment deletion preserving remaining posted totals.

## Final status

- 2D.1 Payroll generation: complete.
- 2D.2 Supplier Partner offload: complete by scope.
- 2D.3 ERP container lifecycle: complete; active create and edit paths are atomic.
- 2D.4 Rental reversal: complete by scope.

## Verification limitation

GitHub Actions has repeatedly failed before exposing executable steps or logs. A full build, type-check, browser test, and database-backed transaction test pass is not claimed.
