# Combo 4F TypeScript Audit

## Scope

Combo 4F reviews the remaining fiscal-transfer TypeScript diagnostics after Combo 4E.

## Starting baseline

- Repository baseline after Combo 4E: **18 diagnostics across 7 files**
- Combo 4F scope: **6 diagnostics** in `server/routes/fiscalTransferRoutes.ts`

## Safety boundary

This phase must not change:

- transfer quantities or monetary amounts
- source or destination company/account selection
- Dr/Cr direction or voucher posting semantics
- inventory movement or stock direction
- transfer status transitions or approval behavior
- exchange-rate calculations
- database schema or migrations
- TypeScript configuration or broad suppression casts

The six diagnostics will be separated into structural response/result typing versus anything that exposes an accounting or workflow decision. Only behavior-preserving corrections will be implemented.

## Deferred to Combo 4G

The following 12 diagnostics remain outside this PR because they involve Supplier Partner, export formulas, container supplier association, legacy barcode semantics, shipping-company persistence, or voucher ownership:

- `server/services/spSalesFormExport.ts` — 5
- `server/routes/sp/spContainerRoutes.ts` — 3
- `server/storage/inventory/stockItemStorage.ts` — 1
- `server/routes/factory/customer-orders/orderCrudRoutes.ts` — 1
- `server/routes/reportsRoutes.ts` — 1
- `server/routes/vouchers/voucherQueryRoutes.ts` — 1
