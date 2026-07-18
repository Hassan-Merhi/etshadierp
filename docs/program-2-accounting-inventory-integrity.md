# Program 2 — Accounting and Inventory Integrity

Status: in progress. This branch must remain unmerged until the owner approves the completed Program 2 package.

## Phase sequence

- [x] 2A — Posting inventory audit
- [x] 2B — Central posting engine
- [ ] 2C — Voucher lifecycle integrity
- [ ] 2D — Cash, bank, customer, and supplier reconciliation
- [ ] 2E — Stock movement integrity
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
- Confirmed the phase does not migrate or change existing accounting routes; that work belongs to Phase 2C.
- No Replit checks or credits were used.

## Next phase

- Phase 2C — Voucher lifecycle integrity

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Commit every phase separately.
- Do not run checks on Replit or consume Replit credits.
- Do not change accounting balances without transaction, idempotency, reversal, and audit guarantees.
