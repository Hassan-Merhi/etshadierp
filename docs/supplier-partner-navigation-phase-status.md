# Supplier Partner Navigation Audit Status

## Phase 1 — complete

- Added the authoritative Supplier Partner navigation registry.
- Inventoried all `/sp` routes, current sidebar entries, internal report tabs, compatibility paths, and existing parent mappings.
- Added a company-type boundary so `/sp` and `/sp/*` only mount for `supplier_partner` companies.
- Added replacement fallback to `/tracking` for direct SP route access from any other company type.
- Established `/sp` as the stable Supplier Partner namespace entry.
- Preserved all Supplier Partner accounting, stock, payable, profit split, export, setup, alias, opening-stock, and migration business logic.

## Phase 2 — complete

- Added `/sp` as the real Supplier Partner overview hub.
- Added direct cards for Reports, Opening Stock, Aliases, Setup, and Migration.
- Split the sidebar into Supplier Partner daily work and SP Administration.
- Centralized Supplier Partner navigation definitions in one shared source.
- Included Supplier Partner pages in Recent navigation for Supplier Partner companies.
- Ensured sidebar sections and active-route handling use the same shared route definitions.
- Added focused regression coverage for landing, section organization, Recent registration, and navigation-only scope.

## Phase 3 — complete

- Converted Reports to validated URL-backed tab state.
- Kept Supplier Payable as the clean default route at `/sp/reports`.
- Added canonical deep links for `/sp/reports?tab=profit` and `/sp/reports?tab=sales-form`.
- Invalid tab values canonicalize back to the default using replacement history.
- Refresh and browser navigation now restore the selected report tab.
- Preserved the payable, profit, profit-split, locations, accounts, and both sales-form export contracts.
- Added focused regression coverage for tab URLs and endpoint preservation.

## Phase 4 — pending

- Consolidate Setup and Migration under Supplier Partner administration/settings.
- Tighten role permissions.
- Canonicalize the duplicate migration routes using replacement redirects.

## Phase 5 — pending

- Complete deterministic Back and Escape mappings.
- Add unknown `/sp/*` safe fallback.
- Add final regression coverage.
- Reconcile with latest `main` and confirm merge readiness.
