# Phase 13 — Release and Deployment Readiness

## Purpose

Phase 13 converts production release readiness from scattered prose and historical pass claims into a fail-closed, machine-verifiable process for one frozen commit.

It does not deploy the application, apply migrations, enable Historical Replay, perform Supplier Partner cutover, connect to production, create a backup, or claim that any executable check passed.

## Manual deployment boundary

`render.yaml` now requires:

- Node `20.19.2`, matching `.node-version`;
- the existing clean-install production build;
- `npm start`;
- `/api/health/ready`;
- `autoDeploy: false`.

Automatic deployment conflicted with the existing requirement to freeze and approve one exact commit. Manual promotion prevents an unrelated push from bypassing release sign-off.

## Runtime release identity

`server/releaseIdentityPolicy.mjs` resolves the full runtime commit from Render or equivalent build metadata. When `RELEASE_EXPECTED_COMMIT` is configured:

- both values must be full 40-character Git SHAs;
- the runtime commit must exist;
- the runtime and approved commits must match exactly;
- mismatch fails production startup.

`runtimeReleaseState` exposes the full commit, expected commit, verification state and optional release ID through `/api/health/live` and `/api/health/ready`.

## Migration registry debt

`config/migration-registry-debt.json` freezes the exact reviewed non-standard migration state:

- three pre-versioning journal gaps;
- six standalone SQL files.

The strict registry verifier now fails on:

- a new unregistered SQL file;
- a removed or renamed approved file;
- a stale allowance after a file is registered;
- a new missing registered file;
- duplicate or non-sequential journal metadata.

The heavy-read index file remains standalone because `CREATE INDEX CONCURRENTLY` cannot run in the transactional Drizzle migration path. Historical ownership/backfill activation remains a separate reviewed operation.

## Release policy and runner

`config/release-readiness.json` is the canonical source for:

- static checks;
- executable checks;
- required operational evidence sections;
- required smoke modules;
- Render settings and forbidden persistent environment controls.

`node scripts/run-release-readiness.mjs` supports:

- no arguments or `--list` — print the exact plan;
- `--static` — run non-database contract checks;
- `--execute` — run the complete executable repository suite after explicit `RELEASE_EXECUTION_CONFIRMATION=RUN_RELEASE_READINESS`;
- `--evidence=<path>` — verify a completed release record.

The confirmation prevents an accidental expensive full-suite invocation.

## Evidence policy

`create-release-evidence.mjs` creates an intentionally incomplete JSON record for a full commit SHA. `verify-release-evidence.mjs` rejects sign-off unless:

- deployed and frozen commits match;
- every required command is recorded as passed with timestamp and evidence;
- every operational section and smoke module is passed;
- automatic deployment, startup migrations, Historical Replay Apply and master password remain disabled;
- approver, approval timestamp and rollback owner are present.

Generated evidence is excluded from Git because it may contain deployment and database identifiers.

## Documentation cleanup

The old deployment checklist declared the application ready using June test counts and claimed no Render blueprint existed. That document was replaced with a current operator workflow and contains no inherited pass result.

## Permanent contracts

Phase 13 adds regression coverage for:

- exact release commit verification and mismatch rejection;
- release evidence creation and validation;
- manual Render deployment and database-aware readiness;
- dangerous startup-operation exclusion;
- exact migration debt;
- removal of stale deployment-ready claims.

The final production readiness verifier enforces all new boundaries while retaining backup, tenant, Supplier Partner and Historical Replay safety markers.

## Verification boundary

No CI, GitHub Actions, CircleCI, formatting, lint, TypeScript, backend or frontend tests, coverage, PostgreSQL connection, migration, backup, restore, browser smoke, production build, Render deployment, runtime probe, rollback rehearsal, static verifier, release runner, or evidence verifier was executed while implementing this phase.
