# Combo 4A — Safe TypeScript UI/report cleanup

Status: validated; draft PR remains unmerged.

## Guardrails

This branch is limited to behavior-preserving TypeScript fixes in UI, report/export, request-shape, response-shape, and display-only code.

Explicitly excluded:

- accounting formulas and net-position calculations
- inventory quantities, values, allocation, and negative-stock behavior
- voucher posting and POS calculations
- container accounting and tracking business logic
- database schema and migrations
- payroll and non-stock accounting types reserved for Combo 4B

No broad `any`, `@ts-ignore`, `@ts-nocheck`, or TypeScript configuration weakening is permitted.

## Verified baseline

A fresh CI run from `main` commit `d30cdba504bb2602430db5256927016b9c5a8804` produced:

- **163 TypeScript diagnostics**
- **34 files**
- identical to the previous verified Combo 3 baseline

The payroll work merged after Combo 3 did not change the repository-wide TypeScript diagnostic count.

## Included in Combo 4A

Exactly **9 TS2352 diagnostics across 2 files** are safely mechanical request/result-shape issues:

### `server/routes/sp/spExportRoutes.ts` — 5 diagnostics

Old diagnostic locations: lines 30, 35, 81, 97, and 102.

Each site treated Drizzle's `QueryResult<Record<string, unknown>>` as `any[]` while trying to support both `{ rows: [...] }` and direct-array results. The fix adds a narrow `QueryRecord`/`QueryResultLike` helper and reads the first row without changing SQL, validation, filenames, request handling, or workbook generation.

### `server/services/sp-sales-form-v2/dataFetchers.ts` — 4 diagnostics

Old diagnostic locations: lines 19, 88, 156, and 179.

Each site used the same unsafe QueryResult-to-array cast. The fix adds a narrow `queryRows` helper. Existing SQL, historical inventory calls, quantity/value/rate arithmetic, ageing rules, cash-balance calculation, and export formulas remain unchanged.

## Deliberately deferred

The other **154 diagnostics across 32 files** do not meet Combo 4A's low-risk boundary:

- **Combo 4B:** payroll query types and non-stock accounting/report calculations.
- **Combo 4C:** container accounting, freight, container read/write, and tracking-adjacent types.
- **Combo 4D:** POS, voucher posting/update/transfer, stock allocation, inventory storage, stock merge, fiscal-transfer, and factory stock/bale types.
- **Later domain review:** net-profit/net-position calculations and report types coupled to business totals or Excel formulas.

Report-looking diagnostics were also deferred when the type error exposes a possible real authorization or domain mismatch rather than a display-only issue. Examples:

- `server/routes/reportsRoutes.ts` and `server/routes/vouchers/voucherQueryRoutes.ts` reference `voucher.userId` for POS access control, but that property is absent from the returned voucher type. This needs an authorization/data-source review, not a cast.
- `server/routes/stats/statsReportsRoutes.ts` passes a company identifier to a storage method whose current signature accepts one argument. Removing either side blindly could alter company scoping.
- `server/services/spSalesFormExport.ts` contains formula-cell and workbook-value diagnostics adjacent to export calculations. Those remain visible until the formula/output contract is reviewed directly.

## Validation

Final CI run 316 on head commit `12b92ba7e9b086ce9ae0d00a0bfde317f3ec9645` completed with:

- TypeScript diagnostics: **154 across 32 files**
- Exact reduction: **9 diagnostics and 2 files**
- New TypeScript diagnostics: **0**
- Diagnostics in the two modified production files: **0**
- Production build: **pass**
- Lint: **pass**
- Test database schema preparation: **pass**
- Production startup migrations: **pass**
- Backend tests: **pass**
- Frontend tests: **pass**
- Frontend coverage thresholds: **pass**
- Coverage summary upload: **pass**
- Formatting check: **pass**

The CI job is expected to have an overall failure conclusion only because the repository intentionally retains 154 deferred TypeScript diagnostics. Every other blocking validation step passed.

The branch was rechecked after CI and is **0 commits behind `main`**.

## Files changed

- `server/routes/sp/spExportRoutes.ts`
- `server/services/sp-sales-form-v2/dataFetchers.ts`
- `docs/combo-4a-typescript-audit.md`

No production calculation, schema, migration, posting, or stock behavior was changed.
