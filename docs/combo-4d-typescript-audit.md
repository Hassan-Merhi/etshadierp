# Combo 4D TypeScript Audit

## Scope

Combo 4D covers the remaining POS, vouchers, inventory storage, stock/fiscal transfer, factory stock allocation, factory stock, and factory bales TypeScript diagnostics.

Starting point: `main` commit `73783b83bc8d217aa0e4099ec0d7aff58bfe30b5` after Combo 4C.

## Verified baseline

- **91 TypeScript diagnostics across 24 files**
- **61 diagnostics across 16 Combo 4D files**

### Combo 4D files

- `client/src/pages/pos/POS.tsx` — 5
- `server/routes/factory/_helpers.ts` — 2
- `server/routes/factory/factoryBalesRoutes.ts` — 5
- `server/routes/factory/factoryStockAllocationV2Routes.ts` — 2
- `server/routes/factory/factoryStockAllocationV3Routes.ts` — 12
- `server/routes/factory/factoryStockAllocationV5Routes.ts` — 1
- `server/routes/factory/factoryStockRoutes.ts` — 7
- `server/routes/fiscalTransferRoutes.ts` — 6
- `server/routes/stock/stockGroupsItemsRoutes.ts` — 1
- `server/routes/stock/stockMergeRoutes.ts` — 1
- `server/routes/vouchers/voucherJournalRoutes.ts` — 3
- `server/routes/vouchers/voucherQueryRoutes.ts` — 1
- `server/routes/vouchers/voucherSalesUpdateRoutes.ts` — 8
- `server/routes/vouchers/voucherTransferRoutes.ts` — 3
- `server/storage/inventory/locationInventoryStorage.ts` — 3
- `server/storage/inventory/stockItemStorage.ts` — 1

## First safe slice

The first patch must be limited to behavior-preserving typing corrections:

- POS ref nullability and a defined exchange-rate fallback while the currency context is loading.
- Correct PostgreSQL raw-query result access without changing SQL or allocation formulas.
- Explicit numeric/null guards before Drizzle comparisons or storage calls.
- Correct stale schema field names only when the current schema and response contract are unambiguous.
- Correct helper input/output types where runtime values already match the intended shape.

## High-risk diagnostics requiring domain review

The following must not be fixed by casting or guessing:

- Stock allocation quantities, source-location selection, and negative-stock behavior.
- Fiscal-transfer accounting entries and transfer reversal behavior.
- Voucher sales update/reversal, configured-price persistence, and inventory restoration.
- Voucher transfer item reconstruction and undefined `transferItemsData` ownership.
- Stock merge helper signature changes.
- Factory stock `Consumption` voucher typing and posting behavior.
- Any change to Dr/Cr direction, voucher totals, cost calculations, inventory quantities, or location ownership.

## Safety boundary

Combo 4D must not change stock quantities, negative-stock rules, allocation order, transfer amounts, voucher totals, Dr/Cr direction, account selection, cost/profit formulas, POS sale totals, or schema/migrations. No broad `any`, `@ts-ignore`, `@ts-nocheck`, or TypeScript configuration weakening is permitted.

## Validation plan

After each safe slice:

1. Re-run the TypeScript baseline and confirm no new diagnostics.
2. Run build and lint.
3. Run database schema setup and startup migrations.
4. Run backend tests, frontend tests, coverage, and format check.
5. Keep the PR in draft until the complete Combo 4D scope is either safely fixed or explicitly split into a reviewed follow-up.
