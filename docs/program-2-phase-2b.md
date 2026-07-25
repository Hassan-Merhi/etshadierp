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

Optional drafts, unidentified compatibility callers, edits, and deletions continue through the existing handlers.

## Preserved debit and credit behavior

The central builder reproduces the existing direction rules:

| Voucher | Payment account classification | Debit | Credit |
|---|---|---|---|
| Payment | cash/bank/ledger/customer/fixed asset | contra account | payment account |
| Payment | supplier/factory supplier/employee | payment account | contra account |
| Receipt | cash/bank/ledger/customer/fixed asset | payment account | contra account |
| Receipt | supplier/factory supplier/employee | contra account | payment account |

Customer targets retain the linked-ledger representation. Selecting a customer stamps its linked ledger when present; selecting a customer-linked ledger also stamps the customer. The central ownership adapter verifies the pair belongs to the active company and rejects mismatches.

## Transaction boundary

For a new protected Payment/Receipt, one database transaction now owns:

- the voucher row;
- every balanced voucher-entry pair;
- company and account ownership validation;
- the idempotency marker;
- the central posting audit record; and
- employee balance, deposit, and withdrawal deltas.

A failure rolls back all of those writes. A replay returns the original voucher and does not apply employee deltas twice.

## Currency behavior

- Transaction amounts remain in the selected transaction currency.
- Historical base amounts remain in USD.
- Non-USD conversion uses the existing transaction-currency-per-USD convention.
- Aggregate and per-line conversion rounding is reconciled to six decimal places.
- The exact voucher-level exchange-rate value is included in the idempotency fingerprint.

## Compatibility effects

For a newly committed posting, the route preserves the existing best-effort behavior:

- factory daybook insertion;
- WhatsApp prompt evaluation;
- detailed voucher audit output;
- intercompany notification checks; and
- loan-account reallocation.

Those effects are skipped when the request is an idempotent replay.

## Client retry protection

The shared accounting request-identity boundary now covers active Payment/Receipt creation. The same payload keeps the same identity through an uncertain network result. A successful response or definite 4xx releases it; network and 5xx outcomes retain it for a safe retry.

## Focused coverage added

- asset-account Payment direction;
- liability-account Payment direction;
- asset-account Receipt direction;
- liability-account Receipt direction;
- customer and linked-ledger targets;
- non-USD exact debit/credit balance;
- stable idempotency across regenerated voucher numbers;
- invalid voucher-type rejection; and
- Payment/Receipt request-identity retention and optional passthrough.

## Intentionally unchanged

- Payment/Receipt editing;
- Payment/Receipt deletion;
- optional Payment/Receipt drafts;
- POS flows;
- stock transfers;
- containers;
- Supplier Partner;
- payroll;
- rentals;
- database schema; and
- historical records.

## Verification limitation

GitHub Actions has repeatedly failed before exposing executable steps or logs. A complete build, type-check, and database-backed test pass is therefore not claimed. Step 2B.2 must not migrate editing until exact old-entry reversal and new-entry application are kept in the same transaction. Deletion convergence must preserve the existing generic voucher cleanup logic and must not intercept non-Payment/Receipt vouchers.
