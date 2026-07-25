# Program 4 — Database and Deployment Safety

Baseline branch: `main`

Baseline commit: `3872e2eaf16be020ca7a4d16234830604582af0e`

Started: 2026-07-25

## Safety boundary

This program must not alter accounting totals, inventory valuation, historical transactions, tenant data, or production database state without a separately reviewed migration and explicit owner approval.

The versioned migration runner introduced in Phase 4A is not called by `npm start`, Render's build command, or the application startup path. It requires both an `--apply` flag and a one-command confirmation environment variable.

## Phase 4A — Versioned migration foundation

### Confirmed current-state risks

The repository currently has two parallel migration systems:

1. SQL files in `migrations/` with a Drizzle journal.
2. A large `startupMigrations` list plus many data-repair queries executed from `server/index.ts`.

The startup path also contains always-running DDL and historical repair operations. Several repair failures are caught and logged without preventing startup. The migration executor records statement failures but marks `migrationsDone = true` in its `finally` block, and the surrounding startup catch also treats migration errors as non-fatal.

Before Phase 4B, Render checked `/api/health`, which only proved that the HTTP server answered.

### Phase 4A implementation

- Registered `20260720_003_ledger_account_opening_balance_currency` in the Drizzle journal. The SQL is idempotent and uses `ADD COLUMN IF NOT EXISTS`.
- Added `scripts/verify-migration-registry.mjs`.
  - Detects duplicate or non-sequential indexes.
  - Detects duplicate migration tags.
  - Confirms each registered tag has a matching SQL file.
  - Reports SQL files that are not registered.
  - Supports `--strict` and `--json` modes.
- Added `scripts/run-versioned-migrations.mjs`.
  - Requires the explicit `--apply` flag.
  - Requires `MIGRATION_CONFIRMATION=APPLY_VERSIONED_MIGRATIONS`.
  - Requires `DATABASE_URL`.
  - Uses a single PostgreSQL client and a session advisory lock.
  - Applies only migrations registered in `migrations/meta/_journal.json`.
  - Is not connected to production startup.
- Added a static regression test protecting the journal and opt-in boundary.

### Manual invocation

Registry review only:

```bash
node scripts/verify-migration-registry.mjs
node scripts/verify-migration-registry.mjs --json
```

Strict registry review, where unregistered SQL files are treated as failures:

```bash
node scripts/verify-migration-registry.mjs --strict
```

Explicit migration application after review:

```bash
MIGRATION_CONFIRMATION=APPLY_VERSIONED_MIGRATIONS \
  node scripts/run-versioned-migrations.mjs --apply
```

Do not run the apply command against production until the registry report, database backup, and deployment plan have been reviewed.

## Phase 4B — Fail-closed readiness

### Implementation

- Added `server/criticalSchemaReadiness.mjs`, which defines a deliberately small set of deployment-critical schema requirements.
- The requirements cover foundational company, authentication, accounting, inventory, exchange-rate, salary-advance, and fiscal-period objects.
- Strengthened the existing `/api/health/ready` runtime endpoint.
  - Confirms the server is listening and not shutting down.
  - Confirms PostgreSQL accepts a connection and query.
  - Confirms required tables exist.
  - Confirms required columns exist.
  - Confirms the exchange-rate upsert uniqueness index exists.
  - Returns HTTP 503 with exact missing object names when the schema is incomplete.
- Added a 30-second schema-result cache, configurable with `READINESS_SCHEMA_CACHE_MS`, so frequent health polling does not repeatedly scan PostgreSQL catalogs.
- Changed `render.yaml` from `/api/health` to `/api/health/ready`.
- Kept `/api/health` unchanged for lightweight browser connectivity checks.
- Added regression coverage for complete and incomplete schema snapshots and for Render's health-check path.

### Deployment behavior

When this branch is eventually merged and deployed:

- A new instance with a complete critical schema returns 200 and becomes healthy.
- A new instance with a missing critical table, column, or index returns 503.
- Render should keep the previous healthy deployment serving traffic rather than promoting the incomplete instance.
- Optional startup repair failures do not block deployment unless they leave a required schema object missing.

### Important limitation

The large legacy migration executor in `server/index.ts` still catches and logs many migration or repair errors. Phase 4B protects deployment by checking the resulting schema rather than trusting its `migrationsDone` boolean. Separating all historical data repairs from startup remains future migration-cleanup work and should be done incrementally, not as one large rewrite.

No migration or database repair was executed as part of Phase 4B.

## Phase 4C — Backup, rollback, and recovery

Planned work:

- Document pre-deploy backup requirements.
- Add a restore-verification checklist.
- Classify migrations as additive, backfill, constraint, or destructive.
- Require explicit rollback notes for non-additive migrations.
- Add a failed-deployment recovery runbook.

## Merge rule

This branch remains isolated and unmerged until explicit owner approval. The versioned migration runner remains opt-in, and production migration application still requires a reviewed backup and deployment plan.
