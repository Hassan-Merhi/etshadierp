# Phase 11 — Heavy API Pagination and Response-Size Reduction

Status: **backend implementation complete; stock-entry frontend adopted; daybook and V5 frontend adoption remain** on `agent/memory-phase-1-stabilization`.

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

Default server page size is 100 and the hard maximum is 250.

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

#### Frontend adoption

`client/src/lib/heavyListPaginationClient.ts` now pages only the condensed `lite=1` screen request:

- default 50 grouped rows per page;
- selectable 25, 50, or 100 rows;
- visible Previous and Next controls;
- current range, total group count, and page count;
- page resets when the filter URL changes;
- detailed mode hides the controls and remains unpaged;
- deleting the final row on a page moves the screen to the final valid page;
- the existing page still receives a legacy array, so its grouping and lazy-expansion code is unchanged.

The controls explicitly state that the totals shown on the screen are page totals.

Detailed view, per-group bale expansion, print output, worker PDF, WhatsApp PDF, and complete export requests omit `lite=1` and are not paged.

`build/viteHeavyListPaginationPlugin.ts` applies an exact, fail-loud source transform so Stock Entry History Excel exports build the Summary sheet from the complete filtered groups returned by `fetchGroupsWithBales()`, not only the visible page. The Bale Details and Worker Matrix sheets already used that full dataset.

### V5 stock allocation

`server/routes/factory/factoryStockAllocationV5PaginationRoutes.ts` replaces the previous in-memory `filtered.slice(...)` path for paginated requests.

It now:

1. Runs the existing idempotent expected-line backfill.
2. Aggregates available stock, loading counts, expected quantities, shortages, weights, product names, and excluded-product flags in SQL.
3. Applies product, customer, proforma, container, status, search, and hide-zero filters before pagination.
4. Computes totals over the complete filtered set.
5. Selects one article-code page.
6. Loads proforma and container details only for those page article codes.

Unpaged calls still use the original route, preserving full-list exports and focused-proforma navigation until the V5 screen receives explicit pagination controls and full-filter export handling.

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
node scripts/verify-phase11-frontend-pagination.mjs
```

They check:

- known-heavy route coverage;
- native database count/limit/offset presence;
- registration order;
- legacy fallback behavior;
- pagination response compatibility;
- route-specific business-rule markers;
- stock-entry lite-only paging;
- visible page controls and detailed-mode isolation;
- full-data Stock Entry History Excel summary generation;
- fail-loud source-transform drift guards.

These scripts and CI were intentionally not executed while editing the isolated branch.

## Remaining frontend adoption boundary

The current daybook and V5 allocation screens perform whole-list client filtering, grouping, deep-link discovery, editing workflows, and exports. Automatically forcing those screens onto page 1 would hide records or produce incomplete exports.

Their UI migration still needs:

- visible page controls;
- page reset when filters change;
- server-side search and amount/status filters;
- dedicated complete-filter export requests;
- focused-record lookup when a deep-linked record is not on the current page;
- V5 drawer/edit actions that can retrieve articles outside the visible page.

This boundary is intentional and prevents a bandwidth optimization from changing business-visible results.
