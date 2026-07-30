# Phase 12 — Test Coverage and Reliability

## Purpose

Phase 12 turns the repository's existing business regression file list into a measurable reliability boundary. It strengthens tests and test architecture without changing accounting entries, route responses, inventory quantities, factory costing, permissions, sessions, schemas, or user-facing workflows.

## Deterministic regression runner

The operator entry point remains:

```bash
node scripts/run-phase12-business-regression.mjs
```

The full boundary runs the highest-risk backend and frontend suites in deterministic order. Database-mutating backend suites use one worker with file parallelism disabled. The frontend route-policy suite uses the jsdom configuration in a separate Vitest invocation.

Available inspection and focused modes:

```bash
node scripts/run-phase12-business-regression.mjs --list
node scripts/run-phase12-business-regression.mjs --smoke
node scripts/run-phase12-business-regression.mjs --domain=accounting
node scripts/run-phase12-business-regression.mjs --domain=inventory
node scripts/run-phase12-business-regression.mjs --domain=costing
node scripts/run-phase12-business-regression.mjs --domain=reports
node scripts/run-phase12-business-regression.mjs --domain=security
node scripts/run-phase12-business-regression.mjs --domain=frontend
```

The runner fails before Vitest starts when a selected file is missing or a domain name is unknown.

## Critical business domains

The full boundary includes:

- cross-module ERP and Supplier Partner lifecycle workflows;
- central posting, manual journals, generic vouchers, payments, receipts, and customer-linked ledgers;
- POS, voucher reversal, inventory, negative-stock hardening, and legacy cost-memory regressions;
- factory mix-batch stability, locked-rate migration, and raw-material moving averages;
- financial reports;
- named permissions, credential versions, company isolation, protected files, privileged-write guards, and security audit persistence;
- authenticated application route policy and Factory page access.

## Coverage gates

Backend global floors increase incrementally from 8/8/6/6 to 10/10/8/8 for lines, statements, functions, and branches. Stronger per-file thresholds now protect:

- `server/services/security/companyContextPolicy.ts`;
- `server/services/accounting/customerLinkedLedgerValidation.ts`;
- the existing password helper and central posting engine boundaries.

Frontend measured coverage expands beyond the three original UI files to include:

- `client/src/app/authenticatedAppRouteGuard.ts`;
- `client/src/app/factoryAccessGuard.ts`.

Those two route-policy modules have dedicated line, statement, function, and branch thresholds backed by direct runtime tests.

## Company isolation policy

Company-ID parsing, request assertion collection, and company-context decisions now live in the pure `companyContextPolicy.ts` module. The Express adapter retains audit persistence, HTTP status mapping, request/session normalization, and compatibility exports.

This split makes malformed IDs, mismatched body/query/param assertions, legacy Factory context, missing company context, and explicit legacy opt-out independently testable without loading the database or Express middleware.

## Route-policy matrix

`tests/ui/authenticated-app-route-guard.test.ts` executes the actual pure route helpers. It covers:

- Properties canonical routes;
- Supplier Partner namespace ownership and migration redirects;
- Factory access-loading and error states;
- ERP-only and Factory-only account routing;
- direct and legacy Factory page keys;
- feature flags;
- hidden production analytics;
- administrator and unresolved-access bypasses.

The older Supplier Partner and Factory refresh source contracts were updated to inspect the current orchestration boundary instead of looking for logic that had already moved out of `AuthenticatedApp.tsx`.

## Inventory cost memory

The authoritative policy remains unchanged:

```text
quantity <= 0  =>  totalValue = 0 and averageRate >= 0
```

Four active regression cases now replace the behavior described by stale skipped tests. They verify non-positive stock valuation, exact reversal normalization, repeated receive/reversal stability, and negative-stock re-offload without phantom value inflation. Production inventory costing was not changed.

## Critical test-debt budget

`config/critical-test-debt.json` records the exact six legacy inventory skips and three Supplier Partner lifecycle TODOs that still exist. `scripts/verify-critical-test-debt.mjs` fails when:

- a new skip or TODO appears in either critical file;
- an approved title disappears without updating the budget;
- an active replacement is removed;
- a replacement is converted back to skip or TODO.

The two Supplier Partner reverse/re-offload TODOs remain because no SP reverse-offload endpoint exists. The charge-line TODO remains until deterministic prepaid, paid-now, and unpaid-payable fixtures are available. They are explicit backlog, not silently ignored coverage.

## Verification

The static reliability verifier is:

```bash
node scripts/verify-phase12-business-regression.mjs
```

It checks files, runner domains, serial execution flags, coverage configuration, pure-policy extraction, route tests, active cost-memory replacements, documentation, and the critical debt verifier.

## Safety

This phase is rollback-safe: removing the Phase 12 policy extraction, tests, runner upgrades, coverage configuration, debt budget, verifier, and documentation restores the previous runtime behavior. The middleware compatibility export preserves existing imports.

CI, GitHub Actions, CircleCI, TypeScript compilation, formatting, lint, backend or frontend Vitest, coverage collection, PostgreSQL setup, migrations, browser tests, production build, deployment, and the regression runner were **not executed** while implementing this phase.
