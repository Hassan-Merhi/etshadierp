# Supplier Partner Navigation Registry

## Purpose

This document is the authoritative route, hierarchy, access, and compatibility registry for Supplier Partner navigation. It covers navigation behavior only and does not redefine Supplier Partner accounting, stock, payable, profit split, export, setup, alias, opening-stock, or migration business rules.

## Company-type boundary

Supplier Partner routes are valid only when the selected company has:

```text
companyType === "supplier_partner"
```

Any direct `/sp` or `/sp/*` request while another company type is selected redirects with replacement history to `/tracking`. This prevents SP pages from mounting under a normal ERP, Factory, or Properties company context.

## Canonical route inventory

| Route | Screen | Current role |
|---|---|---|
| `/sp` | Supplier Partner Overview | Daily operational landing page |
| `/sp/reports` | Supplier Payable report | Daily operational page |
| `/sp/reports?tab=profit` | Profit & Loss report | Daily operational report tab |
| `/sp/reports?tab=sales-form` | Sales Form exports | Daily operational report tab |
| `/sp/opening-stock` | Supplier Partner opening-stock workflow | Operational/configuration page |
| `/sp/aliases` | Stock-item alias management | Operational/configuration page |
| `/sp/setup` | Account, warehouse, and supplier-link initialization/repair | Administrative page; role tightening deferred to Phase 4 |
| `/sp/migration` | GC Lshi staged migration | Compatibility route; canonicalization deferred to Phase 4 |
| `/sp/gc-migration` | GC Lshi staged migration | Historical sidebar route; canonicalization deferred to Phase 4 |

## Sidebar structure

### Supplier Partner

- Overview
- Reports
- Opening Stock
- Aliases

### SP Administration

- Setup
- Migration

Supplier Partner items are included in Recent navigation only while a Supplier Partner company is selected.

## Reports sub-navigation

Allowed `tab` values:

- `payable` — default; omitted from the clean `/sp/reports` URL
- `profit`
- `sales-form`

Invalid values canonicalize back to the default using replacement history. Tab changes are view-state changes and do not add browser-history entries. Refresh and browser navigation restore the canonical tab represented by the URL.

## Current parent-route behavior

Existing parent mappings:

- `/sp/setup` -> `/sp/reports`
- `/sp/migration` -> `/sp/reports`
- `/sp/gc-migration` -> `/sp/reports`

Gaps to resolve in later phases:

- Opening Stock and Aliases need `/sp` as their deterministic parent.
- Setup and Migration should return to an administration/settings parent rather than Reports.
- `/sp/migration` and `/sp/gc-migration` need one canonical destination.
- Unknown `/sp/*` paths need a Supplier Partner-specific safe fallback.

## Recommended final hierarchy

### Daily work

- Overview — `/sp`
- Reports — `/sp/reports`
- Opening Stock — `/sp/opening-stock`
- Aliases — `/sp/aliases`

### Administration

- Setup — `/sp/settings?tab=setup`
- Migration — `/sp/settings?tab=migration`

## Phase plan

1. Registry, company-type guard, and stable `/sp` entry.
2. Supplier Partner overview hub and sidebar organization.
3. URL-backed Reports tabs.
4. Administration/settings consolidation and migration canonicalization.
5. Back/Escape completion, invalid-route fallback, regression review, and merge readiness.

## Completed decisions

- `/sp` is the stable Supplier Partner Overview landing page.
- Direct SP route access from non-SP companies redirects with replacement history to `/tracking`.
- Reports use canonical URL-backed tab state.
- No SP business logic, APIs, calculations, exports, migrations, setup actions, balances, or stock behavior changed.
