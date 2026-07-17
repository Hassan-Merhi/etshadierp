# Program 2A — Posting Inventory Audit

Date: 2026-07-18
Status: complete
Scope: read-only architecture and integrity audit. No balances, stock quantities, postings, or production data were changed.

## Audit basis

The repository already contains the detailed 31-flow `docs/accounting-engine-audit.md`. Program 2A reclassifies that inventory around integrity guarantees required by the remaining Program 2 phases and establishes the implementation order.

## Posting surfaces

| Domain | Primary write surfaces | Accounting effect | Stock effect | Integrity priority |
|---|---|---|---|---|
| Manual vouchers | voucher create, journal, payment/receipt, transfer, purchase/sales update routes | voucher + balanced entries; party and employee side ledgers | purchase/sales reversal paths | Critical |
| POS and sales returns | POS routes, credit notes, debit notes | sales, cash/receivable, returns, variance entries | issue and return inventory | Critical |
| Containers | accounting, freight, offload and storage services | supplier payable, freight/duty, landed cost | receipt and cost basis | Critical |
| Supplier Partner | SP routes and storage | supplier/intercompany vouchers | opening, offload, sale, transfer and reversal stock | Critical |
| Factory raw stock | factory offload, charges, supplier cost and recalculation routes | supplier/daybook/voucher effects | raw-stock kg and value | Critical |
| Mix batches | factory mix-batch create, edit, delete and recalc paths | cost/value attribution | source deduction and output production | Critical |
| Stock transfers | ERP and factory transfer routes | optional/intercompany posting | source/destination movement | High |
| Rentals | contracts, accrual and payment routes | receivable, income, cash | none | High |
| Payroll and employees | payroll core, advances, deductions and employee routes | expense, payable, employee subledger | none | High |
| Repairs and migrations | reconciliation, recalculation and startup repair paths | direct corrective entries or balance rebuilds | direct corrective movements | Critical |

## Integrity findings

### P0 — Multiple posting engines

Posting logic is distributed across route modules, storage modules and factory helpers. `voucherPostingService.ts`, `storage.createVoucher`, direct `db.insert(vouchers)`, direct `voucherEntries` inserts and raw `pool.query` transactions coexist. The same guarantees are therefore not uniformly enforced.

Required in 2B:

- one transaction-owned posting boundary;
- debit/credit equality before commit;
- company ownership validation for every account and party reference;
- deterministic source-document identity and idempotency key;
- consistent audit metadata and reversal linkage;
- no direct stored-balance mutation inside ordinary posting flows.

### P0 — Reversal behavior is not uniform

Some flows replace entries, some create explicit reversal vouchers, some reverse inventory by exact value, and some rebuild derived balances. Delete and edit behavior can therefore remove the visible document without reversing every secondary effect.

Required in 2C:

- immutable posting identity;
- explicit lifecycle states;
- transactional reversal of voucher entries, party ledgers, inventory and linked documents;
- repeat-safe delete/edit requests;
- audit trail connecting original, replacement and reversal.

### P0 — Secondary ledgers can diverge

Customer running balances, employee balances, factory daybook rows, intercompany transfer tables and other cached/secondary records are updated by side helpers. Several helpers run after the main transaction or through separate calls, creating a window where the voucher commits but a secondary balance does not.

Required in 2D:

- voucher entries remain the accounting source of truth;
- transactional outbox or same-transaction updates for required side ledgers;
- reconciliation of cash, bank, customer and supplier totals against voucher entries;
- deletion/edit reconciliation tests.

### P0 — Accounting and stock are coupled inconsistently

POS, purchase, sales, credit-note, container, SP and factory flows combine journal and stock changes, but not all use the same transaction owner or reversal contract.

Required in 2E:

- source movement ID and idempotency key on each stock effect;
- atomic accounting + inventory commit where both are mandatory;
- exact reversal using original movement rows rather than recomputation;
- source/destination company and location validation.

### P0 — Factory cost repair paths are unusually powerful

Raw-stock and mix-batch recalculation routes can rebuild kg, value and cost. These paths require stricter dry-run, confirmation, advisory locking, audit and closed-period rules than normal writes.

Required in 2F and 2G:

- stable supplier cost policy;
- six-decimal-or-better internal precision;
- no re-averaging from deductions or mix production;
- landed-cost changes only from authorized offload/charge events;
- before/after repair reports and idempotent apply operations.

### P1 — Closed periods are not a universal posting invariant

Date validation and edit-day permissions exist in several routes, but period locking is not centralized across every posting and repair path.

Required in 2H:

- a single closed-period guard called by all accounting, inventory, factory and repair writes;
- privileged override with reason and audit entry;
- reversal posted in an open period when policy forbids historical mutation.

### P1 — Repair reporting is fragmented

Existing diagnostics and recalculation endpoints are domain-specific. Operators lack one read-only report showing voucher imbalance, orphan entries, party-ledger drift, stock drift and source-document duplication.

Required in 2I:

- consolidated read-only reconciliation report;
- dry-run repair plans;
- confirmation token bound to exact findings;
- transaction + advisory lock + audit log;
- no silent automatic financial repair.

## Canonical source-of-truth rules

1. Voucher entries are the source of truth for general-ledger balances.
2. Inventory movement rows are the source of truth for stock quantity and value changes.
3. Source documents reference postings and movements; they must not independently mutate cached balances.
4. Customer, supplier, employee, daybook and summary balances are derived or transactionally maintained projections.
5. Every posting and movement has company, source type, source ID, idempotency key, created-by identity and reversal linkage.
6. Money and cost calculations use decimal arithmetic; display rounding never changes stored calculations.
7. Reversals use original committed rows and values, not current prices or reconstructed assumptions.

## Program 2 implementation order

1. **2B Central posting engine** — establish guarantees without migrating every route at once.
2. **2C Voucher lifecycle integrity** — route create/edit/delete/reversal through the engine.
3. **2D Reconciliation** — align cash, bank, customer and supplier projections.
4. **2E Stock movement integrity** — establish an equivalent movement contract.
5. **2F Raw-stock costing** and **2G mix-batch costing** — enforce factory cost policy on top of movement integrity.
6. **2H Period locking** — centralize historical-write protection across both engines.
7. **2I Automated reconciliation** — report and safely repair historical drift.

## Phase 2A completion criteria

- Existing posting flows were inventoried and grouped by domain.
- Sources of truth and required invariants were defined.
- Duplicate engines, reversal gaps, side-ledger drift, stock coupling, factory repair risk and period-control gaps were prioritized.
- Remediation ownership was mapped to Phases 2B–2I.
- No accounting or inventory behavior was changed.
