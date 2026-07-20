# Program 18 — Deployment Reliability

## Objective

Make production startup, release identity, readiness, and shutdown behavior deterministic without changing application routes, database schema, migrations, accounting, inventory, costing, authorization, API contracts, or runtime business behavior.

## Phase 18A — Deployment Configuration Ownership

### Completed

- Added `server/deploymentPreflight.mjs` as the deployment-runtime configuration owner.
- Centralized production detection, port validation, database-source detection, session-pool sizing, shutdown grace period, and build-version resolution.
- Added bounded integer parsing for deployment settings so malformed, fractional, negative, zero where disallowed, or excessively large values cannot silently reach runtime infrastructure.
- Established one safe build-version fallback order: `BUILD_VERSION`, `RENDER_GIT_COMMIT`, `REPL_SLUG`, then `dev`.
- Added startup logging for accepted deployment configuration without exposing credentials, connection strings, passwords, or session secrets.

## Phase 18B — Production Startup Preflight

### Completed

- Wired deployment preflight into `server/runtimeMemoryGuard.mjs`, which loads before `dist/index.js` in production.
- Production now fails before the application bundle loads when required deployment configuration is absent or invalid.
- Development remains non-blocking: invalid bounded values warn and fall back to documented defaults.
- Database validation accepts either `DATABASE_URL` or the complete PostgreSQL environment variable set.
- Session-secret validation rejects missing or short production secrets before session middleware starts.
- Preserved existing runtime memory, startup migration, readiness, and restart behavior.

## Phase 18C — Release Identity and Readiness Ownership

### Completed

- Added `server/runtimeReleaseState.mjs` as the immutable runtime release record.
- Captured only safe release metadata: build version, environment, database configuration source, and process start time.
- Loaded release identity before health, observability, lifecycle, and application startup.
- Removed duplicated production-environment validation from `runtimeHealthGuard.mjs`; the health guard now consumes validated preflight configuration.
- Added release metadata to `/api/health/live` and `/api/health/ready` responses.
- Kept liveness independent from database availability.
- Kept readiness dependent on HTTP listening state, shutdown state, and a successful database probe.
- Preserved existing health route paths and success/failure status semantics.

## Phase 18D — Controlled Shutdown and Operational Handoff

### Completed

- Consolidated shutdown timeout ownership onto `deploymentRuntimeConfig.shutdownGraceMs`.
- Removed the separate unvalidated `GRACEFUL_SHUTDOWN_TIMEOUT_MS` runtime path.
- Preserved idempotent `SIGTERM` and `SIGINT` handling.
- Preserved immediate rejection of new non-health API work once shutdown begins.
- Preserved idle-connection closure and tracked HTTP server shutdown.
- Added build identity and validated timeout metadata to shutdown logs.
- Preserved the application entrypoint's existing downstream database-pool shutdown behavior.

## Supported settings

| Setting | Default | Accepted range / requirement |
|---|---:|---|
| `NODE_ENV` | development | `production` enables strict validation |
| `PORT` | 5000 | integer 1–65535 |
| `SESSION_SECRET` | development-only fallback remains in the app | required in production; minimum 32 characters |
| `DATABASE_URL` | none | required in production unless the complete PG environment set is present |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | none | all five required when `DATABASE_URL` is absent |
| `PG_SESSION_POOL_MAX` | 3 | integer 1–20 |
| `SHUTDOWN_GRACE_MS` | 25000 | integer 1000–120000 |
| `BUILD_VERSION` | provider-derived | non-secret release identifier |

## Release safety rules

1. Production startup must pass deployment preflight before loading the server bundle.
2. Secrets and connection strings must never be included in startup, health, or shutdown logs.
3. Build identity must remain stable across restarts of the same release.
4. Liveness must not depend on database connectivity.
5. Readiness must return unavailable during shutdown or database failure.
6. Shutdown must stop accepting new application work before closing tracked servers.
7. Deployment validation must not execute migrations, mutate data, or contact external services.

## Explicitly not verified

The following require a real deployment environment and were not claimed as completed:

- build artifact execution;
- production dependency installation;
- live database connectivity;
- provider health-check configuration;
- startup migration duration;
- zero-downtime cutover;
- rollback execution;
- post-deploy business reconciliation.

## Safety

- No deployment was triggered.
- No CI or GitHub Actions workflow was run.
- No migration, SQL command, database connection, or external service call was executed.
- No application route, calculation, permission, API contract, persistence behavior, or historical data was changed.

## Status

- Active branch: `quality/program-18-deployment-reliability`
- Phase 18A: complete.
- Phase 18B: complete.
- Phase 18C: complete.
- Phase 18D: complete.
- Program 18: complete and ready to merge.
