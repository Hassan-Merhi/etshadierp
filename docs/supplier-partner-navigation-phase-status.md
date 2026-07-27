# Supplier Partner Navigation Audit Status

## Phase 1 — complete

- Added the authoritative Supplier Partner navigation registry.
- Inventoried all `/sp` routes, current sidebar entries, internal report tabs, compatibility paths, and existing parent mappings.
- Added a company-type boundary so `/sp` and `/sp/*` only mount for `supplier_partner` companies.
- Added replacement fallback to `/tracking` for direct SP route access from any other company type.
- Established `/sp` as the stable Supplier Partner namespace entry.
- Until the Overview hub is introduced in Phase 2, `/sp` redirects with replacement history to `/sp/reports`.
- Preserved all Supplier Partner accounting, stock, payable, profit split, export, setup, alias, opening-stock, and migration business logic.

## Phase 2 — pending

- Add the Supplier Partner overview hub.
- Separate daily work from administration in the sidebar.
- Include Supplier Partner pages in recent-navigation registration.
- Normalize sidebar active-state behavior.

## Phase 3 — pending

- Convert Reports tabs to validated URL query state.
- Support direct links, refresh, and Back/Forward for Payable, Profit & Loss, and Sales Form.
- Preserve report data and export contracts.

## Phase 4 — pending

- Consolidate Setup and Migration under Supplier Partner administration/settings.
- Tighten role permissions.
- Canonicalize the duplicate migration routes using replacement redirects.

## Phase 5 — pending

- Complete deterministic Back and Escape mappings.
- Add unknown `/sp/*` safe fallback.
- Add regression coverage.
- Reconcile with latest `main` and confirm merge readiness.
