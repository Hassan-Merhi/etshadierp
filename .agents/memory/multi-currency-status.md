---
name: Multi-currency implementation status
description: Final implementation state on fix/complete-multi-currency. Code is committed but unmerged; migrations and repair tools have not been run.
---

## Core invariants
- ERP CFA convention is `TRANSACTION_PER_BASE`: CFA per 1 USD, so `baseUsd = cfaAmount / historicalRate`.
- Factory `fxRateToUsd` fields may use `BASE_PER_TRANSACTION`; never mix the conventions without explicit inversion.
- Store `CFA`; accept `XOF` only as an input alias and normalize it immediately.
- Historical transaction currency, original amount, historical rate, and historical base amount are immutable accounting facts.
- `voucher_entries.debit_amount` / `credit_amount` remain backward-compatible historical base values for new and repaired rows.
- Only current translated cash/bank value changes with the latest rate. Native cash/bank amounts and all historical sales, expenses, customers, suppliers, assets, inventory, and profit remain fixed.
- Ambiguous legacy foreign-currency data is never guessed or converted using the current rate.

## Completed code

### Voucher storage and write enforcement
- `shared/schema/erp.ts` contains the seven dual-currency voucher-entry fields.
- `server/services/accounting/currencyAmounts.ts` is the canonical Decimal.js normalization service.
- Journal, Payment/Receipt, POS create/edit, transfers, credit notes, payroll, rental, and multiple factory posting paths use historical normalization.
- `migrations/20260720_005_voucher_entry_currency_normalization_trigger.sql` protects remaining direct USD/CFA inserts and synchronized updates at the database boundary.
- Unsupported third-currency rows are left explicitly unresolved unless their caller supplies a known convention.
- Generic voucher-entry PATCH is overridden by `voucherEntryCurrencyEditRoutes.ts` so CFA amount edits preserve the native amount and historical rate.

### Structural migrations
The branch contains real, structural-only SQL migrations:
- `20260720_002_voucher_entry_currency_fields.sql`
- `20260720_003_ledger_account_opening_balance_currency.sql`
- `20260720_004_bank_account_opening_balance_currency.sql`
- `20260720_005_voucher_entry_currency_normalization_trigger.sql`
- `20260720_006_entity_opening_and_asset_currency.sql`

The migrations add:
- voucher-entry transaction/base/rate fields
- native/historical opening metadata for ledger, bank, customer, supplier, and employee values
- native/historical fixed-asset acquisition metadata

No migration performs a historical data backfill.

### Opening balances and fixed assets
- Native opening/acquisition amounts are stored separately from historical base amounts.
- Legacy amount columns remain historical base values after explicit resolution so existing reports remain compatible.
- New non-zero ledger/bank openings without a currency remain unresolved instead of being silently treated as USD.
- Resolved CFA openings survive edits from legacy account forms without losing their locked native amount/rate.
- `openingBalanceResolutionRoutes.ts` provides an Admin/Owner/Developer-only explicit resolver for ledger, bank, customer, supplier, employee, and fixed-asset values.
- `HistoricalOpeningResolver.tsx` exposes that workflow in Accounts.

### Cash/bank current translation
- `cashBankRevaluationService.ts` uses Decimal.js throughout.
- Native balances are grouped by account and currency; USD and CFA are never added as one native number.
- Resolved CFA is translated using the latest CFA-per-USD rate only for current cash/bank display.
- Missing current rate, unsupported currencies, unresolved openings, and unresolved legacy rows return provisional/null current values rather than fake zero differences.
- Linked standalone bank accounts are not double-counted with their ledger account.
- Existing account/bank balance URLs are safely overridden before legacy handlers register.
- Accounts UI shows native balances, historical base, current translated value, translation difference, and unresolved warnings.

### Net Position and financial reports
- Live Net Position response replaces only resolved cash/bank rows with current translated values.
- Income, expenses, customers, suppliers, assets, inventory, equity, and historical profit are not current-revalued.
- Date-filtered snapshots remain historical.
- Cached report payloads are cloned before cash-only adjustment, preventing repeated revaluation.
- `historicalCurrencyReadiness.ts` identifies unresolved foreign voucher rows and unresolved ledger, bank, customer, supplier, employee, and fixed-asset values.
- Protected Net Position, Net Profit, and statement export endpoints return HTTP 409 while ambiguous historical currency data remains unresolved instead of returning convincing but wrong totals.

### Historical repair
- `scripts/backfill-voucher-entry-currency-amounts.mjs` remains explicit and dry-run by default.
- Apply mode requires a regenerated timing-safe confirmation token.
- It uses stored historical rates only and never uses the latest rate.
- Ambiguous and missing-rate rows are skipped for manual review.
- The branch does not run this script automatically.

### Targeted regression coverage
- `tests/currencyAmounts.test.ts` covers the central normalization helper.
- `tests/multi-currency-integration.test.ts` covers:
  - CFA/USD historical normalization
  - separate native/base opening values
  - all required migration files and journal entries
  - database trigger behavior
  - mixed-currency cash/bank safety
  - unresolved legacy handling
  - cash-only live Net Position translation
  - protected report readiness
  - generic entry edit normalization
  - explicit opening/asset resolution
  - backfill dry-run/token safeguards

## Deployment and execution status
- Branch: `fix/complete-multi-currency`
- Base: `a80704e500178bfa5fb29ec1f49fc6c4b41f37f6`
- The branch is not merged.
- SQL migrations have not been applied by this work session.
- The historical backfill has not been run.
- Production data has not been modified.
- CI and the full test suite were not run.
- The focused tests were added/updated but were not executed in this environment.

## Required deployment order after approval
1. Review and merge the branch.
2. Apply migrations `002` through `006` before starting code that queries the new columns.
3. Open Accounts and review the historical readiness/resolution panels.
4. Run the voucher-entry backfill in dry-run mode for one company.
5. Review every ambiguous/missing-rate row; resolve opening/acquisition values explicitly.
6. Apply only the approved repair token.
7. Recheck readiness; protected financial reports unlock only when historical data is fully resolved.
