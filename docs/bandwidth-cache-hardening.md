# Bandwidth cache hardening

## Why this change exists

Production bandwidth snapshots showed a combination of large JSON responses and repeated requests within the same five-minute reporting window.

The strongest example was `GET /api/sales-report`, whose response was roughly 3.4 MB and appeared as often as 185 times in one five-minute window. Other repeated heavy endpoints included factory payrolls, payroll preview, location inventory, workers, ledger accounts, last-sold prices, raw-stock containers, and report endpoints.

The application already had gzip compression, immutable caching for hashed frontend assets, a client request-storm guard, and a small server read microcache. The server cache did not cover the largest current hotspots, and harmless write traffic such as POS autosave and user-presence heartbeats could erase business-read cache entries repeatedly.

## What is implemented

The existing canonical cache in `server/routes/performance/readMicrocache.ts` is expanded and hardened rather than adding a second caching system.

### Safety boundaries

- Every production cacheable read re-runs `requireAuth` before a cache hit can be served.
- POS location-inventory reads also re-run the existing location-assignment check.
- Cache keys include authenticated user, ERP company, factory company, role, location, POS station, method, full URL, client date, and stable request body where relevant.
- Only explicit exact paths and reviewed dynamic path patterns are cacheable.
- Payroll preview is treated as a read-only POST and keyed by a stable serialization of its request body.
- POS draft reads are intentionally not cached so creates, autosaves, and deletions remain immediately visible.
- Successful authenticated business writes invalidate the cache after the response completes.
- Failed or unauthenticated writes cannot flush the process-wide cache.
- Cache generation prevents an older in-flight read from being stored after a successful write invalidates the cache.
- Presence heartbeats, POS draft autosaves, notifications, chat, and observability writes do not erase unrelated business caches.

### Bandwidth controls

- Repeated reads are served from bounded process memory.
- Concurrent identical misses share one route and database execution.
- Weak ETags allow unchanged browser revalidation to return `304 Not Modified` without resending JSON.
- Browser responses use `private, no-cache, must-revalidate`, so the server still validates every reuse.
- Service-worker `no-store` fetch semantics do not bypass the ERP server cache; explicit bypass uses `x-bypass-request-storm-guard` or `__refresh=1`.
- Existing gzip compression remains active for full responses.
- Existing immutable one-year caching for hashed frontend assets remains unchanged.

### Cache limits and TTLs

- Maximum entries: 128.
- Maximum cached response: 5 MB.
- Maximum total cached response bytes: 64 MB.
- Heavy sales and payroll reads: up to 2 minutes.
- Volatile accounting, inventory, POS, and factory reads: generally 10 to 60 seconds.
- Reference lists such as workers, locations, stock groups, ledger accounts, and suppliers: up to 5 minutes.

## Operations and verification

The existing admin-only `GET /api/admin/operational-monitoring` response includes `readMicrocache` metrics:

- `entries`
- `bytes`
- `hits`
- `misses`
- `revalidated`
- `coalesced`
- `stores`
- `evictions`
- `invalidations`

Cached responses expose `X-ERP-Read-Cache` with one of these states:

- `MISS`
- `HIT`
- `COALESCED`
- `REVALIDATED`

Focused regression coverage is in `server/routes/performance/readMicrocache.test.ts` and verifies hotspot coverage, key isolation, cache hits, service-worker behavior, ETag revalidation, payroll-preview body keys, dynamic paths, TTL expiry, authenticated successful-write invalidation, failed and anonymous write protection, and preservation across POS autosave and presence heartbeats.

## Production acceptance check

1. Open Sales Report, Factory Payroll, POS, and Location Inventory in representative sessions.
2. Confirm first requests show `MISS` and repeated requests show `HIT`, `COALESCED`, or `REVALIDATED`.
3. Create or edit a real voucher and confirm the next dependent read shows `MISS` with fresh values.
4. Leave POS open long enough for autosave and verify report-cache entries remain available while hit counts increase.
5. Compare five-minute bandwidth snapshots before and after deployment, especially `/api/sales-report`, `/api/factory/payrolls`, `/api/factory/payrolls/preview`, and `/api/locations/:locationId/inventory`.
