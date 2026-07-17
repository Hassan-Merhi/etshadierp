# Program 1 — Deployment Reliability

Status: in progress. This branch must remain unmerged until the owner approves the completed Program 1 package.

## Phase sequence

- [ ] 1A — Versioned migration cleanup
- [ ] 1B — Production build reliability
- [ ] 1C — Startup and shutdown lifecycle
- [ ] 1D — Health and recovery controls
- [ ] 1E — Production observability

Each phase must be committed separately. Do not begin Program 2 on this branch.

## Phase 1A — Versioned migration cleanup

### Confirmed finding

`server/routes/factory/raw-stock/rawStockRecalcRoutes.ts` defines and invokes `ensureUndoLogTable()` while routes are registered. This executes `CREATE TABLE IF NOT EXISTS factory_recalc_undo_log` during application startup.

The equivalent schema is already represented by the versioned migration:

- `migrations/20260717_factory_recalc_undo_log.sql`

The runtime DDL must therefore be removed from route registration so deployment order is explicit: migration first, application startup second.

### Phase 1A completion requirements

- Inventory application-startup, route-registration, request-time and repair-time DDL.
- Confirm a versioned migration exists for each required schema change.
- Add missing versioned migrations where necessary.
- Remove automatic schema mutation from normal application startup and route registration.
- Keep explicit administrator-only repair/migration operations separate and documented.
- Ensure missing required schema fails clearly rather than being silently created by a request handler.
- Commit the completed Phase 1A separately before advancing to Phase 1B.

### Safety constraints

- Do not merge this branch.
- Do not push directly to `main`.
- Do not run checks on Replit or consume Replit credits.
- Do not alter accounting or inventory business behavior as part of migration cleanup.
