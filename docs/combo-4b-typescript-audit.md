# Combo 4B — Payroll and non-stock accounting TypeScript cleanup

Status: in progress on `agent/combo-4b-payroll-nonstock-typescript-v3`.

## Verified starting point

- Working base: latest `main` commit `63bcae9867af2654d9b1c6ae5f2581a3dd4a5969`.
- Combo 4A is merged through PR #9.
- A fresh no-production-change CI run on `main` commit `669695d5b8e34f7d600eee83fa6dc95902b87d09` confirms **154 TypeScript diagnostics across 32 files**.
- The three subsequent commits through `63bcae9867af2654d9b1c6ae5f2581a3dd4a5969` modify only `FactorySidebar.tsx`, `FactoryInsurance.tsx`, and `MixBatchList.tsx`; none touches the four Combo 4B server targets.
- Final Combo 4B validation must confirm the complete diagnostic set, not assume the intervening UI commits are neutral.

## Included scope

This combo is limited to narrow, behavior-preserving fixes in payroll and non-stock accounting routes:

- `server/routes/payroll/payrollCoreRoutes.ts`
  - Narrow bulk payroll worker IDs to `number[]` before Drizzle `inArray`.
- `server/routes/payroll/workerStatsAdvancesRoutes.ts`
  - Parse and validate worker/deduction IDs before Drizzle comparisons.
- `server/routes/factory/customer-orders/orderChargesRoutes.ts`
  - Serialize the three diagnosed, already-calculated daybook totals to the decimal-column string shape expected by Drizzle.
- `server/routes/factory/suppliers/supplierCrudRoutes.ts`
  - Compose supplier-payment filters before applying the single Drizzle `.where()` call.

Expected mechanical reduction: **13 diagnostics across 4 files**, from **154 / 32** to **141 / 28**, with no new diagnostics.

## Explicitly deferred

- Stock, inventory, factory mix/allocation, bale, fiscal-transfer, POS, voucher, and container errors remain for Combo 4C/4D.
- `supplierBrokerRoutes.ts` commission-total errors remain deferred because they expose a report/calculation contract mismatch rather than a type-only correction.
- Net-profit, net-position, stats, SP workbook formulas, and authorization/data-source mismatches remain deferred for later domain review.
- No schema, migration, accounting formula, posting rule, inventory value/quantity, negative-stock, container-accounting, or POS behavior may change.

## Validation required before merge

- Compare the complete TypeScript diagnostic set before and after.
- Confirm all touched production files have zero diagnostics.
- Run production build, lint, test database setup, startup migrations, backend tests, frontend tests, coverage thresholds, and formatting.
- Synchronize with latest `main` again before final approval.
- Keep the PR draft and unmerged pending explicit approval.
