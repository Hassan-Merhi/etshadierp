# Combo 4F TypeScript Audit

## Scope

Combo 4F reviews the remaining fiscal-transfer, Supplier Partner, and inventory data-model TypeScript diagnostics after Combo 4E.

## Result

- Starting repository baseline: **18 diagnostics across 7 files**
- Final repository baseline: **8 diagnostics across 7 files**
- Removed: **10 diagnostics**
- New diagnostics: **0**
- Remaining diagnostics in modified production files: **1**

The one remaining diagnostic in a modified file is the intentionally deferred fiscal voucher-type decision described below; all implemented structural targets are clean.

## Implemented structural corrections

### Fiscal transfer routes

- Returned `customerName: null` explicitly where the voucher query has no persisted customer-name field, instead of referencing a nonexistent property.
- Added a response DTO type for merged transfer revisions so synthetic merged items may omit database-only `id` and `revisionId` fields without changing the runtime response.
- Used the actual `revisionDate` field for merged optional revisions instead of nonexistent `createdAt`.
- Replaced the stale `stockItems.unit` reference with the real `stockItems.uom` schema field.

These changes do not alter transfer quantities, revision math, inventory direction, posting totals, or counterparty behavior.

### Supplier Partner sales-form export

- Narrowed ExcelJS formula objects through `unknown` before property inspection.
- Used PostgreSQL `QueryResult.rows` directly for sales and opening-stock query results.
- Typed the existing average-cost and per-bag profit formula objects as `ExcelJS.CellFormulaValue`.

The formulas, cached results, opening/closing stock, cash roll-forward, date filtering, and profit calculations are unchanged.

## Deliberately deferred diagnostics

The remaining **8 diagnostics across 7 files** require business or data-model decisions rather than safe typing substitutions:

- `server/routes/fiscalTransferRoutes.ts` — 1: whether stock consumption should persist as an allowed voucher type or use a separate stock-adjustment representation.
- `server/routes/sp/spContainerRoutes.ts` — 3: vouchers no longer contain `supplierId`; the intended Supplier Partner container-to-supplier/accounting association must be selected explicitly.
- `server/storage/inventory/stockItemStorage.ts` — 1: `stock_items` has no barcode column; code, aliases, or a future field must be selected deliberately.
- `server/routes/factory/customer-orders/orderCrudRoutes.ts` — 1: customer `defaultShippingCompany` no longer exists.
- `server/routes/reportsRoutes.ts` — 1: voucher `userId` no longer exists.
- `server/routes/vouchers/voucherQueryRoutes.ts` — 1: voucher `userId` no longer exists.

## Safety boundary maintained

Combo 4F did **not** change:

- fiscal-transfer debit/credit direction, totals, or counterparty behavior
- Supplier Partner workbook formulas, opening/closing stock, cash roll-forward, profit share, or date filtering
- Supplier Partner container supplier/accounting associations
- stock-item code, alias, barcode, or lookup semantics
- schema or migrations
- TypeScript configuration or broad suppression casts

## Validation

Exact production-code validation through temporary PR #34 confirmed **8 diagnostics across 7 files** with no new diagnostics. Build, lint, database schema setup, startup migrations, backend tests, frontend tests, frontend coverage, and formatting passed. The workflow conclusion remains failure only because the eight deferred TypeScript decisions intentionally remain.
