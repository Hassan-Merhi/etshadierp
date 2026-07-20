# Program 15 — Database Optimization

## Objective

Improve database observability, pool safety, and query-execution guardrails without changing accounting totals, inventory quantities, costing, authorization, company isolation, SQL result semantics, or historical data.

## Phase 15A — Database Runtime Baseline and Guardrails

### Completed

- Audited the shared PostgreSQL pool entry point in `server/db.ts`.
- Preserved SSL selection, connection-source detection, request performance accounting, pool-pressure logging, and the existing 30-second default statement timeout.
- Added `server/lib/databaseConfig.ts` as the single owner of database runtime configuration.
- Added bounded parsing for pool maximum, pool minimum, connection timeout, idle timeout, statement timeout, and slow-query threshold.
- Invalid, fractional, negative, zero where disallowed, or unreasonably large environment values now fall back to safe defaults instead of reaching `pg.Pool` unchecked.
- Ensured `poolMin` can never exceed `poolMax`.
- Added startup logging for the effective bounded configuration without logging credentials or the connection string.

### Supported environment settings

| Setting | Default | Accepted range |
|---|---:|---:|
| `PG_POOL_MAX` | 10 | 1–100 |
| `PG_POOL_MIN` | 2 | 0–20, capped to max |
| `PG_CONNECTION_TIMEOUT_MS` | 8000 | 1000–60000 |
| `PG_IDLE_TIMEOUT_MS` | 120000 | 10000–600000 |
| `PG_STATEMENT_TIMEOUT_MS` | 30000 | 1000–120000 |
| `PG_SLOW_QUERY_MS` | 1000 | 100–60000 |

## Phase 15B — Query Telemetry and Pool Safety

### Completed

- Extended the existing pool query wrapper so query duration is measured for both request-scoped and background database work.
- Preserved request-scoped `recordDatabaseQuery` behavior exactly when a request performance context is active.
- Added threshold-based slow-query warnings for all pool queries.
- Slow-query logs contain duration and threshold only; SQL text, parameters, credentials, and business data are deliberately excluded.
- Preserved promise resolution, rejection, return values, query arguments, transaction behavior, statement timeout behavior, and Drizzle's shared pool integration.
- Preserved sustained pool-pressure detection and idle-client error reporting.

## Index and SQL Rewrite Decision

No index or SQL rewrite was added in 15A/15B. Program 6D already established that indexes must be supported by production-like `EXPLAIN (ANALYZE, BUFFERS)` evidence and reconciliation. Adding speculative indexes without current plan evidence would increase write and storage cost and is explicitly outside these phases.

Any future index candidate must record:

- complete filter, join, and ordering columns;
- existing usable indexes;
- scanned versus returned rows;
- before/after planning and execution time;
- buffer reads/hits;
- write/storage cost;
- accounting and inventory reconciliation where applicable.

## Safety

- No SQL query result was changed.
- No database schema or migration was changed.
- No index was added or removed.
- No accounting, inventory, costing, voucher, authorization, or company-isolation behavior was changed.
- No CI, GitHub Actions, deployment, migration execution, database query-plan collection, or production runtime check was run.

## Status

- Active branch: `quality/program-15-database-optimization`
- Phase 15A: complete.
- Phase 15B: complete.
- Program 15 remains unmerged until its later phases are completed.
