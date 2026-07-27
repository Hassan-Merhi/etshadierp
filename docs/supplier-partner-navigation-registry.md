# Supplier Partner Navigation Registry

## Purpose

This document is the authoritative route, hierarchy, access, and compatibility registry for Supplier Partner navigation. It covers navigation behavior only and does not redefine Supplier Partner accounting, stock, payable, profit split, export, setup, alias, opening-stock, or migration business rules.

## Company-type boundary

Supplier Partner routes are valid only when the selected company has:

```text
companyType === "supplier_partner"
```

Any direct `/sp` or `/sp/*` request while another company type is selected redirects with replacement history to `/tracking`.

## Canonical route inventory

| Route | Screen | Access |
|---|---|---|
| `/sp` | Supplier Partner Overview | Supplier Partner company users |
| `/sp/reports` | Supplier Payable | Supplier Partner company users |
| `/sp/reports?tab=profit` | Profit & Loss | Supplier Partner company users |
| `/sp/reports?tab=sales-form` | Sales Form exports | Supplier Partner company users |
| `/sp/opening-stock` | Opening Stock | Supplier Partner company users |
| `/sp/aliases` | Item aliases | Supplier Partner company users |
| `/sp/setup` | Administration — Setup | Admin or Developer |
| `/sp/setup?tab=migration` | Administration — Migration | Developer only |

## Compatibility routes

The following historical routes remain accepted but never mount the migration page directly:

- `/sp/migration`
- `/sp/gc-migration`

Both redirect with replacement history to:

```text
/sp/setup?tab=migration
```

The consolidated administration hub then enforces Developer-only migration access.

## Sidebar hierarchy

### Supplier Partner

- Overview — `/sp`
- SP Reports — `/sp/reports`
- Opening Stock — `/sp/opening-stock`
- Aliases — `/sp/aliases`

### SP Administration

- Setup — `/sp/setup`
- Migration — `/sp/setup?tab=migration`

## Navigation behavior

- `/sp` is the real Supplier Partner landing page.
- Report tabs are validated URL state and use replacement history.
- Administration tabs are validated URL state and use replacement history.
- Wrong-company SP access redirects to `/tracking`.
- Historical migration URLs redirect to the canonical guarded administration tab.
- Unknown `/sp/*` fallback and final Back/Escape normalization are completed in Phase 5.

## Phase plan

1. Registry, company-type guard, and stable `/sp` entry — complete.
2. Supplier Partner overview hub and sidebar organization — complete.
3. URL-backed Reports tabs — complete.
4. Administration consolidation, permissions, and migration canonicalization — complete.
5. Back/Escape completion, invalid-route fallback, regression review, and merge readiness — pending.

## Scope protection

No Supplier Partner accounting, stock, payable, profit-split, export, setup operation, migration operation, API, balance, or posting business logic is changed by this navigation program.
