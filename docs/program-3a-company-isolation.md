# Program 3A — Company Isolation and Cross-Company Protection

Branch: `security/program-3a-company-isolation`

## 3A.1 — Admin and maintenance request scope

Implemented a shared active-company guard for the administrative surface.

The guard runs before:

- `/api/admin/*` repair and maintenance routes;
- orphaned-record reassignment and purge routes;
- location-summary routes that still accept a compatibility `companyId`;
- deleted-item routes; and
- stored-file routes registered through the admin router.

For `companyId` supplied in a query string, JSON body, or URL parameter, the guard:

1. rejects arrays, objects, non-integers, zero, and negative values;
2. rejects conflicting values supplied through multiple request sources;
3. compares the requested company with the server-owned active ERP/factory/properties company;
4. denies cross-company requests before route logic runs; and
5. writes a structured security log without including request payload contents.

Admin and Developer roles do not bypass this company comparison.

Existing route-level ownership checks remain in place. This guard is an additional boundary, not a replacement for canonical record ownership validation.

## Branch correction

The first draft attempted to place the boundary in the central authentication file. Static review found that rewrite had dropped the existing `requireNonPOS` export. Because the branch was still draft and unmerged, it was reset to the merged `main` commit and rebuilt without changing `auth.ts`. No merged code or production data was affected.

## Focused coverage

`tests/admin-company-scope-policy.test.ts` covers:

- no explicit company filter;
- matching query/body/path company IDs;
- malformed IDs;
- conflicting request sources;
- cross-company requests; and
- missing active-company context.

## Remaining Program 3A work

- Canonical ownership adapters for ID-only voucher, account, stock, container, attachment, restore, and purge operations.
- Company-scoped user and role administration reads.
- Intercompany routes requiring authorization of both sides.
- Classification of global repair/export operations as active-company or Developer-only.

## Safety

- No migration, repair, backfill, deployment, or production command was executed.
- No accounting, inventory, POS, container, payroll, rental, or costing formula changed.
- PR remains draft and unmerged.
