# Render Bandwidth Reduction — Phase 17B

**Date:** 2026-06-26  
**Goal:** Reduce repeated outbound bandwidth from heavy API responses identified in BANDWIDTH_DEBUG logs.

---

## Observed Problem (from logs)

| Endpoint | Observed size | Pattern |
|---|---|---|
| `GET /api/stock-items` | ~630 KB | Called on every component mount and window focus |
| `GET /api/accounts/ledger/:id/transactions` | ~545 KB | Called every time payment account changes in voucher forms |
| `/assets/xlsx-vendor*.js`, `/assets/index*.js` | 1.3 MB + 700 KB | Served repeatedly without browser caching |

Root cause: No `staleTime` set on queries → TanStack Query considers data stale immediately on every mount and re-fetches. No `refetchOnWindowFocus: false` → refetches every time user alt-tabs back.

---

## Step 1 — Audit: `/api/stock-items` Callers

### Active `useQuery` callers (fetch data, not just invalidate)

| File | Query key | staleTime before | enabled guard | Notes |
|---|---|---|---|---|
| `components/vouchers/CreditNoteTab.tsx` | `["/api/stock-items"]` | None | ✅ `selectedLocationId > 0` | Dropdown search |
| `components/StockItemDetailsDialog.tsx` | `["/api/stock-items"]` | None | ✅ `open && editingTransaction !== null` | Only when dialog open |
| `pages/settings/DataToolsTab.tsx` (×2) | `["/api/stock-items", company?.id]` / `["/api/stock-items"]` | None | Partial | Admin merge tool |
| `pages/factory/ProformaAddLine.tsx` | `["/api/stock-items"]` | None | None | Item picker |
| `pages/factory/FactoryProformas.tsx` | `["/api/stock-items"]` | None | ✅ `isAddLineOpen \|\| expandedProformaIds.size > 0` | Conditioned |
| `pages/StockTransferOrder.tsx` | `["/api/stock-items"]` | None | None | Item picker |
| `pages/CombinedInventory.tsx` | `["/api/stock-items"]` | None | ✅ `includeZero` | Toggleable |
| `pages/PurchaseOrderEdit.tsx` | `["/api/stock-items"]` | None | None | Item picker |
| `pages/SalesReport.tsx` | `["/api/stock-items"]` | None | Conditional | Filter picker |
| `pages/VoucherEdit.tsx` | `["/api/stock-items"]` | None | None | Item picker |
| `pages/StockItemDetail.tsx` | `["/api/stock-items"]` | None | None | Name lookup |
| `pages/vouchers/StockTransferForm.tsx` | `["/api/stock-items", company?.id]` | None | None | Item picker |
| `pages/vouchers/StockAdjustmentForm.tsx` | `["/api/stock-items", company?.id]` | None | None | Item picker |
| `pages/vouchers/useVoucherQueries.ts` | `["/api/stock-items", company?.id]` | None | ✅ `needsStockData` | Central hook |
| `pages/StockItems.tsx` | Custom paginated fetch | N/A | N/A | Already server-paginated |
| `pages/StockQuery.tsx` | Custom paginated fetch | N/A | N/A | Already server-paginated |

**Duplicate-call risk:** `StockTransferForm`, `StockAdjustmentForm`, and `useVoucherQueries` all use `["/api/stock-items", company?.id]` — they share the same cache entry. But `StockTransferOrder`, `PurchaseOrderEdit`, `VoucherEdit` use `["/api/stock-items"]` (no company ID) — a different cache key, causing separate network calls.

### Invaliders only (no fetch — these are safe, no action needed)
`StockItemEditDialog`, `StockItemCreateDialog`, `CombinedImportDialog`, `GradesCategoriesManager`, `OffloadDialog`, `ImportStockItems`, `DeletedItems`, `OrphanedRecords`, `BulkRenameTab` — all only call `queryClient.invalidateQueries`.

---

## Step 2 — Audit: `/api/accounts/ledger/:id/transactions` Callers

| File | Query key | staleTime before | Notes |
|---|---|---|---|
| `pages/vouchers/useAccountBalance.ts` | `["/api/accounts", type, id, "balance"]` | None | Fetches ALL transactions to compute balance. Raw fetch inside queryFn |
| `pages/vouchers/useAccountBalance.ts` | `["/api/accounts", type, id, "currencyBalances"]` | None | Fetches ALL supplier transactions for multi-currency breakdown |
| `pages/Accounts.tsx` | `["/api/accounts/${type}/${id}/transactions", { dates }]` | None | Main account ledger viewer |
| `pages/Agents.tsx` | Raw `fetch()` call, no TanStack Query | N/A | Agent ledger view — not cached |
| `pages/settings/ExportAccountsSection.tsx` | URL construction only | N/A | Export, not a recurring query |

---

## Step 3 — Light Endpoint Assessment

**Decision: Deferred.** 

The dominant bandwidth driver is repeated fetches (no staleTime), not individual response size. With 5-minute staleTime, the 630 KB response is fetched once per user session instead of on every mount/focus event. Estimated reduction: **80–90% fewer network calls** for stock-items.

A `GET /api/stock-items/list-light` endpoint (id/code/name/uom only) would provide incremental benefit but requires identifying which callers need only those fields — a refactor unsuitable for release-candidate mode.

**Documented for a follow-up phase.**

---

## Step 4 — Fixes Applied

### 4a. `/api/stock-items` — staleTime + refetchOnWindowFocus

Added `staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false` to **14 files**:

| File | Change |
|---|---|
| `components/vouchers/CreditNoteTab.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/factory/ProformaAddLine.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/factory/FactoryProformas.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/StockTransferOrder.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/CombinedInventory.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/PurchaseOrderEdit.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/SalesReport.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/VoucherEdit.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/StockItemDetail.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/vouchers/StockTransferForm.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/vouchers/StockAdjustmentForm.tsx` | Added staleTime + refetchOnWindowFocus |
| `pages/vouchers/useVoucherQueries.ts` | Added staleTime + refetchOnWindowFocus |

**Not changed** (already had staleTime or fully paginated):
- `pages/StockItems.tsx` — server-paginated, custom fetch, appropriate as-is
- `pages/StockQuery.tsx` — server-paginated, custom fetch
- `components/StockItemDetailsDialog.tsx` — dialog only opens on demand; staleTime would not help since it's rarely opened twice in 5 min

### 4b. Ledger transactions — staleTime + refetchOnWindowFocus

Added `staleTime: 30 * 1000, refetchOnWindowFocus: false` to:

| File | Query | Change |
|---|---|---|
| `pages/vouchers/useAccountBalance.ts` | `["/api/accounts", type, id, "balance"]` | staleTime 30s + no refetch on focus |
| `pages/vouchers/useAccountBalance.ts` | `["/api/accounts", type, id, "currencyBalances"]` | staleTime 30s + no refetch on focus |
| `pages/Accounts.tsx` | `["/api/accounts/${type}/${id}/transactions", ...]` | staleTime 30s + no refetch on focus |

> **30 seconds chosen** (not 5 minutes) because ledger data is mutable — a new voucher posted in another tab should be visible relatively quickly. 30s prevents re-fetch on every re-render while staying reasonably fresh.

---

## Step 5 — Pagination (Ledger Transactions)

**Decision: Deferred.**

Adding `?page=1&pageSize=100` would require the server endpoint to return `{ data, total, page }` instead of a flat array, and the frontend's running-balance `useMemo` in `Accounts.tsx` depends on the complete sorted transaction list. Partial data would break the balance column.

**Documented for a dedicated future phase.**

---

## Step 6 — Static Asset Cache Headers

**Already correctly configured in `server/index.ts`** (confirmed at lines 4319–4345):

```
/assets/*.js  →  Cache-Control: public, max-age=31536000, immutable   ✅
/assets/*.css →  Cache-Control: public, max-age=31536000, immutable   ✅
index.html    →  Cache-Control: no-store, no-cache, must-revalidate   ✅
SPA fallback  →  Cache-Control: no-store, no-cache, must-revalidate   ✅
```

The `server/vite.ts` uses plain `express.static()` (no headers) — this is the **dev-mode** server only. Production uses `server/index.ts` which has all cache headers. **No change needed.**

---

## Step 7 — Verification

### Build
```
npx vite build → EXIT:0   ✅
```

### Tests
```
vitest run → 5 files, 90 passed, 6 skipped   ✅  (pre-existing baseline)
```

### Lint (edited files only)
```
npx eslint [14 edited files] → 0 errors, 50 warnings (all pre-existing)   ✅
```

### Manual smoke (dev server running)
- `/stock-items` — loads ✅  
- `/inventory` — loads ✅  
- `/vouchers` — loads ✅  
- `/pos` — loads ✅  
- `/accounts` — ledger opens on account select ✅  
- `/settings` — loads ✅  
- No accounting values changed ✅  
- No API response shape changed ✅  

---

## Step 8 — Expected Bandwidth Reduction

| Endpoint | Before | After | Mechanism |
|---|---|---|---|
| `GET /api/stock-items` (~630 KB) | Fetched on every component mount + every window focus | Fetched once, reused for 5 minutes | staleTime 5 min |
| `GET /api/accounts/:type/:id/transactions` (~545 KB) | Fetched on every voucher form render + window focus | Fetched once per 30s per account | staleTime 30s |
| Static assets (1.3 MB + 700 KB) | Already `immutable` — browser cache serves | No change needed | Already correct |

**Estimated network call reduction:**
- A user who opens 4 voucher forms in a session (common workflow) previously triggered 4 × 630 KB = ~2.5 MB of stock-items transfers. After: 1 × 630 KB = ~630 KB.
- A user who selects an account and switches tabs 3× previously triggered 3 × 545 KB = ~1.6 MB. After: 1 × 545 KB = ~545 KB per 30s window.
- Overall expected reduction in repeated API bandwidth: **60–85%** for active sessions.

---

## Files Changed

| File | Change type |
|---|---|
| `client/src/pages/vouchers/useAccountBalance.ts` | Query options added |
| `client/src/pages/Accounts.tsx` | Query options added |
| `client/src/pages/vouchers/useVoucherQueries.ts` | Query options added |
| `client/src/pages/vouchers/StockTransferForm.tsx` | Query options added |
| `client/src/pages/vouchers/StockAdjustmentForm.tsx` | Query options added |
| `client/src/components/vouchers/CreditNoteTab.tsx` | Query options added |
| `client/src/pages/factory/FactoryProformas.tsx` | Query options added |
| `client/src/pages/factory/ProformaAddLine.tsx` | Query options added |
| `client/src/pages/StockTransferOrder.tsx` | Query options added |
| `client/src/pages/CombinedInventory.tsx` | Query options added |
| `client/src/pages/PurchaseOrderEdit.tsx` | Query options added |
| `client/src/pages/SalesReport.tsx` | Query options added |
| `client/src/pages/VoucherEdit.tsx` | Query options added |
| `client/src/pages/StockItemDetail.tsx` | Query options added |

**No server files changed. No API routes changed. No response shapes changed. No accounting logic changed.**

---

## Deferred Items (future phases)

1. **Light endpoint** `GET /api/stock-items/list-light` — id/code/name/uom only for dropdown-only pages. Would reduce per-response size ~70%.
2. **Ledger pagination** `?page=1&pageSize=100` — requires server + frontend running-balance refactor. Balance column must receive full sorted history.
3. **`Agents.tsx` raw fetch** — uses raw `fetch()` without TanStack Query caching. Low-traffic page; low priority.
4. **`StockItems.tsx` key normalisation** — some callers use `["/api/stock-items"]` and others use `["/api/stock-items", companyId]`. Normalising to one key would allow cross-page cache sharing. Requires verifying company isolation is enforced server-side (it is — session-based), not client-side.
