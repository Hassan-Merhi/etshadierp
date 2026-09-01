# Duplicate-Posting Protection — Phase 1 Audit and Standard

**Status:** Complete  
**Audit date:** 2026-08-24  
**Scope:** Financial and inventory-changing writes in the ERP, Factory, Properties/Rentals, Supplier Partner, POS, payroll, import, repair, and intercompany domains.

## 1. Phase result

Phase 1 is complete as an audit and policy definition. The repository now has a
single documented classification for every discovered financial write family:

1. **Replay-safe** — the same logical request can be sent again and returns the
   original result without creating another financial effect.
2. **Intentionally repeatable** — a missing key means the caller is deliberately
   asking for a new business event. The client must not silently retry an
   unknown outcome.
3. **State-guarded** — a later call usually converges to a no-op or a conflict,
   but it does not yet have durable request replay semantics.
4. **Not retry-safe** — an uncertain transport result can create another
   document, voucher, stock movement, balance change, or daybook entry.

The last two classifications are documented gaps for Phase 2. They are not
treated as protected merely because a route has a transaction, a timestamped
voucher number, a status check, or a database row lock.

## 2. What is the same logical request?

Two calls are the same logical request only when all of the following are true:

- They use the same company scope.
- They use the same operation family and canonical route/action.
- They carry the same caller-supplied request identity.
- Their normalized financial/business payload has the same fingerprint.
- They have the same authorization context relevant to the operation.

The following are **not** request identities:

- A timestamp or random voucher number.
- A display document number unless that number is a durable unique business key
  owned by the operation.
- Amount + date + customer/supplier alone.
- A payload hash without a caller/request identity.
- A browser click count, React mutation instance, or HTTP connection.

Two calls with the same idempotency key but different operation, company,
authorization context, or payload are a conflict and must not execute the
second call.

Legitimate repeated business events use a new identity. For example, two
separate POS sales with identical items and amount are two sales, not a
duplicate, unless the caller intentionally reuses the first sale identity.

## 3. Required request identity standard

### 3.1 External request identity

The standard external identity is:

```text
v1/<domain>/<operation>/<uuid>
```

Requirements:

- `uuid` must be generated before the first submission and reused for retries.
- The key must contain no password, token, customer PII, or raw financial
  payload.
- Maximum length is 180 characters for the operational accounting boundary;
  other existing stock helpers accept up to 200 characters. Phase 2 should
  converge these limits to 180.
- The preferred transport is `X-Idempotency-Key`.
- `clientRequestId` is the supported body compatibility field.
- A header and body identity, if both supplied, must match; Phase 2 should
  reject mismatches.

Examples:

```text
v1/accounting/payment-receipt/550e8400-e29b-41d4-a716-446655440000
v1/pos/sale/550e8400-e29b-41d4-a716-446655440000
v1/inventory/stock-transfer/550e8400-e29b-41d4-a716-446655440000
```

The prefix is descriptive, not security-sensitive. Company and user authority
come from the authenticated server session, never from the key.

### 3.2 Internal deterministic identity

Infrastructure writers may derive an identity from a stable business source:

```text
infra:<sourceType>:<stableSourceId>:<phase>
```

The source ID must be stable for the lifecycle phase and must not contain a
timestamp, random suffix, or display voucher number. Existing examples include
container charge phases, rental posting phases, exact reversals, and payroll
generation/rebuild phases.

For an operation that can legitimately have multiple postings for one source,
the phase or revision must be explicit. A new economic event must not reuse the
old phase identity.

### 3.3 Business-document identity

Some operations already have a durable document identity:

- POS: `clientSaleId` when supplied.
- Stock document: `sourceType + companyId + clientRequestId`.
- Exact reversal: original voucher ID, company ID, and reversal operation.
- Container charge: company, container, charge kind/index, and lifecycle phase.
- Purchase order: company and PO number, only where the PO creation and posting
  are committed atomically.
- Factory bale finalization: bale ID.
- Rental posting: company, payment group, and posting phase.

A business identity is replay-safe only when the document and its marker are
created or updated atomically and payload conflicts are rejected.

## 4. Fingerprint rules

The fingerprint is a SHA-256 digest of a canonical structure containing:

```text
HTTP method
canonical operation path/action
authenticated company scope
relevant authorization context
canonical business payload
```

Canonicalization rules:

1. Sort object keys recursively.
2. Preserve array order unless the operation explicitly defines its lines as
   an unordered set and sorts them by a stable line identity.
3. Exclude the request identity itself (`clientRequestId` and
   `X-Idempotency-Key`).
4. Exclude generated display values such as voucher numbers, timestamps,
   random group IDs, and server-generated audit metadata.
5. Include dates, currency, exchange rate, account IDs, company-relevant
   location IDs, quantities, rates, and all accounting line details.
6. Preserve decimal values without converting through binary floating point.
7. Include optional fields when their value changes behavior; normalize absent
   and explicitly-defaulted values only when the route treats them identically.
8. Include the source document ID and lifecycle phase for deterministic
   infrastructure writes.
9. Do not include secrets, credentials, or unnecessary PII.

A key replay with a different fingerprint is a `409` conflict. It must never
silently update the original request.

## 5. Retry classification rules

### Replay-safe

The caller may retry after a timeout or connection failure. The server returns
the stored result or a deterministic replay result:

- The request identity marker is durable.
- The marker is company-scoped.
- The marker and all financial effects share the same transaction, or the
  underlying operation has an equivalent durable recovery boundary.
- A concurrent duplicate is serialized.
- Non-transactional side effects are skipped on replay or have their own
  identity.

### Intentionally repeatable

The operation represents a new event when no key is supplied. The UI may submit
again only after the user confirms it is a new event. A timeout must lead to
reconciliation, not blind resubmission.

Examples include a new POS sale without `clientSaleId` and a distinct
continuation raw-stock receipt without a receipt identity.

### State-guarded

The operation uses a status, existing row, or “already applied” check. A second
call may return a conflict or no-op, but it is not guaranteed to replay the
original HTTP response. These routes need Phase 2 treatment if users can retry
them after an unknown outcome.

### Not retry-safe

The operation has a check-then-write race, creates its marker outside the
financial transaction, or has no durable identity. The client must not blindly
retry it. This classification is the implementation priority for Phase 2.

## 6. Route-family audit

The following matrix records the discovered write paths. Route patterns are
grouped only where they share the same implementation and identity behavior.

### Accounting and vouchers

| Write family | Examples | Current identity | Classification |
|---|---|---|---|
| Central payment/receipt create | `POST /api/vouchers/payment-receipt` | `clientRequestId` or `X-Idempotency-Key`; central posting engine | Replay-safe when supplied; boundary rejects omission |
| Central journal create | `POST /api/vouchers/journal` | Caller key through operational boundary; random fallback remains in service | Replay-safe with key; omission is not retry-safe |
| Central generic voucher | `POST /api/vouchers/with-entries` | Required `clientRequestId`; central posting identity | Replay-safe |
| Legacy voucher/payment/journal creates | Legacy `/api/vouchers`, `/with-entries`, `/journal`, payment fallback | Timestamp/display IDs or no key | Not retry-safe |
| Voucher/payment/journal edits | `PATCH /api/vouchers/:id/...` | Replacement/state checks; generated timestamp key in some central paths | State-guarded, not request-replay-safe |
| Voucher deletes/bulk deletes | `DELETE /api/vouchers/:id`, bulk delete | Deleted-state checks | State-guarded; destructive operation needs explicit correction policy |
| Exact voucher reversal | `POST /api/vouchers/:voucherId/exact-reversal` | `voucher-reversal:<company>:<originalVoucherId>` | Replay-safe and append-only |
| Direct voucher-entry writes | `/api/voucher-entries` writes and edits | No common request identity | Not retry-safe |

### POS, customer, supplier, and credit sales

| Write family | Examples | Current identity | Classification |
|---|---|---|---|
| ERP POS sale | `POST /api/pos/sales` | `clientSaleId` + company advisory lock | Replay-safe with `clientSaleId`; intentionally repeatable without it |
| ERP POS edit/delete | `PUT /api/vouchers/:id/sales`, sale delete | Row/state replacement | State-guarded, not request-replay-safe |
| Factory employee POS | `/api/factory/pos/sale` create/edit/delete | No durable request key | Not retry-safe |
| Supplier Partner sale | `POST /api/sp/sales` | No caller key; downstream stock/voucher effects | Not retry-safe |
| Supplier Partner reversal | `POST /api/sp/sales/:id/reverse` | Status guard; timestamp reversal number | State-guarded, not request-replay-safe |
| Supplier payments | `/api/factory/supplier-payments` | Payment row ID after insert | Not retry-safe |
| Supplier FX transfers/settlement | `/api/factory/supplier-fx-transfers`, bulk settlement | Transfer row ID after insert | Not retry-safe |
| Customer-order loading/finalization/charges | Finalize, charge create/update/delete routes | Linked-record checks and voucher linkage | State-guarded; charge/finalization retries are not universally replay-safe |
| Credit/debit notes | `/api/credit-notes` create/update | Inventory movement key derives from newly-created voucher | Not retry-safe for note creation; update is replacement |

### Inventory, stock transfers, and adjustments

| Write family | Examples | Current identity | Classification |
|---|---|---|---|
| Canonical stock movement | `postStockMovementTx` | Company + explicit movement key | Replay-safe |
| New stock transfer document | `POST /api/stock-transfers` | `clientRequestId` marker in transaction | Replay-safe with key; intentionally repeatable without it |
| Existing-voucher transfer path | Transfer creation from existing voucher | No request dedupe in route | Not retry-safe |
| Transfer edit/finalize/approve/revision | Transfer lifecycle routes | State flags, row locks, reversal/reapply | State-guarded; revisions need operation identity |
| Stock adjustments | `/api/stock-adjustments`, adjustment voucher edits | No request key | Not retry-safe |
| Waste dispatch | `/api/waste-dispatches` | Dispatch number plus infrastructure voucher phase | State/infra protected at voucher layer, but document creation is not fully request-idempotent |
| Inventory/location/stock imports | Location import, stock-transfer import, silent transfer/production | Mixed direct `adjustInventory` calls | Not retry-safe unless the specific import supplies a durable marker |
| Direct inventory helper | `adjustInventory` | Row locking only | Transaction/concurrency-safe, not idempotent by itself |

### Containers, purchase orders, freight, and raw stock

| Write family | Examples | Current identity | Classification |
|---|---|---|---|
| Container create/delete | `/api/containers` | Database row ID | Not retry-safe |
| Standard container offload | `/api/containers/:id/offload` | Offload/status lifecycle and revision evidence | State-guarded; replacement is intentional, blind retry is unsafe |
| Container charge vouchers | Duties, office, transport, transfer, indexed charges | Infrastructure phase identity | Replay-safe for the same charge phase |
| Container costing/sync | Costing and sync-voucher routes | Underlying voucher identity varies | State/infra protected in some branches; route contract is not uniform |
| Purchase order create | PO create storage/service | Company + PO number for posting | State/infra protected for voucher; PO/document creation is not atomically request-idempotent |
| Purchase order edit/delete/freight | PO and voucher purchase updates | Ordinary replacement/delete and audit diff | Not retry-safe |
| PO import | `/api/po-import/import` | File hash/import log | Business-file guarded; check-then-insert race must be closed in Phase 2 |
| Factory raw-stock first receipt | `/api/factory/raw-stock/offload` first branch | Key stored in receipt path; no confirmed pre-insert lookup | Not retry-safe |
| Subsequent raw-stock receipt | Continuation receipt route | Company + container + supplied key, locked | Replay-safe with key; intentionally repeatable without it |
| Raw-stock adjustments/opening balances | Adjustment, receipt edit/delete, opening balance routes | Row/document state | Not retry-safe or state-guarded depending on operation |
| Raw-stock recalculation/replay/repair | Recalculate, historical replay, safety repair | Dry-run/confirmation/audit and convergence | Intentionally repeatable maintenance; not business-request replay |

### Factory production, bales, and payroll

| Write family | Examples | Current identity | Classification |
|---|---|---|---|
| Bale finalization | `POST /api/factory/finalize` | Bale ID canonical evidence | Effect replay-safe; duplicate call may return state conflict instead of replay |
| Factory stock entry/removal | Stock entry/removal routes | Entry journals in some paths; removal lacks uniform movement identity | Mixed; entry partially protected, removal not retry-safe |
| Factory payroll generation | `/api/factory/payroll/generate` | Company + period lock and existing-worker detection | State/period replay-safe; no caller response identity |
| Payroll mark-paid/fix-accounting | Single and bulk mark-paid, fix-accounting | Status/cash-account checks | Not retry-safe under concurrent or uncertain retry |
| ERP payroll payments/bonuses/deposits/withdrawals | Worker, bulk worker, bonus, deposit, withdrawal routes | Operational boundary on selected paths; direct legacy writers remain | Replay-safe only when boundary applies and key is supplied; legacy paths not retry-safe |
| Payroll run lifecycle | Run create/edit/delete/undo | Run ID and rebuild helper in some paths | State-guarded; undo/delete are corrections, not ordinary retries |
| Employee advances | Create, repay, bulk repay, cash adjustment | Advance/repayment row IDs; some outer boundary coverage | Not retry-safe for creation/repayment without durable operation identity |
| Payroll balance repair/backfill | Backfill, orphan repair, migration routes | Maintenance state/audit varies | Intentionally repeatable maintenance; no common request replay |

### Rentals, repairs, imports, and intercompany

| Write family | Examples | Current identity | Classification |
|---|---|---|---|
| Rental payment group creation | ERP, Properties, Factory rental payment routes | Random payment-group ID | Not retry-safe |
| Rental bulk payment | Bulk payment route | Per-item loop; no batch identity | Partial success is intentional, but whole-batch retry is not safe |
| Rental scheduled posting/accrual | Scheduled post, monthly run, accrual | Advisory group lock + infrastructure payment phases | Replay-safe for an existing group; caller operation identity is incomplete |
| Rental delete/cancellation | Payment and scheduled-group deletes | State/delete behavior | State-guarded, not append-only |
| Rental guarantee/lifecycle changes | Guarantee-to-statement/cash/rent, undo, contract end | Contract flags/state guards | State-guarded; corrections must remain separate from new payments |
| Credit-sales import | `/api/credit-sales-import/import` | No file/request identity | Not retry-safe |
| POS/stock-transfer imports | Import routes | Mixed downstream checks | Not retry-safe without an import identity |
| Balance repair apply/undo | Admin balance repair routes | Snapshot only; no operation identity/atomic wrapper | Not retry-safe; destructive correction |
| Reallocation/recalculation repairs | Payment reallocation, employee/raw-stock/bale recalculation | Convergence, locks, audit vary | Intentionally repeatable maintenance, but concurrency policy is incomplete |
| Simple company transfer | `/api/simple-company-transfer` | `clientRequestId` passed to both postings; voucher-link checks | Replay-safe with key; omission is not retry-safe |
| Intercompany transfer | `/api/inter-company-transfers` | Service transaction; route key coverage varies | Mixed; requires Phase 2 normalization |
| Fiscal stock transfer revisions | Transfer update/revision routes | Document state, no uniform request key | State-guarded, not request-replay-safe |
| Intercompany links/config/request actions | Link/config/approve/dismiss routes | No financial posting identity | Configuration/workflow state; use explicit state-transition identity in Phase 2 where it can trigger posting |

## 7. Corrections and intentional repeats

### Append-only corrections

These are separate business actions and must never reuse the original creation
identity:

- Exact voucher reversal.
- Simple company-transfer reversal.
- Supplier Partner sale reversal once converted to an append-only reversal.
- Payment/refund/credit-note corrections where the original remains intact.
- Inventory reversal with a stable source-reversal identity.

The reversal identity should include the original document ID and correction
kind. Reversing the same original twice is a replay or conflict, not a new
reversal.

### In-place corrections

Edits, deletes, undo operations, balance repairs, and rebuilds may be required
for legacy workflows, but they are not ordinary retries. They need a separate
operation identity and must include the target document/version in the
fingerprint. They must not reuse a create key.

### Intentionally repeatable operations

The following may be repeated only when the caller is creating a genuinely new
business event or running a documented maintenance operation:

- POS sale without a `clientSaleId`.
- Stock transfer or continuation receipt without a request key, where legacy
  repeatability is intentionally preserved.
- Recalculation, backfill, replay, reconciliation, and repair operations whose
  result is designed to converge.
- A new rental payment or payroll run for a new period/document.
- A new import file with a new file identity.

## 8. Phase 2 implementation backlog produced by this audit

Phase 2 should implement the shared durable boundary in this order:

1. Legacy voucher, payment, journal, credit-note, supplier-payment, factory-POS,
   Supplier Partner sale, and credit-sales-import creates.
2. Payroll mark-paid/fix-accounting, employee advances/repayments, and rental
   payment-group/bulk creation.
3. First raw-stock receipt, stock adjustments, stock imports, waste dispatch,
   PO creation/import, container offload, and transfer revisions.
4. Correction and delete operations, including repair apply/undo, with distinct
   operation identities and append-only treatment where accounting permits.
5. Batch identity, partial-success replay semantics, and header/body identity
   consistency across all bulk routes.

No route in the “not retry-safe” or “state-guarded” classifications should be
described as duplicate-protected until Phase 2 adds the durable boundary and
tests the uncertain-outcome case.

## 9. Audit evidence and limitations

The audit reviewed route registrations and their called accounting/inventory
services, including:

- `operationalVoucherRequestBoundary`
- `centralPostingEngine`
- `infrastructureVoucherIdentity`
- `stockDocumentIdempotency`
- POS sale identity handling
- Rental posting services
- Container offload and charge posting
- Payroll, advance, repair, import, and intercompany route families

This is a source-level route-family audit. It intentionally does not claim that
every branch inside a legacy route is safe merely because another branch at the
same URL is protected. Phase 2 must add runtime/concurrency tests for the
families marked mixed, state-guarded, or not retry-safe.
