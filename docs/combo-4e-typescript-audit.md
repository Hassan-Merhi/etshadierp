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

## Safety boundary

This phase must not change:

- net-profit or net-position formulas
- account classification or Dr/Cr interpretation
- voucher ownership or company-filter semantics without evidence
- broker commission calculations
- customer order totals or shipping behavior
- report date-range, currency, or aggregation behavior
- database schema or migrations
- TypeScript configuration or broad suppression casts

Diagnostics will first be separated into mechanical result-shape/nullability corrections versus domain-sensitive accounting or persistence decisions. Only the mechanical group will be implemented in this PR.

## Deferred from this phase

The following 15 diagnostics remain outside the first Combo 4E review because they belong to separate fiscal-transfer and Supplier Partner/data-model work:

- `server/routes/fiscalTransferRoutes.ts` — 6
- `server/services/spSalesFormExport.ts` — 5
- `server/routes/sp/spContainerRoutes.ts` — 3
- `server/storage/inventory/stockItemStorage.ts` — 1
