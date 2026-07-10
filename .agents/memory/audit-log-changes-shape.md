---
name: Audit log changes shape and suppliers.companyId schema gap
description: Recurring TS/schema patterns hit repeatedly across route files during audit-log and supplier/customer query work.
---

## Audit log `changes` shape requires `{ old, new }`
The audit-log helper's `changes` field type requires each key to be `{ old, new }`, not a bare
value. Many older call sites wrote `changes: { status: "approved" }` etc. When only one side is
meaningful (e.g. a create action with no prior value), use `{ old: null, new: value }` (or vice
versa for deletes) rather than inventing a fake "old" value — this preserves what's actually being
logged while satisfying the type.

**Why:** seen recurring across ~8 files (bankAssetRoutes, customerRoutes, supplierRoutes,
locationCrudRoutes, approvalRoutes, creditNoteRoutes, etc.) — a real widespread inconsistency, not
a one-off typo.

## `suppliers` table has no `companyId` column
Several routes filtered supplier queries by `companyId` as if suppliers were company-scoped; the
column doesn't exist in the schema. Suppliers appear to be intentionally global. The correct fix
is to remove the invalid filter (derive company scoping elsewhere if truly needed), not to add the
column speculatively.

**Why:** hit in chatbotRoutes.ts, aiTools.ts, aiImportRoutes.ts, accountRoutes.ts — a real,
consistent schema fact, not per-file bugs.

## `customers` table has `legalName`, not `name`/`email`/`address`
Code that references `customers.name`, `customers.email`, or `customers.address` will fail to
compile — those fields don't exist on the schema. Use `customers.legalName` for the display name;
there is no email/address column on this table in the current schema.

**How to apply:** when fixing TS errors touching customer queries or audit logs, check the actual
schema columns first rather than assuming a conventional shape.

## Known unresolved gap: vouchers has no creator/userId column
`server/routes/reportsRoutes.ts` (~line 2094) has a POS access-control check
(`voucher.userId !== req.user.id`) referencing a column that doesn't exist on `vouchers` — this
specific restriction is currently a silent no-op. Left unfixed deliberately since it's
security-sensitive POS-flow logic requiring a real product decision, not a type-only fix.
