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

### Step 2A.2 implemented — active manual journal creation

- Added a new `/api/vouchers/journal` handler before the legacy route.
- Active journals are normalized and posted through `postBalancedVoucherTx`.
- Optional journal drafts call `next()` and continue through the unchanged legacy route.
- Journal update and deletion remain unchanged.
- The client API wrapper adds a stable `clientRequestId` before the request reaches CSRF retry or offline queueing.
- The same payload keeps the same request ID after an uncertain network result.
- A confirmed success, a definite 4xx rejection, or safe offline queueing releases the in-memory identity so a later intentional journal receives a new ID.
- The server combines that client ID with a normalized payload fingerprint. Reusing an ID with changed journal content cannot silently return a different posting.
- Per-entry non-USD rounding is adjusted by no more than `0.001000` in base currency so both sides exactly equal the aggregate historical base total.
- USD voucher rows preserve the previous `exchange_rate = NULL` behavior, while entry-level historical fields retain the identity rate.
- Company ownership is checked before insert for every company-scoped accounting target.
- Replayed requests do not repeat:
  - employee balance synchronization;
  - customer-order charge synchronization;
  - factory daybook insertion;
  - WhatsApp prompting;
  - the compatibility voucher audit record.
- Existing response fields remain present, with additional `replayed` and `clientRequestId` diagnostics.

### Compatibility side effects preserved

On the first successful active-journal posting, the route still performs the existing:

- employee balance synchronization;
- customer-order charge linking and recalculation;
- factory daybook write;
- WhatsApp rule evaluation;
- detailed voucher audit record.

The transaction-owned central audit and idempotency marker are written before the voucher transaction commits.

### Step 2A.3 completed — verified customer linked-ledger rule

The central engine now supports exactly two target shapes:

1. one accounting target; or
2. `customerId` plus `ledgerAccountId`.

The second shape is accepted only after the database adapter confirms all of the following:

- the customer belongs to the active company;
- the ledger belongs to the active company;
- the ledger ID is exactly the linked ledger stored on that customer.

A customer paired with a different ledger returns `POSTING_LINKED_LEDGER_MISMATCH`. Other unrelated multi-target combinations remain rejected by `POSTING_TARGET_INVALID`.

This preserves the generic voucher route's linked-ledger reporting model without weakening the central engine into accepting arbitrary duplicate targets.

### Generic voucher endpoint remains unchanged

The generic `/api/vouchers/with-entries` endpoint is deliberately not switched in this slice. Its known callers include insurance extra charges and chatbot-created vouchers. Those callers do not yet all pass a retry-stable request identity through the same client wrapper used by manual journals.

A generic-route cutover must first add a stable identity boundary for all callers, then preserve:

- customer linked-ledger auto-fill and mismatch rejection;
- caller-provided dual-currency fields;
- employee balance synchronization;
- intercompany notifications;
- loan-account reallocation;
- detailed compatibility audit output.

### Remaining Phase 2A work

- Obtain an executable build/test result for the active journal cutover.
- Add retry-stable identity coverage for all `/api/vouchers/with-entries` callers.
- Migrate generic active voucher creation only after those callers are covered.
- Journal editing and deletion are not yet migrated.
- Optional or intentionally unbalanced drafts remain on the compatibility path.
- Employee balance synchronization is still a legacy post-commit incremental side effect. A failed partial employee sync cannot yet be proven fully idempotent; this must be resolved before journal edit/delete convergence.

## Verification status

Focused regression tests were added for:

- central-engine replay status;
- request-ID retention and release;
- manual journal USD and CFA normalization;
- aggregate/per-line rounding balance;
- company target grouping;
- customer linked-ledger acceptance and mismatch rejection.

GitHub Actions continues to fail before exposing executable steps or logs. Therefore the code is implemented on the draft branch, but a full build, type-check, and database-backed test pass is not claimed.

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

This branch remains draft and unmerged until the current slice is reviewed. A route is not considered converged merely because its posting service compiles; every compatibility side effect and replay boundary must be mapped and protected first.
