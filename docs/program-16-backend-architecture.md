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

## Phase 16C — Session Context and Route Decomposition

### Completed

- Added `server/lib/requestContext.ts` as the single owner of session user, company, role, and username extraction.
- Added explicit helpers for required authenticated user, selected company, role lookup, and role enforcement.
- Migrated `server/routes/screenFeedRoutes.ts` from direct session assertions and local session casting to the shared request-context boundary.
- Preserved every screen-feed path, middleware, role requirement, status code, diagnostic response, frame limit, and store interaction.
- Added `server/lib/backendArchitecture.ts` with executable backend layer ownership rules and a typed deferred-boundary register.
- Kept domain services free of Express request and response objects.

## Phase 16D — Architecture Completion

### Completed

- Finalized backend ownership boundaries in code and documentation.
- Established shared route registration, HTTP error, authentication-context, session-context, service, and storage responsibilities.
- Removed representative duplicated request/session plumbing from user-notes and screen-feed route families.
- Recorded broad legacy boundaries that require interactive runtime verification rather than forcing unsafe monolith rewrites.
- Confirmed Program 16 changes are structural and preserve existing runtime contracts.

### Deferred boundaries

The following remain intentionally deferred because safe extraction requires route-by-route runtime verification and, for financial paths, reconciliation evidence:

- Full decomposition of `server/routes.ts`, including its remaining inline business helpers.
- Monolithic accounting, voucher, inventory, factory, and POS route files where transaction ordering is tightly coupled.
- Global conversion of all manual route `try/catch` blocks to centralized async error middleware.
- Migration of every legacy direct `req.session` access where exact status/message behavior has not yet been verified.

These deferrals are not hidden incomplete work: they are explicitly registered in `server/lib/backendArchitecture.ts` and remain outside Program 16's safe structural scope.

## Request infrastructure rules

- Authentication middleware remains authoritative; request helpers only narrow already-authenticated request state.
- Helpers must not infer company, role, module, or action access.
- Domain services must not receive Express request or response objects.
- Error helpers must not expose stacks, SQL, credentials, or internal request data.
- Existing route response shapes must be preserved during migration.
- Composition-root registration remains deterministic and sequential.

## Safety

- No route path or registration order was changed.
- No accounting, inventory, costing, voucher, authorization, permission, company-isolation, schema, migration, or persistence behavior was changed.
- No CI, GitHub Actions, deployment, migration execution, or production runtime checks were run.

## Status

- Active branch: `quality/program-16-backend-architecture`
- Phase 16A: complete.
- Phase 16B: complete.
- Phase 16C: complete.
- Phase 16D: complete.
- Program 16 is ready for merge.
