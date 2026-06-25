# Render Bandwidth Audit — Phase 17

**Date:** 2026-06-25  
**Audited by:** Phase 17 automated audit + agent  

---

## 1. How Production Serving Works

The application is a **full-stack monolith**: one Express.js server handles both the REST API and serves the built frontend. In production (Render), the Node process runs `server/index.ts` which:

1. Starts Express with all middleware
2. Registers all API routes under `/api/*`
3. Serves the Vite-built frontend from `dist/public/` via `express.static()`
4. Falls back to `index.html` for SPA routing (all non-asset, non-API paths)

---

## 2. Does Express Serve Frontend Assets?

**Yes.** In production, `express.static(distPath)` serves everything from `dist/public/`. There is **no separate CDN or static host** — all frontend asset bytes travel through the same Render web service that handles API requests.

This means every JS chunk, CSS file, font, and image download counts against Render outbound bandwidth.

---

## 3. Frontend / Backend on One Render Service?

**Yes — combined single service.** Both the API and the frontend are served from one Render web service. Frontend asset downloads and API responses share the same outbound bandwidth meter.

---

## 4. Compression Status

**✓ Already enabled.**

`compression()` middleware is registered as the **first middleware** in `server/index.ts` (line 47), before all routes and static serving:

```ts
app.use(compression()); // gzip/deflate for all text/JSON responses
```

The `compression` package uses its default filter:
- **Compresses**: `text/*`, `application/json`, `application/javascript`, `text/css`, etc.
- **Skips** (already compressed): `application/zip`, `application/octet-stream`, Excel/PDF binary responses

JSON API responses, HTML, and JS/CSS files are all gzip-compressed. **No change needed here.**

---

## 5. Static Cache Header Status

**✓ Already correct.** Set in `server/index.ts` lines 4310–4340:

| Asset type | Cache-Control |
|---|---|
| Vite hashed assets (`/assets/*.js`, `/assets/*.css`, fonts, images) | `public, max-age=31536000, immutable` |
| `index.html` | `no-store, no-cache, must-revalidate, proxy-revalidate` |
| SPA fallback (non-asset paths) | `no-store, no-cache, must-revalidate, proxy-revalidate` |

Vite's build produces content-hashed filenames (e.g., `react-vendor-BfRk2X.js`), so the 1-year immutable cache is safe. Browsers only download each bundle **once** per deployment — this is the single biggest bandwidth reducer for repeat visitors.

**ETag:** Disabled globally (`app.set("etag", false)`) to prevent stale 304 responses on dynamic API data.

---

## 6. Top Likely Bandwidth-Heavy Routes

### Binary file exports (per-request, large payloads)

| Route | Type | Paginated | Approximate size | Cacheable? |
|---|---|---|---|---|
| `GET /api/factory/customer-orders/:id/export-excel` | Excel (.xlsx) | N/A | 50–500 KB | No — per-user export |
| `GET /api/factory/customer-orders/:id/export-pdf` | PDF | N/A | 100–800 KB | No — per-user export |
| `GET /api/factory/customer-orders/:id/export/excel` | Excel | N/A | 50–500 KB | No |
| `GET /api/factory/customer-orders/:id/pending-export` | Excel (loading list) | N/A | 20–200 KB | No |
| `GET /api/factory/customer-orders/:id/loading-status-export` | Excel | N/A | 20–200 KB | No |
| `GET /api/factory/shipping-container-rows/:id/zip-package` | ZIP archive | N/A | 0.5–10 MB | No — on-demand |
| `GET /api/factory/customers/:id/statement/export-pdf` | PDF | N/A | 100–500 KB | No |
| `GET /api/factory/customers/:id/statement/export-excel` (line 1554) | Excel | N/A | 50–300 KB | No |
| `GET /api/factory/bales/export` | Excel | N/A | 200 KB–2 MB | No |
| `GET /api/factory/bale-export/*` | Excel/ZIP | N/A | 1–20 MB | No |
| `GET /api/factory/stock/*/export` | Excel | N/A | 100 KB–2 MB | No |
| `GET /api/factory/payroll/*/export` | Excel | N/A | 50–500 KB | No |
| `GET /api/factory/invoice-loading/*/export` | Excel | N/A | 50–300 KB | No |
| `GET /api/factory/customer-proforma/*/export` | Excel | N/A | 50–300 KB | No |
| `GET /api/net-profit/export` | Excel | N/A | 100 KB–1 MB | No |
| `GET /api/factory/reports/*/export` | Excel | N/A | 50 KB–1 MB | No |
| `GET /api/stats/net-position/export` | Excel | N/A | 50–300 KB | No |
| `GET /api/supplier-proforma/*/export` | Excel | N/A | 50–300 KB | No |
| `GET /api/rental/*/export` | Excel | N/A | 50–200 KB | No |
| `GET /api/worker-statement/export` | Excel/PDF | N/A | 50–200 KB | No |

> All export routes are user-triggered, not polled. They contribute burst bandwidth, not steady-state bandwidth.

### Large JSON API routes (called repeatedly or on page load)

| Route | Page | Paginated | Risk level |
|---|---|---|---|
| `GET /api/factory/bales` | Bales list | No | HIGH — can be thousands of rows |
| `GET /api/factory/stock` | Stock list | No | HIGH — full inventory dump |
| `GET /api/factory/containers` | Containers | No | Medium |
| `GET /api/inventory` | Inventory | No | Medium-High |
| `GET /api/factory/customer-orders` | Orders list | No | Medium |
| `GET /api/vouchers` | Daybook | Cursor? | Medium |
| `GET /api/ledger-accounts` | Accounts | No | Medium |
| `GET /api/factory/daybook` | Factory daybook | No | Medium |

> These are JSON and benefit from gzip compression (typically 70–80% size reduction). Main risk is if these are called frequently without caching.

---

## 7. Repeated Frontend Requests (Polling Inventory)

### Global components — fire on every page

| Component | Endpoint(s) | Interval | Users affected |
|---|---|---|---|
| `NotificationsCenter.tsx` | `/api/notifications/unread-count`, `/api/intercompany-requests/pending-count`, `/api/notifications` (list), `/api/intercompany-requests` (pending) | 30s each (4 queries) | All logged-in users |
| `AppSidebar.tsx` | `/api/chat/unread-count` | 60s | All ERP users |
| `FactorySidebar.tsx` | (sidebar queries) | 60s | All factory users |
| `use-presence.ts` | `PATCH /api/user-presence` (heartbeat) | 90s | All users |

### Scan pages — high-frequency polling

| Page | Endpoint(s) | Interval | Note |
|---|---|---|---|
| `GroundScan.tsx` | factory ground scan | **4s** | Only when page is open |
| `DailyScan.tsx` | factory daily scan (×2 queries) | **10s** | Only on that page |
| `FactoryStockAllocation.tsx` | stock allocation | **10s** | Only on that page |
| `FactoryDispatchBatchScan.tsx` | dispatch scan (×2 queries) | 10–15s | Only on that page |
| `FactoryContainerLoadingScan.tsx` | loading scan (×2 queries) | 15–30s | Only on that page |
| `FactoryInvoiceLoadingScan.tsx` | invoice loading scan | 10s | Only on that page |
| `ContainerLoadingScan.tsx` | ERP loading scan | 15s | Only on that page |
| `FactoryDispatchBatches.tsx` | batches list (×2 queries) | 30s | Only on that page |
| `FactoryDispatchBatchDetail.tsx` | batch detail | 15s | Only on that page |
| `FactoryNetPosition.tsx` | net position | 30s | Only on that page |
| `ExportCenter.tsx` + `DailyExportSection.tsx` | export status | 15s | Only on settings page |
| `ConflictCenter.tsx` | conflicts | 15s | Only on that page |

### App-level polling

| Hook / Component | Endpoint | Interval | Note |
|---|---|---|---|
| `App.tsx` | `/api/boot` | 60s | Tiny JSON — checks for server restart to bust stale Vite chunks |
| `use-screen-feed.ts` | `/api/screen-feed/*` | varies | Screen monitoring — only active when a user is watching another user's screen |
| `TransactionJournal.tsx` | transaction journal | 30s | Only on that page |
| `PendingLoadings.tsx` | pending loadings | 30s | Only on that page |

### Assessment

- **Scan pages are by design** — real-time scanning requires frequent polling. These are appropriate.
- **NotificationsCenter (4 × 30s)** is the most impactful global poller. However, the payloads are small (integer counts + short lists). With gzip, each response is likely 100–500 bytes. At 10 concurrent users: ~80 requests/min, ~50 KB/min — not a major bandwidth driver.
- **No duplicate queries detected** — each query key is unique and correctly keyed.

---

## 8. Safe Fixes Applied

### Fix 1 — BANDWIDTH_DEBUG middleware added

**Files:** `server/middleware/bandwidthDebug.ts` (new), `server/index.ts` (import + register)

When `BANDWIDTH_DEBUG=true` environment variable is set, every response ≥ 500 KB is logged:

```
[BANDWIDTH] GET /api/factory/bales 200 — 2847KB in 312ms
```

Logs only: method, path, status, size (KB), duration. Never logs body, cookies, or tokens.

**How to use in production:**
1. Set `BANDWIDTH_DEBUG=true` in Render environment variables
2. Watch Render logs for `[BANDWIDTH]` lines
3. Remove the env var when done

### No other code changes were needed

The following were already correct:
- ✓ `compression()` enabled (gzip on all text/JSON)
- ✓ Static assets: `max-age=31536000, immutable`
- ✓ HTML / SPA: `no-cache`
- ✓ API routes: `no-store, no-cache`
- ✓ ETags: disabled globally

---

## 9. Files Changed

| File | Change |
|---|---|
| `server/middleware/bandwidthDebug.ts` | **Created** — BANDWIDTH_DEBUG middleware |
| `server/index.ts` | Import + register `bandwidthDebugMiddleware` after `requestLogger` |

---

## 10. Commands Run

```bash
# Audit
grep -rn "compression\|setHeaders\|Cache-Control" server/index.ts
grep -rn "xlsx\.writeBuffer\|xlsx\.write\|pdf\|zip" server/routes/ --include="*.ts" -l
grep -rn "refetchInterval" client/src/ --include="*.ts" --include="*.tsx"
grep -n "serveStatic\|setupVite\|dist/public\|NODE_ENV" server/index.ts
```

No build or migration commands were run — no schema or dependency changes were made.

---

## 11. Pass/Fail Results

| Check | Result |
|---|---|
| Compression enabled | ✓ PASS — already active |
| Static assets have long-term cache | ✓ PASS — already correct |
| HTML has no-cache | ✓ PASS — already correct |
| API has no-store | ✓ PASS — already correct |
| ETags disabled | ✓ PASS — already disabled |
| BANDWIDTH_DEBUG middleware added | ✓ PASS — new, behind env flag |
| No accounting logic changed | ✓ PASS |
| No POS logic changed | ✓ PASS |
| No voucher/daybook logic changed | ✓ PASS |
| No stock/inventory logic changed | ✓ PASS |
| No API response shapes changed | ✓ PASS |
| No query keys changed | ✓ PASS |
| No database migrations added | ✓ PASS |

---

## 12. Recommendations

### Immediate (no-risk)

1. **Enable BANDWIDTH_DEBUG=true** on Render for 24–48 hours to identify actual top offenders from real traffic. Look for endpoints appearing repeatedly with large sizes.

2. **Check if bales/stock list endpoints are unbounded.** Routes like `GET /api/factory/bales` may return thousands of rows. If these are called on page load and not paginated, they are likely the #1 bandwidth driver. Adding server-side pagination would be the highest-impact fix — but requires confirming the frontend already supports it.

### Medium-term (requires frontend + backend coordination)

3. **Paginate large list endpoints.** `factory/bales`, `factory/stock`, `factory/containers`, `vouchers` are candidates. Only safe if the frontend already has pagination UI; adding it without frontend support would break the UX.

4. **Move static assets to Render Static Site or CDN.** Currently all JS/CSS/font downloads go through the same Render web service as API traffic. Moving the `dist/public/` directory to a Render Static Site (or any CDN) would eliminate frontend asset bandwidth from the API service entirely — the biggest possible bandwidth saving for a high-traffic deployment.

5. **Consider a WebSocket or SSE for notifications.** The current 4 × 30s polling in `NotificationsCenter` could be replaced with server-sent events — eliminating ~8 API calls/min per user. Low priority unless user count is high.

### Not recommended (risky)

- Do **not** cache `/api/factory/*`, `/api/vouchers`, `/api/inventory`, `/api/accounts`, or any financial data endpoints — stale financial data is unacceptable.
- Do **not** reduce scan-page polling intervals — real-time scanning requires it.

---

## 13. Should Frontend Be Split to Render Static Site?

**Recommended for high-traffic production, but not urgent.**

| Consideration | Notes |
|---|---|
| Current setup | Express serves `dist/public/` — every JS download costs API service bandwidth |
| With Static Site | Render serves assets from CDN edge nodes — zero bandwidth cost on API service, faster global delivery |
| Risk | Low — just a deployment config change, no code changes needed |
| Effort | Low — point a new Render Static Site at `dist/public/`, update API URL env var |
| When to prioritize | When BANDWIDTH_DEBUG shows assets (not API) are the main bandwidth source, OR when monthly bandwidth bills are significant |

The fact that hashed assets already have `max-age=31536000, immutable` means repeat visitors don't re-download them — so the benefit depends on how many **new** users/sessions hit the site per day.

---

## 14. Confirmation — No Business Logic Changed

- ✅ No accounting logic changed
- ✅ No POS posting changed  
- ✅ No voucher posting changed
- ✅ No transfer logic changed
- ✅ No stock movement logic changed
- ✅ No inventory quantities changed
- ✅ No customer/supplier balances changed
- ✅ No report calculations changed
- ✅ No API response shapes changed
- ✅ No query keys or invalidation behavior changed
- ✅ No database migrations added
- ✅ No broad refactors made
