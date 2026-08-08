# Phase 2 — Report Route Extraction

## Status

Complete.

## Result

`server/routes/reportsRoutesLegacy.ts` has been reduced from approximately 1,628 lines to a no-op compatibility boundary.

All report handlers now live in focused modules:

- `reportsNetProfitStatementRoutes.ts`
- `reportsClosingStockRoutes.ts`
- `reportsDashboardAccountRoutes.ts`
- `reportsContainerTrackingRoutes.ts`
- `reportsLedgerRoutes.ts`
- `reportsVoucherDetailRoutes.ts`

## Extracted endpoints

- `GET /api/reports/net-profit-statement`
- Closing-stock report endpoints
- Dashboard account-selection endpoints
- `GET /api/dashboard/container-tracking`
- `GET /api/reports/ledger-monthly-summary/:accountId`
- `GET /api/reports/ledger-vouchers/:accountId/:year/:month`
- `GET /api/voucher-detail/:voucherId`

## Guardrails

- The legacy reporting budget is reduced to 12 lines.
- The target is now zero lines for the final registry-removal phase.
- The report composition contract requires all focused registrars to run before the compatibility boundary.
- The compatibility file is prohibited from registering HTTP routes.
