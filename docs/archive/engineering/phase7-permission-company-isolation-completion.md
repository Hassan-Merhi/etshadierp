# Phase 7 — Permission and Company-Isolation Completion

Phase 7 establishes one reusable backend boundary for resolving the authenticated user, active company, privileged cross-company access, and explicit company membership. Existing business behavior and response shapes are preserved while route-local role-only cross-tenant assumptions are removed from the routes touched by the bandwidth program.

## Explicit company membership

Every protected company-scoped request resolves an authenticated user and a positive active company from the session. The active role is read from `session.currentRole` with the authenticated user role as fallback.

Admin and Owner accounts may access only companies present in `getUserCompaniesWithRoles`. Developer accounts retain the pre-existing application behavior that exposes every company through `/api/user/companies` and permits selecting those companies through `/api/auth/set-company`. The shared access boundary resolves that same Developer scope so a valid company selection cannot be rejected by downstream Daybook, voucher, offload, GIT, supplier, or report endpoints.

## Privileged cross-company access

A requested company override or all-accessible-companies view is accepted only for Admin, Owner, or Developer roles. Admin and Owner results remain restricted to explicit company memberships. Developer results use the same synthetic all-company scope already exposed by the company selector. Non-privileged users remain bound to the active company.

Invalid identifiers return a controlled `400`; missing authentication returns `401`; denied membership and forbidden cross-company access return `403`. Responses include stable codes such as:

- `INVALID_COMPANY_ID`
- `AUTH_REQUIRED`
- `CROSS_COMPANY_FORBIDDEN`
- `COMPANY_ACCESS_DENIED`

## GIT containers and reports

GIT container lists, container details, summary reports, at-port reports, truck-location reports, and agent/duty summaries now use the central accessible-company set.

Route-local assumptions that Admin or Developer automatically meant unrestricted database access were removed. Admin and Owner all-company mode means all explicitly assigned companies. Developer all-company mode is resolved centrally from the same company list used by the selector.

## Voucher and Daybook boundary

The voucher list and voucher-detail routes assert access to the active company before reading data. Optional voucher history uses the same boundary.

Supplier unified-ledger and supplier purchase-order routes no longer trust an arbitrary `companyId` or load every company locally. They resolve an authorized override or query only the user’s centrally resolved accessible companies. Container links extracted from supplier narrations are also restricted to those allowed companies.

## Offload boundary

Offload list, detail, optional-status toggle, and diagnostics routes assert active-company access. Detail and mutation routes verify that the target offload belongs to the active company before loading items or changing inventory.

Voucher lookups based on container-number prefixes now include the offload company in the database condition, preventing a matching container number in another company from being read or modified.

## Existing protected boundaries retained

- Company-transfer authorization continues to delegate to the shared boundary.
- The monthly net-position Excel export continues to require non-POS access and an authorized company scope.
- Explicit company-role storage remains authoritative for every role except the application’s existing global Developer account behavior.
- Existing public route shapes, workbook calculations, filenames, costing behavior, and inventory calculations remain unchanged.
- No automatic Admin/Owner role grants or company-role backfills are performed.

## Reusable boundary

`server/security/companyAccessBoundary.ts` provides:

- authenticated active-company context resolution;
- positive company-ID parsing;
- privileged-role classification;
- accessible-company set resolution aligned with the company selector;
- one-company and multi-company access assertions;
- authorized active/override company resolution;
- consistent authorization errors and HTTP responses.

## Database changes

No schema change, migration, SQL script, or data repair is required for Phase 7 or the Developer-scope consistency repair.

## Deferred verification

The source contract and verifier cover GIT reports, voucher and supplier routes, offload routes, stable error codes, and removal of route-local role-only company lookups. The Developer-scope regression test additionally verifies that the selector and central boundary use the same policy. TypeScript, lint, unit, integration, PostgreSQL, build, browser, deployment, and CI checks remain part of the repository verification pipeline.

## Merge order

Phase 5–6 must be integrated before Phase 7–8. The Developer-scope consistency repair applies after Phase 7–8 and does not require SQL or data backfill.
