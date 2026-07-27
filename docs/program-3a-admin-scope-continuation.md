# Program 3A — Admin Company Scope Continuation

This continuation starts from the current `main` after the original Program 3A PR had already merged.

## Implemented

Administrative and maintenance routes now reject a caller-supplied `companyId` unless it matches the server-owned active ERP, Factory, or Properties company.

Protected surfaces include:

- `/api/admin/*` repair and maintenance operations;
- orphaned-record reassignment and purge;
- location-summary compatibility routes;
- deleted-item routes; and
- stored-file routes registered through the admin router.

The shared policy rejects malformed identifiers, conflicting query/body/path identifiers, missing active-company context, and cross-company requests. Admin and Developer roles do not bypass the company comparison.

Existing route-specific ownership checks remain active.

## Remaining

- Canonical ownership for ID-only voucher, account, stock, container, attachment, restore, and purge operations.
- Company-scoped user and role administration reads.
- Explicit authorization of both sides of intercompany operations.
- Classification of global repair and export operations as active-company or Developer-only.

No migration, repair, backfill, deployment, or production command was executed.
