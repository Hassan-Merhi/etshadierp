# Combo 4E TypeScript Audit

## Scope

Combo 4E reviews the remaining accounting, reporting, broker, customer-order, and voucher-query TypeScript diagnostics after Combo 4D.

## Starting baseline

- Repository baseline after Combo 4D: **38 diagnostics across 11 files**
- Initial Combo 4E review set: **23 diagnostics across 7 files**

### Initial review files

- `server/routes/stats/statsNetProfitRoutes.ts` — 9
- `server/routes/stats/statsNetPositionRoutes.ts` — 8
- `server/routes/factory/suppliers/supplierBrokerRoutes.ts` — 2
- `server/routes/factory/customer-orders/orderCrudRoutes.ts` — 1
- `server/routes/reportsRoutes.ts` — 1
- `server/routes/stats/statsReportsRoutes.ts` — 1
- `server/routes/vouchers/voucherQueryRoutes.ts` — 1

## First safe slice implemented

The first slice targets **20 structural diagnostics** without changing accounting or report formulas:

- `server/routes/stats/statsNetProfitRoutes.ts` — synthetic computed rows now match the shared net-position account type; no values or categories changed.
- `server/routes/stats/statsNetPositionRoutes.ts` — removed a duplicate local `round2` declaration and continued using the already-imported shared helper.
- `server/routes/factory/suppliers/supplierBrokerRoutes.ts` — restored the derived `totalCommission` result field expected by the export, calculated only from existing row commission values and excluded from running-balance math.
- `server/routes/stats/statsReportsRoutes.ts` — removed an obsolete extra argument from `getStockGroupById`; runtime lookup behavior remains unchanged.

Expected repository baseline after validation: **18 diagnostics across 7 files**, with zero diagnostics in the four modified production files.

## Deliberately deferred review diagnostics

Three diagnostics from the initial review set are not safe mechanical fixes because the referenced persistence fields no longer exist in the current schema:

- `server/routes/factory/customer-orders/orderCrudRoutes.ts` — `defaultShippingCompany`
- `server/routes/reportsRoutes.ts` — voucher `userId`
- `server/routes/vouchers/voucherQueryRoutes.ts` — voucher `userId`

These require an explicit data-model/ownership decision rather than a cast or invented replacement field.

## Safety boundary

This phase does not change:

- net-profit or net-position formulas
- account classification or Dr/Cr interpretation
- voucher ownership or company-filter semantics without evidence
- broker commission rates or running-balance calculations
- customer order totals or shipping behavior
- report date-range, currency, or aggregation behavior
- database schema or migrations
- TypeScript configuration or broad suppression casts

## Deferred from this phase

The following 15 diagnostics remain outside the first Combo 4E review because they belong to separate fiscal-transfer and Supplier Partner/data-model work:

- `server/routes/fiscalTransferRoutes.ts` — 6
- `server/services/spSalesFormExport.ts` — 5
- `server/routes/sp/spContainerRoutes.ts` — 3
- `server/storage/inventory/stockItemStorage.ts` — 1

## Validation

Temporary patch scripts and workflows were removed. Exact cleaned-head CI validation is being run through temporary PR #31 before PR #30 is marked ready for review.
