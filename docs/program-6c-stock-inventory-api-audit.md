# Program 6C — Stock and Inventory API Audit

Branch: `integration/programs-1-to-6-validation`

## Scope

Reduce stock and inventory payload size and repeated requests without changing quantities, average rates, total values, precision, company isolation, or historical records.

## Existing work confirmed

### Inventory list

`GET /api/inventory` is already server-paginated and bounded:

- Default page size: 100
- Maximum page size: 250
- Server-side company, location, stock-group, and text filters
- Independent filtered count
- Explicit field selection rather than `select *`
- Stable stock-code/location ordering

The route returns inventory quantity, average rate, and total value directly from the authoritative inventory rows. Program 6C must not recalculate or derive those values in the client.

### Full stock-item list

`GET /api/stock-items` retains a legacy flat-array path for compatibility and has an opt-in paginated management path with server-side search, group, grade, category, and active filters.

The full response remains necessary for screens that edit prices, opening balances, costing fields, or other management data. It must not be silently replaced by a reduced contract.

### Lightweight stock-item selectors

The frontend query-key factory and multiple selector-style callers already target `GET /api/stock-items/light`. The integration branch did not register that endpoint in the stock route module.

Program 6C now adds and registers a dedicated lightweight endpoint returning only:

- `id`
- `code`
- `name`
- `uom`
- `active`
- `stockGroupId`
- `categoryId`
- `gradeId`

The endpoint applies company isolation, excludes deleted items, and uses deterministic ordering. It intentionally excludes selling prices, opening balances, values, rates, and timestamps.

### Caller-classification and migration guard

`scripts/audit-program6c-stock-item-callers.mjs` inventories every frontend reference to the full and lightweight stock-item contracts.

It classifies full-endpoint consumers as:

- paginated management
- full-data management
- offline or prefetch
- selector-only migration candidate
- unresolved legacy full caller

The default mode is read-only and prints migration candidates. `--strict` fails while selector-only or unresolved callers remain. `--json` emits a stable machine-readable report. The audit also fails if no frontend caller uses the registered lightweight endpoint, protecting the contract from becoming dead code.

The script now also supports `--fix-safe`. This mode applies only allow-listed exact-string migrations. It refuses to modify a caller unless the expected source appears exactly once, reports already-migrated callers idempotently, and fails when an allow-listed migration no longer matches. It does not rewrite mutations, query invalidations, accounting logic, inventory calculations, costing, or historical records.

### Confirmed migration candidate: Bulk Rename

`client/src/pages/settings/BulkRenameTab.tsx` currently downloads the complete `/api/stock-items` array before searching names. The flow reads only `id`, `code`, and `name`, then posts selected ids to the existing bulk-rename mutation. It does not consume prices, opening balances, quantities, inventory values, costing data, aliases, tax fields, or location pricing.

Bulk Rename is now the first allow-listed `--fix-safe` migration. The migration changes only its read request from `/api/stock-items` to `/api/stock-items/light`. The existing `/api/stock-items/bulk-rename` mutation and both full/light cache invalidations remain untouched.

This gives a patch-safe path for applying the one-line bandwidth fix from a checked-out repository without reconstructing the large shared settings source file through the GitHub contents API.

## Usage

```bash
node scripts/audit-program6c-stock-item-callers.mjs
node scripts/audit-program6c-stock-item-callers.mjs --strict --json
node scripts/audit-program6c-stock-item-callers.mjs --fix-safe --strict --json
```

Review the working-tree diff after `--fix-safe` before committing. The command is intentionally narrow and idempotent.

## Remaining work

1. Run `--fix-safe --strict --json` in a checked-out repository, review the generated one-line Bulk Rename diff, and commit it to the integration branch.
2. Review every remaining selector-only or unresolved full-endpoint caller.
3. Convert other confirmed selector-only callers to the lightweight query key without changing screens that require prices or costing data.
4. Verify inventory list consumers pass server-side filters instead of downloading broad pages and filtering locally.
5. Audit location-inventory and stock-movement detail endpoints for unbounded history responses.
6. Add focused runtime or integration coverage when a runnable checkout is available.

## Safety rules

- Do not change quantity, average-rate, total-value, negative-stock, or costing behavior.
- Do not derive financial totals from a visible page.
- Do not remove the legacy full stock-item contract until every caller is explicitly migrated.
- Do not merge or deploy automatically.
