# Program 2 — Accounting and Inventory Integrity

Status: in progress. This branch must remain unmerged until the owner approves the completed Program 2 package.

## Phase sequence

- [x] 2A — Posting inventory audit
- [x] 2B — Central posting engine
- [x] 2C — Voucher lifecycle integrity
- [x] 2D — Cash, bank, customer, and supplier reconciliation
- [x] 2E — Stock movement integrity
- [x] 2F — Factory raw-stock costing integrity
- [x] 2G — Mix-batch costing integrity
- [ ] 2H — Period locking and closed-period protection
- [ ] 2I — Automated reconciliation and repair reporting

Each phase must be completed and committed separately. Do not begin Program 3 on this branch.

## Phase 2A — Posting inventory audit

Status: complete.

- Classified accounting and inventory posting flows by integrity risk.
- Defined canonical truth for vouchers, stock movements, source documents, and secondary projections.
- Mapped the identified gaps into Phases 2B–2I in `docs/program-2-posting-inventory-audit.md`.

## Phase 2B — Central posting engine

Status: complete.

- Added a strict transaction-owned, Decimal-based balanced voucher posting boundary.
- Required company ownership, deterministic source identity, idempotency, and audit recording.
- Added focused posting invariant tests and safe incremental migration contracts.

## Phase 2C — Voucher lifecycle integrity

Status: complete.

- Added transaction-owned reversal and replacement boundaries.
- Kept committed vouchers immutable and required linked reversal of accounting, inventory, party-ledger, and source effects.
- Added deterministic lifecycle idempotency, locking, linkage, actor/reason, and audit contracts.

## Phase 2D — Cash, bank, customer, and supplier reconciliation

Status: complete.

- Added read-only Decimal reconciliation against voucher-entry truth.
- Added company/domain/currency isolation, exact drift reporting, and duplicate-target protection.
- Kept all repair behavior isolated from the comparison service.

## Phase 2E — Stock movement integrity

Status: complete.

- Added the canonical transaction-owned receipt, issue, transfer, adjustment, and reversal boundary.
- Enforced deterministic locks, equal-and-opposite transfers, negative-stock protection, append-only history, idempotency, and audit recording.
- Added focused movement invariant tests.

## Phase 2F — Factory raw-stock costing integrity

Status: complete.

- Added a locked, versioned, Decimal-only supplier raw-stock costing boundary.
- New offloads and cost-only charges recalculate deterministically; deductions preserve the locked supplier cost/kg.
- Added protection against stale versions, negative stock/cost, stranded depletion cost, currency mismatch, and cost drift.
- Added append-only cost events, idempotency, audit contracts, and focused tests.

## Phase 2G — Mix-batch costing integrity

Status: complete.

### Completed work

- Added `mixBatchCostingIntegrityService.ts` as the transaction-owned mix-batch costing boundary.
- Required company, batch, supplier, currency, source identity, and idempotency validation before any lock or write.
- Required supplier raw-stock states to be locked in deterministic supplier order.
- Derived every component value from the supplier's locked current cost/kg; callers cannot inject or average a replacement supplier rate.
- Added displayed-rate and raw-stock-version conflict checks so stale mix-batch forms fail safely instead of silently changing cost.
- Enforced sufficient stock, internally consistent supplier quantity/cost/rate state, and exact zero-cost depletion.
- Made each component deduction proportional to its locked rate, preserving every supplier's remaining cost/kg exactly.
- Calculated the mix-batch weighted cost/kg only from the sum of component historical values divided by total batch weight.
- Required append-only supplier deduction events, versioned supplier-state persistence, batch-cost persistence, idempotency, and audit recording inside one caller-owned transaction.
- Added focused tests for weighted batch cost, supplier-rate stability, stale rates, stale versions, insufficient stock, duplicate suppliers, write order, and repeat-safe retries.

### Verification

- Confirmed mix-batch deductions cannot re-average or mutate any supplier's cost/kg.
- Confirmed new offloads remain the only quantity-addition path that can change weighted supplier cost/kg; mix-batch creation only removes quantity and its proportional historical value.
- Confirmed stale UI rates and stale raw-stock versions fail before supplier deduction events or state writes.
- Confirmed idempotency is checked before ownership validation, locks, writes, and audit recording.
- Confirmed no production route or historical balance was switched without a complete database adapter and shared transaction boundary.
- No production data or Replit checks/credits were used.

## Next phase

- Phase 2H — Period locking and closed-period protection

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Commit every phase separately.
- Do not run checks on Replit or consume Replit credits.
- Do not change accounting balances without transaction, idempotency, reversal, and audit guarantees.
