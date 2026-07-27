# Properties Mode Navigation Audit Status

## Phase 1 — complete

- Added the authoritative Properties Mode navigation registry.
- Inventoried every route in `PropertiesRoutes.tsx`.
- Mapped pinned links, Rentals, Accounting, footer links, hidden detail pages, admin tools, permission gates, shell exceptions, and fallback behavior.
- Recorded existing deterministic parents and every missing parent relationship.
- Documented the recommended Rentals hub model and the unresolved Dashboard and Account Groups decisions for later phases.
- Confirmed Phase 1 changes are documentation-only and do not alter property, rental, voucher, ledger, accounting, analytics, or administrative logic.

## Phase 2 — pending

- Implement the Rentals navigation structure.
- Standardize section state and direct-link behavior.
- Map Create Property to Warehouses.
- Resolve Dashboard status.

## Phase 3 — pending

- Complete deterministic parent mappings.
- Align visible Back and Escape behavior.
- Add regression coverage.

## Phase 4 — pending

- Add canonical aliases and compatibility redirects.
- Normalize invalid or retired routes with replacement history.
- Preserve permission and safe fallback behavior.

## Phase 5 — pending

- Run final navigation regression verification.
- Reconcile with latest `main`.
- Confirm navigation-only scope before merge.
