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

Render currently checks `/api/health`, while database status is exposed separately at `/api/health/db`.

These behaviors are not changed in Phase 4A. They are the inputs for Phase 4B.

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

Planned work:

- Track migration status as `starting`, `ready`, or `failed` rather than one boolean.
- Preserve the exact migration failure summary.
- Return 503 from a dedicated readiness endpoint when required schema checks fail.
- Point Render to the readiness endpoint only after validating the behavior on a non-production database.
- Stop marking migrations ready from a `finally` block.
- Separate required schema checks from optional compatibility repairs.

## Phase 4C — Backup, rollback, and recovery

Planned work:

- Document pre-deploy backup requirements.
- Add a restore-verification checklist.
- Classify migrations as additive, backfill, constraint, or destructive.
- Require explicit rollback notes for non-additive migrations.
- Add a failed-deployment recovery runbook.

## Merge rule

This branch remains isolated and unmerged until explicit owner approval. The new runner must remain opt-in until Phase 4B and a non-production migration rehearsal are complete.
