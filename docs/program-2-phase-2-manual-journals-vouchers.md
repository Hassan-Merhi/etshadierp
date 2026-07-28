# Program 2 — Phase 2: Manual Journals and Generic Vouchers

Status: complete on current source.

## Goal

Protect manual journal and compatibility-safe generic voucher posting without changing accounting formulas, historical exchange rates, optional draft behavior, specialized deletion workflows, or unrelated voucher types.

## Manual journal creation

The protected `POST /api/vouchers/journal` route handles active journals before the legacy route.

It preserves:

- selected-company ownership;
- voucher and entry balance validation;
- transaction-owned idempotency and central audit records;
- effective date and historical currency metadata;
- customer linked-ledger validation;
- atomic employee balance effects;
- replay status returned to callers;
- replay-safe skipping of daybook, order-charge, WhatsApp, rich-audit, and other compatibility effects.

Optional journal drafts intentionally call `next()` and remain on the legacy route.

## Generic voucher creation

The protected `POST /api/vouchers/with-entries` route handles only the compatibility-safe subset accepted by `supportsCentralGenericVoucher`.

The centralized subset requires:

- an active non-optional voucher;
- a stable `clientRequestId`;
- USD transaction currency;
- at least two entries;
- amounts with no more than two decimal places;
- no caller-supplied advanced dual-currency fields.

Unsupported optional, non-USD, high-precision, advanced dual-currency, or unidentified payloads call `next()` and continue through the unchanged legacy path.

## Journal edit and deletion lifecycle

The protected lifecycle route handles only active Journal to active Journal edits and active Journal deletion.

Within one transaction it:

- validates company ownership and migrated-record protection;
- locks and reloads the current voucher state;
- reverses the exact original employee effects;
- replaces or reverses voucher entries;
- applies new employee effects for edits;
- prevents repeated deletion from reversing balances twice.

Optional transitions and all non-Journal deletion paths remain on their specialized compatibility handlers.

## Safety boundaries

- No optional-draft semantics changed.
- No POS sale, payroll, stock transfer, stock adjustment, container, Supplier Partner, property, or rental workflow was reinterpreted.
- No database schema or historical record changed.
- No compatibility side effect is repeated on an idempotent replay.
- No migrated read-only voucher becomes editable or deletable.

## Verification

Run:

```bash
node scripts/verify-program2-phase2-manual-vouchers.mjs
```

The verifier is static and fail-closed. It confirms route ordering, central posting usage, replay guards, transaction ownership, lifecycle boundaries, migrated-voucher protection, and focused evidence files.