# Program 2 — Phase 6: Supplier Partner accounting

Status: complete

## Protected live boundaries

Supplier Partner remains a specialized accounting and inventory workflow rather than a generic voucher reinterpretation.

- POS sales use the Supplier Partner accounting context from company settings and the selected location.
- Supplier payable, Supplier Partner profit, stock-cost clearing, and payable-deduction clearing accounts remain company-scoped.
- Supplier cost is derived from the inventory average rate, including landed/offloading cost already stored on inventory.
- Per-quantity payable deductions reduce Supplier Cash Payable through the dedicated clearing path; they are not reclassified as income or expense.
- POS entries preserve transaction currency, historical exchange rate, and historical USD base amounts.
- POS create/edit/replay protections from Program 2 Phase 4 continue to own accounting, stock deduction, sales items, and Supplier Partner effects in one transaction.

## Migration and cutover boundary

Supplier Partner migration remains isolated behind the existing controlled workflow.

- Prepare, Finalize, and Rollback remain explicit operations.
- Source and target company ownership must be validated.
- Inventory, accounting, migrated sales, containers, supplier links, users, roles, locations, cash mappings, sessions, and presence must be reconciled before finalization.
- Cutover write guards and target holds remain active until verification succeeds.
- Rollback must restore reversible inventory, user/location/cash mappings, container and Goods-OTW links, and protected manual charge mappings.
- Historical rows are not silently edited by normal Supplier Partner pages.

## Replay and duplication safety

- Replayed POS creation must not duplicate payable, profit, clearing, inventory, sales-item, audit, or intercompany effects.
- POS edits must rebuild Supplier Partner accounting from the locked current sale and current target location.
- A failed Supplier Partner transaction must roll back voucher, entries, inventory, and Supplier Partner effects together.
- Migration Prepare/Finalize/Rollback operations must remain idempotent and audit-visible.

## Intentionally isolated

The following remain outside generic Program 2 voucher cutovers:

- Supplier Partner opening-stock and alias setup;
- profit-share opening balances supplied by an operator;
- Sales Form exports and reporting snapshots;
- container conversion and Goods-OTW reconciliation;
- Phase 4 migration Prepare, Finalize, and Rollback;
- historical repair or cutover release commands.

No live Supplier Partner formula, payable balance, profit split, inventory quantity, historical rate, migrated record, database schema, permission, or user interface is changed by this completion slice.
