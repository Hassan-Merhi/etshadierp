# Phase 6 Foundation — Historical Accounting and FX Repair Center

Phase 6 introduced the controlled repair-center boundary. Phase 8 completes that foundation with authoritative readiness, evidence-only recommendations, visible Accounts tooling, full-voucher approval, and post-write reconciliation. The current operating contract is documented in `phase8-accounting-currency-stabilization.md`.

## Read-only diagnosis

`GET /api/accounts/multi-currency/repair-center` is restricted to Admin, Owner, and Developer roles. It returns authoritative readiness, live reconciliation, and unresolved cases for:

- voucher entries;
- ledger-account opening balances;
- bank-account opening balances;
- customer opening balances;
- supplier opening balances scoped through the selected company’s vouchers;
- employee opening balances;
- fixed-asset acquisition values.

The diagnostic performs no writes and reports `writePerformed: false`.

## Explicit approval

Every manual repair identifies the exact row or complete voucher group, original currency, historical transaction-per-base rate, reviewed amount denomination, and optional source note. Ambiguous rows remain unresolved until an authorized operator supplies reviewed evidence.

The former amount-size command-line classifier is retired. No automatic repair uses the latest exchange rate or guesses whether a legacy value is CFA, USD, native currency, or historical base currency.

## Signed preview

`POST /api/accounts/multi-currency/repair-center/plan` normalizes proposed values through the voucher-entry and opening-balance currency policies. `POST /api/accounts/multi-currency/repair-center/auto-plan` includes only complete voucher or opening groups backed by persisted evidence.

Both return a full before/after plan and a signed, expiring confirmation token bound to:

- repair-center purpose;
- selected company;
- requesting user;
- item count;
- normalized plan fingerprint;
- expiration time.

Preview performs no accounting write.

## Stale-state protection

Every planned row includes a deterministic version tag derived from its current persisted currency state. Apply re-reads every row and refuses the batch when a row changed after preview.

A voucher must include every unresolved entry from that voucher. Partial voucher repair is rejected before a token can be applied.

## Transactional apply

`POST /api/accounts/multi-currency/repair-center/apply` verifies the signed token, rebuilds the plan, checks the fingerprint, and applies the complete batch in one database transaction under a company-scoped PostgreSQL advisory lock.

Voucher-entry repairs preserve original transaction amounts and historical rates while storing historical base debit and credit in both the explicit base columns and compatibility `debit_amount` / `credit_amount` columns. Opening and asset repairs preserve reviewed native amount, original currency, historical rate, base value, and debit/credit orientation.

Before commit, every touched voucher must have complete metadata and balance in historical base currency within `0.000001`. Any failed row, audit insert, completeness check, or balance check rolls back the batch.

## Audit trail

Each applied row creates an atomic `audit_log` entry with action `repair`, affected table and record, full before snapshot, normalized after values, and the operator note.

Original vouchers are not deleted, replaced, or re-dated.

## Readiness reconciliation

After apply, the API recalculates authoritative readiness and reconciliation. Protected financial reports remain blocked while any foreign-currency entry, opening, acquisition value, trial-balance difference, resolved-voucher imbalance, partial metadata, or cash/bank translation issue remains.

## API summary

### Diagnose

`GET /api/accounts/multi-currency/repair-center`

### Reconcile

`GET /api/accounts/multi-currency/repair-center/reconciliation`

### Preview evidence-backed complete groups

`POST /api/accounts/multi-currency/repair-center/auto-plan`

### Preview reviewed rows

`POST /api/accounts/multi-currency/repair-center/plan`

```json
{
  "repairs": [
    {
      "kind": "voucherEntry",
      "id": 123,
      "currency": "CFA",
      "historicalRate": "600",
      "storedAmountMode": "transaction",
      "transactionDebitAmount": "500000",
      "transactionCreditAmount": "0",
      "note": "Approved from archived receipt"
    }
  ]
}
```

### Apply

`POST /api/accounts/multi-currency/repair-center/apply`

Apply repeats the identical approved `repairs` array and includes the preview’s `confirmationToken`.

## Verification boundary

The source contracts cover authorization, explicit approval, signed preview, stale-state protection, complete-voucher coverage, transactional apply, company-scoped writes, audit trail, compatibility historical-base columns, balance reconciliation, visible Accounts tooling, and the prohibition on guessed rates.

Per owner instruction, CI, TypeScript, formatting, lint, tests, database execution, browser verification, build, deployment, and runtime smoke checks were not run.

## Merge boundary

Phase 8 is stacked on Phase 7. Merge Phase 7 first, then retarget or merge the Phase 8 stabilization PR. No automatic merge is requested.
