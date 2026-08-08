# Phase 6 — Historical Accounting and FX Repair Center

Phase 6 consolidates legacy multi-currency diagnosis and approved historical repair into one controlled accounting boundary. It does not guess exchange rates, silently backfill rows, or unblock financial reports by substituting defaults.

## Read-only diagnosis

`GET /api/accounts/multi-currency/repair-center` is restricted to Admin, Owner, and Developer roles. It returns the current historical-currency readiness state plus unresolved repair cases for:

- voucher entries;
- ledger-account opening balances;
- bank-account opening balances;
- customer opening balances;
- supplier opening balances scoped through the selected company’s vouchers;
- employee opening balances;
- fixed-asset acquisition values.

The diagnostic performs no writes and reports `writePerformed: false`.

## Explicit approval

Every repair request must identify the exact row, currency, historical rate, and original transaction/native amount. The service rejects empty batches, duplicate rows, invalid IDs, missing rates, impossible debit/credit combinations, and unsupported entity types.

There is no “repair everything” default and no rate lookup that silently selects the latest company exchange rate. Ambiguous rows remain unresolved until an authorized operator supplies reviewed values.

## Signed preview

`POST /api/accounts/multi-currency/repair-center/plan` normalizes the proposed values through the existing voucher-entry and opening-balance currency policies. It returns the full before/after plan and a signed, expiring confirmation token.

The token is bound to:

- the repair-center purpose;
- selected company;
- requesting user;
- item count;
- normalized plan fingerprint;
- expiration time.

The preview does not update any accounting record.

## Stale-state protection

Every planned row includes a deterministic version tag derived from its current persisted currency state. Apply re-reads every row and refuses the batch when a row was edited, repaired, deleted, moved outside the company scope, or otherwise changed after preview.

The caller must re-run the preview to approve the new state.

## Transactional apply

`POST /api/accounts/multi-currency/repair-center/apply` re-plans the submitted repairs, verifies the signed token, compares the normalized fingerprint, and applies the complete batch in one database transaction.

A company-scoped PostgreSQL advisory lock prevents concurrent historical repair batches for the same company. Any failed row or failed audit insert rolls back the whole batch.

Voucher-entry repairs preserve transaction currency amounts and historical rates while populating the base debit/credit amounts used by financial reporting. Opening-balance repairs preserve the native amount, historical currency, historical rate, base amount, and established debit/credit orientation.

## Audit trail

Each applied row creates an atomic `audit_log` entry with action `repair`, the affected table and record, the full before snapshot, normalized after values, and the operator’s optional review note.

Original vouchers are not deleted, replaced, or re-dated. The repair changes only missing historical currency fields and the compatible legacy base amount columns required by existing reports.

## Readiness reconciliation

After a successful batch, the apply response immediately calls the existing historical-currency readiness service. Financial reports remain blocked while any unresolved foreign-currency voucher entries or opening balances remain.

This means a partially approved batch can be safely applied without falsely declaring the company fully repaired.

## Existing compatibility

Existing per-row opening-balance resolution and voucher-entry editing endpoints remain registered for current clients. The new repair center provides the controlled batch workflow for audited historical cleanup without changing normal current-period accounting entry behavior.

Factory container, offload-charge, and commission FX repair remain under the existing factory FX diagnostic service because those records have their own status, costing, and manual-review rules.

## API summary

### Diagnose

`GET /api/accounts/multi-currency/repair-center`

### Preview

`POST /api/accounts/multi-currency/repair-center/plan`

```json
{
  "repairs": [
    {
      "kind": "voucherEntry",
      "id": 123,
      "currency": "CFA",
      "historicalRate": "0.00165",
      "transactionDebitAmount": "500000",
      "transactionCreditAmount": "0",
      "note": "Approved from archived receipt"
    }
  ]
}
```

### Apply

`POST /api/accounts/multi-currency/repair-center/apply`

The apply request must repeat the identical approved `repairs` array and include the preview’s `confirmationToken`.

## Verification boundary

The phase includes source contracts covering authorization, explicit approvals, signed-token bindings, stale-row detection, one transaction, advisory locking, rollback, audit logging, supported repair kinds, and the prohibition on guessed rates.

The verifier and focused contract test were added but were not executed because the owner explicitly requested no CI checks. No formatting, lint, TypeScript, database, migration, browser, build, or deployment result is claimed.

## Merge boundary

Keep Phase 6 as a draft. Do not merge it until earlier stacked phases are resolved and the owner explicitly authorizes the merge.
