# Program 14 — Frontend Architecture

## Objective

Reduce frontend coupling and oversized screen responsibilities without changing business rules, accounting, inventory, costing, permissions, API contracts, or persistence behavior.

## Phase 14A — Route and Screen Boundaries

- Identify oversized page components that combine routing, data access, derived calculations, mutations, and rendering.
- Move route-level orchestration into thin page shells.
- Extract reusable feature sections only where behavior can be preserved exactly.
- Keep existing URLs, navigation, query keys, permission guards, and mutation behavior unchanged.
- Prioritize the largest and most tightly coupled financial, factory, inventory, POS, and reporting screens.

## Phase 14B — Data and State Boundaries

- Centralize repeated API-response adapters and typed feature hooks.
- Remove page-local compatibility wrappers where a shared adapter can preserve the same response semantics.
- Stabilize query keys and mutation invalidation ownership.
- Separate server state from local UI state without changing refresh timing or optimistic behavior.
- Preserve all existing error, loading, empty-state, and permission handling.

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

## Initial 14A + 14B Work Order

1. Sales Report and Analytics compatibility wrappers introduced by the runtime hotfix.
2. Balance Sheet and Net Position route/page orchestration.
3. Factory stock allocation and bale-history data ownership.
4. POS and receiving page state boundaries.
5. Shared report response adapters and query-key factories.

## Safety Constraints

- No accounting formula changes.
- No inventory quantity or costing changes.
- No voucher posting or authorization changes.
- No API schema or database migration changes.
- No GitHub Actions, CI, deployment, or production runtime checks.
- Any item requiring unavailable validation or a product/schema decision is documented and deferred instead of being forced through.

## Status

- Program 14 started from `main` after Program 13 merge.
- Active branch: `quality/program-14-frontend-architecture`.
- Current execution pair: Phases 14A and 14B.
