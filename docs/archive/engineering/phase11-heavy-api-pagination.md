# Phase 11 — Heavy API Pagination and Response-Size Reduction

Status: **implementation complete; runtime validation not executed** on `agent/memory-phase-1-stabilization`.

This phase adds database-side pagination to the known heavy list endpoints and adopts it on the three heavy factory screens without allowing pagination to shorten exports, drawers, detailed views, or deep-linked workflows.

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

Endpoints whose business response uses another top-level key retain that key. V5 stock allocation returns `rows`, `totals`, and `productNames` plus pagination metadata.

The standard pagination headers are:

- `X-Total-Count`
- `X-Page`
- `X-Page-Size`
- `X-Total-Pages`

Default server page size is 100 and the hard maximum is 250.

## Factory Daybook

`server/routes/factory/factoryDaybookPaginationRoutes.ts` performs in PostgreSQL:

- real daybook filtering;
- live voucher replacement;
- synthetic voucher union;
- deleted voucher, payroll, advance, and repayment exclusion;
- role and own-only filtering;
- transaction, currency, search, optional-status, and amount filters;
- singleton-event deduplication;
- total count, ordering, limit, and offset.

Only the returned page receives bale-production-price enrichment.

### Frontend adoption

`client/src/lib/daybookPaginationClient.ts` pages the normal `/factory/daybook` and `/properties/daybook` screen requests:

- default 100 transactions per page;
- selectable 50, 100, or 250 transactions;
- visible Previous and Next controls;
- page reset when any server filter changes;
- automatic correction when deletion removes the final row on the current page;
- legacy array response preserved for `FactoryDaybook.tsx`;
- page controls explicitly state that table grouping and displayed totals are page-scoped.

The Vite transform moves the existing search, optional-status, minimum amount, maximum amount, and sort direction into the server request. The component's existing client filtering remains as a safety check.

Entry and voucher deep links deliberately bypass paging so the existing full-list lookup and automatic detail opening continue to work.

Both Daybook Excel modes use `fetchAllDaybookEntries()` to request every filtered server page. Summary and detailed exports therefore remain complete and continue excluding `WORKER_EDITED` audit rows.

## Stock-entry history

`server/routes/factory/factoryStockEntryHistoryPaginationRoutes.ts` preserves the existing lite/full grouped queries and adds grouped-result counting, limit, and offset in PostgreSQL.

The same date, worker, product, location, status, reference search, deleted-bale visibility, and unassigned-worker rules remain.

### Frontend adoption

`client/src/lib/heavyListPaginationClient.ts` pages only the condensed `lite=1` request:

- default 50 grouped rows per page;
- selectable 25, 50, or 100 rows;
- visible Previous and Next controls;
- page reset when filters change;
- detailed mode remains unpaged;
- legacy array response preserved;
- controls explicitly disclose that screen totals are page totals.

Per-group bale expansion, detailed mode, print output, Worker PDF, WhatsApp PDF, and complete export requests omit `lite=1` and remain unpaged.

`build/viteHeavyListPaginationPlugin.ts` changes the Stock Entry History Excel Summary sheet to use the complete filtered groups returned by `fetchGroupsWithBales()`. Bale Details and Worker Matrix already use the same complete dataset.

## V5 stock allocation

`server/routes/factory/factoryStockAllocationV5PaginationRoutes.ts` replaces the previous paginated path that built the complete model and then called `slice()`.

It now:

1. Runs the existing idempotent expected-line backfill.
2. Aggregates stock, loaded quantities, expected quantities, shortages, weights, names, and excluded-product flags in SQL.
3. Applies product, customer, proforma, container, status, search, and hide-zero filters before paging.
4. Computes totals over the complete filtered set.
5. Selects one article-code page.
6. Loads proforma and container details only for the selected article codes.

### Frontend adoption

`client/src/lib/v5AllocationPaginationClient.ts` pages normal table browsing:

- default 50 products per page;
- selectable 25, 50, or 100 products;
- visible Previous and Next controls;
- page reset when hide-zero or search filters change;
- full filtered totals retained from the backend;
- page state reset when leaving the route.

The existing Negative Only switch deliberately changes the screen back to the complete legacy response while active, preserving its original global behavior. Focused-proforma and `openEdit=true` links also bypass paging so deep-link discovery remains complete.

The garbage/wiper visibility switch remains page-scoped during normal paged browsing, and the pagination control states this explicitly. Excel applies that switch across the complete filtered result.

`fetchAllV5AllocationData()` retrieves all server pages only for explicit business actions:

- Create Proforma drawer;
- Edit Proforma drawer;
- Edit Draft Quantities;
- Excel export.

Drawers receive the complete unfiltered article catalog, not merely the visible page. Large temporary row references are cleared when create/edit/draft dialogs close or save.

## Existing native pagination retained

The following endpoints already had database count/limit/offset support and remain unchanged:

- `/api/stock-items`
- `/api/inventory`
- `/api/factory/bales`

## Compatibility bridge

`server/apiPaginationBridge.mjs` provides an opt-in fallback for known heavy array routes. It never changes unpaged requests and never re-wraps routes that already return a paginated object.

Native route pagination remains preferred because it reduces database work as well as response size.

## Registration and source-transform safety

The new factory pagination handlers are registered before legacy factory modules in `server/routes/factoryRoutes.ts`. Each calls `next()` when pagination is not requested.

`build/viteHeavyListPaginationPlugin.ts` applies exact transforms to the large existing frontend files instead of replacing their full source through the GitHub connector. Every transform fails loudly when its source marker is missing or ambiguous.

## Audit and verification

Available scripts:

```text
npm run audit:heavy-apis
node scripts/verify-phase11-api-pagination.mjs
node scripts/verify-phase11-native-pagination.mjs
node scripts/verify-phase11-frontend-pagination.mjs
node scripts/verify-phase11-v5-frontend-pagination.mjs
node scripts/verify-phase11-daybook-frontend-pagination.mjs
```

They cover:

- known-heavy route coverage;
- native count/limit/offset behavior;
- registration order and legacy fallback;
- pagination response compatibility;
- Stock Entry History mode and export isolation;
- V5 full-data drawer, edit, export, and deep-link behavior;
- Daybook server filters, deep-link behavior, and complete exports;
- route-state reset and page correction;
- fail-loud transform drift checks.

These scripts, typecheck, build, tests, and CI were intentionally not executed while editing the isolated branch.
