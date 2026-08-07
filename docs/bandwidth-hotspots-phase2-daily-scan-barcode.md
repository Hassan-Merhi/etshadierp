# Bandwidth Hotspots — Phase 2: Daily Scan + Barcode Images

## Scope

Phase 2 targets two high-frequency factory surfaces without changing accounting, costing, stock quantities, bale lifecycle rules, permissions, or database schema:

1. Daily Bale Scan verification traffic.
2. Barcode images used by pressing/final label print and preview windows.

Phase 1 request containment remains in place underneath these changes.

## Daily Bale Scan

### Previous behavior

Opening today's Daily Scan screen started two overlapping list reads:

- `GET /api/factory/daily-bale-scans/produced?date=...&pageSize=1000`
- `GET /api/factory/daily-bale-scans?date=...&pageSize=1000`

Both reads polled independently. The browser then joined the two arrays by `reference_number` even though the server already owns both datasets.

Each successful scan also sent article code, product name, and weight back to the server even though those values already exist on the authoritative `factory_bales` row.

### Phase 2 behavior

The Daily Scan screen now uses one opt-in compact read:

`GET /api/factory/daily-bale-scans?date=YYYY-MM-DD&profile=day`

The response contains the produced-bale fields rendered/exported by the screen plus only two scan-state fields:

- `scan_id`
- `scanned_at`

The server joins the day's production and verification state in one query. The existing `/produced` route and the default scan-log contract are retained for compatibility with other callers.

For the current day:

- one compact request replaces two list requests;
- visible-tab polling is one request every 90 seconds rather than two requests every 60 seconds;
- window-focus, reconnect, and background polling are disabled for this screen;
- successful scan/remove mutations patch the compact TanStack Query cache directly instead of refetching the day;
- a slower visible-tab poll still picks up changes made by another workstation.

Historical dates are treated as stable and retain a longer cache lifetime.

### Scan writes

The client now sends only:

- `scanDate`
- `referenceNumber`

The server copies article code, product name, and weight from the matching `factory_bales` row. A successful scan uses a single `INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING` round trip. A small existence check is only needed to distinguish a missing bale from an already-scanned bale after a conflict/no-op.

The existing unique constraint on `(company_id, scan_date, reference_number)` remains the concurrency guard. No migration is required.

## Barcode images

The existing `/api/barcode/:code` URL is preserved.

Browser `<img>` requests normally advertise SVG support, so Phase 2 serves a compact Code 128 SVG for those requests. Generic/direct fetch callers continue receiving the legacy PNG representation unless `?format=svg` is requested. `?format=png` explicitly forces PNG.

Barcode output is deterministic for a given code, so responses now use a private one-year immutable browser cache. The server also keeps a bounded 512-entry process-local LRU of rendered barcode images to avoid regenerating the same labels during preview/reprint workflows.

The original PNG route remains registered behind the Phase 2 middleware as a compatibility fallback.

## Expected bandwidth effect

Daily Scan removes one complete recurring list response and reduces the remaining refresh frequency. Scan POST bodies/responses are also smaller and no longer duplicate bale metadata.

Barcode print/preview traffic changes from large scale-14 PNG image downloads on repeat visits to compact vector images with long-lived browser caching. Reprints of previously seen codes should usually require no network transfer at all while the browser cache entry remains valid.

## Schema / SQL

No new tables, columns, indexes, or migrations are required for Phase 2.

## Verification policy

Per the five-phase rollout plan, TypeScript, lint, build, automated tests, GitHub Actions/CircleCI, and final bandwidth verification are intentionally deferred to Phase 5 so the complete program is audited once against the final combined branch.
