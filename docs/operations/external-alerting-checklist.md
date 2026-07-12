# External Alerting Checklist

Phase 5C documents how to connect the ERP health and operational-event signals to an external monitoring provider. This phase does not configure a production provider and does not claim that external delivery has been validated.

## Available application signals

- Liveness endpoint: `GET /api/health/live`
- Readiness endpoint: `GET /api/health/ready`
- Protected internal metrics endpoint: `GET /api/health/metrics`
- Operational event categories: `error`, `bandwidth`, and `integrity`
- HTTP 5xx events are recorded as critical error events.
- Large HTTP responses are recorded as bandwidth warning events when bandwidth debugging is enabled.
- Integrity checks can report through the reusable integrity-event hook.

The protected metrics endpoint is for authenticated Admin/Developer access. Do not expose it publicly merely to satisfy a monitoring provider.

## Provider setup checklist

### 1. Availability monitoring

- [ ] Monitor the public liveness endpoint over HTTPS.
- [ ] Choose a check interval appropriate to the hosting plan and expected traffic.
- [ ] Alert only after multiple consecutive failures to reduce transient noise.
- [ ] Configure a recovery notification when the endpoint becomes healthy again.
- [ ] Verify the monitor uses the production hostname and correct TLS certificate.

### 2. Readiness monitoring

- [ ] Decide whether the readiness endpoint should be reachable by the chosen monitor without weakening authentication or network controls.
- [ ] Treat sustained readiness failure as higher urgency than a single transient failure.
- [ ] Confirm database-unavailable behavior in a safe non-production environment before relying on the alert.

### 3. Error alerts

- [ ] Send structured application logs to the chosen provider using the hosting platform's supported log drain or integration.
- [ ] Alert on sustained or sharply increasing HTTP 5xx events.
- [ ] Include safe metadata such as timestamp, request ID, method, normalized path, status, duration, and environment.
- [ ] Do not send request bodies, response bodies, cookies, authorization headers, credentials, connection strings, or attachment contents.
- [ ] Group repeated errors to avoid one notification per request.

### 4. Bandwidth alerts

- [ ] Review the large-response threshold before enabling bandwidth-event alerts in production.
- [ ] Alert on repeated large responses or an abnormal increase in outbound bandwidth rather than a single expected export.
- [ ] Separate known large Excel/PDF exports from unexpectedly large JSON/API responses where the provider supports filtering.
- [ ] Correlate provider bandwidth totals with application large-response events before changing application behavior.

### 5. Integrity alerts

- [ ] Define which integrity event codes are operationally actionable before enabling paging.
- [ ] Route critical accounting or inventory integrity events to a higher-severity channel than informational anomalies.
- [ ] Include identifiers needed for investigation only when they are non-secret and access-controlled.
- [ ] Never auto-correct accounting, inventory, payroll, or migration data solely because an alert fired.

## Recommended severity policy

| Severity | Typical examples | Suggested response |
| --- | --- | --- |
| Critical | Sustained unavailability, repeated 5xx spike, confirmed critical integrity event | Immediate notification to responsible operator |
| Warning | Repeated large responses, elevated latency, non-critical integrity anomaly | Review during active operating hours |
| Informational | Recovery notifications and expected maintenance observations | Record for audit/history |

## Noise controls

- Require a minimum failure count or time window before alerting.
- Add cooldown/deduplication for repeated identical events.
- Send recovery notifications.
- Maintain separate production and non-production alert routes.
- Review alert volume after deployment and tune thresholds without suppressing real failures.

## Notification routing checklist

- [ ] Name a primary owner for production alerts.
- [ ] Name a backup/escalation contact.
- [ ] Select approved notification channels (for example provider app, email, or team messaging integration).
- [ ] Confirm that secrets are stored in the hosting/provider secret store, never committed to the repository.
- [ ] Document who can change alert rules and destinations.

## Validation checklist

Perform these steps only with authorized access to the relevant deployment and monitoring provider:

- [ ] Confirm the production liveness monitor reports healthy.
- [ ] Trigger a safe synthetic monitor failure or use the provider's test-notification feature.
- [ ] Confirm the intended recipient receives the test alert.
- [ ] Confirm recovery notification delivery.
- [ ] Confirm no sensitive request or response data appears in the provider.
- [ ] Confirm repeated identical events are deduplicated or rate-limited as intended.
- [ ] Record the provider, monitor names, alert owners, validation date, and evidence location in the private operations record.

## Rollback

If alerting is noisy or incorrectly routed, disable or mute the external alert rule at the provider while leaving the ERP health endpoints and internal event detection intact. Do not remove application observability merely to silence an external notification problem.

## Operational validation status

Repository-side guidance is complete when this checklist is reviewed and merged. External provider configuration, notification delivery, production monitor health, and backup contact reachability remain **not validated** until an authorized operator performs and records the validation steps above.
