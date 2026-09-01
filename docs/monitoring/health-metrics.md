# Health and internal metrics

## Public liveness

`GET /api/health`

Returns HTTP 200 while the Node process is serving requests. The response contains only:

- status
- current timestamp
- process uptime

This endpoint is safe for Render or an external uptime monitor and does not expose database, environment, user, or company details.

## Database readiness

`GET /api/health/db`

Remains the startup-migration readiness endpoint. It reports whether startup migrations are still running or the database is ready.

## Internal metrics

`GET /api/health/metrics`

Access is limited to authenticated `Admin` and `Developer` sessions. The endpoint reports:

- process uptime and non-sensitive memory totals
- request totals
- active requests
- successful, client-error, and server-error counts
- slow-request count
- request-duration buckets
- PostgreSQL pool maximum, total, idle, active, and waiting counts
- pool utilization percentage

The response intentionally excludes connection strings, hosts, credentials, SQL text, request bodies, cookies, authorization headers, user records, and company data.

## Status interpretation

- `ok`: no request is waiting for a database pool connection
- `degraded`: one or more requests are waiting for a pool connection

These metrics are process-local and reset when the application restarts. They are suitable for operational diagnosis and as a source for later external monitoring, not as permanent historical telemetry.
