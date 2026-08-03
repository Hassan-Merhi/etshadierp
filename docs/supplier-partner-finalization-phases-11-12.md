# Supplier Partner Finalization — Phases 11–12

## Phase 11 — Production cutover controls

The existing cutover implementation remains authoritative for preparation, final delta synchronization, user/location/cash mapping, target activation, source write locking, rollback deadline, and controlled rollback.

Production operators must record evidence for:

- verified database backup;
- final-verification PASS;
- final delta synchronization;
- production smoke tests;
- rollback availability.

Evidence is company- and cutover-scoped and is never inferred from a UI click alone.

## Phase 12 — Stabilization and final closure

The closure status endpoint requires PASS evidence for:

- daily sales and stock;
- container and offload postings;
- supplier statement versus ledger;
- Sales Form and profit split;
- source-company write lock;
- production log review;
- supplier links;
- Migration Suspense.

It also independently queries the database for post-activation source vouchers and Migration Suspense entries. Any mismatch blocks closure.

The rollback window may be closed only by an Admin using the exact confirmation `CLOSE SP ROLLBACK WINDOW`, a meaningful reason, and an all-PASS status. Closure stores the complete completion snapshot and changes the active cutover to completed.

## Endpoints

- `GET /api/sp/production/closure-status`
- `POST /api/sp/production/evidence`
- `POST /api/sp/production/close-rollback-window`

## SQL classification

### Required manual SQL

None.

### Repair SQL

None.

### Diagnostic-only SQL

None. The endpoints perform the required diagnostics directly.
