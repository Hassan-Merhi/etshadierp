# Program 2 — Phase 4: POS and Stock Transfers

Status: complete

## POS creation

The current POS sale service owns the Sales voucher, accounting entries, inventory row locks and deductions, sales-item rows, and Supplier Partner POS accounting in one database transaction.

Duplicate submission protection uses the company and `clientSaleId` as a transaction-scoped identity. The protected path performs a fast existing-sale lookup, acquires a PostgreSQL advisory lock, repeats the lookup while holding that lock, and returns the committed sale with `_idempotent: true` instead of posting accounting or deducting stock again.

A replay does not repeat detailed audit output, intercompany POS auto-transfer, inventory writes, accounting writes, or sales-item inserts.

## POS editing

The POS edit transaction locks the current Sales voucher before resolving source state. It rechecks company ownership, deleted and migrated state, voucher type, and POS location restrictions; resolves source and target locations; reads current voucher entries; locks sales items; reverses current inventory; and rebuilds inventory, sales items, voucher fields, and accounting from the same locked state.

Existing pricing, cost, profit, currency, historical exchange-rate, payment-account, negative-stock, location-access, and Supplier Partner formulas remain unchanged.

## POS deletion

POS Sales and Receipt deletion remains on the inventory-aware specialized deletion path. Receipt vouchers containing sales items must not use the plain Payment/Receipt deletion route because deletion must restore inventory and remove sales-item state atomically.

## Stock Transfer lifecycle

`saveStockTransferLifecycle` remains the authoritative active Stock Transfer lifecycle. It locks the transfer header and parent voucher, distinguishes draft, posting, unposting, recovery, and posted-edit states, validates company-owned locations and stock items, locks source inventory in deterministic order, reverses previously applied inventory only when required, and applies the replacement transfer atomically.

The lifecycle and revision routes must remain registered before the older direct editor.

## Stock Transfer deletion

The dedicated Admin-only deletion route locks the voucher, transfer header, and transfer items; rechecks company ownership, migrated protection, transfer type, and deletion state; decides reversal from `inventoryApplied` with the legacy fallback; validates persisted location and stock-item scope; reverses inventory in deterministic order; removes transfer rows; preserves required employee and intercompany cleanup; and soft-deletes the voucher.

A repeated deletion returns `replayed: true` and does not move inventory again. Mixed bulk deletion containing Stock Transfer vouchers remains blocked until it can own the same locks and lifecycle rules.

## Preserved boundaries

No POS accounting formula, price, cost, profit, negative-stock policy, historical currency rule, Supplier Partner formula, Stock Transfer costing rule, posting/unposting formula, database schema, or historical record is changed by this completion slice.

Containers, Supplier Partner non-POS workflows, payroll, rentals, and Properties remain outside Phase 4.
