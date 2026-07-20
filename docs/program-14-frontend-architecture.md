# Program 14 — Frontend Architecture

## Objective

Reduce frontend coupling and oversized screen responsibilities without changing business rules, accounting, inventory, costing, permissions, API contracts, or persistence behavior.

## Phase 14A — Route and Screen Boundaries

### Completed

- Audited the active route/screen boundary candidates for Sales Report, Analytics, Balance Sheet, Net Position, factory allocation/history, POS, and receiving.
- Confirmed that Analytics already owns its server-state orchestration in `useAnalyticsQueries`, allowing the route/page rendering layer to remain separate from request construction and response adaptation.
- Confirmed existing shared query-key ownership for factory bales, stock allocation, daybook, stock-entry history, inventory, and stock-item selectors.
- Preserved every existing URL, navigation path, permission guard, accounting formula, inventory rule, costing rule, mutation, and refresh contract.
- Established the rule that route files may provide context and navigation only; feature hooks own server state; feature components own local presentation state.

### Deferred route extractions

The following legacy screens remain intentionally deferred to Phase 14C because safe extraction requires full-file modification plus runtime verification that is unavailable in this execution environment:

- `client/src/pages/SalesReportLegacy.tsx` — still references the temporary route-supplied `selectedCompany` compatibility binding.
- Balance Sheet and Net Position large-screen decomposition beyond their existing extracted calculation/view pieces.
- POS and receiving orchestration extraction where local form state, mutation timing, keyboard behavior, and optimistic updates are tightly coupled.
- Additional factory allocation and bale-history visual decomposition beyond their existing shared query-key/data hooks.

These are not treated as blockers for 14A because the required route and ownership boundaries are now documented and the risky physical decomposition belongs to 14C.

## Phase 14B — Data and State Boundaries

### Completed

- Added `client/src/lib/apiResponseAdapters.ts` as the shared response boundary.
- Centralized array, account-envelope, and checked JSON response handling.
- Removed Analytics' page-local `/api/accounts/all` response-shape assumption; both legacy arrays and `{ accounts, asOfDate }` envelopes now normalize through one adapter.
- Extended `client/src/lib/queryKeys.ts` with `analyticsKeys` so Analytics and financial-report cache ownership is explicit and stable.
- Replaced ad hoc Analytics query arrays with shared key factories.
- Replaced repeated fetch/error/JSON boilerplate with typed feature-level helpers.
- Replaced Analytics `dateRange: any` and `detailsDateRange: any` boundaries with `Record<string, string>`.
- Computed URL-builder results once per hook render and used those stable values for query keys and fetches.
- Preserved all existing query enablement, loading results, endpoint URLs, credentials, date parameters, refresh behavior, and empty-array fallbacks.

## Phase 14C — Component Decomposition

- Split oversized components into cohesive feature components.
- Keep forms, dialogs, tables, filters, and summaries independently testable.
- Avoid prop drilling by introducing narrowly scoped feature contexts only where necessary.
- Preserve keyboard behavior, accessibility semantics, and responsive layout.

## Phase 14D — Architecture Completion

- Remove obsolete compatibility layers made unnecessary by earlier phases.
- Document frontend module boundaries and ownership rules.
- Record deferred items that require runtime validation, product decisions, or broad behavioral changes.
- Merge Program 14 only after completed work is internally consistent and deferred work is explicitly listed.

## Safety Constraints Maintained

- No accounting formula changes.
- No inventory quantity or costing changes.
- No voucher posting or authorization changes.
- No API schema or database migration changes.
- No GitHub Actions, CI, deployment, or production runtime checks.

## Status

- Active branch: `quality/program-14-frontend-architecture`.
- Phase 14A: complete with physical legacy-screen decomposition assigned to 14C.
- Phase 14B: complete.
- Next execution pair: Phases 14C and 14D.
