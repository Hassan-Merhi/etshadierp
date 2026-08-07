# Program 2 — Accounting Convergence

Baseline branch: `main`

Original baseline commit: `4db45950ba27bb58f7252347d3be02c4a946d55b`

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

### Confirmed original state

- `postBalancedVoucherTx` already validated decimal balance, entry sides, one accounting target per entry, declared totals, ownership hooks, idempotency hooks, and audit hooks.
- Production manual journal and generic voucher routes inserted voucher and entry rows directly.
- The central engine had no production database implementation for ownership, idempotency, or audit.
- The engine returned an existing voucher for duplicate requests without telling the caller it was a replay. A caller could therefore repeat compatibility effects such as employee-balance synchronization or daybook insertion.
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

### Step 2A.2 completed — active manual journal creation

- Added a new `/api/vouchers/journal` handler before the legacy route.
- Active journals are normalized and posted through `postBalancedVoucherTx`.
- Optional journal drafts call `next()` and continue through the unchanged legacy route.
- The client API wrapper adds a stable `clientRequestId` before the request reaches CSRF retry or offline queueing.
- The same payload keeps the same request ID after an uncertain network result.
- A confirmed success, a definite 4xx rejection, or safe offline queueing releases the in-memory identity so a later intentional journal receives a new ID.
- The server combines that client ID with a normalized payload fingerprint. Reusing an ID with changed journal content cannot silently return a different posting.
- Per-entry non-USD rounding is adjusted by no more than `0.001000` in base currency so both sides exactly equal the aggregate historical base total.
- USD voucher rows preserve the previous `exchange_rate = NULL` behavior, while entry-level historical fields retain the identity rate.
- Company ownership is checked before insert for every company-scoped accounting target.
- Replayed requests do not repeat employee, order-charge, daybook, WhatsApp, or compatibility-audit side effects.

### Step 2A.3 completed — verified customer linked-ledger rule

The central engine now supports exactly two target shapes:

1. one accounting target; or
2. `customerId` plus `ledgerAccountId`.

The second shape is accepted only after the database adapter confirms all of the following:

- the customer belongs to the active company;
- the ledger belongs to the active company;
- the ledger ID is exactly the linked ledger stored on that customer.

A customer paired with a different ledger returns `POSTING_LINKED_LEDGER_MISMATCH`. Other unrelated multi-target combinations remain rejected by `POSTING_TARGET_INVALID`.

### Step 2A.4 completed — atomic employee balance posting

For active manual-journal and protected generic-voucher creation, employee balance changes now execute inside the same database transaction as the voucher, its entries, the idempotency marker, and the central posting audit record.

The existing formulas are preserved:

- `currentBalance += credit - debit`;
- `totalDeposits += credit`;
- `totalWithdrawals += debit`.

Direct `employeeId` entries retain precedence. Ledger entries still map through company-scoped `EMP-<employee code>` accounts. A missing employee for an `EMP-*` ledger remains non-blocking, matching the prior compatibility behavior.

### Step 2A.5 completed — protected generic voucher creation

A startup-installed fetch guard now adds retry-stable identity to both active manual journals and active `/api/vouchers/with-entries` JSON writes, including callers that use `apiRequest` directly. Successful and definite 4xx outcomes release the identity; 5xx and network outcomes retain it.

The protected generic route handles only the compatibility-safe subset:

- active, non-optional vouchers;
- a valid `clientRequestId`;
- USD transaction currency;
- at least two entries;
- amounts with at most two decimal places;
- no caller-supplied dual-currency fields.

That subset covers the currently known Insurance extra-charge and chatbot voucher producers. Unsupported optional, non-USD, high-precision, advanced dual-currency, or unidentified payloads call `next()` and continue into the unchanged legacy route.

### Step 2A.6 completed — exact transactional journal update and deletion

The employee-balance helper now supports explicit `apply` and `reverse` directions. Reverse mode subtracts the exact original effects:

- `currentBalance -= credit - debit`;
- `totalDeposits -= credit`;
- `totalWithdrawals -= debit`.

It does not swap deposits and withdrawals. Totals retain the legacy zero floor.

A journal-only lifecycle route is registered before the legacy handlers:

- Active Journal -> active Journal edits are handled centrally.
- Old employee deltas are reversed inside the same transaction that replaces the voucher entries.
- New employee deltas are applied before that same transaction commits.
- If validation, entry insertion, or employee application fails, the old journal and old employee balances remain unchanged.
- Active Journal deletion reverses employee effects and soft-deletes the voucher in one transaction.
- A repeated delete cannot reverse the employee a second time.
- Company ownership and migrated-voucher read-only rules remain enforced.
- Existing order-charge recalculation, intercompany counterpart synchronization, WhatsApp prompting, and detailed audit output remain in place.

The lifecycle route deliberately calls `next()` for:

- optional Journal transitions;
- optional Journal deletion;
- every non-Journal voucher deletion.

Those flows therefore retain their original compatibility behavior and are not accidentally affected by Phase 2A.

### Remaining compatibility side effects

After a committed voucher transaction, routes still perform their existing best-effort external or compatibility effects:

- customer-order charge linking and recalculation;
- factory daybook writes for journal creation;
- WhatsApp rule evaluation;
- detailed voucher audit output;
- intercompany notifications;
- loan-account reallocation.

These are skipped when a central create result is a replay.

### Phase 2A completion boundary

Phase 2A is complete for active manual journals, the protected simple generic-voucher subset, active Journal edits, and active Journal deletion.

The following remain intentionally on compatibility paths rather than being silently reinterpreted:

- optional or intentionally unbalanced drafts;
- optional-to-active and active-to-optional Journal transitions;
- advanced generic multi-currency payloads;
- generic amounts requiring more than two decimal places.

## Verification status

Focused regression tests were added for:

- central-engine replay status;
- manual and generic request-ID retention and release;
- manual journal USD and CFA normalization;
- aggregate/per-line rounding balance;
- generic USD normalization and legacy passthrough boundaries;
- company target grouping;
- customer linked-ledger acceptance and mismatch rejection;
- employee direct-ID and `EMP-*` ledger delta formulas;
- exact employee deposit, withdrawal, and balance reversal.

GitHub Actions continues to fail before exposing executable steps or logs. Therefore the code is implemented on the draft branch, but a full build, type-check, and database-backed test pass is not claimed.

## Phase 2B — Payments and receipts

Planned next:

- centralize cash, bank, customer, supplier, employee, and ledger posting;
- preserve currency history and party-balance behavior;
- make duplicate submissions replay-safe;
- verify exact edit and deletion reversal.

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

This branch remains draft and unmerged until the current slice is reviewed. A route is not considered converged merely because its posting service compiles; every compatibility side effect and replay boundary must be mapped and protected first.
