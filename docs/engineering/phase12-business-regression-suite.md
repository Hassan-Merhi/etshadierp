# Phase 12 — End-to-End Business Regression Suite

## Purpose

Phase 12 provides one deterministic operator entry point for the ERP's highest-risk business workflows. It does not replace the existing focused suites and does not change production behavior. It composes the real database-backed tests already protecting POS, vouchers, ledgers, reporting, company isolation, inventory, factory costing, and Supplier Partner container processing.

## Smoke boundary

Run `node scripts/run-phase12-business-regression.mjs --smoke` to execute the two cross-module workflows:

- `tests/workflow.test.ts` protects POS sale, voucher posting, ledger effects, deletion reversal, reports, daybook, stock transfer, inventory movement, and company isolation.
- `tests/factory-container-lifecycle.test.ts` protects Supplier Partner setup, Goods OTW accounting, container creation, offload accounting, inventory application, and idempotent replay.

The smoke boundary is intended for fast owner verification after ordered roadmap integration.

## Full boundary

Run `node scripts/run-phase12-business-regression.mjs` to add the focused POS, voucher, accounting, reporting, company-context, stable factory-cost, and locked-rate migration suites.

All selected database-mutating files execute with one worker and no file parallelism. This avoids cross-suite races and makes failures easier to attribute.

## Inspection mode

Run `node scripts/run-phase12-business-regression.mjs --list` or combine `--list --smoke` to print the exact selected files without executing Vitest. The runner also fails before test startup if a required suite has been removed or renamed.

## Safety and behavior preservation

This phase is test orchestration only. It introduces no route, schema, accounting, inventory, costing, session, permission, or frontend behavior changes. Existing test setup and cleanup remain authoritative. The suite is rollback-safe because removing the Phase 12 runner, verifier, contract, and documentation returns the repository to its previous runtime behavior.

## Required environment

The selected suites require the same PostgreSQL test environment and dependencies as the existing backend test suite. No hidden production endpoint, production credentials, or production data are used by the runner.

## Verification boundary

CI, TypeScript, formatting, lint, Vitest, PostgreSQL migrations, browser tests, production build, deployment, and the Phase 12 runner itself were intentionally not executed while creating this phase.
