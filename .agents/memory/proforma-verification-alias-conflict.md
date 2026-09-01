---
name: Supplier proforma/container verification barcode matching
description: How proforma-vs-loaded item matching works and the alias-conflict guardrail added to prevent silent item cross-matching.
---

The container verification comparison (proforma vs loaded items) matches items **only by barcode/alias identity**, never by item name — even when names look similar (e.g. "SAFETY BOOT" vs "SAFETY BOOTS #2"). This is intentional per user preference; do not introduce name-based/fuzzy matching here.

`buildAliasMap()` in `server/routes/supplierProformaRoutes.ts` resolves alias codes to a stock item's own primary code. It now detects and excludes "conflicting" aliases — where an alias row's code equals a *different* stock item's own primary code (a data-entry mistake, e.g. two similarly-named items' aliases got crossed). Excluded conflicts are returned separately and surfaced to the container verification page as a warning banner, instead of silently merging two distinct items' loaded qty/price into one row.

**Why:** A bad alias row exactly like this caused two different boot SKUs' loaded prices to swap in the "Price Differences" table on `ContainerVerification.tsx`, producing a confusing/wrong report with no error surfaced.

**How to apply:** Any future change to `buildAliasMap`/`resolveBarcode` in `supplierProformaRoutes.ts` must keep this conflict check and keep returning `{ map, conflicts }` — there are 7 call sites in that file that all destructure this shape.
