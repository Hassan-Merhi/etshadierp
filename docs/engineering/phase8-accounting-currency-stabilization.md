# Phase 8 — Accounting and Multi-Currency Stabilization

## Status

Complete at the source-contract boundary.

## Purpose

Phase 8 turns the existing multi-currency schema and report guards into one usable accounting stabilization workflow. It does not invent historical rates, classify rows from amount size, silently convert native values, or unblock protected reports before reconciliation succeeds.

## Authoritative readiness

Historical readiness now checks every live non-base voucher entry for the complete dual-currency contract:

- transaction currency;
- transaction debit and credit;
- historical base debit and credit;
- historical exchange rate;
- rate convention.

It also checks non-zero ledger, bank, customer, supplier, employee, and fixed-asset opening or acquisition values for native amount, original currency, historical base amount, and a locked rate when the original currency differs from the company base currency.

The previous “no backfill has started” compatibility state no longer declares a company ready. Missing structural currency columns are reported separately through `schemaReady`.

## Evidence-only classification

The repair center classifies a row automatically only when persisted evidence proves the conversion:

- complete transaction amounts plus a locked historical rate;
- complete base amounts plus a locked historical rate;
- identity currency matching the company base currency;
- opening/acquisition metadata with a known native or base amount, currency, and locked rate.

Missing currency, missing rate, partial metadata, and unknown legacy storage denomination remain manual. Amount-size thresholds and “likely CFA” or “likely USD” guesses are prohibited.

## Complete-voucher approval

A foreign-currency voucher must be repaired as one complete unresolved group. Preview rejects a request that omits another unresolved entry from the same voucher. Automatic repair is offered only when every unresolved entry in that voucher is evidence-backed.

Manual voucher review asks the operator to confirm:

- original currency;
- historical transaction-per-base rate;
- whether legacy debit/credit columns contain transaction amounts or historical base amounts;
- an optional source-document note.

## Signed preview and transactional apply

Every preview is bound to the selected company, requesting user, normalized plan fingerprint, item count, and expiration time. Apply reconstructs the plan and refuses stale or modified rows.

The complete apply runs under a company-scoped PostgreSQL advisory lock and one database transaction. Each changed row receives an `audit_log` record with before/after snapshots and the review note.

For voucher entries, compatibility `debit_amount` and `credit_amount` are rewritten to the normalized historical base values so legacy ledger, Daybook, and report queries cannot mix native and base currencies.

Before commit, every touched voucher must:

- have complete dual-currency metadata;
- balance in historical base currency within `0.000001`.

Any failure rolls back the entire batch.

## Reconciliation

The repair center exposes a reconciliation report containing:

- live historical-base trial-balance debit, credit, and difference;
- fully resolved voucher count;
- unbalanced voucher count and sample IDs;
- partial metadata count;
- cash/bank current-translation readiness;
- deleted-voucher entries excluded from live totals;
- repository-wide orphan-entry warnings.

`readyForHistoricalReports` requires authoritative readiness, a balanced live trial balance, no unbalanced resolved vouchers, and no partial metadata. `readyForLiveNetPosition` additionally requires every live cash/bank account to have a resolvable current translation.

## Accounts workflow

Admin, Owner, and Developer users now see the following directly on Accounts:

1. **Historical Currency Stabilization** — diagnosis, evidence-backed automatic preview, manual complete-voucher review, signed apply, and reconciliation.
2. **Historical Opening & Asset Resolver** — reviewed native amount, original currency, historical rate, and debit/credit side.
3. **Cash & Bank Currency Values** — native balances, historical base value, current translated base value, and translation difference.

Protected Net Position and Net Profit responses direct operators to this workflow instead of telling them to run a command-line backfill.

## Retired heuristic CLI

`scripts/backfill-voucher-entry-currency-amounts.mjs` no longer connects to the database or supports `--apply`. Its former amount-scale classification could not prove denomination and was therefore incompatible with the stabilization policy.

## Verification boundary

The phase includes deterministic source contracts for readiness, repair classification, full-voucher coverage, company-scoped writes, compatibility base columns, signed-token binding, stale-state protection, transactional apply, audit logging, balance reconciliation, retired heuristics, and visible Accounts tooling.

Per owner instruction, CI, GitHub Actions, CircleCI, TypeScript compilation, formatting, lint, tests, database execution, production build, browser verification, deployment, and runtime smoke checks were not run.

## Merge boundary

This phase is stacked on Phase 7 (`agent/phase-7-debug-routes`). Merge Phase 7 first, then retarget or merge this phase. No automatic merge is requested.
