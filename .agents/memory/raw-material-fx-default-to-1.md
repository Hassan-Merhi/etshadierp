---
name: Raw-material exchange-rate "looks set" heuristic
description: How to distinguish a genuinely unset fx rate from a real one when a schema column defaults to '1', and where the centralized helper lives.
---

Raw-material cost columns (`factory_containers.fx_rate_to_usd` and similar) default
to the string `'1'` at the schema level. For a non-USD currency, a stored rate of
exactly 1 is indistinguishable from "nobody ever set this" — so every cost-recompute
path must treat `rate > 0 && rate !== 1` as the "looks set" condition, not just
`rate > 0`.

**Why:** several write paths (container create/update, duty-confirm recompute,
post-offload charges, opening-balance creation, bulk import) used to do
`parseFloat(x || "1")`, silently pricing a non-USD container as if 1 unit of its
currency were worth 1 USD whenever the real rate was missing.

**How to apply:** use `server/services/factory/currencyConversion.ts`
(`resolveStoredFxRate`, `applyFxRate`, `convertToUsdOrThrow`, `convertToUsdOrNull`)
for any new or changed site that turns an original-currency raw-material cost into
USD. Reject the write with `UnresolvedExchangeRateError` → HTTP 400 when the rate
doesn't look set and the currency isn't USD. Exception: when the *current* request
body explicitly supplies an fxRateToUsd value (a fresh manual entry), trust it even
if it equals 1 — only fall back to the "looks set" check when reading a
previously-stored/fallback rate. Generic display-only paths (`writeDaybookEntry` in
`server/routes/factory/_helpers.ts`, `factoryDaybookRoutes.ts`) log a warning instead
of blocking, since they're shared by many non-raw-material daybook entry types.
