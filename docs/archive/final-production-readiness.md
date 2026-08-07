# Final Production Readiness and Release Sign-off

## Status

The repository implementation is complete for Program 3 company isolation, Historical Replay Phase 8, Supplier Partner Phase 4, Programs 6–8, and the ERP/Factory/Properties navigation audits.

This document does **not** declare production verified. Production sign-off requires executable checks, a verified backup and restore rehearsal, controlled database activation, deployment evidence, and business smoke tests.

No step in this runbook authorizes historical replay Apply, Supplier Partner cutover, a database repair, or an unreviewed production write.

## Release invariants

- Freeze one exact Git commit for the release.
- Do not deploy a moving branch or an unrecorded working tree.
- Keep Historical Replay Apply disabled unless a separate release window explicitly authorizes it.
- Do not run Supplier Partner cutover until the rehearsal company has completed finalize and rollback testing.
- Do not apply migration `0013_tenant_control_integrity_guards` until the tenant audit, backup, restore rehearsal, and rollback plan are reviewed.
- A readiness failure is a stop condition, not permission to disable a guard.
- Never test a restore by overwriting production.

## Gate 1 — Repository contract verification

From a clean checkout of the frozen release commit:

```bash
npm ci --registry=https://registry.npmjs.org/
npm run verify:final-production-readiness
```

This static verifier confirms that the fail-closed release contracts remain present. It does not connect to a database, deploy code, or prove runtime correctness.

Stop when:

- any required file is missing;
- a required safety marker is missing;
- migration journal index 13 does not map exactly to `0013_tenant_control_integrity_guards`;
- Render readiness no longer points to `/api/health/ready`; or
- the Historical Replay Apply mode appears in `render.yaml`.

## Gate 2 — Executable application checks

Run on the frozen release commit in a clean environment:

```bash
npm run format:check
npm run lint
npm run check
npm test
npm run build
npm run verify:production-dependencies
npm run verify:stabilization
npm run verify:bandwidth
npm run check:security
```

Also run the focused UI navigation configurations used by the ERP and Properties audits.

Do not continue to production when any required check cannot execute or fails. A missing CI runner is not a passing result. An approved independent checkout may supply the evidence while GitHub Actions is unavailable, but the exact commands, commit, environment, and output must be recorded.

## Gate 3 — Backup and restore rehearsal

Follow `docs/operations/database-backup-rollback-recovery.md`.

Required evidence:

- frozen release commit;
- current production commit and deployment identifier;
- database host and database name without credentials;
- backup filename, timestamp, size, and SHA-256;
- `pg_restore --list` evidence for a custom-format dump;
- successful restore into a new disposable database;
- `/api/health/ready` HTTP 200 on the restored database;
- representative table counts compared with the source snapshot;
- restore duration and warnings;
- explicit approver.

Never point the restore rehearsal at production. Disable schedulers and external integrations on the rehearsal instance.

## Gate 4 — Tenant-integrity audit and migration rehearsal

Run the read-only audit against the restored database first:

```bash
DATABASE_URL='postgresql://.../erp_restore_rehearsal' \
  node scripts/tenant-control-integrity-audit.mjs --json
```

The audit must report zero error rows. Warnings must be reviewed and accepted or repaired through a separate approved change.

Review the migration registry:

```bash
node scripts/verify-migration-registry.mjs --strict
```

Rehearse the registered migrations only against the disposable restored database:

```bash
DATABASE_URL='postgresql://.../erp_restore_rehearsal' \
MIGRATION_CONFIRMATION=APPLY_VERSIONED_MIGRATIONS \
  node scripts/run-versioned-migrations.mjs --apply
```

After rehearsal:

- `/api/health/ready` must remain HTTP 200;
- login and company switching must work;
- no cross-company role, location, cash-account, or POS mapping may be created;
- application totals and inventory quantities must remain unchanged;
- migration duration and warnings must be recorded.

Do not add the deferred unique `(user_id, company_id)` constraint or validate historical foreign keys during this release unless a separate reviewed migration explicitly owns that work.

## Gate 5 — Supplier Partner Phase 4 rehearsal

Use a non-production rehearsal source and target company.

Follow `docs/archive/sp-migration-phase-4-runbook.md` and require:

1. final verification returns `PASS` or only approved synchronizable warnings;
2. Prepare locks source and target writes;
3. Finalize completes exact stock, sales, container, Goods-OTW, user, role, location, cash-account, session, and presence reconciliation;
4. the target activates only after final verification is `PASS`;
5. the old source rejects writes with `SP_SOURCE_READ_ONLY`;
6. one rehearsal container and one rehearsal sale can be created and reversed;
7. controlled rollback restores source users and inventory state before the deadline;
8. the target remains read-only after rollback to prevent split-brain operation.

Do not start a production cutover solely because the repository code is merged.

## Gate 6 — Deployment with dangerous features disabled

Before deploying:

- leave `HISTORICAL_REPLAY_APPLY_MODE` unset;
- leave `HISTORICAL_REPLAY_RELEASE_ID` unset;
- do not place migration application in `npm start` or Render startup;
- record the previous healthy deployment for code rollback;
- confirm the deployed commit matches the frozen release commit.

Deploy the code. Apply reviewed versioned migrations only through the explicit migration runner and only after the production backup and rehearsal evidence are approved.

## Gate 7 — Production smoke verification

Immediately after deployment, verify read-only behavior first:

- `/api/health/ready` returns HTTP 200 and names no missing critical schema objects;
- login, logout, session refresh, and legitimate company switching;
- Admin, normal ERP user, Factory user, POS user, and Properties user routing;
- ERP, Factory, POS, Properties, and Supplier Partner navigation, Back, Escape, browser Back/Forward, and direct URLs;
- Accounts, Daybook, vouchers, customers, suppliers, employees, inventory, location inventory, stock transfers, containers, offloading, mix batches, reports, and exports;
- company isolation on admin, deleted-item, file, location-summary, and orphan-record operations;
- no unexpected 401, 403, 409, 500, readiness, pool-timeout, memory, repeated restart, or bandwidth-loop errors in logs.

Do not create production financial transactions merely as smoke tests unless the business owner explicitly approves the exact transaction and reversal procedure.

## Gate 8 — Historical Replay readiness only

With Apply still disabled, inspect:

```text
GET /api/factory/raw-stock/recalc/historical-replay/readiness
GET /api/factory/raw-stock/recalc/historical-replay/verification
```

Resolve every schema and safety blocker. Review supplier changes, raw-material value, Balance on Table, and projected Net Position.

Historical Replay Apply requires a separate explicit authorization, unique release identifier, two server-issued tokens, a fresh Prepare, a one-use Apply, exact post-apply verification, and removal of the Apply-mode environment variable after the window.

Do not perform Apply as part of ordinary deployment verification.

## Gate 9 — Sign-off record

Record:

- frozen release commit;
- production deployment identifier;
- previous known-good deployment;
- database target without credentials;
- backup and restore evidence;
- tenant audit result;
- migration registry and rehearsal result;
- Supplier Partner rehearsal result;
- executable check outputs;
- smoke-test results by module and company type;
- Render log review result;
- Historical Replay readiness result with Apply disabled;
- approver and timestamp;
- rollback owner and trigger conditions.

Production is signed off only when every required gate has evidence and no unresolved stop condition remains.

## Stop conditions

Stop deployment or activation when any of the following occurs:

- CI or independent checks cannot execute;
- backup is missing, stale, empty, or not restorable in rehearsal;
- tenant audit reports error rows;
- migration rehearsal fails or changes business totals;
- `/api/health/ready` returns 503;
- cross-company access succeeds where it should be denied;
- Supplier Partner final verification is not `PASS`;
- rollback cannot be demonstrated in rehearsal;
- unexpected API 500s, repeated restarts, memory pressure, or request loops appear;
- Historical Replay readiness reports blockers; or
- the deployed commit differs from the approved release commit.

When stopped, keep the previous healthy deployment serving traffic, preserve evidence, and fix the problem on an isolated branch. Do not bypass the safety control that detected the failure.
