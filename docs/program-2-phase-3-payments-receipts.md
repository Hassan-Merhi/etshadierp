# Program 2 — Phase 3: Payments and Receipts

Status: complete.

## Scope

Phase 3 protects active Payment and Receipt creation, active-to-active editing, and supported deletion while preserving the original ERP direction rules, historical currency behavior, linked-customer representation, employee balances, Factory daybook behavior, intercompany cleanup, property-payment cleanup, and specialized POS/payroll deletion paths.

## Protected creation

`POST /api/vouchers/payment-receipt` uses the central path only when the voucher is active, is a Payment or Receipt, includes a stable `clientRequestId`, and contains at least one contra line. Optional or unidentified requests continue to the unchanged legacy route.

One transaction owns target resolution, company ownership checks, balanced entries, voucher persistence, idempotency, central audit, and employee balance/deposit/withdrawal effects. Replays return the existing voucher and skip compatibility effects.

The original debit/credit direction is preserved for asset-like and liability-like payment accounts. Customer selections preserve the linked-ledger representation during creation. Historical base amounts remain USD, transaction amounts remain in the selected currency, and conversion rounding is reconciled without changing stored history.

## Protected editing

Only active Payment/Receipt to active Payment/Receipt edits use the protected editor. The voucher row is locked, ownership is validated, old employee effects are reversed, entries are replaced, and new employee effects are applied in one transaction.

The edit path intentionally preserves the original single-target representation and does not denormalize customer/ledger pairs. Submitted currency metadata rebuilds historical entry amounts, while voucher-level currency and exchange-rate fields are not silently rewritten.

Optional transitions, non-Payment/Receipt edits, cross-company vouchers, deleted vouchers, and read-only migrated vouchers remain blocked or continue through their existing compatibility path.

## Protected deletion

Plain active Payment and Receipt vouchers use the protected Admin-only deletion path. The policy is checked before and after the voucher row lock.

One transaction reverses employee effects exactly once, reverses linked property-payment rows using the existing monthly-ledger rule, removes intercompany transfer state in the existing order, removes pending payment requests, and soft-deletes the voucher. A repeated delete returns replay status and does not reverse balances again.

The following remain on specialized legacy deletion paths:

- Receipt vouchers with sales items, because POS inventory must be restored;
- `SAL-*` payroll vouchers, because payroll-run and salary-advance state must be reversed;
- optional Payment/Receipt vouchers;
- Journals, Sales, stock transfers, stock adjustments, purchases, notes, and unrelated voucher types.

## Replay-safe compatibility effects

For newly committed creation only, the existing Factory daybook, WhatsApp, detailed audit, intercompany notification, and loan-account allocation effects are preserved. They are skipped on replay.

## Safety boundary

No database schema, historical record, accounting formula, inventory quantity, POS stock rule, payroll rule, property formula, or optional-draft behavior changed in this Phase 3 completion slice.

## Verification

Run:

```bash
node scripts/verify-program2-phase3-payments-receipts.mjs
```

The verifier is a fail-closed source contract. It does not replace TypeScript, database-backed tests, build, deployment, or production smoke verification.