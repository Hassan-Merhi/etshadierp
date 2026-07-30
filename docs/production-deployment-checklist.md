# Production Deployment Checklist

## Status

This is an operator checklist, not a historical pass report. **No release is ready until evidence verification passes** for the exact commit that will be deployed.

Do not copy results from an older deployment, another branch, or another database. A command that was not executed is `pending`, not `passed`.

## 1. Freeze the release

Record the full 40-character commit SHA and create the evidence file:

```bash
export RELEASE_EXPECTED_COMMIT='<full-40-character-commit-sha>'
node scripts/create-release-evidence.mjs \
  --commit="$RELEASE_EXPECTED_COMMIT" \
  --output=release-evidence.json
```

The evidence template is intentionally incomplete. It cannot pass verification until every required check, rehearsal, smoke module, deployment record, rollback owner, and approval is filled in.

## 2. Inspect the deterministic plan

```bash
node scripts/run-release-readiness.mjs --list
```

The plan is sourced from `config/release-readiness.json`. Do not remove or rename checks inside the evidence file. The verifier confirms that every recorded command still matches the policy.

## 3. Run static release contracts

```bash
node scripts/run-release-readiness.mjs --static
```

This boundary verifies:

- final production safety contracts;
- the reviewed migration registry and migration-debt manifest;
- Phase 12 test/reliability architecture;
- critical skip/TODO debt;
- lockfile registry safety;
- Render manual-deployment, Node-version and readiness settings;
- release identity and evidence tooling.

Static verification does not prove that the application builds, tests pass, a backup restores, or production is healthy.

## 4. Run executable repository checks

Use a clean checkout of the frozen commit:

```bash
npm ci --registry=https://registry.npmjs.org/
RELEASE_EXECUTION_CONFIRMATION=RUN_RELEASE_READINESS \
  node scripts/run-release-readiness.mjs --execute
```

The executable boundary includes formatting, lint, TypeScript, backend and frontend coverage, the critical business regression suite, production build, production dependency verification, memory stabilization, bandwidth boundaries, and focused security checks.

Any failure or inability to execute is a stop condition. Do not mark a timed-out, unavailable, skipped, or manually cancelled command as passed.

## 5. Verify backup and restore

Follow `docs/operations/database-backup-rollback-recovery.md`.

Required evidence includes:

- source database identifier without credentials;
- backup filename, timestamp, size, type and SHA-256;
- successful `pg_restore --list` where applicable;
- restore into a new disposable database;
- `/api/health/ready` HTTP 200 against the restored database;
- representative table counts;
- restore duration, warnings and approver.

Never test a restore by overwriting production. Disable schedulers and external integrations on the rehearsal instance.

## 6. Review migration state

```bash
node scripts/verify-migration-registry.mjs --strict
```

Strict mode accepts only the exact reviewed debt in `config/migration-registry-debt.json`:

- three pre-versioning journal entries whose original SQL files are unavailable;
- six explicitly classified standalone SQL files.

A new unregistered SQL file, a removed allowance, a stale allowance, duplicate index, non-sequential journal entry, missing registered file, or missing required migration fails the gate.

The heavy-read index migration uses `CREATE INDEX CONCURRENTLY` and must stay outside the transactional Drizzle runner. The historical ownership migration contains a backfill and `NOT VALID` constraints and requires separate rehearsal and approval.

Apply registered migrations only to the disposable restored database first:

```bash
DATABASE_URL='postgresql://.../erp_restore_rehearsal' \
MIGRATION_CONFIRMATION=APPLY_VERSIONED_MIGRATIONS \
  node scripts/run-versioned-migrations.mjs --apply
```

Migration application remains outside `npm start` and Render startup.

## 7. Rehearse controlled business migrations

Before production activation:

- complete the Supplier Partner Phase 4 finalize and rollback rehearsal on non-production companies;
- inspect Historical Replay readiness and verification with Apply disabled;
- record all blockers, warnings, before/after totals and rollback evidence;
- do not enable Historical Replay Apply during ordinary deployment verification.

## 8. Configure Render safely

The repository blueprint requires:

- build command: `npm ci --registry=https://registry.npmjs.org/ && npm run build`;
- start command: `npm start`;
- Node `20.19.2`;
- health check `/api/health/ready`;
- `autoDeploy: false`.

Manual deployment is required so an unapproved push cannot bypass release sign-off.

Before starting the manual deployment, set:

```text
RELEASE_EXPECTED_COMMIT=<the exact frozen 40-character commit>
RELEASE_ID=<operator-selected release identifier>
```

Do not configure these dangerous controls in the persistent Render blueprint:

- `HISTORICAL_REPLAY_APPLY_MODE`;
- `HISTORICAL_REPLAY_RELEASE_ID`;
- `MIGRATION_CONFIRMATION`;
- `MASTER_PASSWORD`.

`RELEASE_EXPECTED_COMMIT` is checked during production startup. A mismatch between the deployed commit and approved commit fails startup. `/api/health/live` and `/api/health/ready` expose the full deployed SHA, expected SHA, verification state and release ID.

## 9. Deploy and verify read-only behavior first

Record the previous healthy deployment before promotion. After the new instance starts:

1. confirm `/api/health/live` returns the expected full commit SHA;
2. confirm `/api/health/ready` returns HTTP 200 with `commitVerified: true`;
3. verify login, logout, session refresh and company switching;
4. verify Admin, ERP, Factory, POS, Properties and Supplier Partner routing;
5. inspect logs for unexpected 401, 403, 409, 500, pool timeout, memory pressure, restart or request-loop events.

Do not create production financial transactions solely as smoke tests without an approved transaction and reversal plan.

## 10. Complete every smoke module

The required smoke module list is defined in `config/release-readiness.json` and covers:

- authentication, sessions and company isolation;
- ERP, Factory, POS, Properties and Supplier Partner navigation;
- Accounts, Daybook, vouchers and stock transfers;
- inventory and location inventory;
- containers, offload and mix batches;
- reports and exports;
- runtime logs and readiness.

Each module needs a timestamp and evidence reference in `release-evidence.json`.

## 11. Record rollback readiness

The evidence must name:

- the previous healthy deployment;
- rollback owner;
- code rollback trigger;
- database recovery trigger;
- expected rollback duration;
- proof that rollback was rehearsed where required.

A rollback plan that depends on an unknown deployment, an unverified backup, or an unavailable owner is not acceptable.

## 12. Verify final evidence

```bash
node scripts/verify-release-evidence.mjs --file=release-evidence.json
```

The verifier requires:

- the deployed SHA to equal the frozen SHA;
- every required command to be recorded as passed with evidence and timestamp;
- every operational section and smoke module to be passed;
- auto deploy, startup migrations, Historical Replay Apply and master password to remain disabled;
- approver, approval timestamp and rollback owner.

Production sign-off exists only after this command passes and the evidence is retained with the release record.

## Stop conditions

Stop or roll back when:

- the deployed commit differs from approval;
- any required command fails or cannot execute;
- backup or restore evidence is incomplete;
- migration strict mode fails;
- migration rehearsal changes business totals unexpectedly;
- readiness returns 503;
- cross-company access succeeds;
- Supplier Partner verification is not `PASS`;
- Historical Replay readiness has unresolved blockers;
- unexpected API errors, restarts, memory pressure or request loops appear;
- rollback cannot be demonstrated.

Do not disable the guard that detected the failure. Preserve evidence, keep or restore the previous healthy deployment, and fix the problem on an isolated branch.
