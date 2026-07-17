# Phase 11 — Heavy API Pagination and Response-Size Reduction

Status: **backend implementation complete; frontend adoption remains explicit** on `agent/memory-phase-1-stabilization`.

This phase adds database-side pagination to the known heavy list endpoints while preserving every legacy response for callers that do not request pagination.

## Pagination contract

Pagination activates when a request contains any of:

- `pagination=1`
- `page`
- `limit`
- `pageSize`
- `offset`

The standard response contract is:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "limit": 100,
  "totalPages": 0,
  "hasNextPage": false,
  "hasPreviousPage": false
}
```

Endpoints whose existing business response uses another top-level key retain that key. V5 stock allocation therefore returns `rows`, `totals`, and `productNames` plus pagination metadata.

The standard pagination headers are:

- `X-Total-Count`
- `X-Page`
- `X-Page-Size`
- `X-Total-Pages`

Default page size is 100 and the hard maximum is 250.

## Protected endpoints

### Factory daybook

`server/routes/factory/factoryDaybookPaginationRoutes.ts` performs in SQL:

- real daybook filtering;
- live voucher replacement;
- synthetic voucher union;
- deleted voucher, payroll, advance, and repayment exclusion;
- role and own-only filtering;
- transaction, currency, search, optional-status, and amount filters;
- singleton-event deduplication;
- total count, ordering, limit, and offset.

Only the returned page is passed through bale-production-price enrichment.

The original daybook handler remains unchanged and receives requests that do not ask for pagination.

### Stock-entry history

`server/routes/factory/factoryStockEntryHistoryPaginationRoutes.ts` preserves the existing lite/full grouped query behavior and adds grouped-result counting, limit, and offset in PostgreSQL.

The same date, worker, product, location, status, reference search, deleted-bale visibility, and unassigned-worker rules are retained.

### V5 stock allocation

`server/routes/factory/factoryStockAllocationV5PaginationRoutes.ts` replaces the previous in-memory `filtered.slice(...)` path for paginated requests.

It now:

1. Runs the existing idempotent expected-line backfill.
2. Aggregates available stock, loading counts, expected quantities, shortages, weights, product names, and excluded-product flags in SQL.
3. Applies product, customer, proforma, container, status, search, and hide-zero filters before pagination.
4. Computes totals over the complete filtered set.
5. Selects one article-code page.
6. Loads proforma and container details only for those page article codes.

Unpaged calls still use the original route, preserving full-list exports and focused-proforma navigation until the frontend receives explicit pagination controls.

### Existing native pagination retained

The following endpoints already had database count/limit/offset support and remain unchanged:

- `/api/stock-items`
- `/api/inventory`
- `/api/factory/bales`

## Compatibility bridge

`server/apiPaginationBridge.mjs` provides a backward-compatible response pagination fallback for known heavy array routes. It only activates when pagination is explicitly requested and never re-wraps an endpoint that already returned an object.

Native route pagination is preferred because it reduces database work as well as response size.

## Registration order

The new factory pagination handlers are registered before the legacy factory modules in `server/routes/factoryRoutes.ts`.

Each new handler calls `next()` when pagination is not requested. This preserves legacy behavior without duplicating or deleting the original handlers.

## Audit and verification

Available scripts:

```text
npm run audit:heavy-apis
node scripts/verify-phase11-api-pagination.mjs
node scripts/verify-phase11-native-pagination.mjs
```

They check:

- known-heavy route coverage;
- native database count/limit/offset presence;
- registration order;
- legacy fallback behavior;
- pagination response compatibility;
- route-specific business-rule markers.

These scripts and CI were intentionally not executed while editing the isolated branch.

## Frontend adoption boundary

The current daybook and V5 allocation screens perform whole-list client filtering, grouping, deep-link discovery, and exports. Automatically forcing those screens onto page 1 would hide records and produce incomplete exports.

Therefore Phase 11 does not silently change those callers. Their UI migration must include:

- visible page controls;
- page reset when filters change;
- server-side search and amount/status filters;
- dedicated full-filter export requests;
- focused-record lookup when a deep-linked record is not on the current page.

This boundary is intentional and prevents a bandwidth optimization from changing business-visible results.
