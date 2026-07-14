---
name: fxRateConfirmed explicit flag replaces rate===1 heuristic
description: How "is this non-USD exchange rate actually resolved" is now decided on factory_containers/offload-charges/commissions, and where it still isn't.
---

`server/services/factory/currencyConversion.ts`'s `resolveStoredFxRate(currencyCode, storedFxRateToUsd, confirmed?)` decides
whether a stored rate is trustworthy:
- USD is always resolved (rate=1, looksSet=true), no flag needed.
- When `confirmed` is passed (boolean, from the table's `fxRateConfirmed` column), it is the source
  of truth: `looksSet = confirmed && rate > 0`. A confirmed rate of exactly 1.0 IS valid.
- When `confirmed` is `undefined` (table has no such column yet), falls back to the legacy heuristic
  `rate > 0 && rate !== 1` — this is a known imprecision, not a design choice: a genuine confirmed 1.0
  rate on those tables is still misflagged as unresolved.

**Why:** the user explicitly rejected "rate===1 means unset" as guessing from a numeric value; a real
schema flag was required.

**How to apply:** `fxRateConfirmed` boolean columns (default false) exist on `factory_containers`,
`factory_offload_additional_charges`, `factory_container_commissions` — pass `(row as any).fxRateConfirmed`
whenever resolving one of those tables' rates. Tables WITHOUT the column yet (`factory_daybook_entries`,
`factory_supplier_payments`, `factory_supplier_fx_transfers`, `factory_raw_stock` commission fields,
`factory_fx_rates`, generic ERP `vouchers.exchangeRate`) still use the legacy heuristic or are out of
scope (generic voucher exchange rate is a separate ERP-wide system, not raw-material specific).

Known remaining gap (not yet converted to the flag-based/rejecting model as of this pass): the
`/api/factory/suppliers/with-balances` list endpoint in `supplierBalanceRoutes.ts` (~lines 900-1140)
still uses `configuredFxRates[cc] ?? parseFloat(c.fxRateToUsd || "1")` as a fallback chain — an
admin-configured company rate takes priority (safer than a bare default), but the final fallback can
still silently use 1. Also unconverted: `supplierStatementRoutes.ts`, `supplierCrudRoutes.ts`,
`supplierBrokerRoutes.ts`, `employeeNetPositionRoutes.ts` fx read sites.
