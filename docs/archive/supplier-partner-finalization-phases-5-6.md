# Supplier Partner Finalization — Phases 5 and 6

## Phase 5 — Reverse Offload and Re-Offload

Implemented endpoint:

- `POST /api/sp/offloads/:id/reverse`

Required payload:

```json
{
  "reason": "Required audit reason",
  "reversalDate": "YYYY-MM-DD"
}
```

The reversal is atomic and:

- locks the offload, container, stock lots, prepaid records, and vouchers;
- rejects duplicate reversal;
- rejects reversal when any offloaded lot has been consumed by a sale;
- restores prepaid usage exactly;
- removes the offloaded quantity from ERP location inventory;
- closes the original SP lots as `offload_reversed`;
- creates exact debit/credit-swapped vouchers for Goods-OTW reversal and stock recognition;
- finds and reverses the parent-company agent/intercompany voucher;
- restores the container to `open`;
- records actor, date, and reason in the container lifecycle notes;
- stores an immutable JSON snapshot of the original offload, charges, movements, and voucher pairs.

Corrected re-offload uses the existing `/api/sp/offload` flow. A preparation guard archives only the reversed operational offload and charge rows immediately before corrected re-offload. The immutable `sp_offload_reversals` snapshot remains available for audit and duplicate protection.

## Phase 6 — Charges and Supplier-Ledger Reconciliation

Implemented endpoints:

- `GET /api/sp/reconciliation/offloads`
- `GET /api/sp/reconciliation/charges`

The reports return `PASS` only when mismatch count is zero. Checks include:

- Dr equals Cr for SP and parent-agent vouchers;
- active stock movement value equals offload final cost;
- landed charge total equals offload landed cost;
- prepaid references exist and used balances remain between zero and paid amount;
- paid-now charges reference a bank account;
- unpaid payable and other-ledger charges reference a ledger account;
- parent-agent charges reference an agent ledger and match the parent voucher amount;
- original and reversal voucher totals match exactly in opposite directions;
- container status agrees with its active offload;
- unknown charge types are rejected by reconciliation.

Supported charge types:

- `prepaid_used`
- `paid_now`
- `unpaid_payable`
- `invoice_freight`
- `supplier_freight`
- `other`
- `parent_agent`

## SQL classification

### Required

None to run manually. The application idempotently creates `sp_offload_reversals` and its index.

### Repair

None.

### Diagnostic only

None. Use the reconciliation endpoints instead.

## Verification status

The implementation and verification endpoints are included. CI, GitHub Actions, and the full test matrix were intentionally not run in this phase per instruction. They remain mandatory in Phase 10.
