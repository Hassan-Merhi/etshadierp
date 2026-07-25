# Program 1 — Release Verification

Baseline branch: `main`

Baseline commit: `3872e2eaf16be020ca7a4d16234830604582af0e`

Started: 2026-07-25

## Safety boundary

Program 1 is verification-first. This branch must not change accounting totals, inventory quantities or valuation, historical transactions, company data, production migrations, permissions, or user-facing workflows while the baseline is being established.

No production database actions, deployments, repairs, backfills, or destructive commands are part of Phase 1A.

## Phase 1A — Current-main verification

The goal is to establish current evidence for the exact baseline commit rather than relying on older test-count documentation.

### Required checks

- Dependency installation from the committed lockfile
- TypeScript type check
- Production frontend and server build
- ESLint
- Changed-file formatting check
- Test database schema preparation
- Application startup and startup-migration readiness against the temporary CI database
- Backend tests
- Backend coverage thresholds
- Frontend tests
- Frontend coverage thresholds

### Workflow evidence

Opening draft PR #193 triggered the repository's existing workflows for head commit `5bd7022a0b7aa23ba94470f7606a65a157a276db`.

- CI run `1113` (`30163274267`) concluded `failure`.
- Security run `661` (`30163274252`) concluded `failure`.
- The CI job and both Security jobs reported zero executable steps.
- GitHub exposed no job logs; the log download returned a missing-blob response.

Because no checkout, installation, build, test, audit, or scan step started, these workflow conclusions are classified as **Actions infrastructure / repository execution blocked**, not as application failures.

### Static wiring review

The repository configuration was inspected without changing application code:

- `package.json` defines direct scripts for TypeScript, production build, lint, backend tests, frontend tests, and coverage.
- The TypeScript command is explicitly `tsc --noEmit` and the project has `strict: true`.
- The production build runs the Vite frontend build, server bundling, and server-bundle verification.
- CI is configured for Node.js 20 and a temporary PostgreSQL 15 service.
- CI is configured to prepare the temporary schema, start the built application, and wait for `/api/health/db` before backend tests.
- Backend and frontend Vitest configurations and coverage thresholds are present.
- Security is configured for production dependency auditing and TruffleHog secret scanning.

This proves the intended verification path is wired. It does **not** prove the current baseline passes because the runner never executed a step.

### Evidence status

| Check | Status | Evidence |
|---|---|---|
| Dependency installation | Blocked | CI job ended before checkout or installation |
| TypeScript | Blocked | Command is configured; no step executed |
| Production build | Blocked | Command is configured; no step executed |
| ESLint | Blocked | Command is configured; no step executed |
| Formatting | Blocked | Changed-file check is configured; no step executed |
| Temporary database schema | Blocked | PostgreSQL and schema step are configured; no step executed |
| Startup migrations | Blocked | `/api/health/db` readiness step is configured; no step executed |
| Backend tests | Blocked | Vitest command is configured; no step executed |
| Backend coverage | Blocked | Coverage command is configured; no step executed |
| Frontend tests | Blocked | jsdom/Vitest command is configured; no step executed |
| Frontend coverage | Blocked | Coverage command is configured; no step executed |
| Dependency security audit | Blocked | Security job ended before steps |
| Secret scan | Blocked | Security job ended before steps |

### Phase 1A branch integrity

At this evidence point the branch differs from `main` only by this documentation file. No application, schema, migration, workflow, dependency, test, accounting, inventory, or frontend source file has been changed.

## Phase 1B — Financial regression baseline

After Phase 1A is understood, Phase 1B will review the focused regression evidence for:

- Balanced voucher posting and exact deletion/reversal
- Payments, receipts, and journals
- POS sale inventory/accounting effects
- Stock transfers
- Container offload, freight, reversal, and re-offload
- Supplier and customer balances
- Multi-currency historical values and report consistency
- Company isolation across financial and inventory reads

Any failing or missing coverage will be documented before production behavior is changed.

## Phase 1C — Documentation and test alignment

Phase 1C will reconcile documentation and test assumptions with the current implemented business rules, including the intentional negative-stock cost-memory policy.

## Merge rule

This branch remains isolated and unmerged until the owner explicitly approves a merge. A verification failure is evidence to investigate, not permission to make a broad repair.