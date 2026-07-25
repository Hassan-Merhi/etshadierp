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

### Evidence status

| Check | Status | Evidence |
|---|---|---|
| Dependency installation | Pending | Awaiting CI run |
| TypeScript | Pending | Awaiting CI run |
| Production build | Pending | Awaiting CI run |
| ESLint | Pending | Awaiting CI run |
| Formatting | Pending | Awaiting CI run |
| Temporary database schema | Pending | Awaiting CI run |
| Startup migrations | Pending | Awaiting CI run |
| Backend tests | Pending | Awaiting CI run |
| Backend coverage | Pending | Awaiting CI run |
| Frontend tests | Pending | Awaiting CI run |
| Frontend coverage | Pending | Awaiting CI run |

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