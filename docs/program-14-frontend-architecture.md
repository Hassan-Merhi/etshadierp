# Program 14 — Frontend Architecture

## Objective

Reduce frontend coupling and oversized screen responsibilities without changing business rules, accounting, inventory, costing, permissions, API contracts, or persistence behavior.

## Phase 14A — Route and Screen Boundaries

### Completed

- Audited the active route/screen boundary candidates for Sales Report, Analytics, Balance Sheet, Net Position, factory allocation/history, POS, and receiving.
- Confirmed and documented the ownership rule: route files provide context/navigation, feature hooks own server state, and feature components own local presentation state.
- Preserved existing URLs, navigation paths, permission guards, mutations, query enablement, and refresh contracts.
- Retained existing shared factory, inventory, bale-history, and stock-item query ownership.

## Phase 14B — Data and State Boundaries

### Completed

- Added `client/src/lib/apiResponseAdapters.ts` as the shared response boundary.
- Centralized checked JSON, array, and `/api/accounts/all` envelope handling.
- Added `analyticsKeys` to `client/src/lib/queryKeys.ts` for stable Analytics and financial-report cache ownership.
- Removed repeated page-local response compatibility logic from Analytics.
- Replaced Analytics date-range `any` boundaries with `Record<string, string>`.
- Preserved endpoint URLs, credentials, date parameters, loading results, empty-array fallbacks, and enablement rules.

## Phase 14C — Component Decomposition

### Completed

The Analytics server-state layer was decomposed without changing the public `useAnalyticsQueries` contract:

- `analyticsQueryClient.ts` owns credentials, checked responses, array normalization, and account-envelope normalization.
- `useAnalyticsReferenceQueries.ts` owns locations, stock groups, suppliers, and user-company reference data.
- `useAnalyticsReportQueries.ts` owns accounts, financial sales, transaction details, containers, net profit, stock movement, and opening-stock reports.
- `useAnalyticsFactoryQueries.ts` owns factory sales, POS summary, and container-sales analytics.
- `useAnalyticsQueries.ts` is now a thin orchestration boundary that composes those feature hooks and returns the existing result shape.

This reduces the original all-in-one query hook while preserving consumer-facing names, query enablement, loading flags, and returned data defaults.

## Phase 14D — Architecture Completion

### Completed

Frontend ownership rules are now explicit:

1. Route/shell modules own navigation, selected mode, company context, and permission gates.
2. Feature query hooks own server state and query-key selection.
3. Shared response adapters own compatibility with legacy response envelopes.
4. Feature components own local UI state, dialogs, filters, selection, and rendering.
5. Query invalidation must use the owning feature key factory rather than ad hoc arrays.
6. Business calculations remain in existing domain helpers or backend services; architectural refactors must not duplicate them in view components.

### Deferred legacy-screen work

The following physical screen decompositions remain set aside because they require broad whole-file edits and runtime interaction verification that is unavailable under the no-checks constraint:

- `SalesReportLegacy.tsx` removal of the temporary global `selectedCompany` compatibility binding.
- Further Balance Sheet and Net Position visual decomposition beyond their existing extracted calculations and views.
- POS and receiving form-state decomposition where keyboard behavior, mutation ordering, and optimistic updates are tightly coupled.
- Further factory stock-allocation and bale-history visual decomposition beyond existing shared query/data hooks.

These items are documented deferred work, not hidden completion claims. They may be resumed when a real checkout and interactive runtime verification are available.

## Safety Constraints Maintained

- No accounting formula changes.
- No inventory quantity or costing changes.
- No voucher posting or authorization changes.
- No API schema or database migration changes.
- No GitHub Actions, CI, deployment, or production runtime checks.

## Completion Status

- Phase 14A: complete.
- Phase 14B: complete.
- Phase 14C: complete with broad legacy-screen rewrites explicitly deferred.
- Phase 14D: complete.
- Program 14 status: complete-with-deferrals and ready to merge.
