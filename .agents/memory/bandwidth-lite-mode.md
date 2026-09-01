---
name: Bandwidth lite mode — bale history endpoints
description: How stock-entry-history and /api/factory/bales use ?lite=1 to cut payload size, and how the frontend fetches bale details on demand.
---

## Rule
Both bale-history endpoints support `?lite=1` for a slim initial payload. The frontend uses this for the default (condensed) view and fetches bale details on demand.

## stock-entry-history (`GET /api/factory/bales/stock-entry-history`)
- Without `?lite=1`: full response with `JSON_AGG` embedding per-bale rows (~600 KB/day).
- With `?lite=1`: summary-only query (no `JSON_AGG`); returns each group row with `bales: []`. Response is ~few KB.
- StockEntryHistory.tsx sends `?lite=1` when `viewMode === "condensed"` (the default).
- Detailed mode sends no `?lite=1` — full response, flat bale list works normally.

## /api/factory/bales (`GET /api/factory/bales`)
- Without `?lite=1`: full `db.select()` on factory_bales + full factoryBaleProducts + full factoryMixBatches + lastPrintedAt lookup.
- With `?lite=1`: slim product join (`id, name, articleCode`), slim mixBatch join (`id, batchCode, name`), skips lastPrintedAt lookup.
- BalesHistory.tsx always sends `?lite=1`.

## Frontend: on-demand bale loading (StockEntryHistory.tsx)
- `useLite = viewMode === "condensed"`.
- `expandedGroupBaleKeys`: memoized list of `gKey + "-bales"` strings that are in `expandedKeys`.
- `groupBaleQueries`: `useQueries` — one query per expanded group key, enabled only when `useLite && !!group`.
  - Each query hits stock-entry-history (without lite) filtered to that group's date+workerId+productId+locationId.
  - Returns `BaleDetail[]` from `rows.flatMap(g => g.bales)`.
  - `staleTime: 5 * 60 * 1000`.
- `getGroupBales(g)`: returns `g.bales` in detailed mode; in condensed mode returns lazy-loaded bales from `groupBaleQueries`.
- `isGroupBalesLoading(g)`: returns loading state from the per-group query.
- `fetchGroupsWithBales()`: async helper used by exportExcel, handlePrintMatrix, handleExportWorkerPDF — does a one-time full fetch (drops `?lite=1`) before building the export.

## Frontend: polling prevention (both pages)
- `staleTime: 60_000` — data stays fresh for 1 min; no refetch on re-mount.
- `refetchOnWindowFocus: false, refetchOnReconnect: false` — no refetch on tab focus or reconnect.
- `placeholderData: (prev) => prev` — shows previous data while refetching (no loading flash).
- StockEntryHistory.tsx also debounces the `search` input (400 ms) to prevent per-keystroke fetches.

**Why:** these two endpoints were being fetched 10–34× per 2 min due to missing staleTime and focus/reconnect options.
