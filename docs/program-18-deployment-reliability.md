# Program 18 — Deployment Reliability

## Objective

Make production startup deterministic and fail fast on invalid deployment configuration without changing application routes, database schema, migrations, accounting, inventory, costing, authorization, API contracts, or runtime business behavior.

## Phase 18A — Deployment Configuration Ownership

### Completed

- Added `server/deploymentPreflight.mjs` as the deployment-runtime configuration owner.
- Centralized production detection, port validation, database-source detection, session-pool sizing, shutdown grace period, and build-version resolution.
- Added bounded integer parsing for deployment settings so malformed, fractional, negative, zero where disallowed, or excessively large values cannot silently reach runtime infrastructure.
- Established one safe build-version fallback order: `BUILD_VERSION`, `RENDER_GIT_COMMIT`, `REPL_SLUG`, then `dev`.
- Added startup logging for accepted deployment configuration without exposing credentials, connection strings, passwords, or session secrets.

### Supported settings

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

## Phase 18B — Production Startup Preflight

### Completed

- Wired deployment preflight into `server/runtimeMemoryGuard.mjs`, which is already imported before `dist/index.js` by the production `start` command.
- Production now fails before the application bundle loads when required deployment configuration is absent or invalid.
- Development remains non-blocking: invalid bounded values warn and fall back to documented defaults.
- Database validation accepts either `DATABASE_URL` or the complete PostgreSQL environment variable set.
- Session-secret validation rejects missing or short production secrets before session middleware starts.
- Preflight logs only deployment metadata and bounded numeric settings; it never logs secret values or database connection details.
- Preserved the existing runtime memory, health, observability, lifecycle, startup migration, readiness, and process-restart behavior.

## Release safety rules

1. Production startup must pass deployment preflight before loading the server bundle.
2. Secrets and connection strings must never be included in startup logs.
3. Build identity must be stable across restarts of the same release.
4. Readiness remains separate from liveness; startup migrations continue to control readiness in the existing server flow.
5. Deployment validation must not execute migrations, mutate data, or contact external services.
6. Provider-specific tuning must be bounded and documented before use.

## Deferred work for later Program 18 phases

- graceful shutdown ownership consolidation;
- release metadata exposure and deployment diagnostics;
- build artifact and production dependency verification integration;
- rollback and post-deploy verification documentation;
- provider configuration files and health-check alignment where supported;
- live deployment, migration, readiness, and rollback exercises.

These require later phases or a real deployment environment and were not guessed or simulated here.

## Safety

- No deployment was triggered.
- No CI or GitHub Actions workflow was run.
- No migration, SQL command, database connection, or external service call was executed.
- No application route, calculation, permission, API contract, persistence behavior, or historical data was changed.

## Status

- Active branch: `quality/program-18-deployment-reliability`
- Phase 18A: complete.
- Phase 18B: complete.
- Program 18 remains unmerged until later phases are completed.
