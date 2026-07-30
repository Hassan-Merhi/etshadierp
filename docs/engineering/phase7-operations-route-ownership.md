# Phase 7 — Operations route ownership

## Outcome

Operational HTTP ownership is fully outside `server/routesLegacy.ts`.

Phase 5 moved the active application composition into `server/routes/applicationRoutes.ts`. Phase 7 freezes the operations portion of that architecture so logistics, stock movement, POS, rentals, factory workflows, imports, containers, employees, locations, and supporting operational services remain in focused registrars.

## Focused ownership

The application composition root preserves the established registration order while delegating operational behavior to focused modules, including:

- `locationRoutes.ts`
- `employeeRoutes.ts`
- `stockRoutes.ts`
- `containerRoutes.ts`
- `importRoutes.ts`
- `posRoutes.ts`
- `baleRoutes.ts`
- the ERP, properties, and factory rental registrars
- the focused factory route registrars
- global transaction and fiscal transfer registrars

`server/routesLegacy.ts` remains only a compatibility export to `registerApplicationRoutes` and must not register HTTP handlers or import operational registrars directly.

## Behavior preservation

This phase intentionally changes no endpoint path, payload, validation, authorization rule, company isolation rule, inventory quantity, voucher behavior, factory costing behavior, database schema, migration, or route registration order.

## Architecture guard

`tests/operations-route-ownership.test.ts` records the focused ownership contract and prevents operational HTTP registration from returning to `routesLegacy.ts`.

## Verification boundary

CI, TypeScript compilation, formatting, lint, tests, database execution, production build, browser checks, deployment, and runtime smoke checks were intentionally skipped per owner instruction.
