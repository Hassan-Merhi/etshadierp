# Program 1 — Production Monitoring and Observability

Program status: complete.

## Goal

Make production failures diagnosable without changing ERP, Factory, Supplier Partner, Properties, POS, accounting, inventory, costing, or posting behavior.

## Phase 1 — Centralized error capture and correlation

Status: complete.

Implemented:

- Every API request receives a normalized or generated correlation ID and returns it in `X-Request-Id`.
- Browser API calls carry correlation IDs and remember the latest server response ID.
- Authenticated same-origin browser-error intake at `POST /api/auth/observability/client-error`.
- React render errors, `window.error`, and non-chunk `unhandledrejection` failures are captured.
- Client and server deduplication plus bounded rate limits prevent error storms.
- Safe user, company, route, deployment, browser-request, and server-request context.
- Optional fail-open delivery through `OBSERVABILITY_WEBHOOK_URL` and `OBSERVABILITY_WEBHOOK_TOKEN`.

Privacy boundary:

- Never send request bodies, response bodies, cookies, authorization headers, passwords, tokens, customer data, voucher contents, or free-form form values.
- Only bounded error messages, stacks, component stacks, safe routes, request IDs, deployment version, and session-derived identifiers are recorded.

## Phase 2 — Structured tracing and dependency timing

Status: complete.

Implemented:

- Concurrency-safe `AsyncLocalStorage` trace context.
- Always-on HTTP request and database performance context.
- Structured logs inherit request ID, safe route template, user, company, Factory company, location, deployment, and source.
- Raw identifier-heavy paths are converted to safe route templates.
- Database query counts and aggregate database time are collected without SQL text or parameters.
- Selected Green API and carrier HTTP calls are traced without recording URLs, payloads, credentials, or responses.
- Cron callbacks receive generated scheduler correlation IDs.
- WebSocket connection, message, and broadcast work receive generated trace contexts.

## Phase 3 — Performance dashboards

Status: complete.

Implemented:

- Bounded rolling HTTP performance window with configurable time and sample limits.
- p50, p95, and p99 request latency.
- Per-route p95, average and maximum latency, response size, database time, request count, and 5xx count.
- Separate ERP, Factory, Supplier Partner, Properties, and POS summaries.
- Process memory and PostgreSQL pool pressure snapshots.
- Bounded scheduled-job and external-dependency aggregates.
- Protected Admin/Developer HTML dashboard at `/api/health/performance`.
- Protected JSON snapshot at `/api/health/performance.json`.

Configuration:

- `PERFORMANCE_DASHBOARD_WINDOW_MS` defaults to 15 minutes.
- `PERFORMANCE_DASHBOARD_MAX_SAMPLES` defaults to 5,000 HTTP samples.
- `PERFORMANCE_DASHBOARD_RUNTIME_MAX_SAMPLES` defaults to 2,000 runtime samples.

## Phase 4 — Alerts and operational response

Status: complete.

Implemented:

- Configurable alerts for elevated 5xx rate, p95 latency, RSS memory, database-pool waiting, scheduled-job failures, and supported external-dependency failures.
- Warning and critical severities with a recommended operator action for each incident.
- Active and recently resolved incident lifecycle.
- Configurable cooldown and bounded resolved-history retention to prevent alert storms and unbounded memory growth.
- Periodic alert evaluation that remains disabled unless `OBSERVABILITY_ALERTS_ENABLED=true`.
- Optional fail-open webhook delivery with bearer-token support and a short timeout.
- Protected Admin/Developer incident dashboard at `/api/health/incidents`.
- Protected incident JSON snapshot at `/api/health/incidents.json`.
- Performance and incident dashboards link to each other.
- Operational runbook at `docs/program-1-incident-response-runbook.md` covering triage, mitigation, recovery verification, and configuration.

Default configuration:

- `OBSERVABILITY_ALERTS_ENABLED=false`
- `OBSERVABILITY_ALERT_EVALUATION_MS=60000`
- `OBSERVABILITY_ALERT_COOLDOWN_MS=900000`
- `OBSERVABILITY_ALERT_HISTORY_LIMIT=100`
- `OBSERVABILITY_ALERT_5XX_PERCENT=5`
- `OBSERVABILITY_ALERT_MIN_REQUESTS=20`
- `OBSERVABILITY_ALERT_P95_MS=2000`
- `OBSERVABILITY_ALERT_RSS_MB=900`
- `OBSERVABILITY_ALERT_DB_WAITING=1`
- `OBSERVABILITY_ALERT_JOB_FAILURES=1`
- `OBSERVABILITY_ALERT_DEPENDENCY_FAILURES=1`

## Verification boundary

- `npm run verify:program1-observability` protects the complete Phase 1–4 source contract.
- Static source review and contract verification are complete.
- No claim is made that TypeScript, lint, tests, production build, deployment, webhook delivery, or live alert behavior passed unless separate execution evidence is available.

## Safety boundaries

- Monitoring is read-only with respect to business tables.
- No monitoring route may expose cross-company data.
- No raw payload or secret may be logged.
- Monitoring dependencies must fail open for normal application traffic.
- Alerting and external telemetry remain disabled until explicitly configured.
- No accounting, inventory, stock, costing, posting, permissions, navigation, database schema, or business workflow behavior is changed by Program 1.
