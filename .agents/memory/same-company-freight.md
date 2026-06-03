---
name: Same-company parent freight posting
description: When freightPaidBy='parent' and the PO company IS the parent company (or no interco config), freight must be embedded in the local PO voucher, not skipped.
---

## Rule
When `freightPaidBy='parent'` and `freightParentAccountId` is set, always check `isSameCompanyOrNoInterco = !parentCompanyId || po.companyId === parentCompanyId`.

- **Same-company**: embed freight directly in the PO voucher as DR freightParentAccountId. Structure: DR Purchases (supplierTotal) + DR freightParentAccountId (freight) + CR Supplier (grossTotal).
- **Interco (subsidiary)**: keep the existing structure — DR Purchases×2 + CR parentCreditAccountId. freightParentAccountId is NEVER in the child's voucher.

**Why:** The original code only called `syncIntercoParentVoucher` and restructured the voucher for the interco case. When `po.companyId === parentCompanyId`, the interco sync was guarded out entirely, leaving the freight account with no posting at all.

**How to apply:** Three call sites were fixed:
1. `charges PATCH` — `_isSameCompanyOrNoInterco` computed before the transaction, used in the voucher entry rebuild.
2. `sync-parent-voucher` endpoint — same-company now updates the local PO voucher instead of returning early.
3. `sync-all-vouchers` endpoint — `isSameCompanyPo` checked in both detection and repair branches.

The "Fix All PO & Parent JV Sync" button (Containers page, Developer only) runs sync-all and will bulk-fix all affected POs.
