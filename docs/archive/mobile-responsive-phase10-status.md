# Mobile Responsiveness Phase 10 — Performance and Offline Behavior

Status: Implemented; final CI and device validation pending.

Branch: `agent/mobile-responsive-phase-10-performance-offline`

## Delivered

- Added browser connection profiling for data-saver mode and effective connection type.
- Added adaptive health-check and offline-queue scheduling for visible, hidden, online, offline, and slow-network states.
- Removed fixed 15-second queue-count polling and fixed 30-second health polling from the connectivity provider.
- Avoided healthy network pings while the authenticated tab is hidden.
- Connected browser visibility and online state to TanStack Query focus and online managers.
- Marked the document with visibility, online, data-saver, effective-connection, and slow-connection state for shared UI behavior.
- Paused animations and transitions while the application tab is hidden.
- Limited post-sync query refetching to currently active screens and scheduled it during browser idle time.
- Enabled service-worker navigation preload to reduce mobile startup latency while preserving network-only API requests.
- Kept the app-shell fallback, immutable hashed-asset caching, cache bounds, and stale-cache cleanup.
- Added focused source-contract tests and a standalone Phase 10 verifier.

## Deliberately unchanged

- API payloads, accounting, inventory, costing, permissions, company isolation, and database schema.
- Offline queue allow/deny rules and mutation replay ordering.
- Query keys, page-specific stale times, business polling explicitly configured by individual screens, and mutation retry behavior.
- Company-scoped API responses remain network-only in the service worker.

## Remaining verification

- TypeScript and production build.
- Lint and exact changed-file formatting.
- Phase 10 focused test and standalone verifier.
- Full frontend/backend tests, API smoke, coverage, Security, I18n, and CircleCI.
- Test online/offline transitions, hidden-tab battery behavior, data-saver and 2G profiles, queued mutations, reconnect sync, service-worker upgrades, stale chunks, and offline navigation on physical Android and iOS devices.

## SQL

None.
