# Supplier Partner Finalization — Phases 9 and 10

## Phase 9 — Migration rehearsal

The disposable PostgreSQL rehearsal verifies the complete SP schema and migration prerequisites, including stock master linkage, aliases, opening data surfaces, historical sales tables, containers and Goods-OTW data, supplier links, users, roles, locations, cash/accounting tables, quantity/value reconciliation, Migration Suspense, and rollback safety.

The rehearsal fails closed for unknown stock codes, duplicate aliases, unmapped charges, missing suppliers, quantity differences, value differences, missing schema, or rollback drift.

Cutover rehearsal runs inside a database transaction and savepoint. The rollback rehearsal proves that target operational counts return exactly to their pre-cutover values.

## Phase 10 — Full regression and release verification

The dedicated workflow runs TypeScript, production build, lint, formatting, schema preparation, migration registry verification, production startup migrations, SP migration rehearsal, lifecycle tests, backend regression, API smoke, frontend tests, company-isolation and permission contracts, English/Arabic/French audit, production-readiness and bandwidth contracts, dependency audit, Node 22 serial PostgreSQL regression, and secret scanning.

No SP lifecycle test may be skipped or marked todo in the release workflow. A release decision is allowed only when every required job is green.

## SQL

No manual SQL is required. The rehearsal uses a disposable database and transaction rollback. Runtime-created SP support tables remain idempotent.
