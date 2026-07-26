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

## 3A.2 — Company-scoped administration and maintenance — implemented

The live authentication boundary now intercepts high-risk global and ID-only administration operations before their legacy handlers.

### User administration

- `GET /api/users` returns only users assigned to the active company and excludes Developer accounts.
- `GET /api/users/:userId/company-roles` returns only the target user's role for the active company.
- PATCH/DELETE of a user and Admin password reset require the target user to belong to the active company.
- A user shared by multiple companies cannot be globally edited, deleted, or password-reset by a company Admin. The request returns `SHARED_USER_GLOBAL_MUTATION_BLOCKED`; the company role must be managed instead.
- PATCH/DELETE of `user_company_roles` loads the role record first and verifies its canonical company ownership.
- A role assignment cannot be moved to another company through a body update.

### Destructive maintenance

`POST /api/cleanup/orphaned-charges` previously scanned `CHARGE-*` vouchers globally. The protected path now:

1. selects vouchers only from the active company;
2. checks purchase orders through containers owned by that company;
3. deletes voucher entries and vouchers transactionally; and
4. keeps a final company predicate on the voucher deletion.

### Focused coverage

`tests/company-scoped-administration-policy.test.ts` verifies route classification and proves that global user mutation is allowed only for a user exclusive to the active company.

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

### ID-only business-resource operations

Routes that accept only a record ID must load the record's canonical company before read, update, delete, restore, export, or repair. Remaining high-priority examples include:

- voucher and account ID operations;
- stock and container repair endpoints;
- attachments and exports; and
- deleted-record restore/purge actions.

These will use `authorizeCompanyScopedResourceTx` with a database ownership adapter instead of trusting a request filter.

### Reports, imports, exports, and repairs

All report/export/import/repair paths will be classified as either:

- active-company only;
- explicitly intercompany with both sides authorized; or
- Developer-only global maintenance.

### Intercompany operations

Explicit intercompany routes must validate both the source and destination company and must not treat authorization for one company as authorization for the other.

## Safety

- No database migration, repair, backfill, deployment, or production command was executed.
- No accounting, inventory, POS, container, payroll, or rental formula was changed.
- The branch remains draft and unmerged until the phase is complete and explicitly approved.

## Verification limitation

GitHub Actions has recently failed before exposing executable steps or logs. A full build, type-check, browser test, database test, and security scan pass is not claimed unless usable execution evidence becomes available.
