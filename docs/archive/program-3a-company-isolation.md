# Program 3A — Company Isolation and Cross-Company Protection

Started: 2026-07-26

Branch: `security/program-3a-company-isolation`

Status: implemented by scope; draft and unmerged.

## Security rule

The server-owned active company is authoritative. A caller-supplied `companyId` does not grant access, and privileged roles do not bypass tenant isolation.

Factory and Properties mode resolve the active company from `session.factoryCompanyId`; ERP mode resolves it from `session.currentCompanyId`.

## 3A.1 — Explicit company request boundary

`requireAuth` parses `companyId` from query, JSON body, and URL parameters. It rejects invalid or conflicting identifiers and requires the supplied company to match the server-owned active company through the existing strict `companyIsolationPolicy`.

Cross-company denials are logged with user, role, company, method, route, and policy code.

## 3A.2 — Canonical ID ownership

A pre-route company-resource guard classifies ID-based voucher, ledger, bank, fixed-asset, customer, employee, stock-item, location, ERP-container, and factory-container routes.

The guard loads company ownership from canonical database storage through `databaseCompanyIsolationAdapter` and returns a non-leaking not-found response when the record is missing or belongs to another company.

## 3A.3 — Company user and role administration

The company user gateway now scopes:

- user lists;
- active sessions;
- user company-role lists;
- security-permission targets;
- global user PATCH, DELETE, and password reset;
- new role assignments;
- ID-only role PATCH and DELETE;
- Developer-role assignment; and
- user-location and POS cash-account configuration.

Company Admins cannot operate on a user outside the active company or globally mutate a user whose account is shared with another company. Developer accounts and Developer-role assignments retain their explicit higher-security rules.

## 3A.4 — Deleted records and destructive maintenance

Deleted-item restore and purge routes load canonical ownership for locations, stock items, stock groups, ledger accounts, employees, customers, bank accounts, vouchers, factory records, proformas, and customer orders.

Global suppliers remain global maintenance and require Developer access.

Companyless maintenance routes are classified and restricted to Developer, including all-company equity repair, unattributable POS cleanup, orphaned-charge cleanup, account migration, parent-company settings, deployment/schema diagnostics, runtime schema changes, and historical intercompany repair.

Deleted-item checks now use the authoritative active-company resolver, including Factory and Properties mode.

## 3A.5 — Intercompany and global transaction protection

Intercompany configuration validates authorization for both source and destination companies. It also validates that each selected ledger belongs to the corresponding side of the pair.

Global transaction routes load the voucher's canonical company and require the user to have access to that company before returning or mutating the record.

A protected central global-transaction route handles company-aware list and type operations before the legacy module.

## 3A.6 — Factory company selection

Factory company selection is limited to active factory companies assigned to the user. A stale or unauthorized pinned factory is rejected instead of silently selecting a global factory.

Historical ERP-container aliases under `/api/factory` remain mapped to ERP company ownership and do not get misclassified as factory-container records.

## Focused coverage

Policy tests cover:

- explicit company parsing and conflicts;
- canonical resource-route classification;
- company user and role scope;
- deleted-item ownership classification;
- factory-company selection;
- global maintenance classification;
- global transaction classification;
- intercompany company and ledger pairs; and
- user-location configuration.

## Safety

- No database migration, repair, backfill, deployment, or production command was executed.
- No accounting, inventory, POS, container, payroll, rental, or costing formula was changed.
- The branch remains draft and unmerged pending explicit approval.

## Verification limitation

GitHub Actions has repeatedly failed before exposing executable steps or logs. A full build, type-check, browser test, database-backed test, and security scan pass is not claimed unless usable execution evidence becomes available.
