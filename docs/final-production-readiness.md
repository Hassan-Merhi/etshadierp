# Final Production Readiness and Release Sign-off

## Status

Repository implementation is not production sign-off. Production sign-off requires executable checks on one frozen commit, verified backup and restore evidence, controlled migration rehearsal, manual deployment of the approved SHA, module-level smoke evidence, and a demonstrated rollback owner.

No step in this runbook authorizes Historical Replay Apply, Supplier Partner production cutover, a database repair, or an unreviewed financial transaction.

## Release invariants

- Freeze one full 40-character Git commit for the release.
- Do not deploy a moving branch or an unrecorded working tree.
- Keep Render `autoDeploy: false`; promotion must be manual.
- Set `RELEASE_EXPECTED_COMMIT` to the frozen SHA before deployment.
- A production startup mismatch between the actual and approved commits must fail closed.
- Leave Historical Replay Apply, migration confirmation, and master-password impersonation disabled during ordinary deployment.
- Do not run Supplier Partner cutover until finalize and rollback have been rehearsed on non-production companies.
- A readiness or evidence failure is a stop condition, not permission to disable a guard.
- Never test a restore by overwriting production.

## Gate 1 — Freeze and initialize evidence

```bash
export RELEASE_EXPECTED_COMMIT='<full-40-character-commit-sha>'
node scripts/create-release-evidence.mjs \
  --commit="$RELEASE_EXPECTED_COMMIT" \
  --output=release-evidence.json
node scripts/run-release-readiness.mjs --list
```

The generated evidence file starts in `pending` state. It cannot pass until every required repository check, database rehearsal, deployment record, smoke module and approval is complete.

## Gate 2 — Static release contracts

```bash
node scripts/run-release-readiness.mjs --static
```

This executes the machine-defined static checks in `config/release-readiness.json`, including:

- final production contracts;
- migration registry strict mode;
- Phase 12 test/reliability contracts;
- critical test-debt limits;
- lockfile registry safety.

The static boundary also protects:

- Render manual deployment, exact Node version and `/api/health/ready`;
- the full runtime release identity;
- the reviewed migration-debt manifest;
- evidence creation and verification tooling;
- the current deployment checklist.

Static verification does not prove runtime correctness.

## Gate 3 — Executable application checks

From a clean checkout of the frozen release commit:

```bash
npm ci --registry=https://registry.npmjs.org/
RELEASE_EXECUTION_CONFIRMATION=RUN_RELEASE_READINESS \
  node scripts/run-release-readiness.mjs --execute
```

The executable boundary includes formatting, lint, TypeScript, backend and frontend coverage, the critical business regression suite, production build, production dependency verification, memory stabilization, bandwidth boundaries and focused security checks.

Do not continue when any command fails, times out, is unavailable, is cancelled or cannot execute. A missing CI service is not a passing result; an independent clean checkout may supply evidence only when the exact commit, command, environment and output are retained.

## Gate 4 — Backup and restore rehearsal

Follow `docs/operations/database-backup-rollback-recovery.md`.

Required evidence:

- frozen release commit and current production deployment;
- database target without credentials;
- backup filename, timestamp, size, type and SHA-256;
- successful backup inspection;
- restore into a new disposable database;
- `/api/health/ready` HTTP 200 on the restored database;
- representative source and restored table counts;
- restore duration, warnings and explicit approver.

Disable schedulers and external integrations on the rehearsal instance.

## Gate 5 — Tenant and migration rehearsal

Run the read-only tenant audit against the restored database:

```bash
DATABASE_URL='postgresql://.../erp_restore_rehearsal' \
  node scripts/tenant-control-integrity-audit.mjs --json
```

The audit must report zero error rows. Warnings require explicit review.

Verify the exact migration state:

```bash
node scripts/verify-migration-registry.mjs --strict
```

Strict mode permits only the exact debt recorded in `config/migration-registry-debt.json`:

- three approved pre-versioning journal gaps;
- six approved standalone SQL files.

A new unregistered SQL file, missing allowance, stale allowance, missing registered file, duplicate tag, duplicate index or non-sequential journal fails the gate.

`20260717_phase3_heavy_read_indexes.sql` uses `CREATE INDEX CONCURRENTLY` and must remain outside the transactional Drizzle runner. `20260721_001_factory_mix_batch_sources_inventory_supplier.sql` includes a reviewed historical backfill and `NOT VALID` constraints and requires controlled rehearsal.

Apply registered migrations only to the restored database first:

```bash
DATABASE_URL='postgresql://.../erp_restore_rehearsal' \
MIGRATION_CONFIRMATION=APPLY_VERSIONED_MIGRATIONS \
  node scripts/run-versioned-migrations.mjs --apply
```

After rehearsal, readiness, login, company switching, isolation, business totals and inventory quantities must remain correct. Migration application remains outside `npm start` and Render startup.

## Gate 6 — Supplier Partner and Historical Replay rehearsal

Supplier Partner Phase 4 rehearsal must prove:

1. final verification returns `PASS` or explicitly approved synchronizable warnings;
2. Prepare locks source and target writes;
3. Finalize reconciles stock, sales, containers, Goods OTW, users, roles, locations, cash accounts, sessions and presence;
4. the source rejects writes with `SP_SOURCE_READ_ONLY`;
5. controlled rollback restores the source and prevents split-brain operation.

With Historical Replay Apply disabled, inspect:

```text
GET /api/factory/raw-stock/recalc/historical-replay/readiness
GET /api/factory/raw-stock/recalc/historical-replay/verification
```

Review supplier changes, raw-material value, Balance on Table and projected Net Position. Historical Replay Apply requires a separate approved window and is not part of ordinary release verification.

## Gate 7 — Manual deployment of the approved commit

The repository `render.yaml` requires:

- Node `20.19.2`;
- build command `npm ci --registry=https://registry.npmjs.org/ && npm run build`;
- start command `npm start`;
- readiness path `/api/health/ready`;
- `autoDeploy: false`.

Before manual promotion, configure:

```text
RELEASE_EXPECTED_COMMIT=<exact frozen 40-character SHA>
RELEASE_ID=<release identifier>
```

Do not persist these dangerous controls in the Render blueprint:

- `HISTORICAL_REPLAY_APPLY_MODE`;
- `HISTORICAL_REPLAY_RELEASE_ID`;
- `MIGRATION_CONFIRMATION`;
- `MASTER_PASSWORD`.

Record the previous healthy deployment before promotion. The application startup policy compares the full runtime commit against `RELEASE_EXPECTED_COMMIT`; a mismatch fails startup.

## Gate 8 — Production smoke verification

Verify read-only behavior first:

- `/api/health/live` returns the expected full commit SHA and release ID;
- `/api/health/ready` returns HTTP 200 with `commitVerified: true`;
- login, logout, session refresh and legitimate company switching work;
- Admin, ERP, Factory, POS, Properties and Supplier Partner routing works;
- Back, Escape, browser Back/Forward and direct URLs work;
- Accounts, Daybook, vouchers, inventory, transfers, containers, offload, mix batches, reports and exports load correctly;
- company isolation remains enforced on administrative, deleted-item, file and location operations;
- logs show no unexpected 401, 403, 409, 500, pool timeout, memory pressure, restart or request loop.

Do not create production financial transactions merely as smoke tests without an approved transaction and reversal procedure.

Complete every smoke module listed in `config/release-readiness.json`, with timestamp and evidence reference.

## Gate 9 — Rollback readiness

Record:

- previous healthy deployment;
- rollback owner;
- code rollback trigger;
- database recovery trigger;
- expected rollback duration;
- rehearsal evidence where required.

Rollback is not ready when the previous deployment is unknown, the backup is unverified, the recovery procedure has not been rehearsed, or the owner is unavailable.

## Gate 10 — Machine-verified sign-off

Fill the release evidence and run:

```bash
node scripts/verify-release-evidence.mjs --file=release-evidence.json
```

The verifier requires:

- deployed SHA equals frozen SHA;
- every required command is `passed` with timestamp and evidence;
- every operational section and smoke module is `passed`;
- auto deploy, startup migrations, Historical Replay Apply and master password remain disabled;
- approver, approval timestamp and rollback owner are present.

Production sign-off exists only when evidence verification passes and the record is retained with the release.

## Stop conditions

Stop deployment or roll back when:

- the deployed commit differs from the approved commit;
- a required check fails or cannot execute;
- backup is missing, stale, empty or not restorable;
- tenant audit reports error rows;
- migration strict mode or rehearsal fails;
- rehearsal changes business totals unexpectedly;
- `/api/health/ready` returns 503;
- cross-company access succeeds where it should be denied;
- Supplier Partner final verification is not `PASS`;
- Historical Replay readiness reports unresolved blockers;
- unexpected API errors, repeated restarts, memory pressure or request loops appear;
- rollback cannot be demonstrated;
- evidence verification fails.

When stopped, preserve evidence, keep or restore the previous healthy deployment, and fix the issue on an isolated branch. Do not bypass the safety control that detected the failure.
