---
name: SP POS unification
description: Supplier Partner POS now shares the exact same UI as normal ERP POS; which backend endpoint is correct for SP sales and what to watch for when unifying stock-sourced UIs.
---

The old standalone `SpPOS` component (custom simplified UI) was removed; Supplier Partner companies now render the same shared `POS.tsx` UI as normal ERP POS, gated by `isSpCompany = selectedCompany?.companyType === "supplier_partner"`.

- `/api/sp/sales` is the correct/target backend endpoint for SP sale posting — it already implements the required voucher (Dr Bank/Cash / Cr Supplier Cash Payable only, no Sales/COGS/Stock/Cost-Clearing lines) with server-side FIFO lot consumption from `sp_stock_movements`.
- `/api/pos/sales`'s `isSpCompany` branch (Deduction Clearing accounting keyed off `supplierPartnerPayableDeductionPerQty`) is a **separate, unrelated feature** — don't conflate the two when doing SP POS work.
- SP stock must be grouped by `stockItemId`, not `articleCode`, when aggregating `/api/sp/stock` movements into inventory rows — two distinct stock items can share a display code, and merging by code would submit the wrong stockItemId at checkout. Any UI list rendering (`key=`, `data-testid=`) on that stock must also use `stockItemId` as the identity, not `code`, for the same reason.
- When a shared UI is bolted onto a company-type flag, any *other* effect that also sets the same state (e.g. a "default cash account for POS users" effect) must be explicitly guarded against the new flag too — state-setting effects can race/override each other silently.
- When normalizing one endpoint's response shape to match another so shared downstream components (print/invoice templates) keep working, check exactly which field names those components read (e.g. `item.rateUSD || item.rate`, not `sellingPrice`) — mismatched normalization fields silently produce `NaN` rather than throwing.
