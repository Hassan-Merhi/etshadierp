# Phase 6 — Inventory Route Ownership

## Status

Complete.

Phase 5 removed the final active HTTP registrations from `server/routesLegacy.ts`. Phase 6 verifies and freezes the resulting inventory boundary so inventory endpoints cannot drift back into the compatibility export.

## Inventory composition

`server/routes/applicationRoutes.ts` registers `registerInventoryRoutes(app)` from `server/routes/inventoryRoutes.ts`.

The inventory registrar delegates to focused modules in preserved order:

1. `server/routes/inventory/inventoryListRoutes.ts`
2. `server/routes/inventory/inventoryQuickAdjustRoutes.ts`
3. `server/routes/inventoryMovementRoutes.ts`

Stock master, stock summary, location inventory, container inventory, factory raw stock, and other adjacent domains remain owned by their existing focused registrars. This phase does not combine those registrars or change their relative registration order.

## Legacy boundary

`server/routesLegacy.ts` is a compatibility-only export and owns no inventory endpoint, middleware, query, schema, or business rule.

The Phase 6 source contract requires:

- the application composition root to register the focused inventory registrar;
- the inventory registrar to compose list, quick-adjust, and movement modules;
- the compatibility export to contain no Express route registration;
- the architecture boundary metadata to state that inventory ownership is outside the legacy file.

## Behavior preservation

No endpoint path, request or response shape, validation rule, inventory calculation, stock quantity, company isolation rule, permission, database schema, or registration order was intentionally changed.

## Verification boundary

CI, TypeScript, formatting, lint, tests, database execution, production build, browser checks, deployment, and runtime smoke checks were not run, per owner instruction.
