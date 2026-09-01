# Supplier Partner Finalization — Phases 11–12

## Scope

This implementation ports the Phase 11–12 production-evidence and stabilization-closure safeguards onto the current `main` branch. It does not assert that a real production cutover has been executed.

## Phase 11 — Production cutover evidence

The existing cutover workflow remains authoritative for preparation, final delta synchronization, mappings, target activation, source write locking, rollback deadline and controlled rollback.

Operators can record company- and cutover-scoped evidence for:

- verified database backup;
- final verification;
- final delta synchronization;
- production smoke testing;
- rollback availability;
- migration archive.

Evidence writes require the Phase 7 `sp_migration` permission, exact confirmation `RECORD SP PRODUCTION EVIDENCE`, a meaningful reason and an idempotency key. Every attempt is auditable.

## Phase 12 — Stabilization and closure

Closure requires PASS evidence for daily sales/stock, offload postings, supplier statement/ledger, Sales Form/profit split, source write lock, production logs, supplier links and Migration Suspense.

The status endpoint also independently checks the database for post-activation source vouchers and non-zero Migration Suspense entries. Any missing or failing check blocks closure.

Closing the rollback window requires `sp_migration`, exact confirmation `CLOSE SP ROLLBACK WINDOW`, a meaningful reason and an idempotency key. It atomically marks the active cutover completed and inserts one immutable completion snapshot.

## Startup-managed storage

Application startup idempotently initializes:

- `sp_production_evidence`;
- `sp_completion_records`.

No manual production SQL is required for these two tables.

## Endpoints

- `GET /api/sp/production/closure-status`
- `POST /api/sp/production/evidence`
- `POST /api/sp/production/close-rollback-window`

## Operational boundary

The code, tests and safeguards may be released independently. A real production cutover and its evidence must only be recorded by authorized operators after the actual operational steps occur.
