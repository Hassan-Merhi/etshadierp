# Program 3C — Database tenant safeguards

Status: implemented by scope on `security/program-3c-database-tenant-guards`.

This branch is stacked on Program 3B, which is stacked on Program 3A. Merge order must remain 3A, then 3B, then 3C.

## Purpose

Programs 3A and 3B enforce company ownership and operational permissions in the application. Program 3C adds a second database-level boundary for the small authentication and POS control tables that decide what a user may access.

No accounting facts, inventory quantities, voucher entries, container costing, payroll, or rental data are changed.

## Read-only integrity audit

`scripts/tenant-control-integrity-audit.mjs` connects using `DATABASE_URL` and opens a PostgreSQL `BEGIN READ ONLY` transaction.

It reports:

- duplicate `(user_id, company_id)` role rows;
- orphan user or company references;
- role locations belonging to another company;
- role cash accounts belonging to another company;
- inactive, deleted, or non-Cash role cash accounts as warnings;
- invalid or duplicate user-location assignments;
- invalid location-specific POS cash mappings;
- orphan role-feature permission companies; and
- named permissions whose user/company/role relationship is incomplete.

It executes SELECT statements only and always rolls back before disconnecting.

Review command:

```bash
DATABASE_URL='postgresql://...' \
  node scripts/tenant-control-integrity-audit.mjs --json
```

Optional sample limit:

```bash
DATABASE_URL='postgresql://...' \
  node scripts/tenant-control-integrity-audit.mjs --sample-limit=10
```

The audit has **not** been run against production.

## Versioned migration

Migration `0013_tenant_control_integrity_guards` is registered as journal index 13.

It is not part of application startup. Applying it still requires the Program 4 opt-in boundary:

```bash
MIGRATION_CONFIRMATION=APPLY_VERSIONED_MIGRATIONS \
  node scripts/run-versioned-migrations.mjs --apply
```

Do not run that command until all of the following exist:

1. a reviewed audit report;
2. a current verified backup;
3. a restore rehearsal for the backup when required by the migration risk class;
4. a deployment and rollback plan; and
5. explicit owner approval.

## Database protections

### `NOT VALID` foreign keys

The migration adds company/user foreign keys for:

- `user_company_roles`;
- `user_locations`;
- `user_location_cash_accounts`;
- `role_feature_permissions`; and
- `user_security_permissions`.

The foreign keys are `NOT VALID` deliberately:

- PostgreSQL does not scan or rewrite historical rows during migration application;
- existing violations remain visible for separate review;
- new inserts and updates are protected immediately; and
- constraint validation can happen later as a separate reviewed migration after cleanup.

### Same-company child triggers

New or changed control rows cannot connect:

- a role to a location from another company;
- a role to a cash ledger from another company;
- a user-location assignment to another company's location; or
- a POS location mapping to a location or cash account from another company.

These checks validate company identity only. Active/deleted state and Cash account type remain application authorization rules from Program 3B; the audit reports historical violations without silently rewriting them.

### Parent company-move triggers

A referenced location or ledger account cannot have its `company_id` changed when that move would leave role/location/POS control rows pointing across companies.

## Intentionally deferred work

### Unique user role per company

The application already prevents creating a second role for the same `(user_id, company_id)`, but the database does not yet have a unique constraint.

A unique constraint is intentionally **not** included in migration 0013 because PostgreSQL cannot add it as `NOT VALID`. Adding it before reviewing duplicate rows could fail deployment or force an unsafe automatic cleanup.

After the read-only audit proves there are no duplicates—or after a separately approved repair—the unique constraint should be added in its own migration.

### Constraint validation

Migration 0013 does not run `VALIDATE CONSTRAINT`. Validation remains a separate future step after historical violations are reviewed and corrected explicitly.

## Schema alignment

`shared/schema/security.ts` now declares the existing company ownership of `user_security_permissions`. The remaining cross-company rules are trigger-based and intentionally remain in the versioned SQL migration because they span multiple tables.

## Safety and verification

- No migration was applied.
- No audit was run against production.
- No repair, backfill, delete, update, deployment, or production database command was executed.
- No accounting or inventory behavior changed.
- Static regression tests were added but have not been executed because GitHub Actions currently do not provide usable execution evidence.
