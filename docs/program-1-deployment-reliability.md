# Program 1 — Deployment Reliability

Status: complete and awaiting owner approval. This branch must remain unmerged until the owner approves the completed Program 1 package.

## Phase sequence

- [x] 1A — Versioned migration cleanup
- [x] 1B — Production build reliability
- [x] 1C — Startup and shutdown lifecycle
- [x] 1D — Health and recovery controls
- [x] 1E — Production observability

Do not merge this branch automatically.

## Phase 1A — Versioned migration cleanup

Status: complete.

- Versioned migration `migrations/20260717_factory_recalc_undo_log.sql` owns the recalculation undo-log schema and indexes.
- Normal route registration no longer executes its historical `CREATE TABLE` statement.
- The compatibility registration boundary changes no accounting, inventory, recalculation, undo, or HTTP behavior.

## Phase 1B — Production build reliability

Status: complete.

- Added `scripts/verify-production-artifact.mjs`.
- Production builds validate `dist/index.js`, required preload files, external runtime imports, dependency declarations, and package resolvability.
- The decimal.js bundle check remains active and chains into the complete artifact contract.
- Missing runtime packages or preload files now fail before deployment startup.

## Phase 1C — Startup and shutdown lifecycle

Status: complete.

- Added `server/runtimeLifecycleGuard.mjs`.
- SIGTERM/SIGINT stop new connections, drain HTTP work, close idle connections, enforce a shutdown deadline, and remain idempotent.
- Ordinary API work receives a retryable 503 while health endpoints remain available.
- Existing database-pool shutdown behavior is preserved.

## Phase 1D — Health and recovery controls

Status: complete.

- Added `server/runtimeHealthGuard.mjs`.
- `/api/health/live` reports process liveness independently of dependencies.
- `/api/health/ready` verifies the server is listening, shutdown has not begun, required production environment values are present, and PostgreSQL answers a real `SELECT 1` probe.
- Production startup now fails clearly when `SESSION_SECRET` is absent instead of serving with unsafe configuration.
- Readiness returns 503 with structured failure details when the database or configuration is unavailable.

## Phase 1E — Production observability

Status: complete.

- Added `server/runtimeObservability.mjs`.
- Tracks active, total, peak, slow, and 5xx requests.
- Measures RSS, heap, external memory, and event-loop mean/max/p95/p99 delay.
- Logs structured JSON for slow requests, 5xx responses, and runtime pressure.
- `/api/health/metrics` exposes a no-store operational snapshot.
- Health and observability modules load automatically through the existing production memory preload.

## Focused verification

- Inspected the production start chain and confirmed all Program 1 modules are loaded before `dist/index.js`.
- Confirmed liveness, readiness, and metrics endpoints bypass request shedding and shutdown rejection.
- Confirmed the readiness database client always closes after its probe.
- Confirmed the draft PR remains open and unmerged.
- No Replit checks or credits were used.

## Safety constraints

- Do not merge this branch without owner approval.
- Do not push directly to `main`.
- Do not alter accounting or inventory business behavior as part of deployment hardening.
