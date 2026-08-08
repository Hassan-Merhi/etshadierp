# Program 3B — Operational permissions

Status: implemented by scope on `security/program-3b-operational-permissions`.

This branch is stacked on Program 3A and must not be merged before the Program 3A company-isolation branch.

## Live active-company permission context

Operational permission checks now load the current role and POS fields from `user_company_roles` instead of trusting login-time session values.

The request-scoped context includes:

- active company and role;
- assigned location;
- fallback cash account;
- POS station;
- negative-stock permission;
- POS view-only state;
- date-edit window;
- customer access; and
- delete permission.

Permission company resolution is path-aware:

- Factory and Properties routes use the server-pinned `factoryCompanyId`;
- ERP, POS, import, export, repair, and report routes use `currentCompanyId`;
- historical ERP container document/freight aliases below `/api/factory` remain on the ERP company.

This prevents one browser tab's Factory role from authorizing an ERP action in another tab.

## Permission middleware

Role-feature checks now:

- load the role for the active company from canonical storage;
- keep Developer/Admin feature bypass only after that role is resolved;
- cache permission rows only for the current request and company-role pair;
- use the Factory/Properties company when appropriate; and
- fail closed with HTTP 503 if permission storage is unavailable.

The previous fail-open behavior on permission database errors was removed.

## POS operational boundaries

All POS routes now run through live operational guards before business handlers.

For POS users the guards enforce:

- `posViewOnly` against every POS mutation;
- exact assigned-location ownership against an active, non-deleted company location;
- existing-sale location ownership during edits;
- no location changes during POS edits;
- location-specific cash-account mappings;
- fallback role cash accounts only when no location mappings exist; and
- Cash type, company ownership, active state, and non-deleted state for selected cash ledgers.

Stale or cross-company cash mappings are rejected before voucher or inventory posting begins.

## POS capability permissions

The following catalog permissions are now enforced server-side:

- `pos_perm_credit_sale` for credit sales;
- `pos_perm_discount` when request or item discount fields are positive;
- `pos_perm_override_price` when a submitted price differs from the configured location/default price;
- `pos_perm_open_shift` for shift opening and closing; and
- `pos_perm_view_shift_summary` for shift history and shift-detail reports.

Admin and Developer keep the catalog's existing bypass. Other roles follow the configured role-feature permission semantics.

## Imports, repairs, and exports

A centralized route classifier runs before legacy handlers.

- Import workflows require `act_import_data`.
- POS and View Only roles are blocked from historical/bulk import workflows.
- Company-scoped repair, recalculation, rebuild, cleanup, backfill, reconciliation, resync, and fix mutations require `act_bulk_operations`.
- Excel, PDF, stock-report, print, WhatsApp, and backup routes use their matching `exp_*` permissions.
- The all-company `/api/export/*` center is Developer-only because it creates archives containing every company.

The classifier supplements existing route authentication and role checks; it does not replace business validation.

## Safety boundaries

- No accounting, inventory, costing, payroll, container, or rental formula changed.
- No database migration, repair, backfill, production command, or deployment was executed.
- No workflow was rerun.
- Focused policy tests were added but have not been executed because GitHub Actions currently fail before exposing steps or logs.
