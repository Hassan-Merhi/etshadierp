---
name: Golden Coast vouchers are immutable
description: Vouchers numbered GC- are posted by the accounting programme and may never be edited in place; every voucher write path must call voucherMutationBlockReason.
---

Every Golden Coast programme voucher number starts with `GC-` — the cutover
journal, POS sale and settlement pairs, special-location deductions, HADI
transfers, container offloads, Hassan Savings withdrawals, monthly closes, and
the reversals of any of them. None may be edited, voided or deleted in place.

Voucher write paths must call `voucherMutationBlockReason(voucher)` from
`server/lib/migratedVoucherGuard.ts` and surface the reason it returns, rather
than testing `isReadonlyMigratedVoucher` alone. The client mirror is
`isVoucherMutationBlocked` / `voucherLockLabel`, used by the daybook to disable
the action and show which lock applies.

**Why:** these vouchers are generated from an idempotency-tracked posting
request, and the Golden Coast routes cap new postings against balances they
contribute to. A hand edit corrupts the GC Sales Cash payable and leaves the
stored marker describing entries that no longer exist, so the next replay of the
same client request fails as inconsistent instead of returning the original
voucher. The migration guard had already been caught missing the optional-toggle
and voucher-entry routes, so the combined check exists to keep one question in
one place.

**How to apply:** correct a Golden Coast document by posting a balanced reversal
and re-posting through the originating workflow — that is how the POS edit path
already works. `server/lib/voucherMutationGuard.test.ts` asserts that no write
path consults the migration guard on its own.
