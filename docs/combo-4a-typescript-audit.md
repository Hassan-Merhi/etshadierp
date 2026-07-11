# Combo 4A — Safe TypeScript UI/report cleanup

Status: synchronized with latest `main`; draft PR remains unmerged.

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

`main` later advanced to bandwidth commit `b773f13d167c56f27ed0253d61232ee0c34501c9`. That commit was merged into this branch through synchronization PR #10. The synchronized TypeScript artifact remained **154 diagnostics across 32 files**, so the latest-main baseline remains exactly **163 across 34** and the upstream commit introduced no TypeScript diagnostic changes.

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

## Validation history

CI run 316 on head `12b92ba7e9b086ce9ae0d00a0bfde317f3ec9645` completed with the expected TypeScript failure only; build, lint, database preparation, startup migrations, backend tests, frontend tests, coverage thresholds, and formatting passed.

After the documentation-only finalization commit, CI run 317 repeated the same successful validation profile.

After `main` advanced, synchronization PR #10 merged commit `b773f13d167c56f27ed0253d61232ee0c34501c9` into this branch as merge commit `5f1ed11d5058b0ffcfca233866c38297b2714cdc`. Its TypeScript artifact stayed at **154 across 32 files**, with zero diagnostics in both modified production files. Build, lint, database setup, startup migrations, frontend tests, coverage, and formatting passed. The first synchronized backend run executed all **853 tests successfully** but the suite teardown failed because a concurrent `login_history` row still referenced a test company. That failure is outside Combo 4A's files and is treated as a test-isolation flake; the latest subsequent CI result is recorded in the PR description.

## Files changed by Combo 4A

- `server/routes/sp/spExportRoutes.ts`
- `server/services/sp-sales-form-v2/dataFetchers.ts`
- `docs/combo-4a-typescript-audit.md`

The synchronization merge also carries the unrelated latest-main bandwidth changes without modifying them.

No production calculation, schema, migration, posting, or stock behavior was changed by Combo 4A.
