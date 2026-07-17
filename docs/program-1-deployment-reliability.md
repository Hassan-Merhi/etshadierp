# Program 1 — Deployment Reliability

Status: in progress. This branch must remain unmerged until the owner approves the completed Program 1 package.

## Phase sequence

- [x] 1A — Versioned migration cleanup
- [x] 1B — Production build reliability
- [x] 1C — Startup and shutdown lifecycle
- [ ] 1D — Health and recovery controls
- [ ] 1E — Production observability

Do not begin Program 2 on this branch.

## Phase 1A — Versioned migration cleanup

Status: complete.

- Versioned migration `migrations/20260717_factory_recalc_undo_log.sql` owns the recalculation undo-log schema and indexes.
- Normal route registration no longer executes its historical `CREATE TABLE` statement.
- The compatibility registration boundary changes no accounting, inventory, recalculation, undo, or HTTP behavior.

## Phase 1B — Production build reliability

Status: complete.

### Completed work

- Added `scripts/verify-production-artifact.mjs`.
- Every production build now validates that `dist/index.js` exists.
- Every Node preload file referenced by the production start command must exist.
- Every external package import left in the server bundle must be declared in `dependencies` and resolvable from the production install.
- The existing decimal.js bundle check remains active and now chains into the complete artifact contract.
- A missing runtime package or preload file fails during build verification instead of crashing after deployment.

### Focused verification

- Inspected the build and start commands in `package.json`.
- Confirmed `npm run build` already invokes `verify-server-bundle.mjs`, which now invokes the production artifact verifier.
- Confirmed the verifier ignores Node built-ins and bundled relative imports while checking external runtime packages.
- No Replit checks or credits were used.

## Phase 1C — Startup and shutdown lifecycle

Status: complete.

### Completed work

- Added `server/runtimeLifecycleGuard.mjs`, loaded before the compiled application through the existing runtime memory preload.
- Tracks all Node HTTP servers as they begin listening.
- On SIGTERM or SIGINT, stops accepting new connections before the existing application handler closes the database pool.
- Closes idle connections, waits for tracked HTTP servers, applies a configurable shutdown deadline, and makes repeated shutdown signals idempotent.
- Exposes shutdown state so new API work receives a retryable 503 response during the drain window.
- Preserves the existing database-pool shutdown and process-manager restart behavior.

### Focused verification

- Confirmed the lifecycle guard is imported at the top of `runtimeMemoryGuard.mjs`, which is already loaded by the production start command before `dist/index.js`.
- Confirmed shutdown interception is installed before the application registers its existing SIGTERM/SIGINT handlers.
- Confirmed health endpoints remain available while ordinary API work is rejected during shutdown.
- No Replit checks or credits were used.

## Remaining Program 1 work

- Phase 1D — Health and recovery controls
- Phase 1E — Production observability

## Safety constraints

- Do not merge this branch.
- Do not push directly to `main`.
- Do not run checks on Replit or consume Replit credits.
- Do not alter accounting or inventory business behavior as part of deployment hardening.
