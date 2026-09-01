---
name: Same-company parent freight posting
description: When freightPaidBy='parent' and the PO company IS the parent company OR no INTERCO-PARENT voucher exists, freight must be embedded in the local PO voucher, not skipped.
---

## Rule
When `freightPaidBy='parent'` and `freightParentAccountId` is set, the sync-parent-voucher endpoint has three paths:

1. **Same-company** (`isSameCompanySync = !parentCompanyId || po.companyId === parentCompanyId`):
   Apply local split immediately — DR Purchases (grossTotal), CR Supplier (grossTotal−freight), CR FreightAccount (freight).

2. **Subsidiary with INTERCO-PARENT voucher** (`!isSameCompanySync`, syncIntercoParentVoucher returns found:true):
   Sync the INTERCO-PARENT voucher in the parent company. The subsidiary's own local voucher was created correctly by the container import flow.

3. **Fallback — no INTERCO-PARENT exists** (`!isSameCompanySync`, syncIntercoParentVoucher returns found:false, but `poHasParentFreight && po.voucherId`):
   Apply the same local split as path #1 directly to the PO's purchase voucher. This handles companies like "Business OS" that are NOT the configured parentCompanyId but still have `freightPaidBy='parent'` POs with no interco relationship.

**Why:** Business OS POs have freightPaidBy='parent' + freightParentAccountId but Business OS is not the configured parentCompanyId. The old code fell through to syncIntercoParentVoucher, found nothing, and returned an error — leaving the voucher with the full amount credited to the supplier.

**How to apply:** Three call sites for the split logic:
1. `sync-parent-voucher` endpoint — paths 1 and 3 above (path 3 is the new fallback).
2. `sync-all-vouchers` endpoint — `isSameCompanyPo` branch handles same-company bulk repair.
3. `charges PATCH` — `_isSameCompanyOrNoInterco` computed before the transaction.

The fix is idempotent — re-running sync on an already-split voucher produces the same result.
