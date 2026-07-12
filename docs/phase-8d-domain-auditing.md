# Phase 8D — Payroll, Accounts, Users, Roles, and Migration Auditing

Phase 8D extends the shared audit framework introduced in Phase 8A to the remaining high-sensitivity administrative and financial mutation domains.

## Target mutation areas

- payroll runs, payroll updates, worker advances, settlements, approvals, and payroll accounting posts;
- ledger-account creation, updates, archival, and account-related repair flows;
- user creation, updates, deactivation, company-role assignment, page-access changes, and hidden-cost visibility changes;
- role and feature-permission updates;
- import, migration, cleanup, and administrative data-repair mutations.

## Safety requirements

- Audit writes must be awaited for completed critical mutations.
- Financial mutations already inside a database transaction should pass the active transaction executor to the shared audit writer where practical.
- Audit payloads must contain stable identifiers and bounded field-level changes only; they must not contain passwords, reset tokens, session data, uploaded file contents, raw import rows, SQL, connection strings, or full request bodies.
- Audit coverage must not change payroll math, ledger balances, authorization decisions, migration behavior, transaction boundaries, response shapes, or production data.

## Verification strategy

The package uses focused regression guards to keep established user, role, account, and migration audit call sites connected to the shared `writeAuditEvent` path. Payroll and other transaction-sensitive flows are reviewed separately before the package is considered complete so that audit insertion does not create partial commits or alter accounting behavior.

This document intentionally distinguishes established coverage from remaining integration work. Phase 8D must not be marked complete until all target areas have either transaction-bound audit writes or an explicit documented safety exception.