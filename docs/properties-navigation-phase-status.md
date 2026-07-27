# Properties Mode Navigation Audit Status

## Phase 1 — complete

- Added the authoritative Properties Mode navigation registry.
- Inventoried every route in `PropertiesRoutes.tsx`.
- Mapped pinned links, Rentals, Accounting, footer links, hidden detail pages, admin tools, permission gates, shell exceptions, and fallback behavior.
- Recorded existing deterministic parents and every missing parent relationship.
- Documented the recommended Rentals hub model and the unresolved Dashboard and Account Groups decisions for later phases.
- Confirmed Phase 1 changes are documentation-only and do not alter property, rental, voucher, ledger, accounting, analytics, or administrative logic.

## Phase 2 — complete

- Added `/properties/rentals` as the shared Rentals hub.
- Standardized Warehouses, Shops, and Payments on one validated `tab` query-state contract.
- Used replacement history for tab changes so browser Back remains focused on meaningful page transitions.
- Redirected the three legacy rental URLs to their canonical hub tabs with replacement history.
- Updated all Properties sidebar rental links to canonical hub URLs.
- Updated warehouse and shop payment-log navigation to remain inside the shared hub.
- Preserved the existing rental pages and APIs without changing contracts, balances, payments, accruals, units, tenants, or accounting behavior.
- Retained `/properties/dashboard` as a hidden compatibility route because repository usage only proves route-table and command-palette access; it is not the operational landing page.
- Confirmed `/properties/daybook` remains the Properties company landing and unknown-route fallback.

## Phase 3 — complete

- Completed deterministic parent mappings for Rentals, accounting details, and administration children.
- Mapped Create Property to the Warehouses tab and Cash Transfer to the Rentals hub.
- Mapped legacy rental routes to their exact canonical Rentals tabs.
- Confirmed voucher detail/edit, monthly ledger, and ledger voucher hierarchy.
- Classified Account Groups under Accounts after verifying its accounting role.
- Mapped Net Position, diagnostics, repair, reset, deleted, orphaned, and chatbot pages to Settings.
- Added focused Properties parent-route regression tests, including root-page null-parent protection and query/hash normalization.
- Visible Back and Escape now share the same registered parent contract through the existing navigation system.

## Phase 4 — pending

- Add canonical aliases and compatibility redirects.
- Normalize invalid or retired routes with replacement history.
- Preserve permission and safe fallback behavior.

## Phase 5 — pending

- Run final navigation regression verification.
- Reconcile with latest `main`.
- Confirm navigation-only scope before merge.
