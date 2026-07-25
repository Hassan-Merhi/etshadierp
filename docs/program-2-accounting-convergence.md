# Program 2 — Accounting Convergence

Baseline branch: `main`

Baseline commit: `4db45950ba27bb58f7252347d3be02c4a946d55b`

Started: 2026-07-25

## Safety boundary

Program 2 must preserve existing voucher totals, historical exchange rates, account targets, inventory quantities, party balances, factory daybook behavior, and deletion semantics. Each production route is migrated separately. No broad accounting rewrite and no production data repair are allowed in this program.

Every route cutover requires:

1. A current behavior map.
2. Company/account ownership checks.
3. Decimal balance validation.
4. A deterministic source identity.
5. Transaction-owned idempotency and audit records.
6. Replay-safe compatibility side effects.
7. Focused regression coverage.
8. An isolated draft PR until owner approval.

## Phase 2A — Manual journals and vouchers

### Confirmed current state

- `postBalancedVoucherTx` already validates decimal balance, entry sides, one accounting target per entry, declared totals, ownership hooks, idempotency hooks, and audit hooks.
- The production manual journal and generic voucher routes still insert voucher and entry rows directly.
- The central engine previously had no production database implementation for ownership, idempotency, or audit.
- The engine previously returned an existing voucher for duplicate requests without telling the caller it was a replay. A caller could therefore repeat non-transactional compatibility effects such as employee-balance synchronization or daybook insertion.
- Journal `effectiveDate` was not part of the shared posting type and would have been lost by an unsafe direct cutover.
- ERP suppliers are currently global in the Drizzle schema. Their existence can be verified, but company ownership cannot be truthfully enforced until Program 3 introduces a tenant boundary for them.

### Step 2A.1 completed — production posting foundation

- Added `effectiveDate` to the central voucher posting type and persistence helper.
- Added `CentralPostingResult.replayed` so route adapters can skip duplicate compatibility effects.
- Added `createDatabasePostingDependencies()`:
  - validates company ownership for locations, ledger accounts, bank accounts, fixed assets, employees, customers, and factory suppliers;
  - validates existence for globally scoped ERP suppliers;
  - serializes identical idempotency keys with a PostgreSQL transaction advisory lock;
  - stores idempotency markers in the existing `audit_log` table, avoiding a schema migration in this first slice;
  - loads and returns the original voucher on replay;
  - writes a transaction-owned posting audit record.
- Added target-ID validation and de-duplication before database access.
- Added focused tests for replay status and target grouping.

### Deliberately not changed yet

- No HTTP route uses the new database adapter yet.
- Manual journal creation, editing, deletion, daybook writes, order-charge synchronization, employee balances, WhatsApp prompts, and loan allocation behave exactly as before.
- Optional/unbalanced voucher drafts remain outside the strict balanced-posting boundary.
- No schema migration, database command, repair, backfill, or production deployment was executed.

### Next Step 2A.2

Migrate active manual journal creation only, while preserving every existing compatibility side effect. The route adapter must:

- accept a stable client request ID;
- normalize all transaction/base currency fields before posting;
- use `postBalancedVoucherTx` only for active balanced journals;
- keep optional journal drafts on the compatibility path;
- skip employee, order-charge, daybook, WhatsApp, audit-compatibility, and loan-allocation side effects when `replayed` is true;
- return the same response fields currently consumed by the frontend.

Journal update and deletion will remain unchanged until creation is proven.

## Phase 2B — Payments and receipts

Planned after Phase 2A is verified:

- centralize cash, bank, customer, supplier, employee, and ledger posting;
- preserve currency history and party-balance behavior;
- make duplicate submissions replay-safe;
- verify exact deletion reversal.

## Phase 2C — POS and stock transfers

Planned after Phase 2B:

- unify accounting and inventory transaction ownership;
- verify edit and deletion reversals;
- protect against duplicate posting and partial commits.

## Phase 2D — Containers and special workflows

Planned last because of the highest regression risk:

- container offload and own-account freight;
- Supplier Partner;
- payroll;
- rentals.

## Merge rule

This branch remains draft and unmerged until the current slice is reviewed. A route will not be switched to the central engine merely because the service compiles; its complete compatibility side effects must be mapped and protected first.
