# Program 2 — Phase 9: Final Accounting Convergence Reconciliation

Program 2 is complete at the documentation and static-verification boundary after Phases 1–8.

## Covered domains

- accounting foundation and posting invariants;
- manual journals and generic vouchers;
- payments and receipts;
- POS sales and stock transfers;
- containers, freight, commissions, and post-offload charges;
- Supplier Partner accounting and controlled migration;
- payroll and employee accounting; and
- rentals and property accounting.

## Program-wide invariants

Every protected active posting path must preserve company ownership, decimal balance, historical currency, deterministic request identity, transaction-owned writes, replay-safe compatibility effects, exact edit/delete reversal, migrated-record protection, and specialized-workflow isolation.

## Compatibility boundaries retained intentionally

- optional or deliberately unbalanced voucher drafts;
- unsupported advanced multi-currency generic payloads;
- specialized Factory production and Historical Replay operations;
- Supplier Partner cutover and repair commands;
- payroll-run, advance, deduction, and salary-specific lifecycle operations;
- scheduled/accrual/shared-contract rental operations; and
- historical-data repair that requires explicit operator review.

These paths must not be silently routed through a simpler generic posting or deletion handler.

## Merge-order requirement

The stacked branches must be reviewed and merged in phase order. A later phase assumes the completed contracts and verifier files from the preceding phase.

## Verification boundary

Program completion means the current source behavior has been mapped and guarded by fail-closed static verifiers. It does not establish that TypeScript, build, tests, migrations, database-backed concurrency, deployment, or production smoke tests passed.
