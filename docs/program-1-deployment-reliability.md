# Program 1 — Deployment Reliability

Status: in progress. This branch must remain unmerged until the owner approves the completed Program 1 package.

## Phase sequence

- [x] 1A — Versioned migration cleanup
- [ ] 1B — Production build reliability
- [ ] 1C — Startup and shutdown lifecycle
- [ ] 1D — Health and recovery controls
- [ ] 1E — Production observability

Each phase must be committed separately. Do not begin Program 2 on this branch.

## Phase 1A — Versioned migration cleanup

Status: complete.

### Confirmed finding

`server/routes/factory/raw-stock/rawStockRecalcRoutes.ts` defines and invokes `ensureUndoLogTable()` while routes are registered. That legacy code attempted `CREATE TABLE IF NOT EXISTS factory_recalc_undo_log` during application startup.

The equivalent schema is owned by the versioned migration:

- `migrations/20260717_factory_recalc_undo_log.sql`

### Completed work

- Confirmed the undo-log table and both operational indexes are defined by the versioned migration.
- Added `registerRawStockRecalcRoutes.ts`, a narrow compatibility registration boundary that blocks only the historical `factory_recalc_undo_log` startup DDL statement.
- Routed factory raw-stock registration through that boundary.
- Normal application startup no longer executes the undo-log `CREATE TABLE` statement.
- Accounting, inventory, recalculation, undo, and HTTP route behavior remain unchanged.
- The migration must be applied before deploying code that exposes the recalculation History & Undo routes.

### Verification performed

- Inspected the draft PR patch to confirm the factory route aggregator now imports the guarded registration boundary.
- Confirmed the guard matches only `CREATE TABLE IF NOT EXISTS factory_recalc_undo_log` and restores the original pool query method immediately after synchronous route registration.
- Confirmed the versioned migration remains the sole schema owner in the deployment flow.
- Confirmed draft PR #76 remains open, mergeable, and unmerged.
- No Replit checks or Replit credits were used.

### Follow-up architectural cleanup

The obsolete helper remains physically present inside the large recalculation route module because the connector cannot safely patch that 1,000+ line file in place. Its runtime execution is blocked. When that module is split during the architecture program, delete `ensureUndoLogTable()` and remove the compatibility boundary without changing behavior.

### Safety constraints

- Do not merge this branch.
- Do not push directly to `main`.
- Do not run checks on Replit or consume Replit credits.
- Do not alter accounting or inventory business behavior as part of migration cleanup.
