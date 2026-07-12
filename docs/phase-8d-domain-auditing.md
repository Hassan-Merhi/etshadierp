# Phase 8D — Payroll, Accounts, Users, Roles, and Migration Auditing

Phase 8D extends the shared audit framework introduced in Phase 8A to the remaining high-sensitivity administrative and financial mutation domains.

## Covered mutation areas

- ledger-account creation, updates, archival, and account-related repair flows;
- user creation, updates, deactivation, company-role assignment, page-access changes, and hidden-cost visibility changes;
- role and feature-permission updates;
- import, migration, cleanup, and administrative data-repair mutations.

These established mutation paths retain awaited `logAudit` calls. The Phase 8B compatibility adapter routes those calls through the shared `writeAuditEvent` implementation, so redaction, bounded payloads, normalization, and safe failure logging remain consistent.

## Payroll review and safety exception

The ERP payroll-run, salary-payment, advance-deduction, and undo paths were reviewed. Several legacy multi-step payroll mutations create vouchers, voucher entries, payroll records, deductions, and balance changes through separate database calls rather than one transaction.

Adding a mandatory audit insert to those non-atomic paths would not make the business mutation atomic and could introduce a new partial-commit failure point. Phase 8D therefore records a documented safety exception: no audit write is inserted into those legacy flows until they are first converted to a single transaction boundary. Existing voucher auditing remains available for payroll-generated accounting vouchers where the established voucher flow already emits it.

This is a safety boundary, not a claim that payroll is transactionally hardened. The later accounting and concurrency packages should convert the relevant payroll mutations before transaction-bound payroll audit events are added.

## Safety requirements

- Audit writes remain awaited for the covered critical administrative mutations.
- Financial mutations already inside a database transaction should pass the active transaction executor to the shared audit writer where practical.
- Audit payloads contain stable identifiers and bounded field-level changes only; they must not contain passwords, reset tokens, session data, uploaded file contents, raw import rows, SQL, connection strings, or full request bodies.
- Audit coverage must not change payroll math, ledger balances, authorization decisions, migration behavior, transaction boundaries, response shapes, or production data.

## Regression verification

`server/services/audit/phase8dCoverage.test.ts` guards the account, user, role, migration, cleanup, and repair audit call sites and verifies that the compatibility adapter remains connected to the shared audit framework. It also keeps the reviewed payroll safety exception explicit so it cannot be silently mistaken for transaction-bound payroll audit coverage.

Phase 8D is complete within these documented safety boundaries.
