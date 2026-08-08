# Readable Production Logging — Phases 8 and 9

## Phase 8 — ERP administrator activity view

The existing company-scoped Activity History page remains the human-facing view. It already supports user, action, module, record, search and date filters, pagination, grouped dates and detailed change inspection.

Phase 8 adds `GET /api/audit-log/overview`, protected by authentication and the existing `exp_audit_log` permission. The endpoint returns a 30-day company-scoped overview with:

- total audited activity and active-user count;
- most frequent actions and modules;
- the most active users;
- the latest business events;
- current logger, alerting and operational-event diagnostics.

The endpoint never returns another company's activity and requires an active company selection.

## Phase 9 — External alert delivery

Warning and critical operational events can now be delivered to any HTTPS webhook receiver. Suitable destinations include Better Stack, Datadog, New Relic, Slack-compatible webhook relays, PagerDuty event relays or an internal monitoring gateway.

Delivery is disabled by default and is provider-neutral. Alerts are fire-and-forget, bounded by a timeout and deduplicated by severity, category, code and path.

Recommended Render variables:

```env
LOG_ALERTS_ENABLED=true
LOG_ALERT_WEBHOOK_URL=https://your-monitoring-gateway.example/events
LOG_ALERT_MIN_SEVERITY=warning
LOG_ALERT_COOLDOWN_MS=300000
LOG_ALERT_TIMEOUT_MS=5000
```

Optional bearer authentication:

```env
LOG_ALERT_WEBHOOK_BEARER_TOKEN=<secret>
```

The bearer token is never included in the alert payload or application logs. Payloads include only operational metadata such as event code, safe message, request ID, route, status, duration, response size, company ID, environment and build version.

## Alert policy

- `critical`: server errors and critical operational failures;
- `warning`: bandwidth budget violations, slow or abnormal conditions and integrity warnings;
- `info`: retained in Render and diagnostics but never sent externally.

A five-minute default cooldown prevents repeated copies of the same event from flooding the provider.

## Database changes

No schema migration or manual SQL is required.
