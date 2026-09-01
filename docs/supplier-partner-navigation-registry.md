# Supplier Partner Navigation Registry

## Purpose

This document is the authoritative route, hierarchy, access, and compatibility registry for Supplier Partner navigation. It covers navigation behavior only and does not redefine Supplier Partner accounting, stock, payable, profit split, export, setup, alias, opening-stock, or migration business rules.

## Company-type boundary

Supplier Partner routes are valid only when the selected company has:

```text
companyType === "supplier_partner"
```

Any direct `/sp` or `/sp/*` request while another company type is selected redirects with replacement history to `/tracking`.

## Final route inventory

| Route | Screen | Access | Parent / compatibility behavior |
|---|---|---|---|
| `/sp` | Supplier Partner Overview | Supplier Partner companies | Namespace root |
| `/sp/reports` | Supplier payable, profit and loss, sales-form exports | Supplier Partner companies | Back / Escape → `/sp` |
| `/sp/opening-stock` | Supplier Partner opening-stock workflow | Supplier Partner companies | Back / Escape → `/sp` |
| `/sp/aliases` | Stock-item alias management | Supplier Partner companies | Back / Escape → `/sp` |
| `/sp/setup` | Supplier Partner Administration, Setup tab | Admin or Developer | Back / Escape → `/sp` |
| `/sp/setup?tab=migration` | Supplier Partner Administration, Migration tab | Developer | Back / Escape → `/sp` |
| `/sp/migration` | Historical compatibility path | Supplier Partner companies | Replacement redirect → `/sp/setup?tab=migration` |
| `/sp/gc-migration` | Historical compatibility path | Supplier Partner companies | Replacement redirect → `/sp/setup?tab=migration` |
| Unknown `/sp/*` | Invalid Supplier Partner route | Supplier Partner companies | Replacement redirect → `/sp` |

## Sidebar hierarchy

### Daily work

- Overview — `/sp`
- Reports — `/sp/reports`
- Opening Stock — `/sp/opening-stock`
- Aliases — `/sp/aliases`

### Administration

- Setup — `/sp/setup`
- Migration — `/sp/setup?tab=migration`

Supplier Partner pages are registered with Recent navigation from the same shared route source used by the sidebar.

## Reports sub-navigation

- Supplier Payable — `/sp/reports`
- Profit & Loss — `/sp/reports?tab=profit`
- Sales Form — `/sp/reports?tab=sales-form`

Invalid report-tab values canonicalize to Supplier Payable using replacement history. Refresh restores the selected canonical tab.

## Administration sub-navigation

- Setup — `/sp/setup`
- Migration — `/sp/setup?tab=migration`

Invalid administration-tab values canonicalize to Setup. Admin users cannot open Migration; non-admin/non-developer users cannot open the administration hub.

## Final decisions

- `/sp` is the stable Supplier Partner landing page.
- Setup and Migration are consolidated under one guarded administration hub.
- Both historical migration URLs remain compatible but cannot bypass the administration permissions.
- Back and Escape behavior is deterministic within the Supplier Partner hierarchy.
- Unknown Supplier Partner URLs never fall through to the generic ERP 404.
- No Supplier Partner business logic, APIs, calculations, exports, migrations, setup actions, balances, posting behavior, or historical data behavior changed.
