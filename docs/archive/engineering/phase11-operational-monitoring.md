# Phase 11 — Operational Monitoring

Phase 11 turns the existing request metrics and operational event recorder into a protected operator-facing health boundary. It does not change accounting, inventory, costing, permissions, database schemas, or request behavior.

## Protected monitoring endpoint

`GET /api/admin/operational-monitoring` is available only to authenticated Admin, Owner, and Developer users. The endpoint is read-only and returns aggregate operational state only.

It never returns request bodies, cookies, authorization headers, SQL text, bound parameters, or arbitrary error objects.

## Health evaluation

The monitoring service evaluates:

- HTTP server-error percentage;
- slow-request percentage;
- waiting database-pool clients;
- Node.js heap usage;
- recent critical operational events.

Each condition has configurable warning and critical thresholds through environment variables. The resulting status is `ok`, `degraded`, or `critical`, with explicit alert codes, observed values, thresholds, and units.

## Operational event rollups

The event recorder now exposes:

- counts by category;
- counts by severity;
- grouped counts by normalized event code;
- latest severity, message, and timestamp for each event code;
- the existing bounded newest-first recent-event list.

This preserves current logging while making repeated failures, bandwidth events, and integrity warnings identifiable without scanning individual log lines.

## Compatibility retained

- Existing `/api/health`, `/api/health/metrics`, and performance endpoints remain unchanged.
- Existing request logging and event logging remain active.
- No new background process, scheduler, webhook, database table, or external monitoring vendor is required.
- Threshold defaults can be overridden without code changes.

## Configuration

Supported environment variables:

- `OPS_SERVER_ERROR_WARNING_PERCENT`
- `OPS_SERVER_ERROR_CRITICAL_PERCENT`
- `OPS_SLOW_REQUEST_WARNING_PERCENT`
- `OPS_SLOW_REQUEST_CRITICAL_PERCENT`
- `OPS_DB_POOL_WAITING_WARNING`
- `OPS_HEAP_WARNING_MB`
- `OPS_HEAP_CRITICAL_MB`
- `OPS_RECENT_CRITICAL_EVENTS_WARNING`

Invalid or negative values fall back to safe defaults.

## Verification boundary

Focused contracts verify that the endpoint is protected and read-only, the composition root registers it, all required health dimensions are evaluated, sensitive payload fields are excluded, and operational events expose severity and code rollups.

The phase includes:

```bash
node scripts/verify-phase11-operational-monitoring.mjs
node node_modules/vitest/vitest.mjs run tests/operational-events.test.ts tests/phase11-operational-monitoring.test.ts
```

These checks were added but not executed in this connected session. TypeScript, formatting, lint, tests, build, database behavior, browser behavior, and deployment remain unverified.

## Merge boundary

Phase 11 must remain a draft and must not be merged until the earlier roadmap phases are integrated in order and the owner explicitly authorizes the merge.
