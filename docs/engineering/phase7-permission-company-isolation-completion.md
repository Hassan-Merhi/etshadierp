# Phase 7 — Permission and Company-Isolation Completion

Phase 7 establishes one reusable backend boundary for resolving the authenticated user, active company, privileged cross-company access, and explicit company membership. It preserves existing business behavior while removing role-only cross-tenant assumptions from sensitive routes.

## Explicit company membership

Every company-scoped request must resolve an authenticated user and a positive active company from the session. A user may access a company only when `getUserCompaniesWithRoles` contains an explicit role for that company. Admin, Owner, and Developer status does not by itself grant access to every company in the database.

## Privileged cross-company access

A requested company override is accepted only for Admin, Owner, or Developer roles. The override is then checked against the user’s explicit company memberships. Non-privileged users remain bound to the active company. Invalid identifiers return a controlled 400 response; missing authentication returns 401; denied membership or cross-company access returns 403.

## Active company

The active company is resolved centrally from `req.session.currentCompanyId`. Routes no longer duplicate parsing rules or silently continue with an undefined company. The central context returns the authenticated user ID, active company ID, and current role as one consistent authorization input.

## Transfer boundary

Company-transfer authorization now delegates to the central company-access boundary. Source and destination company checks share the same membership rules as other protected routes. The compatibility `TransferRouteError` mapping remains so existing transfer API response behavior is preserved.

## Financial exports

The monthly net-position Excel export now requires non-POS access and resolves an optional company override through the central boundary. Previously, an Admin or Developer could provide an arbitrary company ID and the route trusted the role alone. The route now requires both a privileged role and explicit access to the requested company.

The export still uses the same workbook generator, date handling, company naming, headers, and output format.

## Reusable boundary

`server/security/companyAccessBoundary.ts` provides:

- authenticated company context resolution;
- privileged-role classification;
- accessible-company set resolution;
- one-company and multi-company membership assertions;
- authorized active/override company resolution;
- consistent authorization error codes and HTTP responses.

This boundary is intended for remaining company-scoped routes, exports, background jobs, repair tools, and cross-company workflows so authorization behavior does not drift between modules.

## Compatibility retained

- Existing company-role storage remains authoritative.
- Existing transfer routes and services retain their public API shape.
- Existing workbook data calculations and filenames remain unchanged.
- POS users remain excluded from general financial exports.
- No schema or production migration is introduced.
- No automatic role grants or company-role backfills are performed.

## Verification boundary

The Phase 7 verifier rejects duplicate transfer-owned role lookup logic, role-only company overrides in the monthly net-position export, missing explicit membership enforcement, and missing controlled authorization codes. A focused source contract covers the central boundary, transfer integration, and financial export protection.

The verifier and contract test were added but not executed because the owner requested no CI checks. No TypeScript, lint, unit, integration, database, build, browser, or deployment result is claimed.

## Merge boundary

Keep this phase as a draft and do not merge without explicit owner authorization. Earlier draft phases remain unmerged and may require ordered reconciliation before final integration.
