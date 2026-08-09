# Readable Production Logging — Phase 10 Release

## Purpose

Phase 10 turns phases 1–9 into a controlled production release rather than a one-step logging switch.

## Release gates

The logging release is ready only when all of the following pass on the final stacked branch:

- formatting and TypeScript;
- production build and server bundle verification;
- logger readability, redaction and alert-delivery tests;
- phases 1–9 static contracts;
- final production-readiness contracts;
- dependency and secret scans;
- application startup and API smoke checks.

## Rollout sequence

### Stage 1 — readable local verification

Use production-like settings without external alert delivery:

```env
NODE_ENV=production
LOG_LEVEL=info
LOG_FORMAT=pretty
LOG_REDACT_SENSITIVE=true
REQUEST_LOG_SAMPLE_RATE=0
RUNTIME_OBSERVABILITY_REQUEST_LOGS=false
BANDWIDTH_DEBUG=true
BANDWIDTH_DEBUG_REPORT_INTERVAL_MS=300000
BANDWIDTH_DEBUG_LOG_TOP_N=3
LOG_ALERTS_ENABLED=false
```

Verify that normal inventory reads, polling, heartbeats and lifecycle-start messages do not flood logs. Confirm warnings, failures, request IDs, build versions and company context remain visible.

### Stage 2 — Render deployment without outbound alerts

Deploy the same settings to Render with `LOG_ALERTS_ENABLED=false`. Confirm:

- startup completes;
- `/api/health` returns success;
- protected `/api/health/metrics` is available to Admin/Developer roles;
- protected `/api/audit-log/overview` returns the selected company's activity and diagnostics;
- no credential, phone, WhatsApp ID, signed URL or private upload URL appears in Render logs.

### Stage 3 — warning-only alerts

Enable the webhook with warning severity and the five-minute cooldown:

```env
LOG_ALERTS_ENABLED=true
LOG_ALERT_MIN_SEVERITY=warning
LOG_ALERT_COOLDOWN_MS=300000
LOG_ALERT_TIMEOUT_MS=5000
```

Send one controlled warning event and verify a single safe payload reaches the provider. Repeating the same event during the cooldown must not create another notification.

### Stage 4 — normal operation

Keep `LOG_LEVEL=info`. Use `LOG_LEVEL=debug` only for a short, supervised diagnostic window and return it to `info` immediately afterward.

## Rollback

Logging and alerting can be reduced without redeploying:

1. Set `LOG_ALERTS_ENABLED=false` to stop outbound alerts.
2. Keep `LOG_REDACT_SENSITIVE=true`.
3. Set `BANDWIDTH_DEBUG=false` only when bandwidth summaries themselves are causing an operational problem.
4. Keep `LOG_LEVEL=info`; do not use `error` as a permanent workaround because it hides actionable warnings.
5. Revert the stacked logging PRs only if the logger itself prevents application startup or request completion.

## Post-deployment checks

Review the first production window for:

- duplicate slow-request messages;
- repeated inventory or polling lines;
- unmasked secrets or identifiers;
- alert floods;
- missing request IDs;
- unusually large API responses;
- webhook delivery failures.

The release is considered stable after a normal operating window completes without sensitive-data exposure, request interruption, duplicate noise or alert flooding.

## Database changes

No schema migration, manual SQL or data backfill is required.
