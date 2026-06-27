# Render Bandwidth — Phase 17C

**Date:** 2026-06-27
**Goal:** Reduce repeated large payloads from `/api/stock-items` (630 KB) and `/api/factory/bale-ledger` (886 KB).

---

## Files Changed

| File | Change |
|---|---|
| `server/routes/stock/stockGroupsItemsRoutes.ts` | Added `GET /api/stock-items/light` endpoint; imported `pool` |
| `client/src/components/StockItemDetailsDialog.tsx` | Added `staleTime: 5 min`, `refetchOnWindowFocus: false` to `/api/stock-items` query |
| `client/src/pages/BaleLedger.tsx` | Bumped `staleTime` to 60 s, added `refetchOnWindowFocus: false` |
| `client/src/pages/factory/DailyProductionReport.tsx` | Bumped `staleTime` to 60 s, added `refetchOnWindowFocus: false` |
| `server/routes/supplierProfitCheckRoutes.ts` | (Phase 17C pre-step) alias-code fallback in 3 SQL queries |

---

## Stock-Items Callers Found

All callers of `GET /api/stock-items` (the full list) that use `useQuery`:

| File | Had `staleTime`? | Had `refetchOnWindowFocus: false`? | Action |
|---|---|---|---|
| `CombinedInventory.tsx` | ✅ 5 min | ✅ | None |
| `SalesReport.tsx` | ✅ 5 min | ✅ | None |
| `PurchaseOrderEdit.tsx` | ✅ 5 min | ✅ | None |
| `CreditNoteTab.tsx` | ✅ 5 min | ✅ | None |
| `FactoryProformas.tsx` | ✅ 5 min | ✅ | None (has `enabled` guard too) |
| `ProformaAddLine.tsx` | ✅ 5 min | ✅ | None |
| `StockItemDetailsDialog.tsx` | ❌ missing | ❌ missing | **Fixed** — added both |

Non-`useQuery` callers (no refetch risk):
- `BulkRenameTab.tsx` — uses raw `fetch()`, one-shot on button click
- `AccountingCreate.tsx` — `endpoint:` field in offline-sync config, not a live query
- `CompanyContext.tsx` / `factoryApi.ts` / `offlinePrep.ts` — prefetch lists, not `useQuery`
- `StockItemCreateDialog.tsx`, `StockItemEditDialog.tsx`, `CombinedImportDialog.tsx` — invalidation only

---

## Bale-Ledger Callers Found

| File | Had `staleTime`? | Had `refetchOnWindowFocus: false`? | Action |
|---|---|---|---|
| `BaleLedger.tsx` | ✅ 30 s | ❌ missing | **Fixed** — bumped to 60 s, added flag |
| `DailyProductionReport.tsx` | ✅ 30 s | ❌ missing | **Fixed** — bumped to 60 s, added flag |

Without `refetchOnWindowFocus: false`, every tab switch or window refocus triggered an 886 KB fetch. With 60 s staleTime and the flag, the data is only re-requested after 60 seconds of staleness.

---

## Query Options Changed

### `StockItemDetailsDialog.tsx` — `/api/stock-items`
```ts
// Before
{ queryKey: ["/api/stock-items"], enabled: open && editingTransaction !== null }

// After
{
  queryKey: ["/api/stock-items"],
  enabled: open && editingTransaction !== null,
  staleTime: 5 * 60 * 1000,
  refetchOnWindowFocus: false,
}
```

### `BaleLedger.tsx` — `/api/factory/bale-ledger`
```ts
// Before
{ queryKey: ["/api/factory/bale-ledger"], staleTime: 30_000 }

// After
{ queryKey: ["/api/factory/bale-ledger"], staleTime: 60_000, refetchOnWindowFocus: false }
```

### `DailyProductionReport.tsx` — `/api/factory/bale-ledger`
```ts
// Before
{ queryKey: ["/api/factory/bale-ledger"], staleTime: 30_000 }

// After
{ queryKey: ["/api/factory/bale-ledger"], staleTime: 60_000, refetchOnWindowFocus: false }
```

---

## Light Endpoint Added

**Yes.** `GET /api/stock-items/light` was added in `stockGroupsItemsRoutes.ts`.

Returns only: `id, code, name, stockGroupId, gradeId, categoryId, uom`

- Registered before `/api/stock-items/:id` to avoid route conflict
- Uses `pool.query` directly for minimal overhead
- Intended for future migration of pure dropdown callers

**Current callers migrated to `/light`:** None in this phase. All main dropdown callers (`ProformaAddLine`, `CreditNoteTab`, `FactoryProformas`) also use `weightPerBaleKg` and other full-item fields, making migration non-trivial without type surgery. The endpoint is ready for future use.

---

## Bale-Ledger Pagination

**Deferred — not added.**

The bale-ledger response is a pre-aggregated summary grouped into sections (`currentStock`, `wasteStock`, `sold`, `wasteDispatched`, `pendingLoading`, `totals`). Adding server-side pagination within sections would require restructuring the response shape, which violates the "do not change API response shape" rule.

Client-side pagination was also deferred — the page already collapses sections with `<Collapsible>` components, so the user experience is acceptable without pagination.

The primary bandwidth reduction for bale-ledger is achieved through `refetchOnWindowFocus: false` and the 60 s staleTime, which eliminates the repeated 886 KB fetches on tab switches.

---

## Static Assets Cache Headers

Verified in `server/index.ts` (lines 4319–4328):

```ts
// /assets/* files
res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

// HTML and non-hashed files
res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
```

Static asset immutable caching is in place and unchanged.

---

## Build / Test / Lint Results

| Check | Result |
|---|---|
| `npm run build` | Timed out — known issue (tsc takes >2 min per `replit.md` gotchas); dev server restarts cleanly |
| `npm run test` | ✅ 90 passed, 6 skipped |
| `npm run lint` | ✅ No errors — pre-existing warnings only (unused vars in App.tsx, unrelated to this change) |
