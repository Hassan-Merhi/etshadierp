# Combo 4B — Payroll and non-stock accounting TypeScript cleanup

Status: in progress on `agent/combo-4b-payroll-nonstock-typescript`.

## Verified starting point

- Latest `main`: `e25367b389f6ea93c9e6fa0363e78723ef477f7c`
- Combo 4A is merged through PR #9.
- Fresh retained CI artifact from Combo 4A confirms **154 TypeScript diagnostics across 32 files**.
- Build, lint, database setup, startup migrations, backend tests, frontend tests, coverage, and formatting passed on the synchronized Combo 4A head; TypeScript remained the only expected failing step.

## Included scope

This combo is limited to narrow, behavior-preserving fixes in payroll and non-stock accounting routes:

- `server/routes/payroll/payrollCoreRoutes.ts`
  - Narrow bulk payroll worker IDs to `number[]` before `inArray`.
- `server/routes/payroll/workerStatsAdvancesRoutes.ts`
  - Parse and validate worker/deduction IDs before Drizzle comparisons.
- `server/routes/factory/customer-orders/orderChargesRoutes.ts`
  - Serialize already-calculated daybook totals to the decimal-column string shape expected by Drizzle.
- `server/routes/factory/suppliers/supplierCrudRoutes.ts`
  - Compose supplier-payment filters before applying the single Drizzle `.where()` call.

Expected mechanical reduction: **13 diagnostics across 4 files**, from **154 / 32** to **141 / 28**, with no new diagnostics.

## Explicitly deferred

- Stock, inventory, factory mix/allocation, bale, fiscal-transfer, POS, voucher, and container errors remain for Combo 4C/4D.
- `supplierBrokerRoutes.ts` commission-total errors remain deferred because they expose a report/calculation contract mismatch rather than a type-only correction.
- Net-profit, net-position, stats, SP workbook formulas, and authorization/data-source mismatches remain deferred for later domain review.
- No schema, migration, accounting formula, posting rule, inventory value/quantity, negative-stock, container-accounting, or POS behavior may change.

## Validation required before merge

- Compare TypeScript diagnostics before and after.
- Confirm all touched production files have zero diagnostics.
- Run production build, lint, database setup, startup migrations, backend tests, frontend tests, coverage thresholds, and formatting.
- Keep the PR draft and unmerged pending explicit approval.
