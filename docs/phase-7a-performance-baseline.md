# Phase 7A — Performance Baseline

Phase 7A establishes a lightweight, production-safe baseline for API and database-pool performance without adding an external monitoring dependency or changing business logic.

## Baseline source

Authorized Admin and Developer users can read the existing internal endpoint:

- `GET /api/health/metrics`

The endpoint exposes aggregate process, API request, database-pool, and operational-event metrics. It does not expose request or response bodies, credentials, cookies, authorization headers, SQL, connection strings, or customer data.

## Request baseline fields

The request section now includes:

- total and currently active API requests;
- completed, successful, client-error, server-error, and slow-request counts;
- average and maximum completed-request duration;
- slow-request and server-error percentages;
- the configured slow-request threshold;
- stable latency buckets: under 100 ms, under 500 ms, under 1 second, under 5 seconds, and 5 seconds or more.

These metrics are process-local and reset whenever the application process restarts. `startedAt` and uptime are included so every snapshot can be interpreted within that process lifetime.

## Initial review thresholds

These are investigation thresholds, not automatic deployment blockers:

- any database-pool waiting count above zero;
- sustained pool utilization above 80%;
- sustained server-error percentage above 1%;
- sustained slow-request percentage above 5%;
- repeated requests in the 5-second-or-more bucket;
- memory growth that does not settle after traffic drops.

A single snapshot is not enough to diagnose a regression. Compare snapshots over a representative operating window and correlate them with structured slow-request, bandwidth, and integrity events.

## Safety and scope

- No route response shape other than the internal metrics endpoint is changed.
- No business query, transaction, accounting calculation, inventory mutation, export, or authorization rule is changed.
- No production benchmark or provider-level load test is claimed by this phase.
- Later Phase 7 packages should use this baseline to target stock-items, inventory, factory, accounts, Daybook, reports, Excel, and PDF hotspots.
