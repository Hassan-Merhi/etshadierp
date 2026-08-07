# Program 1 — Production Monitoring and Observability

Program status: complete.

## Goal

Make production failures diagnosable without changing ERP, Factory, Supplier Partner, Properties, POS, accounting, inventory, costing, or posting behavior.

## Phase 1 — Centralized error capture and correlation

Status: complete.

- Correlated browser and server failures with request IDs.
- Authenticated, rate-limited, deduplicated browser-error intake.
- React, window error, promise rejection, and server process failure capture.
- Optional external delivery with bounded timeout and fail-open behavior.

## Phase 2 — Structured tracing and dependency timing

Status: complete.

- Concurrency-safe trace context.
- Safe route templates and inherited structured-log context.
- Per-request database counts and duration without SQL or parameters.
- Green API and carrier dependency timing.
- Scheduler and WebSocket correlation contexts.

## Phase 3 — Performance dashboards

Status: complete.

- Bounded HTTP and runtime performance windows.
- p50, p95, and p99 request latency.
- Per-route response size, database duration, request count, and 5xx count.
- Separate ERP, Factory, Supplier Partner, Properties, and POS summaries.
- Process memory and PostgreSQL pool snapshots.
- Scheduled-job and dependency aggregates.
- Protected Admin/Developer views at `/api/health/performance` and `/api/health/performance.json`.

## Phase 4 — Alerts and operational response

Status: complete.

- Configurable alerts for 5xx rate, p95 latency, RSS memory, database-pool waiting, scheduled-job failures, and supported dependency failures.
- Active and resolved incident lifecycle with cooldown and bounded history.
- Protected Admin/Developer views at `/api/health/incidents` and `/api/health/incidents.json`.
- Optional webhook delivery rejects unsuccessful HTTP responses and fails open.
- Invalid numeric configuration falls back to documented safe defaults.
- Operational response runbook covers first response, investigation, mitigation, and recovery verification.

## Configuration defaults

- `PERFORMANCE_DASHBOARD_WINDOW_MS=900000`
- `PERFORMANCE_DASHBOARD_MAX_SAMPLES=5000`
- `PERFORMANCE_DASHBOARD_RUNTIME_MAX_SAMPLES=2000`
- `OBSERVABILITY_ALERTS_ENABLED=false`
- `OBSERVABILITY_ALERT_EVALUATION_MS=60000`
- `OBSERVABILITY_ALERT_COOLDOWN_MS=900000`
- `OBSERVABILITY_ALERT_HISTORY_LIMIT=100`

## Verification boundary

`npm run verify:observability` protects the complete Phase 1–4 source contract.

Static source review is complete. No claim is made that TypeScript, lint, tests, production build, deployment, webhook delivery, or live alert behavior passed without separate execution evidence.

## Safety boundaries

- Monitoring is read-only with respect to business tables.
- No monitoring route may expose cross-company data.
- Never send request bodies, response bodies, cookies, authorization headers, passwords, tokens, customer data, voucher contents, or free-form form values.
- Monitoring dependencies must fail open for normal application traffic.
- Alerting and external telemetry remain disabled until explicitly configured.
- No accounting, inventory, stock, costing, posting, permissions, navigation, database schema, or business workflow behavior is changed by Program 1.
