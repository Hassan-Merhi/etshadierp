# Bandwidth hotspot repair — Phase 1: Location Summary

## Scope

Phase 1 addresses the production `GET /api/location-summary` hotspot. Production diagnostics showed this endpoint transferring roughly 10–20 MB in individual five-minute windows.

Per the rollout plan, this phase is implementation-only. Typecheck, lint, tests, build, GitHub Actions, production smoke checks, and post-deploy bandwidth verification are intentionally deferred to Phase 5.

## Root causes found

1. The Location Summary page downloaded every non-zero item row for every selected location before the user expanded any stock group.
2. The legacy response materialized a zero `{ quantity, rate, value }` object for every item/location combination, even where no inventory existed.
3. The page included `startDate` and `endDate` in the query/cache identity even though the backend route never applied those fields to inventory calculation. Changing the visible period therefore caused another large transfer of identical current-inventory data.
4. Other legacy callers still depend on the full nested response shape, so replacing the endpoint contract outright would be unsafe.
5. Location Summary traffic was already eligible for the existing 60-second server read microcache and browser request-coalescing guard, but oversized legacy payloads reduced the usefulness of the browser-side cache.

## Implementation

### Server profiles

`server/routes/admin/deleted-items/location-summary-bandwidth.ts` now supplies three compatible response profiles under the existing route:

- default/full: backwards-compatible nested stock-group/item response, generated from non-zero inventory only and with sparse location cells;
- `profile=summary`: stock-group totals and grand totals only, with no item rows;
- `profile=group&groupId=<id>`: item rows for one expanded stock group only.

All optimized contracts are scoped to `req.session.currentCompanyId`. Location IDs are de-duplicated and canonicalized. Active/deleted stock-item and active stock-group semantics match the previous route. Group and grand-total average rates retain the previous `value / quantity` behavior for positive totals.

The original route remains as an unknown-profile fallback so an unexpected future profile cannot silently receive the wrong response shape.

### Location Summary page

`client/src/hooks/use-location-summary-bandwidth.ts` introduces a company-scoped, location-scoped reader:

- first paint requests only `profile=summary`;
- item details are requested only for currently expanded groups;
- selected location IDs are canonicalized for query identity;
- current inventory is cached for one minute and does not refetch on mount, focus, or reconnect;
- the meaningless period values are no longer part of the network/cache identity;
- group details are merged back into the legacy page shape so the table, keyboard navigation, totals, links, highlighting, and saved expansion state continue to operate without a page rewrite.

### Legacy callers

Stock Transfer Order and Smart Transfer still consume the historical full shape. They are covered by the new default/full sparse implementation without requiring risky changes to those workflows in this phase. Their payload no longer contains a zero location cell for every item/location pair, and the server no longer loads every active stock item merely to discard zero-inventory rows.

## Expected bandwidth effect

The normal Location Summary first paint now scales primarily with `stock groups × locations`, not `stock items × locations`. Expanding a group transfers only that group's non-zero items. Legacy callers keep the same shape but transfer only non-zero sparse cells.

This should also make the existing request-coalescing/browser cache more effective because normal Location Summary responses are far smaller than the previous multi-megabyte payloads.

## Phase 5 verification gates

No checks are run in Phase 1. Phase 5 must verify:

- TypeScript and lint;
- targeted unit/integration/UI tests;
- production build and existing bandwidth verification scripts;
- route manifest / production readiness;
- GitHub Actions;
- several consecutive production five-minute bandwidth windows after deployment, with particular attention to `GET /api/location-summary`;
- correctness of stock-group totals, grand totals, expanded item quantities/rates/values, company isolation, Stock Transfer Order, and Smart Transfer behavior.
