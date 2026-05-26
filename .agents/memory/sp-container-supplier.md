---
name: SP Container Supplier Linking
description: How SP (supplier_partner) containers link to the suppliers table for balance tracking
---

## Rule
`sp_containers.supplier_id` (integer, nullable FK to `suppliers`) must be set, and the OTW voucher (`vouchers.supplier_id`) must also be set, for the container amount to appear in the supplier's balance ledger.

**Why:** `storage.getVoucherEntriesBySupplier(supplierId, companyId)` aggregates voucher entries filtered by voucher.supplier_id. Without it, the OTW journal posts to the books but is invisible in the supplier's statement.

**How to apply:**
- POST `/api/sp/containers`: accept `supplierId` in body, store on container row and on the voucher row.
- PATCH `/api/sp/containers/:id`: update container + voucher header + delete/re-insert voucher entries.
- AddContainerDialog SP form: supplier select (writes supplierId) auto-fills supplierName; user can also type supplierName directly for unlisted suppliers.
- `Containers.tsx`: when `isSupplierPartner`, fetches `/api/sp/containers` (not `/api/containers/active`) and renders a simplified list with same View button → `/containers/:id`.
- `ContainerDetailPage.tsx` → `SpContainerDetailView`: edit dialog calls PATCH and invalidates both the single-item and list queries.
