# Combo 4D TypeScript Audit

## Scope

Combo 4D covers POS, vouchers, inventory storage, stock/fiscal transfer, factory stock allocation, factory stock, and factory bales diagnostics. The starting point is `main` commit `73783b83bc8d217aa0e4099ec0d7aff58bfe30b5` after Combo 4C.

## Verified baseline

- **91 TypeScript diagnostics across 24 files**
- **61 diagnostics across 16 Combo 4D files**

## First safe slice implemented

The first production slice targets exactly **20 diagnostics**:

- `client/src/pages/pos/POS.tsx` — 5 diagnostics resolved through supporting prop/ref type corrections
- `server/routes/factory/factoryStockAllocationV2Routes.ts` — 2
- `server/routes/factory/factoryStockAllocationV3Routes.ts` — 12
- `server/routes/factory/factoryStockAllocationV5Routes.ts` — 1

Supporting POS files were updated so nullable exchange rates remain nullable through component and hook boundaries. Existing runtime behavior is preserved; no fallback exchange rate was introduced. Raw PostgreSQL `db.execute()` results now use their actual `.rows` property instead of casting the whole `QueryResult` to an array.

## First-slice safety boundary

The first slice does not change:

- stock quantities or status transitions
- negative-stock rules
- allocation order or free-to-promise calculations
- transfer quantities or amounts
- voucher totals, Dr/Cr direction, or account selection
- cost, profit, or workbook formulas
- POS item prices, sale totals, or exchange-rate validation
- schema or migrations

## Remaining Combo 4D files for review

- `server/routes/factory/factoryBalesRoutes.ts`
- `server/routes/factory/factoryStockRoutes.ts`
- `server/routes/fiscalTransferRoutes.ts`
- `server/routes/stock/stockGroupsItemsRoutes.ts`
- `server/routes/stock/stockMergeRoutes.ts`
- `server/routes/vouchers/voucherJournalRoutes.ts`
- `server/routes/vouchers/voucherQueryRoutes.ts`
- `server/routes/vouchers/voucherSalesUpdateRoutes.ts`
- `server/routes/vouchers/voucherTransferRoutes.ts`
- `server/storage/inventory/locationInventoryStorage.ts`
- `server/storage/inventory/stockItemStorage.ts`

These remaining errors must be separated into mechanical null/schema corrections versus business-sensitive stock restoration, voucher posting, transfer, merge, and cost logic. They must not be hidden with broad casts, `any`, `@ts-ignore`, `@ts-nocheck`, or TypeScript configuration weakening.

## Validation target for first slice

The expected baseline after the first safe slice is **71 diagnostics across 20 files**, with zero diagnostics in POS and the three stock-allocation route files and no new diagnostics.
