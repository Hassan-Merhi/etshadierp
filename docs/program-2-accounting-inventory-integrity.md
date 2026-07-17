# Program 2 — Accounting and Inventory Integrity

Status: in progress. This branch must remain unmerged until the owner approves the completed Program 2 package.

## Phase sequence

- [ ] 2A — Posting inventory audit
- [ ] 2B — Central posting engine
- [ ] 2C — Voucher lifecycle integrity
- [ ] 2D — Cash, bank, customer, and supplier reconciliation
- [ ] 2E — Stock movement integrity
- [ ] 2F — Factory raw-stock costing integrity
- [ ] 2G — Mix-batch costing integrity
- [ ] 2H — Period locking and closed-period protection
- [ ] 2I — Automated reconciliation and repair reporting

Each phase must be completed and committed separately. Do not begin Program 3 on this branch.

## Phase 2A — Posting inventory audit

### Scope

- Inventory every accounting and stock-posting write path.
- Map source document, posting service, journal entries, balance effects, stock effects, reversal behavior, company isolation, currency behavior, and audit logging.
- Identify duplicate posting logic, direct balance mutation, non-transactional writes, incomplete reversals, and missing idempotency.
- Produce a prioritized remediation map for Phases 2B–2I.

### Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Do not change accounting balances during the audit phase.
- Do not run checks on Replit or consume Replit credits.
