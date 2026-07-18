---
name: /api/stock-items bandwidth fix
description: Root causes and fixes for 47×649 KB downloads of /api/stock-items in 5 minutes. All changes on branch fix/stock-items-bandwidth.
---

## The problem
`stockItemKeys.light(companyId)` previously returned `["/api/stock-items", companyId, "light"]`.
Because `getQueryFn` in `queryClient.ts` uses only `queryKey[0]` as the fetch URL, the "light"
discriminator was silently ignored and every "light" query fetched the full 649 KB endpoint.
Broad `invalidateQueries({ queryKey: ["/api/stock-items"] })` in mutations then refetched all of
these active "light" queries — triggering another full download each time.

## The fix (commit 0a533c2a on fix/stock-items-bandwidth)

### Rule to preserve
`stockItemKeys.light()` MUST return `["/api/stock-items/light", companyId]` — the first element
of every React Query key MUST be the real URL the shared query function will fetch.
Adding a discriminator after the URL does NOT change the fetch URL and is silently wrong.

### Key factory in queryKeys.ts
```ts
light: (companyId) => ["/api/stock-items/light", companyId] as const,
full:  (companyId) => ["/api/stock-items",        companyId] as const,
```

### Invalidation helpers (queryClient.ts)
`invalidateStockItemLight(companyId?)`, `invalidateStockItemPageQueries()`, `invalidateStockItems(companyId?)`.

After a stock-item mutation, call BOTH:
```ts
queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });       // management page
queryClient.invalidateQueries({ queryKey: ["/api/stock-items/light"] }); // selector dropdowns
```
The first does NOT hit light queries (different first element), so the management page gets its
649 KB refresh; the dropdowns get the 4 KB refresh.

### Callers that must use stockItemKeys.light
Any component that only needs id/code/name/uom for a dropdown or selector must use
`["/api/stock-items/light", companyId]`.  Full list converted: StockTransferOrder, CombinedInventory,
FactoryProformas, ProformaAddLine, SalesReport, PurchaseOrderEdit, StockItemDetail,
StockItemDetailsDialog, CreditNoteTab, DataToolsTab (both queries).

### Callers that correctly stay on the full endpoint
- `StockItems.tsx` paginated query `["/api/stock-items", { page, ... }]` — management page.
- `StockItems.tsx` export query `["/api/stock-items"]` with `enabled: false` — user-triggered only.

### offlinePrep.ts
ERP pack now fetches `/api/stock-items/light`.  Per-company single-flight lock added:
`isOfflinePrepInProgress(companyId)`, `getLastOfflinePrepTime(companyId)`.

### ExcelJS lazy load (StockItems.tsx)
`import { utils, writeFile } from "@/lib/excelHelper"` removed from top-level static imports.
Both export functions (`exportToExcel`, `exportSalesHistory`) now use:
`const { utils, writeFile } = await import("@/lib/excelHelper");`
so the 1.3 MB ExcelJS bundle is not part of the initial page bundle.

### Backend light endpoint
`GET /api/stock-items/light` now returns `barcode` and `active` in addition to
`id, code, name, stockGroupId, gradeId, categoryId, uom`.

## Tests
`tests/stock-items-bandwidth.test.ts` — 12 tests all passing.
Key assertion: `stockItemKeys.light(1)[0] === "/api/stock-items/light"` (not "/api/stock-items").
