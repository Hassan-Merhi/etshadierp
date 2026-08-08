# Program 2 — Phase 2B: Payments and Receipts

Started: 2026-07-25

Branch: `refactor/program-2-accounting-convergence`

## Step 2B.1 completed — protected active creation

The original Payment/Receipt creation route wrote the voucher and entries in a transaction, but then updated employee balances after the transaction. It also had no stable request identity, so an uncertain network retry could create a duplicate voucher and repeat daybook, notification, audit, WhatsApp, and loan-allocation effects.

The protected creation route is registered before the legacy route and handles only requests that are:

- `POST /api/vouchers/payment-receipt`;
- active (`optional !== true`);
- `Payment` or `Receipt`;
- carrying a non-empty `clientRequestId`;
- carrying at least one contra line.

Optional drafts and unidentified compatibility callers continue through the existing creation handler.

## Preserved debit and credit behavior

The central builder reproduces the existing direction rules:

| Voucher | Payment account classification | Debit | Credit |
|---|---|---|---|
| Payment | cash/bank/ledger/customer/fixed asset | contra account | payment account |
| Payment | supplier/factory supplier/employee | payment account | contra account |
| Receipt | cash/bank/ledger/customer/fixed asset | payment account | contra account |
| Receipt | supplier/factory supplier/employee | contra account | payment account |

For creation, customer targets retain the linked-ledger representation. Selecting a customer stamps its linked ledger when present; selecting a customer-linked ledger also stamps the customer. The central ownership adapter verifies the pair belongs to the active company and rejects mismatches.

## Creation transaction boundary

For a new protected Payment/Receipt, one database transaction owns:

- the voucher row;
- every balanced voucher-entry pair;
- company and account ownership validation;
- the idempotency marker;
- the central posting audit record; and
- employee balance, deposit, and withdrawal deltas.

A failure rolls back all of those writes. A replay returns the original voucher and does not apply employee deltas twice.

## Creation currency behavior

- Transaction amounts remain in the selected transaction currency.
- Historical base amounts remain in USD.
- Non-USD conversion uses the existing transaction-currency-per-USD convention.
- Aggregate and per-line conversion rounding is reconciled to six decimal places.
- The exact voucher-level exchange-rate value is included in the idempotency fingerprint.

## Creation compatibility effects

For a newly committed posting, the route preserves the existing best-effort behavior:

- factory daybook insertion;
- WhatsApp prompt evaluation;
- detailed voucher audit output;
- intercompany notification checks; and
- loan-account reallocation.

Those effects are skipped when the request is an idempotent replay.

## Client retry protection

The shared accounting request-identity boundary covers active Payment/Receipt creation. The same payload keeps the same identity through an uncertain network result. A successful response or definite 4xx releases it; network and 5xx outcomes retain it for a safe retry.

## Step 2B.2 completed — atomic active editing

A protected edit route is registered before the legacy Payment/Receipt editor. It handles only:

- an existing active `Payment` or `Receipt` voucher;
- a submitted active `Payment` or `Receipt` replacement;
- a voucher owned by the selected company; and
- a voucher that is not a read-only migrated record.

Optional-to-active, active-to-optional, optional-to-optional, and non-Payment/Receipt edits continue through the original handler.

For an active edit, one transaction now:

1. locks the voucher row;
2. rebuilds and validates the replacement posting;
3. validates every target against the active company;
4. loads the old entries;
5. reverses the old employee balance, deposit, and withdrawal effects;
6. replaces the voucher fields and all entries; and
7. applies the new employee effects.

Any failure rolls back the reversal, voucher update, entry replacement, and new employee effects together.

### Edit compatibility preserved

The legacy Payment/Receipt edit route represents each account as one target. It does not add a linked customer to a ledger or a linked ledger to a customer during replacement. The protected editor preserves that exact representation while performing ownership validation separately.

The legacy editor also uses submitted currency metadata to normalize replacement entries and calculate the historical base total, but does not rewrite the voucher-level `currency` or `exchangeRate` fields. The protected editor preserves that contract rather than silently changing stored voucher metadata.

After a successful edit, the existing WhatsApp prompt and detailed update-audit behavior remain present. The legacy edit route does not rewrite the factory daybook or rerun intercompany/loan side effects, so the protected editor does not introduce those new behaviors.

## Step 2B.3 completed — exact active deletion reversal

A protected Admin-only delete route now handles plain active `Payment` and `Receipt` vouchers before the generic deletion route.

For a supported deletion, one transaction now:

1. locks the voucher row;
2. returns replay status immediately when the voucher is already deleted;
3. loads the original voucher entries;
4. reverses employee balance, deposit, and withdrawal effects exactly once;
5. reverses and removes linked property-payment rows using the existing monthly-ledger rule;
6. preserves the existing intercompany cleanup order by deleting the transfer record before the counterpart voucher;
7. removes pending intercompany notification requests; and
8. soft-deletes the selected voucher.

The detailed deletion audit remains best-effort after the transaction. A repeated deletion does not reverse employee balances again.

### Specialized deletion boundaries preserved

The protected route intentionally calls the legacy deletion chain for:

- `Receipt` vouchers that contain sales items, because those are POS sales requiring inventory restoration;
- `SAL-*` payroll vouchers, because those require payroll-run and salary-advance reversal;
- optional Payment/Receipt vouchers;
- Journals, Sales, stock transfers, stock adjustments, notes, purchases, and every unrelated voucher type; and
- read-only migrated vouchers, which remain blocked.

The policy is checked before the transaction and again after the row lock so a compatibility-state change cannot partially execute the central deletion path.

## Focused coverage added

- asset-account Payment direction;
- liability-account Payment direction;
- asset-account Receipt direction;
- liability-account Receipt direction;
- customer and linked-ledger creation targets;
- customer-only legacy edit target support;
- non-USD exact debit/credit balance;
- stable idempotency across regenerated voucher numbers;
- invalid voucher-type rejection;
- Payment/Receipt request-identity retention and optional passthrough;
- plain Payment/Receipt deletion eligibility;
- POS Receipt deletion passthrough;
- payroll voucher deletion passthrough; and
- optional and unrelated voucher deletion passthrough.

## Intentionally unchanged

- optional Payment/Receipt lifecycle;
- POS inventory reversal logic;
- payroll-run and salary-advance reversal logic;
- stock transfers;
- containers;
- Supplier Partner;
- payroll posting;
- rental posting;
- database schema; and
- historical records.

## Verification limitation

GitHub Actions has repeatedly failed before exposing executable steps or logs. A complete build, type-check, and database-backed test pass is therefore not claimed.

Phase 2B is complete by implementation scope on the draft branch. Phase 2C must migrate POS and stock-transfer posting separately because those workflows own inventory effects in addition to accounting entries.
