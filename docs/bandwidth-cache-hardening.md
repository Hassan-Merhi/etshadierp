# Bandwidth cache hardening

## Why this change exists

Production bandwidth snapshots showed that the problem was not one slow query. It was a combination of large JSON responses and the same requests being repeated many times within a five-minute reporting window.

The strongest example was `GET /api/sales-report`, whose response was roughly 3.4 MB and appeared as often as 185 times in one five-minute window. Other repeated heavy endpoints included factory payrolls, payroll preview, location inventory, workers, ledger accounts, POS drafts, last-sold prices, raw-stock containers, and report endpoints.

The application already had gzip compression, immutable caching for hashed frontend assets, and conservative TanStack Query defaults. However, every API response was globally forced to `no-store`, ETags were disabled, and identical concurrent requests were not deduplicated at the server boundary.

## What is implemented

`server/middleware/privateApiCache.ts` installs a bounded, explicit allowlist cache before application routes are registered.

### Safety boundaries

- Cache keys include authenticated user, selected ERP company, pinned factory company, role, location, POS station, method, full URL, client date, and stable request body where relevant.
- Only explicitly listed JSON read endpoints are cached.
- The in-memory cache is limited to 64 MB, 400 entries, and 8 MB per response.
- Payroll preview is treated as a read-only POST and is cached by a stable request-body key.
- Real API writes clear the cache before execution and again after a successful response.
- Cache generation prevents a read that started before a write from being inserted after that write.
- Ephemeral writes such as POS draft autosave, user presence, notifications, chat, and client observability do not erase business caches.
- Browser responses use `private, no-cache, must-revalidate`; the browser must revalidate instead of silently serving stale business data.

### Bandwidth controls

- Repeated requests are served from bounded process memory.
- Concurrent identical misses are coalesced into one route/database execution.
- Weak ETags allow unchanged browser requests to return `304 Not Modified` with no JSON body.
- Existing gzip compression remains active for the first full response.
- Existing immutable one-year caching for hashed frontend assets remains unchanged.

### Cache classes

- Volatile accounting/inventory/POS reads: 30-second server TTL.
- Heavy reports and payroll reads: 2-minute server TTL.
- Reference lists such as workers, locations, stock groups, accounts, and suppliers: 5-minute server TTL.

All classes still use browser revalidation rather than positive browser freshness, so application invalidations continue to reach the server.

## Operations and verification

The existing admin-only `GET /api/admin/operational-monitoring` response now includes `privateApiCache` metrics:

- `entries`
- `bytes`
- `hits`
- `misses`
- `revalidated`
- `coalesced`
- `stores`
- `evictions`
- `invalidations`

Cached responses also expose diagnostic headers:

- `X-ERP-Cache: MISS | HIT | COALESCED | REVALIDATED | REFRESH | BYPASS-SIZE`
- `X-ERP-Cache-Policy: <policy-name>`

Focused regression coverage is in `tests/private-api-cache.test.ts` and verifies:

1. memory cache hits,
2. concurrent request coalescing,
3. ETag `304` revalidation,
4. authenticated-user isolation,
5. invalidation on business writes,
6. preservation across POS autosave and presence heartbeats,
7. stable-body payroll preview caching, and
8. allowlist-only behavior.

Recommended production acceptance check after deployment:

1. Open Sales Report, Factory Payroll, POS, and Location Inventory in representative sessions.
2. Confirm first requests show `MISS`, repeated requests show `HIT`, `COALESCED`, or `REVALIDATED`.
3. Create or edit a real voucher and confirm the next dependent read shows `MISS` with fresh values.
4. Leave POS open long enough for autosave and verify report-cache entries and hit count continue increasing.
5. Compare five-minute bandwidth snapshots before and after deployment, especially `/api/sales-report`, `/api/factory/payrolls`, `/api/factory/payrolls/preview`, and `/api/locations/:locationId/inventory`.
