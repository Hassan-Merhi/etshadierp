# Program 2 — Phase 2C: POS and Stock Transfers

Started: 2026-07-25

Branch: `refactor/program-2-accounting-convergence`

## 2C.1 completed — concurrent POS creation protection

The POS creation service already owned these writes in one database transaction:

- Sales voucher;
- voucher accounting entries;
- authoritative inventory row locks and deductions;
- sales item rows; and
- Supplier Partner POS accounting when applicable.

The remaining creation race was `clientSaleId` handling. The old fast lookup occurred before the sale transaction and the vouchers schema has no company/client-sale uniqueness constraint. Two simultaneous requests could both see no existing voucher and enter the sale transaction.

The protected path now:

1. keeps the existing fast idempotency lookup;
2. acquires a transaction-scoped PostgreSQL advisory lock keyed by company and `clientSaleId`;
3. repeats the active Sales-voucher lookup while holding that lock;
4. returns the existing sale without inserting accounting, deducting inventory, or writing sales items when another request already committed it; and
5. retries the committed-sale lookup before surfacing inventory errors that may have been caused by the competing successful request.

The lock requires no schema migration and is released automatically on commit or rollback.

### Replay side effects

A transaction-level replay returns the existing voucher, location, and sales items with `_idempotent: true`. It does not repeat:

- detailed create audit;
- intercompany POS auto-transfer; or
- inventory and accounting writes.

No POS price, cost, profit, currency, account-selection, negative-stock, location-access, cash-account, or Supplier Partner formula changed.

## 2C.2 completed — current-state POS edit locking

The POS edit service already reversed inventory, rebuilt sales items, updated the voucher, and rebuilt accounting in one transaction. It also locked sales-item rows.

However, the voucher and old accounting entries were loaded before that transaction. Two overlapping edits could therefore serialize on the sales items while the second edit still used stale:

- source location;
- voucher date;
- stored currency and historical exchange rate;
- payment/revenue account entries; or
- migrated/deleted voucher state.

The edit transaction now:

1. locks the current Sales voucher row for the selected company;
2. rechecks deleted, migrated, Sales-type, and POS location restrictions;
3. resolves the source and target locations from the locked voucher;
4. validates a changed location in the same transaction;
5. reads the Supplier Partner deduction rate from the resolved target location in that transaction;
6. loads the current voucher entries after the voucher lock;
7. locks the current sales-item rows;
8. reverses the current inventory state;
9. rebuilds inventory, sales items, voucher fields, and accounting from the same locked state; and
10. commits or rolls everything back together.

The existing edit response, audit, intercompany recalculation, historical currency behavior, payment-account preservation, and Supplier Partner accounting formulas remain unchanged.

## POS deletion boundary

POS Sales/Receipt deletion remains on the inventory-aware generic deletion path. Program 2B explicitly excludes Receipt vouchers with sales items from the plain Payment/Receipt deletion route, so inventory restoration and sales-item cleanup continue to run.

## 2C.3 completed — stock-transfer lifecycle and deletion safety

### Edit and lifecycle ownership

The repository already contains `saveStockTransferLifecycle`, which:

- locks the transfer header and parent voucher together;
- distinguishes optional drafts, posting, unposting, recovery, and posted edits through `optional` and `inventoryApplied`;
- validates company-owned locations and stock items;
- locks source inventory in deterministic source/item order;
- reverses previously applied stock only when required; and
- applies the replacement transfer atomically.

`stockTransferLifecycleRoutes` is registered before the older direct transfer editor, so the lifecycle service owns active direct edits and the weaker legacy algorithm does not execute for recognized Stock Transfer vouchers. Revision approval remains on its separate transaction-safe workflow.

### Replay-safe deletion

The old generic deletion path loaded the voucher before its transaction and read the transfer header without a row lock. Two concurrent deletion requests could therefore both observe the transfer as applied and reverse the same inventory movement.

A dedicated Admin-only Stock Transfer deletion route now runs before the generic delete handler. One transaction:

1. locks the voucher row;
2. rechecks company ownership, transfer type, migrated protection, and `deletedAt`;
3. locks the transfer header and item rows;
4. decides reversal from `inventoryApplied`, retaining the non-optional fallback for legacy records;
5. validates the persisted source, destination, and stock-item company scope;
6. reverses items in deterministic source/item order;
7. removes the transfer items and header;
8. preserves employee/intercompany pending cleanup when malformed legacy links exist; and
9. soft-deletes the voucher.

A second deletion waits for the first transaction and then returns `replayed: true` without moving stock again.

The older mixed bulk-delete implementation is temporarily blocked when the request contains a Stock Transfer voucher because it does not own the same row locks. Stock Transfer vouchers must be deleted individually until bulk deletion is migrated to the lifecycle service.

## Active registry correction

During Phase 2C, the audit found that Program 2 central routes had been added to `server/routes/vouchers/index.ts`, while the running server imports `server/routes/voucherRoutes.ts`. The active registry is now authoritative and registers:

- central generic voucher creation;
- Payment/Receipt creation, editing, and deletion;
- Journal creation, editing, and deletion;
- Stock Transfer deletion; and
- Stock Transfer lifecycle and revision routes

before their legacy compatibility handlers.

`server/routes/vouchers/index.ts` is now only a compatibility re-export of the active registry. The generic voucher-entry routes remain registered once by `server/routes.ts` immediately after the protected registry, removing the previous duplicate registration.

## Focused regression coverage added

- absent and provided POS retry identities;
- stable company-scoped POS advisory lock keys;
- lock-key separation across companies and sale IDs;
- locked-location fallback when an edit does not submit a new location;
- explicit location-change resolution;
- POS-user location-change rejection against the locked voucher state;
- all persisted Stock Transfer voucher-type spellings;
- current and legacy deletion-reversal policy;
- deterministic deletion item ordering;
- applied transfer deletion restoring inventory exactly once; and
- optional unapplied transfer deletion without inventory movement.

## Intentionally unchanged

- POS accounting entry formulas;
- POS inventory costing and negative-stock policy;
- POS deletion and inventory restoration logic;
- Stock Transfer posting, unposting, revision formulas, and inventory costing;
- container, Supplier Partner non-POS, payroll, and rental posting;
- database schema; and
- historical records.

## Verification limitation

GitHub Actions continues to fail before exposing executable steps or logs. A complete build, type-check, browser test, and database-backed concurrency test pass is not claimed.
