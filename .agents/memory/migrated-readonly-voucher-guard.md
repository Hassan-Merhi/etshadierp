---
name: Migrated read-only voucher guard
description: All surfaces that can mutate a voucher or its entries must check isReadonlyMigratedVoucher, not just the primary edit/delete routes.
---
A voucher copied read-only by a migration tool (sourceModule === 'SP_MIGRATION_READONLY', or legacy 'MIG-' prefix)
must never be touched again. There is more than one route that can mutate a voucher:
- PATCH /api/vouchers/:id, PATCH /api/vouchers/:id/sales, PATCH /api/vouchers/:id/optional (void toggle)
- PUT /api/vouchers/:id/with-entries, PUT /api/vouchers/:id/sales (POS edit service)
- DELETE /api/vouchers/:id
- POST /api/voucher-entries, PATCH /api/voucher-entries/:id (entries can be added/edited independently of the voucher route)

**Why:** the first implementation pass only guarded the "obvious" edit/delete endpoints and missed the optional-toggle
and voucher-entry CRUD routes, which are independent write paths into the same underlying data — a code reviewer
caught this as a bypass of the stated read-only invariant.

**How to apply:** when adding a "this record must be immutable" invariant, grep for every route that writes to the
underlying table(s), not just the ones with "edit"/"update" in the name — companion tables (entries, line items) often
have their own independent mutation endpoints.
