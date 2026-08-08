# Supplier Partner Finalization — Phases 1 and 2

Approved: 2026-08-03

## Phase 1 — Scope and currency freeze

The production-finalization scope is frozen as follows:

- Supplier Partner is USD-only for this release. All SP amount columns, vouchers and settlement postings remain in USD at exchange rate 1.
- Multi-currency Supplier Partner behavior is out of scope and requires a separate approved design, migration and reconciliation phase.
- Migration source and target companies are selected by configured company IDs. Runtime code must not hard-code production company IDs.
- The intended operational migration remains GC-Lshi to GC Lshi #2 (Supplier Partner), but every migration endpoint must continue validating the selected companies and their roles.
- Sales correction will use full-sale reversal in the later reversal phase. Partial returns are disabled until a separately approved workflow exists.
- Direct SQL corrections are not an accepted operating workflow. Supported API actions, audited repair tools and rollback procedures must be used instead.
- Sensitive correction permissions, approval reasons and audit events remain part of the later permissions/reversal phases.

The executable policy is defined in `server/services/sp/spReleasePolicy.ts`.

## Phase 2 — Atomic inventory and accounting safety

The following rule is mandatory for every Supplier Partner stock-changing write:

> SP lot movements, ERP location inventory, accounting vouchers, charge usage and container/sale state must commit together or roll back together.

Implemented protections:

1. SP sales no longer suppress ERP inventory failures.
2. Opening stock requires a mapped stock item and active company location.
3. Container offloads no longer suppress ERP inventory failures.
4. Every SP inventory adjustment validates that the stock item and location belong to the active Supplier Partner company.
5. Invalid or missing mappings return `SP_INVENTORY_LINK_REQUIRED` and leave no partial write.
6. Inventory engine failures return `SP_INVENTORY_POST_FAILED`; the enclosing database transaction rolls back movements, vouchers, charges and status updates.
7. Offload bank and ledger charge validation now runs through the same transaction executor as the accounting writes.
8. Core SP vouchers use the frozen release currency constants instead of repeating ungoverned currency literals.

## Acceptance criteria

Phase 1 is complete when the release policy is documented, code-owned and covered by tests.

Phase 2 is complete when:

- no SP sales, opening-stock or offload route catches and ignores inventory errors;
- no new SP stock-changing operation can commit without a valid stock item and active company location;
- failures propagate to the route and cause the surrounding transaction to reject;
- the USD release policy and atomic inventory contract tests pass;
- no SQL migration is required.

## SQL

No SQL schema or data migration is required for Phases 1 and 2.
