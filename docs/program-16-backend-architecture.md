# Program 16 — Backend Architecture

## Objective

Reduce backend coupling and duplicated request plumbing without changing accounting, inventory, costing, authorization, company isolation, API contracts, route ordering, persistence behavior, or historical data.

## Phase 16A — Route and Service Boundaries

### Completed

- Audited the central `server/routes.ts` composition root and confirmed that it remains a large compatibility boundary containing both route registration and legacy inline business helpers.
- Added `server/lib/routeRegistration.ts` with a typed `RouteRegistrar`, named route-module definition, and deterministic sequential registration helper.
- Preserved route registration order as an explicit architectural requirement because several route families depend on specific-path routes being registered before parameter routes.
- Extracted screen-feed payload validation and click sanitization from `server/routes/screenFeedRoutes.ts` into `server/services/screenFeedService.ts`.
- Kept the screen-feed route responsible only for authentication, HTTP status selection, store coordination, and response serialization.
- Removed route-local `any` usage for session username and click validation.
- Preserved frame-size limits, click age, click count, developer-only access, disabled-feature behavior, diagnostics, route paths, and response bodies.

### Route ownership rules

1. The composition root owns registration order only.
2. Route modules own HTTP concerns: middleware, parameters, status codes, and serialization.
3. Services own reusable validation and business processing.
4. Storage modules own persistence and in-memory state.
5. Route registration must remain sequential unless independence and ordering safety are proven.

## Phase 16B — Shared Request Infrastructure

### Completed

- Added `server/lib/httpHandlers.ts` as the shared request boundary.
- Added one authenticated-request type instead of repeating route-local request interfaces.
- Added `HttpError` for explicit HTTP failures.
- Added `getAuthenticatedUserId()` to centralize authenticated-user extraction and the existing 401 response semantics.
- Added shared unknown-error normalization and HTTP error response handling.
- Added `asyncRoute()` for route modules that use centralized Express error middleware.
- Migrated `server/routes/userNotesRoutes.ts` to the shared authenticated request and error-response helpers.
- Preserved the user-notes GET and PUT paths, authentication middleware, empty-content behavior, service calls, success body, and failure messages.

### Request infrastructure rules

- Authentication middleware remains authoritative; request helpers only narrow already-authenticated request state.
- Helpers must not infer company, role, module, or action access.
- Domain services must not receive Express request or response objects.
- Error helpers must not expose stacks, SQL, credentials, or internal request data.
- Existing route response shapes must be preserved during migration.

## Deferred work for later Program 16 phases

The following broad changes are intentionally deferred because they require full composition-root editing and wider route-by-route verification:

- Moving all route registrars from `server/routes.ts` into categorized registry arrays.
- Extracting remaining inline business helpers from the legacy composition root.
- Migrating every route-local authenticated request interface to `httpHandlers.ts`.
- Converting all manual try/catch handlers to centralized async error propagation.
- Splitting remaining monolithic route files where accounting, inventory, and transaction ordering are tightly coupled.

These are not blockers for 16A/16B: the shared contracts are implemented, two representative route families are migrated, and ownership rules are established for continued phased adoption.

## Safety

- No route path or registration order was changed.
- No accounting, inventory, costing, voucher, authorization, permission, company-isolation, schema, migration, or persistence behavior was changed.
- No CI, GitHub Actions, deployment, migration execution, or production runtime checks were run.

## Status

- Active branch: `quality/program-16-backend-architecture`
- Phase 16A: complete.
- Phase 16B: complete.
- Program 16 remains unmerged until later phases are completed.
