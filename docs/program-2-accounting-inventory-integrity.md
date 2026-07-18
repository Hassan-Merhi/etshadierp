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
- [x] 2H — Period locking and closed-period protection
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

- Added `mixBatchCostingIntegrityService.ts` as the transaction-owned mix-batch costing boundary.
- Required deterministic supplier locks, locked-rate component valuation, stale form/version checks, sufficient stock, append-only events, idempotency, and audit recording.
- Confirmed mix-batch deductions preserve each supplier's remaining cost/kg exactly.

## Phase 2H — Period locking and closed-period protection

Status: complete.

### Completed work

- Added `periodLockService.ts` as the shared transaction-owned boundary for accounting, inventory, and factory effective dates.
- Added strict company, domain, and calendar-date validation.
- Added `assertPeriodOpenTx` so all dated business writes can reject dates on or before the applicable locked-through date before their first write.
- Added `lockThroughTx` with deterministic state locking, optimistic version checks, append-only audit requirements, and no-op handling for repeated identical closes.
- Prevented normal workflows from shortening or reopening an already closed period.
- Added exceptional closed-period overrides that require an explicit source identity, idempotency key, actor reason, override record, and audit record; overrides do not silently reopen the period.
- Exported the period-lock boundary from the central accounting service for gradual route/service adoption.
- Added focused invariant tests for open dates, blocked dates, reasoned overrides, repeat-safe overrides, stale lock versions, forbidden reopening, and lock-before-write ordering.

### Verification

- Confirmed the closed date itself is protected, not only dates before it.
- Confirmed normal reversal, repair, import, back-date, accounting, inventory, and factory paths are expected to invoke the same guard within their owning transaction.
- Confirmed period extension cannot race silently because the adapter must lock state and enforce the expected version.
- Confirmed an administrative override is idempotent and independently auditable without modifying the period lock.
- Confirmed no production route was switched without a complete database adapter and caller-owned transaction integration.
- No production data or Replit checks/credits were used.

## Next phase

- Phase 2I — Automated reconciliation and repair reporting

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Commit every phase separately.
- Do not run checks on Replit or consume Replit credits.
- Do not change accounting balances without transaction, idempotency, reversal, and audit guarantees.