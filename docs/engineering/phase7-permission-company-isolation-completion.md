# Phase 7 — Permission and Company-Isolation Completion

Phase 7 establishes one reusable backend boundary for resolving the authenticated user, active company, privileged cross-company access, and explicit company membership. Existing business behavior and response shapes are preserved while role-only cross-tenant assumptions are removed from the routes touched by the bandwidth program.

## Explicit company membership

Every protected company-scoped request resolves an authenticated user and a positive active company from the session. The active role is read from `session.currentRole` with the authenticated user role as fallback. A user may access a company only when `getUserCompaniesWithRoles` contains an explicit role for that company.

Admin, Owner, and Developer status does not by itself grant access to every company in the database.

## Privileged cross-company access

A requested company override or all-accessible-companies view is accepted only for Admin, Owner, or Developer roles. The result is then restricted to the user’s explicit company memberships. Non-privileged users remain bound to the active company.

Invalid identifiers return a controlled `400`; missing authentication returns `401`; denied membership and forbidden cross-company access return `403`. Responses include stable codes such as:

- `INVALID_COMPANY_ID`
- `AUTH_REQUIRED`
- `CROSS_COMPANY_FORBIDDEN`
- `COMPANY_ACCESS_DENIED`

## GIT containers and reports

GIT container lists, container details, summary reports, at-port reports, truck-location reports, and agent/duty summaries now use the central membership set.

The previous behavior that allowed Admin or Developer users to read every company with an active container was removed. All-company mode now means all companies explicitly assigned to that user, not all companies in the database.

## Voucher and Daybook boundary

The voucher list and voucher-detail routes now assert access to the active company before reading data. Optional voucher history uses the same boundary.

Supplier unified-ledger and supplier purchase-order routes no longer trust an arbitrary `companyId` or load every company. They resolve an authorized override or query only the user’s accessible companies. Container links extracted from supplier narrations are also restricted to those allowed companies.

## Offload boundary

Offload list, detail, optional-status toggle, and diagnostics routes assert active-company membership. Detail and mutation routes verify that the target offload belongs to the active company before loading items or changing inventory.

Voucher lookups based on container-number prefixes now include the offload company in the database condition, preventing a matching container number in another company from being read or modified.

## Existing protected boundaries retained

- Company-transfer authorization continues to delegate to the shared boundary.
- The monthly net-position Excel export continues to require non-POS access and explicit membership for an override.
- Existing company-role storage remains authoritative.
- Existing public route shapes, workbook calculations, filenames, costing behavior, and inventory calculations remain unchanged.
- No automatic role grants or company-role backfills are performed.

## Reusable boundary

`server/security/companyAccessBoundary.ts` provides:

- authenticated active-company context resolution;
- positive company-ID parsing;
- privileged-role classification;
- accessible-company set resolution;
- one-company and multi-company membership assertions;
- authorized active/override company resolution;
- consistent authorization errors and HTTP responses.

## Database changes

No schema change, migration, SQL script, or data repair is required for Phase 7.

## Deferred verification

The source contract and verifier were expanded to cover GIT reports, voucher and supplier routes, offload routes, stable error codes, and removal of role-only company lookups. Per owner request, TypeScript, lint, unit, integration, PostgreSQL, build, browser, deployment, and CI checks were not run in this phase and remain part of the final all-phase verification.

## Merge order

This phase is stacked on the Phase 5–6 branch. Phase 5–6 must be integrated before Phase 7–8, and neither branch should be merged without explicit owner authorization.
