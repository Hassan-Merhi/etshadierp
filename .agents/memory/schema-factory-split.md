---
name: Schema domain split — factory.ts
description: factory.ts is now actual table definitions; key ownership rules for tables that straddle erp.ts and factory.ts.
---

## Rule
`factory.ts` now contains actual `pgTable()` definitions (not a re-export stub). It imports `companies`, `locations` from `./common`; `ledgerAccounts` from `./accounting`; `customers`, `vouchers` from `./erp`; `containers` from `./containers`.

## Tables that belong to erp.ts (NOT factory.ts)
Even though they appeared in old `_definitions.ts` factory region, these are owned by `erp.ts`:
- `baleLabelPrints` / `insertBaleLabelPrintSchema` / `BaleLabelPrint`
- `customerLogos` / `insertCustomerLogoSchema` / `CustomerLogo`
- `referenceSequences` / `ReferenceSequence`
- `locationPriceGroups` / `insertLocationPriceGroupSchema` / `LocationPriceGroup`

**Why:** erp.ts was updated to own these tables at some point; factory.ts re-exporting them from _definitions.ts previously masked the overlap since _definitions.ts wasn't in index.ts.

## _definitions.ts status
`_definitions.ts` is now dead code — nothing imports it after factory.ts was rewritten. It still contains ~4918 lines of duplicate definitions, but since it is excluded from `index.ts`, it causes no conflicts. Safe to leave as-is or clean up separately.

## How to apply
If adding a new table that conceptually lives in the factory domain: define it in `factory.ts`. Do NOT define it in `_definitions.ts`. Check erp.ts exports first to avoid re-introducing the conflict pattern.
