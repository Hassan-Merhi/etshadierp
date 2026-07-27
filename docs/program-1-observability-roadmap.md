# Program 1 — Production Monitoring and Observability

## Goal

Make production failures diagnosable without changing ERP, Factory, Supplier Partner, Properties, POS, accounting, inventory, costing, or posting behavior.

## Existing foundation confirmed on current main

- Sanitized structured server logger with JSON production output.
- Request IDs returned through `X-Request-Id`.
- Slow-request and HTTP failure logging.
- In-memory request, process-memory, database-pool, and operational-event metrics.
- Admin/Developer-only `/api/health/metrics` endpoint.
- Process handlers for unhandled rejections and uncaught exceptions.
- Bandwidth debug middleware for oversized responses.

## Phase 1 — Centralized error capture and correlation

Status: complete.

Implemented:

1. Every API request receives a normalized or generated correlation ID.
2. The correlation ID is available on the request object and returned in `X-Request-Id`.
3. Browser API calls send their own correlation IDs and remember the latest server response ID.
4. A same-origin authenticated `POST /api/auth/observability/client-error` intake is mounted before business routes.
5. The intake applies strict text limits, strips query strings from routes, rejects unauthenticated reports, and never accepts business payloads.
6. React render errors, `window.error`, and non-chunk `unhandledrejection` failures are captured.
7. Expected stale-asset and chunk-loading recovery failures remain excluded from application-error reporting.
8. Client and server deduplication prevent repeated errors from creating storms.
9. Client and server rate limits bound reporting volume.
10. Reports include safe route, user, company, deployment, browser request ID, and server request ID context.
11. Browser failures feed the existing structured logger and operational-event counters.
12. Optional external delivery is controlled by `OBSERVABILITY_WEBHOOK_URL` and `OBSERVABILITY_WEBHOOK_TOKEN`.
13. External delivery uses a short timeout and fails open without delaying or breaking ERP traffic.
14. A React fallback screen records the failure and provides a manual application refresh.
15. `npm run verify:program1-observability` preserves the Phase 1 safety contract.

Privacy boundary:

- Never send request bodies, response bodies, cookies, authorization headers, passwords, tokens, customer data, voucher contents, or free-form form values.
- Only bounded error messages, stacks, component stacks, safe routes, request IDs, deployment version, and session-derived identifiers are recorded.

## Phase 2 — Structured tracing and dependency timing

Status: complete.

Implemented:

- Added concurrency-safe `AsyncLocalStorage` trace context.
- Every API request creates an always-on trace and request-performance context.
- Structured logs automatically inherit request ID, safe route template, user, company, Factory company, location, deployment, and source context.
- Raw identifier-heavy paths are converted to safe route templates.
- Database query counts and aggregate database time are collected per request without SQL text or parameters.
- Slow/error request logs include route template, database query count, and database duration.
- Protected health metrics include cumulative database request timing.
- Existing successful activity-audit behavior remains isolated and unchanged.
- Added a fail-open `withTraceSpan` helper for dependency operations.
- Selected Green API and carrier HTTP calls are traced centrally without recording URLs, payloads, credentials, or responses.
- Slow and failed external dependencies emit safe dependency name, duration, request ID, and source context.
- Cron callbacks receive generated scheduler correlation IDs and deployment context.
- WebSocket connection, message, and broadcast work receive generated WebSocket correlation contexts.
- Extended `npm run verify:program1-observability` to protect the complete Phase 2 contract.

Verification boundary:

- Static source and contract verification are complete.
- No claim is made that TypeScript, lint, tests, production build, deployment, or live external calls passed unless separate execution evidence is available.

## Phase 3 — Performance dashboards

- Provide Admin/Developer dashboards for latency percentiles, error rate, active requests, memory, database-pool pressure, response size, and top slow route templates.
- Add bounded time-window aggregation rather than unbounded in-memory history.
- Separate ERP, Factory, Supplier Partner, Properties, POS, and background-job views.

## Phase 4 — Alerts and operational response

- Add configurable alerts for readiness failure, 5xx spikes, latency spikes, memory pressure, database-pool waiting, oversized responses, scheduler failures, and repeated frontend crashes.
- Add cooldown and deduplication so one incident does not create alert storms.
- Document alert severity, owner action, verification steps, and recovery procedure.

## Safety boundaries

- Monitoring is read-only with respect to business tables.
- No monitoring route may expose cross-company data.
- No raw payload or secret may be logged.
- Monitoring dependencies must fail open for normal application traffic.
- Alerting and external telemetry remain disabled until explicitly configured.
