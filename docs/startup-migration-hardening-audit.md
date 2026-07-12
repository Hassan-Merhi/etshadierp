# Startup Migration Hardening Audit

## Scope

This phase covers all schema and data repair work executed from `server/index.ts` during application startup.

## Current risks found

1. Every application instance executes the full migration list concurrently.
2. The migration client uses statement and lock timeouts but no database-wide coordination lock.
3. Reconnect logic creates a new PostgreSQL session, so any future session-level coordination must be reacquired after reconnect.
4. DDL, idempotent repairs, and historical data rewrites are mixed in one startup path.
5. Some repairs are safe predicates, while others perform multi-step read/modify/write work that can interleave across instances.
6. Migration failures are logged but startup continues, leaving the database health endpoint unable to distinguish complete success from partial failure.
7. Several one-time markers use check-then-insert patterns that can race unless protected by a unique conflict-safe insert or a migration lock.
8. Foreign-key drop/re-add statements run on every boot and can request high-level table locks even when the desired constraint is already correct.

## Hardening plan

- Add a PostgreSQL advisory lock around the complete startup migration and repair sequence.
- Use bounded lock acquisition so a stuck deployment cannot wait forever.
- Reacquire the advisory lock after connection-drop recovery before retrying a migration.
- Always release the lock in `finally` before closing the dedicated client.
- Track migration outcome explicitly: `starting`, `ready`, `degraded`, or `failed`.
- Make `/api/health/db` report partial migration failure rather than claiming readiness.
- Keep safe schema verification at startup, but classify expensive historical rewrites for later extraction into explicit operational migrations.
- Add tests for lock acquisition, lock contention, release-on-error, and repeat execution.

## Safety boundary

This phase must not change accounting, inventory quantities, voucher postings, customer balances, or other business calculations. It only coordinates and reports migration execution more safely.
