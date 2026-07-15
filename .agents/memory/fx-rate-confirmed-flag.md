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
`factory_offload_additional_charges`, `factory_container_commissions`. Every container-create/edit/bulk-import
write path now sets it `true` when it explicitly resolves a rate (manual entry or a real auto-fetch);
all read/aggregate paths pass `(row as any).fxRateConfirmed` through to `resolveStoredFxRate` and exclude
(never guess at 1) any row where `looksSet` is false. Tables WITHOUT the column yet
(`factory_daybook_entries`, `factory_supplier_payments`, `factory_supplier_fx_transfers`, `factory_raw_stock`
commission fields, `factory_fx_rates`, generic ERP `vouchers.exchangeRate`) still use the legacy heuristic —
out of scope by design for `vouchers.exchangeRate` (separate ERP-wide voucher system), and a documented
stopgap everywhere else until those tables get the same column.

A read-only diagnostic, `GET /api/factory/suppliers/fx-diagnostic`, scans containers/offload-charges/commissions
for the current company and reports every unresolved row grouped by supplier/currency/status/container, flagging
CLOSED/COMPLETED/OFFLOADED rows as `manualReviewRequired` (never auto-fixable). No repair/write service exists
yet — that and decimal.js-based arithmetic are still open work.
