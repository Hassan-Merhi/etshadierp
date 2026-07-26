# Program 3A — Company Isolation and Cross-Company Protection

Started: 2026-07-26

Branch: `security/program-3a-company-isolation`

## Security rule

The server-owned active company is authoritative. A caller-supplied `companyId` does not grant access and privileged roles do not bypass tenant isolation.

Factory/properties mode resolves the active company from `session.factoryCompanyId`; ERP mode resolves it from `session.currentCompanyId`.

## 3A.1 — Explicit company request boundary — implemented

`requireAuth` now parses `companyId` from:

- the query string;
- the JSON body; and
- URL parameters named `companyId`.

The boundary:

1. rejects non-positive, non-integer, array, and object identifiers;
2. rejects conflicting company IDs supplied through different request sources;
3. compares the requested company to the server-owned active company through the existing `companyIsolationPolicy`;
4. returns a non-leaking `Forbidden` response for cross-company requests; and
5. logs the denied company, user, role, method, route, and policy code.

An Admin or Developer cannot bypass this comparison. The user must switch company through the authenticated company-switch workflow before operating on that company.

This protects the many existing routes that still accept `companyId` for compatibility without requiring an immediate high-risk rewrite of each route file.

## Existing policy reused

The repository already contained:

- `authorizationPolicy.ts` — default-deny role/permission policy;
- `companyIsolationPolicy.ts` — canonical-storage ownership checks and strict same-company enforcement; and
- `tests/company-isolation-policy.test.ts` — regression coverage proving Admin does not bypass tenant scope.

Program 3A extends that existing boundary rather than introducing a competing authorization model.

## Focused coverage added

`tests/company-request-scope-policy.test.ts` covers:

- no explicit company;
- query, body, and path parsing;
- matching identifiers across request sources;
- invalid identifiers; and
- conflicting identifiers.

## Remaining 3A work

### ID-only resource operations

Routes that accept only a record ID must load the record's canonical company before read, update, delete, restore, export, or repair. High-priority examples include:

- user-company-role PATCH/DELETE;
- voucher and account ID operations;
- stock and container repair endpoints;
- attachments and exports; and
- deleted-record restore/purge actions.

These will use `authorizeCompanyScopedResourceTx` with a database ownership adapter instead of trusting a request filter.

### Global administration reads

User-management and configuration endpoints that currently return global rows must be reviewed so a company Admin sees only the active company's scope. Developer-only global behavior will be documented explicitly where retained.

### Reports, imports, exports, and repairs

All report/export/import/repair paths will be classified as either:

- active-company only;
- explicitly intercompany with both sides authorized; or
- Developer-only global maintenance.

## Safety

- No database migration, repair, backfill, deployment, or production command was executed.
- No accounting, inventory, POS, container, payroll, or rental formula was changed.
- The branch remains draft and unmerged until the phase is complete and explicitly approved.

## Verification limitation

GitHub Actions has recently failed before exposing executable steps or logs. A full build, type-check, browser test, database test, and security scan pass is not claimed unless usable execution evidence becomes available.
