# Phase 3 — Accounting Boundary Completion

Phase 3 closes the accounting-write gaps that remained after the Phase 2 backend module separation. The existing Program 2 convergence contracts remain the baseline for journals, payments and receipts, POS and stock transfers, containers and freight, Supplier Partner accounting, payroll, rentals, and reconciliation. This phase adds the same controlled boundary to the modular company-transfer and container-sale services.

## Required invariants

Every migrated flow uses the central balanced posting engine so that:

- debit equals credit before any voucher is written;
- company ownership is validated for every posting target;
- the source document and its accounting effects commit in one transaction;
- a retry-stable request identity prevents duplicate postings after uncertain network or server outcomes;
- the authenticated actor and business source are written to the accounting audit trail;
- generated voucher numbers and display narrations do not alter the business fingerprint used for replay protection.

## Atomic cross-company transfer

Both simple and inter-company transfers now create the source-company voucher, destination-company voucher, idempotency markers, audit records, and transfer row inside one database transaction.

The source and destination legs use separate idempotency keys derived from one client request ID. A concurrent or repeated request resolves the existing two vouchers and the existing transfer row rather than creating another transfer. Access to both companies is checked before the transaction begins, while the central engine independently validates that each ledger account belongs to the company being posted.

Preparatory creation of the clearing or inter-company ledger account remains outside the financial transaction. No voucher or transfer value is written until both accounts have been resolved.

## Auditable reversal

The Company Transfer **Undo** operation no longer hard-deletes voucher entries or vouchers. It locks the transfer row, loads both original vouchers, creates one balanced reversal voucher in each company, records deterministic reversal identities, and removes only the transfer UI record after both reversals commit.

The original accounting vouchers remain available for audit. A retry after an uncertain response checks the two reversal markers and returns success without producing another reversal.

## Container sale

A container sale now writes its balanced posting, idempotency marker, accounting audit, sale record, and container `SOLD` status in one transaction. The company and container ID provide a stable source identity, while the payload fingerprint covers the sale date, amount, accounts, and business description.

The existing unique company/container sale rule is retained. A repeated request returns the existing sale, and a concurrent transaction cannot leave an orphan voucher if the sale row fails.

## Compatibility retained

- Existing API paths and response shapes remain in place.
- Existing voucher types, debit/credit directions, account codes, descriptions, and entry narrations are retained.
- The transfer history row is removed after a successful reversal, matching the existing user workflow while preserving the accounting evidence.
- No production schema migration is introduced by this phase.

## Verification boundary

The Phase 3 verifier runs the complete Program 2 final reconciliation verifier first, then checks the new company-transfer and container-sale boundaries. It rejects direct voucher inserts in those services, voucher hard deletion in the transfer repository, missing transaction ownership, missing replay identities, and missing authorization or audit contracts.

Focused unit coverage verifies balanced transfer legs, separate source/destination identities, invalid same-account rejection, deterministic container-sale replay identity, and browser request-ID reuse for both transfer endpoints.

The verifier and tests have been added to the branch but were not executed through CI in this connected session. Build, TypeScript, lint, database-backed behavior, migrations, and deployment remain subject to the owner's full CI run.

## Merge boundary

Phase 3 remains on its own draft branch and must not be merged until the full CI suite is completed and the owner explicitly approves the result.
