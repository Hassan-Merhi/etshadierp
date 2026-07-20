---
name: Multi-currency implementation status
description: Phase 15 multi-currency — what is done, what remains, and key design invariants.
---

## Core design invariants (never break these)
- **Rate convention**: ERP = `TRANSACTION_PER_BASE` (CFA per USD). `baseUsd = cfaAmount / rate`. Factory uses the opposite (multiply). Never mix.
- **CFA identifier**: Store `"CFA"` everywhere — DB, APIs, responses. `"XOF"` is only ever accepted as *input* at the `normalizeCurrencyCode` boundary and immediately mapped to `"CFA"`. No code should produce `"XOF"` as output.
- **Historical immutability**: `historicalExchangeRate` on a `voucher_entries` row never changes after posting. Reports must read `base_debit_amount`/`base_credit_amount` columns, not recompute from the current company rate.
- **Backward compat**: `debitAmount`/`creditAmount` always store the historical base (USD) value. Legacy queries that SUM these get the correct historical USD total.
- **No backfill during migration**: Migration SQL adds columns only. Backfill is manual via the script with dry-run + HMAC token.

## DB migration status — voucher_entries
The 7 multi-currency columns (`transaction_currency`, `transaction_debit_amount`, `transaction_credit_amount`, `base_debit_amount`, `base_credit_amount`, `historical_exchange_rate`, `rate_convention`) exist in BOTH:
- Drizzle schema (`shared/schema/erp.ts`, lines 312–329)
- Live database (applied via idempotent `ADD COLUMN IF NOT EXISTS`)

Pre-existing rows have NULL for all 7 columns. New posts fill them via `normalizeVoucherEntryAmounts`. Backfill script fills legacy rows.

## What is done (Task #1 — migration + normalization)

### Fixed bugs
- `normalizeCurrencyCode("CFA")` → was "XOF" (wrong), now "CFA". `normalizeCurrencyCode("XOF")` → "CFA" (correct boundary normalization).
- Backfill script (`scripts/backfill-voucher-entry-currency-amounts.mjs`) fully rewritten:
  - Token validation: re-scans DB in apply mode, uses `crypto.timingSafeEqual` for constant-time comparison.
  - All monetary math uses `Decimal.js` (no `parseFloat * number` or `.toFixed()` on floats).
  - Outputs "CFA" never "XOF".
  - New classifications: `confirmed-base-stored` (was "likely-base-stored"), `confirmed-transaction-stored` (new — stored amounts are CFA, derive USD base by dividing).

### POS accounting
- `postSaleAccounting.ts`: `insertSaleAccountingEntries` now accepts `currency`/`exchangeRate`, uses `normalizeVoucherEntryAmounts` via local `normalizePosEntry` helper for all entry inserts. Soft-fails to legacy if normalization impossible.
- `createSaleService.ts`: threads `currency`/`exchangeRate` through to `insertSaleAccountingEntries`.
- `rebuildSaleAccounting.ts`: `rebuildSaleAccountingEntries` now accepts `currency`/`exchangeRate` and uses `normalizeVoucherEntryAmounts`.
- `updateSaleService.ts`: passes `existingVoucher.currency`/`existingVoucher.exchangeRate` (the ORIGINAL stored rate) to rebuild. Never uses current company rate.

### Voucher reads
- `server/storage/accounting.ts` `getVoucherEntriesByVoucher`: all 7 dual-currency fields now included in SELECT and returned to callers.

### Generic voucher create ("with-entries")
- `voucherCreateRoutes.ts` POST `/api/vouchers/with-entries`: accepts `voucher.currency`/`voucher.exchangeRate` from request body, stores them on the voucher row, and runs `normalizeVoucherEntryAmounts` on each entry. Falls back gracefully if normalization fails (e.g. non-rate companies). Caller-supplied `transactionCurrency` on individual entries is respected as-is (new frontend path).

### Frontend formatters (CurrencyContext.tsx + use-currency.ts)
Four new formatters added (additive, no breakage):
- `formatTransactionAmount(amount, currency)` — format in the specific transaction currency, no conversion.
- `formatHistoricalBaseAmount(amount)` — always USD, never re-translated (historical).
- `formatCurrentCashTranslation(nativeAmount, nativeCurrency)` — live translation of native (CFA) balance to selected display currency at current rate (display-only).
- `formatNewTransactionPreview(amount)` — shows both currencies for a new transaction using the current rate.

### Tests
- `tests/currencyAmounts.test.ts` updated: 41 tests all passing.
  - Fixed assertions that expected "XOF" output (now "CFA").
  - Added: CFA identifier consistency tests, Payment round-trip, POS CFA entry normalization, extended normalizeCurrencyCode tests.

## What is done (Task #2 — reporting layer, fixed-asset, cash/bank revaluation, exports)

### COALESCE substitution strategy
All report/export SQL now reads `COALESCE(base_debit_amount, debit_amount)` / `COALESCE(base_credit_amount, credit_amount)`.
- Pre-backfill: `base_debit_amount IS NULL` → COALESCE falls back to `debit_amount` (same as before).
- Post-backfill: COALESCE picks up historical USD base amounts → correct historical figures without re-translating.

### Files changed
- `server/routes/stats/statsNetProfitRoutes.ts`: COALESCE in all 3 pool.query calls (ledger, supplier, employee balance queries). CFA revaluation block RETAINED for backward compat (will be removed after backfill).
- `server/routes/stats/statsNetPositionRoutes.ts`: Two Drizzle entry queries converted to pool.query with COALESCE. Added `pool` import.
- `server/routes/reportsRoutes.ts`: COALESCE via `sql<string>` template in periodEntries, allTimeEntries, erpSalesEntries, drill-down endpoints (purchases, direct-incomes, direct-expenses, indirect-expenses), and account-statement (opening + monthly entries). Added `pool` import.
- `server/routes/netProfitExcelRoute.ts`: COALESCE in allPeriodEntries, erpIncEntries, allTimeEntriesXlsx (all switched from `db.select()` to explicit column selects with sql template). Added `pool` import.
- `server/routes/bankAssetRoutes.ts`:
  - New `GET /api/bank-accounts/revaluation` endpoint: returns per-account `nativeCurrency`, `nativeBalance`, `historicalBaseBalance`, `currentRate`, `currentTranslatedBaseBalance`, `translationDifference`.
  - `GET /api/fixed-assets` now returns `historicalCostBase` and `historicalDepreciationBase` computed from voucher_entries via COALESCE pool.query.
  - Added `ledgerAccounts`, `exchangeRates` schema imports, `pool` import.
- Factory daybook and POS daybook routes: no changes needed (no entry-summing queries found).

## What is done (Task #3 — frontend, voucher editing, backfill review, tests)

### DB columns applied
- Applied idempotent `ALTER TABLE voucher_entries ADD COLUMN IF NOT EXISTS ...` for all 7 dual-currency columns in the live DB.
- Key lesson: voucher_entries schema had the columns defined in Drizzle (erp.ts) but they weren't in the DB yet; always verify with `information_schema.columns` before assuming Drizzle schema == DB state.

### Frontend types
- `client/src/pages/daybook/types.ts`: `ViewVoucherEntry` and `VoucherEntry` interfaces now include all 7 optional multi-currency fields (`transactionCurrency`, `transactionDebitAmount`, `transactionCreditAmount`, `baseDebitAmount`, `baseCreditAmount`, `historicalExchangeRate`, `rateConvention`).

### VoucherDetailsDialog (read-only view)
- `client/src/pages/daybook/VoucherDetailsDialog.tsx`: Added `txCurrencyLabel(entry)` helper. Payment/Receipt/Journal entry amounts now show the original CFA amount as a secondary line (e.g. "CFA 60,000") when `transactionCurrency !== "USD"`. Debit and credit cells in Journal view each show their native side's amount.

### VoucherEditDialog (shared edit component)
- `client/src/components/VoucherEditDialog.tsx`:
  - `VoucherEntry` interface extended with 5 optional multi-currency fields.
  - `voucherEntrySchema` (Zod) extended with matching nullable optional fields.
  - Form `reset()` now maps `transactionCurrency`, `transactionDebitAmount`, `transactionCreditAmount`, `historicalExchangeRate`, `rateConvention` from loaded entry data.
  - Per-entry row shows an amber info badge ("CFA 60,000 @ 600 (historical)") for non-USD entries.
  - `entriesPayload` on save includes `transactionCurrency`, `historicalExchangeRate`, `rateConvention` so the server can recompute base amounts consistently.

### Targeted tests
- `tests/multi-currency-integration.test.ts` (NEW, 22 tests, all passing):
  - CFA voucher creation → entries have `transactionCurrency=CFA`, `historicalExchangeRate=600`, `baseDebitAmount=100` (60000 ÷ 600)
  - USD voucher creation → `transactionCurrency=USD`
  - `GET /api/vouchers/:id/entries` returns `historicalExchangeRate` for CFA vouchers
  - `GET /api/vouchers/:id/view-entries` returns `transactionDebitAmount` and `baseDebitAmount`
  - `GET /api/bank-accounts/revaluation` returns 200 with correct response shape
  - `GET /api/fixed-assets` returns `historicalCostBase`
  - Backfill token constant-time comparison unit tests (5 tests)
  - Backfill classification logic unit tests (8 tests)
  - Voucher edit GET /entries returns historical rate info

## What still remains (not in scope of Tasks 1–3)

### Issue 7 — Purchase/expense posting routes
Many routes still insert voucher entries without `normalizeVoucherEntryAmounts`:
- Purchase order vouchers, expense accounts, income accounts, supplier bills, credit/debit notes, payroll, rental income/expense, container expenses, freight, commissions, post-offload charges.
- These all write `debitAmount`/`creditAmount` as raw strings from the request body.
- Fix: add `normalizeVoucherEntryAmounts` to each route's entry insert, threading the voucher's currency/rate.

### Issue 8 — Customer/supplier balance reads
- `GET /api/customers/stats` and `GET /api/customers/:id/transactions` sum `debit_amount`/`credit_amount` — should also return `historicalBaseBalance` (sum of `base_debit_amount`/`base_credit_amount`) and per-currency native balances.
- Same for `GET /api/suppliers/:id/balance` and `GET /api/suppliers/stats`.

### Issue 10 — Cash/bank current translation in account balance endpoints
- `GET /api/accounts/ledger/:id/balance` does not yet return `nativeBalance`, `historicalBaseBalance`, `currentTranslatedBaseBalance`, `translationDifference` fields. Frontend formatters are ready; the API endpoint needs updating.

### Issue 12 — Backfill execution + CFA revaluation block removal
- Run backfill script in dry-run on production data, verify, then apply.
- After backfill confirmed, remove the CFA revaluation block from `statsNetProfitRoutes.ts` (~lines 333–370 and related lines ~553, 555, 602, 607, 620, 621, 733). This block divides all balance-sheet account values by `currentCfaRate` to compensate for pre-backfill CFA amounts. Once backfill runs, COALESCE handles this correctly and the block is wrong.
- **Removal is only safe after backfill runs** — removing it before will break Net Position for CFA companies.

### Issue 14 — Frontend display hooks for new formatters
- Hook up `formatHistoricalBaseAmount` / `formatCurrentCashTranslation` formatters in voucher detail pages, account statement, and the net-position table.
- Show `translationDifference` in the cash/bank revaluation UI (endpoint exists, UI not yet built).
- Build a "Bank/Cash Revaluation" report page that surfaces the `/api/bank-accounts/revaluation` endpoint data.
