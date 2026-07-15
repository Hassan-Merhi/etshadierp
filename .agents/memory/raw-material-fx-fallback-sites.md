---
name: Raw-material FX fallback site sweep — scope decision
description: Which "|| 1" exchange-rate fallback sites in the factory/raw-material domain were converted to reject/flag unresolved rates, and which general-ledger sites were deliberately left alone.
---

## Rule
Every raw-material-domain site that reads `container.fxRateToUsd` / a charge's / commission's
`fxRateToUsd` and uses it to price a voucher, daybook entry, or display field must resolve
it through `resolveStoredFxRate` / `resolveStoredFxRateOrThrow` (in
`server/services/factory/currencyConversion.ts`), never a bare `parseFloat(x || "1")`.
- Write paths (posting a voucher/daybook entry from an already-stored container/charge/
  commission row): use `resolveStoredFxRateOrThrow` so an unresolved rate throws
  `UnresolvedExchangeRateError` instead of silently pricing at 1.
- Bulk/backfill loops over many containers: catch the throw per-row and skip+report
  (`fxUnresolvedSkipped`), never abort the whole batch or silently misprice.
- Read/display paths (statements, balance rollups): use the non-throwing
  `resolveStoredFxRate` and show `"unresolved"` instead of a guessed rate when
  `looksSet` is false.

## Explicitly out of scope (documented, not missed)
`server/routes/factory/_helpers.ts`'s `writeDaybookEntry` and
`server/routes/factory/factoryDaybookRoutes.ts` narration/display fallbacks operate on
**general vouchers** (payroll, sales, and other non-raw-material daybook entries), not
raw-material containers/charges/commissions. They were left as-is — already loudly
warn on non-USD unresolved rates — per the separate accounting-engine audit's
"LEAVE ALONE" scope for the general-ledger domain.

**Why:** the raw-material pricing audit's mandate was raw-material cost/kg, stock value,
and supplier balances specifically; conflating it with the general voucher/GL fallback
(shared by payroll and sales flows) risks an unreviewed behavior change outside the
audited domain.

**How to apply:** if a future raw-material change touches a site not in this list,
check whether it reads a container/offload-charge/commission FX field — if so, route it
through the shared resolver rather than adding a new bare fallback.
