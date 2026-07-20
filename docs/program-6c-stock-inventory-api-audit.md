# Program 6C — Stock and Inventory API Audit

Branch: `integration/programs-1-to-6-validation`

## Scope

Reduce stock and inventory payload size and repeated requests without changing quantities, average rates, total values, precision, company isolation, costing, or historical records.

## Completed implementation

### Inventory list

`GET /api/inventory` remains server-paginated and bounded:

- Default page size: 100
- Maximum page size: 250
- Server-side company, location, stock-group, and text filters
- Independent filtered count
- Explicit fields rather than `select *`
- Stable stock-code/location ordering
- Authoritative stored quantity, average rate, and total value preserved

### Full stock-item management contract

`GET /api/stock-items` retains its legacy flat-array compatibility path and its opt-in paginated management path. Screens that require prices, opening balances, costing, aliases, tax, or location-pricing data remain on this full contract.

### Lightweight stock-item contract

`GET /api/stock-items/light` is registered before the full stock routes and returns only selector-safe identity/classification fields:

- `id`
- `code`
- `name`
- `barcode`
- `uom`
- `active`
- `stockGroupId`
- `categoryId`
- `gradeId`

It applies company isolation, excludes deleted items, and uses deterministic ordering. It excludes selling prices, opening quantities, opening rates, opening values, inventory quantities, average rates, total values, costing fields, and timestamps.

### Caller migration

Selector-style callers use the lightweight URL through `stockItemKeys.light(...)` or a direct lightweight request. Existing bandwidth work already migrated voucher, transfer, proforma, reporting, purchase-order, detail-selector, credit-note, data-tool, and offline-preparation callers.

Bulk Rename was the remaining confirmed selector-only direct caller. Its read request now uses `/api/stock-items/light`; the existing bulk-rename mutation and both full/light cache invalidations are unchanged.

The following callers intentionally remain on the full contract:

- Paginated Stock Items management
- User-triggered full Stock Items export
- Stock-item create/edit/import and repair tools that consume management fields
- Deleted/orphaned record tools that require extended record state

### Stock and location history

The stock-movement APIs are bounded by explicit business periods rather than open-ended history downloads:

- Monthly summary produces at most the requested year's month rows and returns a full-period grand total.
- Transaction drill requires `stockItemId`, `year`, and `month`, and returns that month's transactions plus complete month totals.
- Location-specific opening quantities and rates continue to use the historical inventory helper, preserving running quantity/value semantics.

No page slicing was added inside a month because doing so without a separate opening-state cursor would change running balances and closing values.

### Completion guards

- `scripts/audit-program6c-stock-item-callers.mjs` inventories full and lightweight callers and supports strict, JSON, and exact allow-listed safe-fix modes.
- `scripts/verify-program6c-stock-inventory-contracts.mjs` protects route registration, field limits, query-key separation, Bulk Rename and offline lightweight usage, inventory pagination, filtered counts, and period-bounded movement totals.
- Existing `tests/stock-items-bandwidth.test.ts` protects the lightweight query-key URL and cache separation.

## Safety confirmation

Program 6C does not alter:

- Stock quantities
- Average rates
- Total values
- Negative-stock behavior
- Costing or valuation rules
- Historical movement records
- Mutation behavior
- Company isolation
- Legacy full stock-item compatibility

No production migration, deployment, merge to `main`, or runtime data repair is part of this phase.
