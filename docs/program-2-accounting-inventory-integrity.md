# Program 2 — Accounting and Inventory Integrity

Status: in progress. This branch must remain unmerged until the owner approves the completed Program 2 package.

## Phase sequence

- [x] 2A — Posting inventory audit
- [x] 2B — Central posting engine
- [x] 2C — Voucher lifecycle integrity
- [x] 2D — Cash, bank, customer, and supplier reconciliation
- [x] 2E — Stock movement integrity
- [ ] 2F — Factory raw-stock costing integrity
- [ ] 2G — Mix-batch costing integrity
- [ ] 2H — Period locking and closed-period protection
- [ ] 2I — Automated reconciliation and repair reporting

Each phase must be completed and committed separately. Do not begin Program 3 on this branch.

## Phase 2A — Posting inventory audit

Status: complete.

### Completed work

- Reclassified the existing detailed accounting flow inventory by business domain and integrity risk.
- Defined canonical sources of truth for general-ledger balances, inventory movements, source documents, and secondary projections.
- Identified the highest-risk gaps: multiple posting engines, inconsistent reversals, secondary-ledger drift, non-uniform accounting/stock transactions, powerful factory repair paths, fragmented period controls, and fragmented reconciliation.
- Mapped each finding to its remediation owner in Phases 2B–2I.
- Added `docs/program-2-posting-inventory-audit.md` as the Program 2 implementation contract.

### Verification

- Cross-checked the audit against the repository's existing 31-flow `docs/accounting-engine-audit.md`.
- Confirmed the phase changed documentation only and did not alter balances, stock, routes, migrations, or production data.
- No Replit checks or credits were used.

## Phase 2B — Central posting engine

Status: complete.

### Completed work

- Added `centralPostingEngine.ts` as the strict transaction-owned posting boundary for new and migrated voucher flows.
- Added Decimal-based debit/credit validation, non-negative finite amount checks, exactly-one accounting-target validation, balanced total enforcement, and declared voucher-total matching.
- Required deterministic source identity and idempotency contracts before any insert can occur.
- Required company ownership validation and audit recording as explicit dependencies of the posting boundary.
- Preserved `insertVoucherWithEntriesTx` as a low-level compatibility primitive so route migration can proceed safely and incrementally in Phase 2C.
- Exported the new posting contract through the accounting service index.
- Added focused tests for balanced postings, imbalance rejection, invalid multi-target entries, total mismatch, and repeat-safe idempotent return behavior.

### Verification

- Performed focused static inspection of the new engine, exports, and tests on the Program 2 branch.
- Confirmed validation runs before ownership checks and database writes.
- Confirmed an existing idempotent posting returns without duplicate insert, ownership work, idempotency recording, or audit duplication.
- No Replit checks or credits were used.

## Phase 2C — Voucher lifecycle integrity

Status: complete.

### Completed work

- Added `voucherLifecycleService.ts` as the transaction-owned boundary for reversal and replacement of committed vouchers.
- Reversals are created from the original committed entry rows by swapping debit and credit amounts; current balances, prices, or reconstructed assumptions are never used.
- Added immutable lifecycle states and explicit original, reversal, and replacement linkage contracts.
- Required company-scoped row locking before lifecycle changes.
- Required deterministic operation idempotency before any reversal or replacement work begins.
- Required linked accounting, inventory, party-ledger, and source-document effects to reverse inside the caller-owned transaction through the lifecycle adapter.
- Added repeat-safe behavior so retried delete/edit requests return the prior lifecycle result rather than duplicating reversals.
- Required actor, reason, source identity, and operation audit recording.
- Exported the lifecycle boundary through the accounting service index.

### Verification

- Confirmed invalid, missing, cross-company, already-reversed, and unsupported-replacement targets fail before linked effects are changed.
- Confirmed the original voucher remains immutable and is marked through linkage instead of deleting committed voucher entries.
- Confirmed replacement performs reversal, linked-effect reversal, replacement creation, lifecycle linkage, and audit recording in deterministic order.
- Confirmed no existing production route was silently switched without an adapter for all of its secondary effects.
- No Replit checks or credits were used.

## Phase 2D — Cash, bank, customer, and supplier reconciliation

Status: complete.

### Completed work

- Added `partyReconciliationService.ts` as a read-only, transaction-owned reconciliation boundary for cash, bank, customer, and supplier balances.
- Defined voucher-entry balances as canonical accounting truth and operational account, bank, customer, and supplier balances as projections.
- Required company, domain, target, and optional as-of-date identity for every comparison.
- Added Decimal-based exact comparison and explicit projection-minus-canonical difference reporting.
- Added currency compatibility validation so unlike currencies cannot be silently compared.
- Added deterministic duplicate-target rejection for batch reconciliation.
- Added batch matched/mismatched summaries without mutating balances or attempting repairs.
- Exported the reconciliation contract through the accounting service index.
- Added focused tests for exact matches, positive and negative drift, currency mismatch, batch summaries, and duplicate targets.

### Verification

- Confirmed canonical and projected balances are loaded from one caller-owned transaction/snapshot.
- Confirmed the service is read-only and cannot repair, overwrite, or delete accounting data.
- Confirmed no tolerance or floating-point rounding can hide a non-zero accounting difference.
- Confirmed repair planning remains isolated to Phase 2I.
- No production data or Replit checks/credits were used.

## Phase 2E — Stock movement integrity

Status: complete.

### Completed work

- Added `stockMovementIntegrityService.ts` as the canonical transaction-owned boundary for receipts, issues, transfers, adjustments, and reversals.
- Required deterministic source identity and idempotency before any stock write.
- Required company ownership validation for the stock item and every participating location.
- Added deterministic balance locking in sorted location order before quantity validation or writes.
- Added Decimal-based positive quantity, non-negative unit-cost, and movement-value calculation.
- Enforced movement-specific location rules, including equal-and-opposite transfer rows at one unit cost.
- Rejected insufficient stock before append unless an explicitly authorized caller enables negative stock.
- Made stock history append-only: corrections require new movement rows and reversals require explicit original-movement linkage.
- Required exact append counts, idempotency recording, and audit recording inside the caller-owned transaction.
- Added focused tests for transfer symmetry, invalid locations, reversal linkage, negative-stock prevention, append ordering, and repeat-safe retries.

### Verification

- Confirmed validation and idempotency checks run before ownership, balance locks, and writes.
- Confirmed stock source documents, accounting effects, movement rows, and audit records can share one transaction and rollback boundary.
- Confirmed transfers cannot silently change quantity or cost between source and destination.
- Confirmed existing production routes were not switched without complete adapters for their source-document and accounting effects.
- No production data or Replit checks/credits were used.

## Next phase

- Phase 2F — Factory raw-stock costing integrity

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Commit every phase separately.
- Do not run checks on Replit or consume Replit credits.
- Do not change accounting balances without transaction, idempotency, reversal, and audit guarantees.
