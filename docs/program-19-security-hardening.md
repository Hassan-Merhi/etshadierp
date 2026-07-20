# Program 19 — Security Hardening

## Objective

Strengthen early runtime request boundaries and centralize security-policy ownership without changing application authorization, permissions, API contracts, business logic, persistence, accounting, inventory, costing, or historical data.

## Phase 19A — Runtime Security Configuration

### Completed

- Added `server/securityRuntimeConfig.mjs` as the owner of early runtime security policy.
- Centralized the supported HTTP method set.
- Added bounded validation for request-target length and request-header count.
- Added one immutable set of safe response headers for early responses and rejected requests.
- Recorded the currently permitted Capacitor origins without changing the application CORS or origin-guard implementation.
- Production rejects malformed numeric security settings; development warns and falls back to documented defaults.
- Startup logs contain policy metadata only and never include cookies, authorization headers, session secrets, database credentials, request bodies, or CSRF tokens.

### Supported settings

| Setting | Default | Accepted range |
|---|---:|---:|
| `MAX_REQUEST_TARGET_BYTES` | 8192 | 1024–32768 |
| `MAX_REQUEST_HEADER_COUNT` | 100 | 20–250 |

## Phase 19B — Early Request Boundary Guard

### Completed

- Added `server/runtimeSecurityGuard.mjs` and loaded it before health, observability, lifecycle, memory protection, and `dist/index.js`.
- Added safe baseline response headers before application middleware runs.
- Rejects unsupported HTTP methods with `405 METHOD_NOT_ALLOWED`.
- Rejects oversized request targets with `414 REQUEST_TARGET_TOO_LONG`.
- Rejects excessive header counts with `431 TOO_MANY_HEADERS`.
- Rejections return small JSON responses with `Cache-Control: no-store` and do not echo request data.
- Guard installation is idempotent through a global symbol.
- Existing Helmet, session-cookie configuration, application body limits, origin guard, CSRF synchronizer token, role enforcement, and route authorization remain authoritative and unchanged.

## Phase 19C — Security Event Observability

### Completed

- Added `server/runtimeSecurityEvents.mjs` as a bounded, in-memory security-event recorder.
- Added counters by stable rejection code.
- Retains only the 50 most recent early-boundary events to prevent unbounded memory growth.
- Emits structured warning logs for rejected requests.
- Logs only event time, stable code, bounded method, status code, and bounded numeric or policy detail.
- Does not log URLs, query strings, headers, cookies, tokens, request bodies, credentials, or database details.
- Added an immutable snapshot function for later observability integration without exposing a new public endpoint.

## Phase 19D — Security Ownership and Change Boundaries

### Completed

- Established `securityRuntimeConfig.mjs` as the sole owner of early infrastructure security limits and safe early-response headers.
- Established `runtimeSecurityGuard.mjs` as the sole early request-boundary enforcement layer.
- Established `runtimeSecurityEvents.mjs` as the owner of bounded early-rejection telemetry.
- Kept authentication, authorization, role enforcement, company isolation, CSRF, CORS, session policy, uploads, and route validation in existing application middleware and services.
- Documented that early runtime guards must never make business authorization decisions or inspect request bodies.
- Documented that new security limits must be bounded, backward-compatible, and secret-safe.

## Security ownership rules

1. Runtime security configuration owns bounded infrastructure policy only.
2. The early request guard may reject structurally unsafe HTTP requests but must not infer users, roles, companies, permissions, or business actions.
3. Application middleware remains responsible for authentication, authorization, CSRF, CORS, session handling, uploads, and route-level validation.
4. Security logs must never include credentials, cookies, tokens, authorization headers, request bodies, URLs with query strings, or database connection strings.
5. New limits must remain bounded, documented, and backward-compatible with legitimate application traffic.
6. Security event retention must remain bounded and must not become a persistence or audit-log substitute.

## Future work requiring a runnable environment

- dependency and secret scanning;
- route-by-route authorization verification;
- upload and file-access penetration testing;
- runtime traffic replay;
- production validation.

These were not guessed, simulated, or reported as completed.

## Safety

- No permissions, role rules, company isolation, authentication flow, CSRF behavior, CORS behavior, session lifetime, route path, API contract, calculation, mutation, schema, migration, or persistence behavior was changed.
- No CI, GitHub Actions, deployment, database connection, dependency scan, secret scan, penetration test, runtime test, or production verification was run.

## Status

- Active branch: `quality/program-19-security-hardening`
- Phase 19A: complete.
- Phase 19B: complete.
- Phase 19C: complete.
- Phase 19D: complete.
- Program 19: complete and ready to merge.
