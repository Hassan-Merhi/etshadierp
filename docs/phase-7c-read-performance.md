# Phase 7C — Factory, Account, Daybook, and Reporting Performance

Phase 7C adds a narrowly scoped one-second server-side JSON microcache for repeated heavy reads:

- `GET /api/factory/daybook`
- `GET /api/accounts/all`
- `GET /api/stats/monthly-data`
- `GET /api/dashboard/sales-report-all`

## Why this is safe

- Only successful `GET` JSON responses are cached.
- Error responses, writes, file downloads, and unrelated routes are never cached.
- Cache keys include the full URL, user ID, current company, factory company, and current role.
- The one-second TTL collapses duplicate component requests and rapid repeated reads without introducing a meaningful stale-data window.
- Clients can bypass the microcache with `Cache-Control: no-cache`.
- The cache is process-local, bounded to 100 entries, and prunes expired data.

## Scope boundaries

- No accounting, inventory, payroll, factory, Daybook, or report calculations changed.
- No database schema, index, migration, transaction, authorization, or provider setting changed.
- No production load-test result is claimed.

## Verification

`server/routes/performance/readMicrocache.test.ts` verifies the exact allowlist, user/company/query isolation, successful cache hits, error exclusion, unrelated-route exclusion, and TTL expiry.
