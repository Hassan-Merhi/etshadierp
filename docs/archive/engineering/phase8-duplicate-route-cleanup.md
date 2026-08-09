# Phase 8 — Duplicate Route Cleanup

## Status

Complete.

## Objective

Prevent focused route registrars from being composed more than once and confirm that the four legacy compatibility files no longer own active Express HTTP registrations.

## Completed work

- audited `server/routes/applicationRoutes.ts` as the active application composition root;
- confirmed every focused registrar is invoked once in the preserved registration order;
- confirmed `server/routesLegacy.ts`, `reportsRoutesLegacy.ts`, `authRoutesLegacy.ts`, and `customerRoutesLegacy.ts` contain no active `app.get`, `app.post`, `app.put`, `app.patch`, `app.delete`, or `app.use` ownership;
- normalized legacy-boundary ownership descriptions to compatibility-only language;
- advanced the machine-readable boundary version to 8;
- added a source contract that fails if a focused registrar is duplicated or active HTTP registration returns to a compatibility file.

## Behavior preservation

This phase does not intentionally change endpoint paths, middleware order, request or response contracts, permissions, accounting direction, inventory quantities, factory costing, database schemas, migrations, or frontend behavior.

## Next phase

Phase 9 may remove compatibility exports and no-op legacy registrars once all remaining importers have been migrated to focused composition roots.

## Verification boundary

CI, TypeScript compilation, formatting, lint, tests, database execution, production build, browser checks, deployment, and runtime smoke checks were intentionally not run per owner instruction.
