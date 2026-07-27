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

Status: started.

Required implementation:

1. Give every API request one correlation ID that is available to route handlers, error handlers, logs, and the response header.
2. Include request ID, safe route, status, user ID, company ID, Factory company ID, and deployment version in server error events.
3. Add a same-origin authenticated browser-error intake endpoint with strict payload limits and sanitization.
4. Capture React render errors, `window.error`, and non-chunk `unhandledrejection` failures.
5. Deduplicate repeated browser errors and apply a client-side send-rate limit.
6. Never send request bodies, response bodies, cookies, authorization headers, passwords, tokens, customer data, voucher contents, or free-form form values.
7. Keep stale-asset recovery behavior intact and do not report expected chunk-recovery events as application failures.
8. Make external delivery optional behind environment configuration; the application must continue working when no external provider is configured.

Acceptance criteria:

- A frontend error and its related API failure can be followed using a correlation ID.
- Production logs contain enough safe context to identify route, deployment, company mode, and affected user.
- Monitoring failure never breaks or delays the business request.
- Browser reports are bounded, sanitized, authenticated, and rate-limited.

## Phase 2 — Structured tracing and dependency timing

- Add safe spans for HTTP, database, and selected external-carrier/WhatsApp operations.
- Record route templates rather than raw URLs containing identifiers.
- Add slow database-query and pool-wait measurements without SQL parameter values.
- Propagate correlation IDs through scheduled jobs and WebSocket-triggered work.

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
