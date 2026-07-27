# Supplier Partner Navigation Registry

## Purpose

This document is the authoritative route, hierarchy, access, and compatibility registry for Supplier Partner navigation. It covers navigation behavior only and does not redefine Supplier Partner accounting, stock, payable, profit split, export, setup, alias, opening-stock, or migration business rules.

## Company-type boundary

Supplier Partner routes are valid only when the selected company has:

```text
companyType === "supplier_partner"
```

Any direct `/sp` or `/sp/*` request while another company type is selected must redirect with replacement history to `/tracking`. This prevents SP pages from mounting under a normal ERP, Factory, or Properties company context.

## Current route inventory

| Route | Screen | Current role | Phase 1 access |
|---|---|---|---|
| `/sp` | Namespace entry | Missing before audit | Supplier Partner companies only; replacement redirect to `/sp/reports` |
| `/sp/reports` | Supplier payable, profit and loss, sales-form exports | Daily operational page | Supplier Partner companies only |
| `/sp/opening-stock` | Supplier Partner opening-stock workflow | Operational/configuration page | Supplier Partner companies only |
| `/sp/aliases` | Stock-item alias management | Operational/configuration page | Supplier Partner companies only |
| `/sp/setup` | Account, warehouse, and supplier-link initialization/repair | Administrative page | Supplier Partner companies only; role tightening deferred to Phase 4 |
| `/sp/migration` | GC Lshi staged migration | Compatibility route | Supplier Partner companies only; canonicalization deferred to Phase 4 |
| `/sp/gc-migration` | GC Lshi staged migration | Current sidebar route | Supplier Partner companies only; canonicalization deferred to Phase 4 |

## Current sidebar structure

Supplier Partner is appended inside the standard ERP sidebar when the selected company is a Supplier Partner company.

- SP Reports
- Opening Stock
- Aliases
- Setup
- GC Migration

The section is currently flat. Daily work and administration are not separated yet.

## Reports sub-navigation

`/sp/reports` currently contains three internal tabs:

- Supplier Payable
- Profit & Loss
- Sales Form

The tabs currently use component-local default state and are not represented in the URL. URL-backed report tabs are deferred to Phase 3.

## Current parent-route behavior

Existing parent mappings:

- `/sp/setup` -> `/sp/reports`
- `/sp/migration` -> `/sp/reports`
- `/sp/gc-migration` -> `/sp/reports`

Gaps to resolve in later phases:

- Opening Stock and Aliases have no Supplier Partner parent.
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

### Reports

- Supplier Payable — `/sp/reports`
- Profit & Loss — `/sp/reports?tab=profit`
- Sales Form — `/sp/reports?tab=sales-form`

## Phase plan

1. Registry, company-type guard, and stable `/sp` entry.
2. Supplier Partner overview hub and sidebar organization.
3. URL-backed Reports tabs.
4. Administration/settings consolidation and migration canonicalization.
5. Back/Escape completion, invalid-route fallback, regression review, and merge readiness.

## Phase 1 decisions

- `/sp` is introduced as the stable namespace entry immediately.
- Until the dedicated Overview hub is built in Phase 2, `/sp` redirects with replacement history to `/sp/reports`.
- Direct SP route access from non-SP companies redirects with replacement history to `/tracking`.
- No SP business logic, APIs, calculations, exports, migrations, setup actions, balances, or stock behavior are changed.
