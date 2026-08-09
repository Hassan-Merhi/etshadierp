# Phase 5 — Complete `routesLegacy.ts` extraction

## Status

Complete at the source-contract boundary.

`server/routesLegacy.ts` is now a compatibility-only export. It contains no HTTP route registrations, database access, business logic, middleware setup, or domain imports.

## Extracted ownership

- `routes/core/permissionBoundaryRoutes.ts`
  - global module permissions;
  - action permissions;
  - export permissions.
- `routes/core/healthRoutes.ts`
  - lightweight health endpoint;
  - database health endpoint.
- `routes/pos/intercompanyPosConfigRoutes.ts`
  - intercompany POS configuration reads and writes;
  - destination-account lookup.
- `routes/employees/erpWorkerDocumentRoutes.ts`
  - ERP worker document list, create, edit, delete, and download.
- `routes/employees/salaryAdvanceRoutes.ts`
  - salary advance list, create, deduction, delete, reconciliation, and deduction history.
- `routes/applicationRoutes.ts`
  - public application composition order;
  - write-invalidation middleware;
  - focused registrar registration;
  - HTTP server creation.

## Behavior-preservation rules

- Permission middleware remains before every affected domain registrar.
- Existing Factory registrars remain ahead of the historical ERP registrars.
- Auth, location, inventory, ledger, employee, supplier, and customer registration order is unchanged.
- The previously inline POS configuration, worker document, and salary advance routes remain in the same relative position.
- Remaining domain registrars retain their original sequence.
- The HTTP server is created only after all routes are registered.
- No endpoint path, request field, response payload, status code, accounting direction, inventory operation, schema, or database migration was intentionally changed.

## Guardrails

- `routesLegacy.ts` has a final 14-line ceiling.
- It may not contain Express HTTP registrations.
- The application composition root must register all extracted focused registrars.
- The static verifier and Vitest source contract protect these boundaries.

## Verification boundary

No CI, TypeScript compilation, formatting, lint, tests, production build, database execution, browser verification, deployment, or runtime smoke test was run for this phase.
