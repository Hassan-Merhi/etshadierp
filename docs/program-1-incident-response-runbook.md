# Program 1 — Operational Incident Response

## Purpose

Use this runbook when the observability system reports elevated 5xx errors, latency, memory, database-pool waiting, scheduled-job failures, or external dependency failures.

## First response

1. Open `/api/health/performance` using an Admin or Developer account.
2. Record the deployment version, incident key, first-seen time, latest request ID, affected route template, and affected company mode.
3. Do not retry accounting repairs, offloads, voucher posting, stock transfers, or exports until the failure scope is understood.
4. Preserve logs before restarting the service.

## Severity

### Critical

- Elevated HTTP 5xx rate.
- Process RSS memory above the configured limit.
- PostgreSQL pool waiting requests.
- Scheduled-job failures.

Action: investigate immediately. Stop only the failing background operation where possible. Do not disable company isolation, permission checks, accounting guards, or idempotency controls.

### Warning

- Elevated p95 HTTP latency.
- Green API or carrier dependency failures.

Action: verify provider availability, request volume, response size, database duration, and retry behavior. Continue normal ERP traffic when core posting and stock flows remain healthy.

## Alert lifecycle

- Alerts are evaluated only when `OBSERVABILITY_ALERTS_ENABLED=true`.
- Repeated alerts use a cooldown to avoid storms.
- Active incidents remain in memory while the condition is present.
- When the condition clears, the incident moves to recently resolved history.
- Optional webhook delivery must fail open and must never block ERP traffic.

## Rule-specific checks

### HTTP 5xx rate

- Review the slowest and busiest route templates.
- Correlate request IDs with structured logs.
- Check whether failures are limited to one company mode.
- Verify database pool waiting and recent deployment changes.

### Latency

- Compare HTTP duration with database duration.
- Check response size and repeated frontend polling.
- Check exports, PDF/Excel generation, and large stock/daybook endpoints.

### Memory pressure

- Check large HTTP responses and export buffers.
- Check repeated report generation and duplicate requests.
- Restart only after capturing logs and identifying the likely source.

### Database pool waiting

- Identify database-heavy route templates and scheduled jobs.
- Check for transactions that remain open.
- Confirm connections are released on success and failure paths.

### Scheduled-job failure

- Use the scheduler correlation ID.
- Check export generation, email, WhatsApp, and database logs.
- Confirm whether the last run partially succeeded before retrying.

### External dependency failure

- Confirm Green API or carrier availability.
- Verify credentials without logging or exposing them.
- Correlate the dependency span with its parent request or scheduled job.
- Avoid uncontrolled retries.

## Recovery verification

After mitigation:

1. Confirm the incident becomes resolved.
2. Confirm 5xx rate, p95 latency, memory, and database waiting return below thresholds.
3. Verify one representative read and one representative safe business workflow in the affected module.
4. For accounting, stock, POS, voucher, container, or factory issues, run the relevant reconciliation before declaring recovery.
5. Document the cause, change, verification evidence, and follow-up prevention work.

## Configuration

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
- `OBSERVABILITY_ALERT_WEBHOOK_URL`
- `OBSERVABILITY_ALERT_WEBHOOK_TOKEN`

Alert evaluation and webhook delivery remain disabled until explicitly configured.