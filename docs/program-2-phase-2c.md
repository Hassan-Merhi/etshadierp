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

## Stock transfer map

Stock-transfer revision approval already has a strong transaction boundary with transfer/voucher row locks, company/location/item validation, and deterministic inventory updates.

The older direct stock-transfer edit route still needs a separate convergence slice. Its current audit snapshot is read before the transaction, and the transaction reads the transfer header and old items without first locking the transfer/voucher scope. The next stock-transfer work must:

- lock the voucher and transfer header before resolving old locations and items;
- validate source and destination company ownership inside the transaction;
- lock item and inventory rows in deterministic order;
- preserve `inventoryApplied` and optional-transfer behavior;
- prevent simultaneous edit or retry double reversal; and
- leave the newer revision-approval workflow unchanged.

## Focused regression coverage added

- absent and provided POS retry identities;
- stable company-scoped POS advisory lock keys;
- lock-key separation across companies and sale IDs;
- locked-location fallback when an edit does not submit a new location;
- explicit location-change resolution; and
- POS-user location-change rejection against the locked voucher state.

## Intentionally unchanged

- POS accounting entry formulas;
- POS inventory costing and negative-stock policy;
- POS deletion and inventory restoration;
- stock-transfer creation, edit, deletion, and revision approval;
- container, Supplier Partner non-POS, payroll, and rental posting;
- database schema; and
- historical records.

## Verification limitation

GitHub Actions continues to fail before exposing executable steps or logs. A complete build, type-check, browser test, and database-backed concurrency test pass is not claimed.
