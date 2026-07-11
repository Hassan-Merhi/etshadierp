# Combo 4F TypeScript Audit

## Scope

Combo 4F reviews the remaining fiscal-transfer, Supplier Partner, and inventory data-model TypeScript diagnostics after Combo 4E.

## Verified starting baseline

- Repository baseline after Combo 4E: **18 diagnostics across 7 files**
- Combo 4F implementation set: **15 diagnostics across 4 files**

### Combo 4F files

- `server/routes/fiscalTransferRoutes.ts` — 6
- `server/services/spSalesFormExport.ts` — 5
- `server/routes/sp/spContainerRoutes.ts` — 3
- `server/storage/inventory/stockItemStorage.ts` — 1

## Separate stale-field decisions

Three diagnostics remain outside this implementation set because their referenced persistence fields no longer exist and require explicit ownership/data-model decisions:

- `server/routes/factory/customer-orders/orderCrudRoutes.ts` — customer `defaultShippingCompany`
- `server/routes/reportsRoutes.ts` — voucher `userId`
- `server/routes/vouchers/voucherQueryRoutes.ts` — voucher `userId`

## Safety boundary

Combo 4F must not change:

- fiscal-transfer debit/credit direction, totals, or counterparty behavior
- Supplier Partner workbook formulas, opening/closing stock, cash roll-forward, profit share, or date filtering
- Supplier Partner container supplier/accounting associations without evidence from the current schema and runtime flow
- stock-item code, alias, barcode, or lookup semantics by inventing a replacement field
- schema or migrations
- TypeScript configuration or broad suppression casts

Each diagnostic will be classified as a structural typing correction or deferred data-model/business-logic decision before implementation.
