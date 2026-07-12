# Phase 7B — Stock Items and Common Inventory Performance

Phase 7B adds safe paginated fast paths for the two most common inventory reads:

- `GET /api/stock-items?page=...`
- `GET /api/inventory?page=...`

## What changed

- Independent count and page-data queries execute concurrently with `Promise.all`.
- The inventory count query no longer joins `stock_groups`, because that table is not needed for counting or filtering.
- Existing filters, ordering, pagination limits, response fields, authorization, company isolation, and error responses are preserved.
- Requests without a `page` parameter fall through to the established legacy handlers unchanged, preserving dropdown, offline-sync, and compatibility behavior.

## Safety boundaries

- No schema, index, migration, inventory quantity, valuation, accounting, or transaction behavior changed.
- No production load test or provider-level performance validation is claimed.
- The fast paths are process code only and can be reverted independently.

## Verification

`server/routes/location/commonInventoryPerformanceRoutes.test.ts` guards concurrent execution, legacy fall-through, the 500-row page-size ceiling, and removal of the unused count-query join.
