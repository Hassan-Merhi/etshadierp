# Multi-currency Phase 8 — Account API

Phase 8 completes the account-statement API contract without changing report
valuation rules or performing historical data repair.

## Response contract

Account transaction rows retain the legacy `debitAmount` and `creditAmount`
fields as historical base-currency values and additionally expose:

- `transactionCurrency`
- `transactionDebitAmount` / `transactionCreditAmount`
- `baseDebitAmount` / `baseCreditAmount`
- `historicalExchangeRate`
- `rateConvention`

Non-paginated account transaction responses include `currencySummary`, with
separate native debit/credit buckets, historical base totals, and an explicit
`totalsProvisional` flag when unresolved legacy non-base rows are present.
Paginated statements expose the same summary for the returned page.

## Safety boundaries

- Native values are never summed across currencies.
- Legacy non-USD rows without stored base amounts remain unresolved and
  provisional; the API does not infer a rate.
- Ledger, bank, fixed-asset, employee, supplier, and customer transaction
  queries remain company-scoped.
- Resolved USD/CFA rows preserve historical base values for existing consumers.

Phase 9 covers Net Position, Phase 10 covers the frontend-wide account display,
and Phase 11 covers spreadsheet/export presentation. Historical backfill and
production repair remain explicit operational workflows.