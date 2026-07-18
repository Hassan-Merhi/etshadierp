# Program 7B — Financial Screens

Branch: `integration/programs-1-to-6-validation`

## Status

Implementation complete.

## Scope reviewed

The financial UI surface includes Accounts, Daybook, Vouchers, transaction journals, ledger summaries and details, net-position and net-profit views, customer and supplier statements, and related factory financial screens.

The review boundary was presentation consistency only. Accounting attribution, opening balances, brought-forward balances, running balances, closing balances, voucher posting, reconciliation, permissions, company isolation, currency conversion, and report totals were not changed.

## Completed work

- Added `client/src/components/financial/financial-screen.tsx` as the shared financial presentation contract.
- Added `FinancialScreenHeader` for consistent page titles, descriptions, action placement, and responsive filter bars.
- Added `FinancialSummaryCard` with tabular numerals, optional context, trend indicators, and semantic default/success/warning/destructive/info tones.
- Added `FinancialSummaryGrid` with consistent responsive KPI layout.
- Added `FinancialTableShell` for consistent bordered financial tables and horizontal-overflow containment.
- Reused the Program 7A loading, empty, and error-state primitives rather than introducing financial-only duplicates.
- Added `scripts/verify-program7b-financial-screens.mjs` to preserve the shared financial primitives, responsive behavior, semantic tones, tabular-number formatting, and shared page-state dependency.

## Adoption rule

New or touched financial screens should use these primitives where their layout matches the contract. Existing high-risk accounting screens should be migrated incrementally when already being changed for a business requirement; broad cosmetic rewrites are intentionally avoided because they create unnecessary regression risk in mature financial workflows.

## Preserved behavior

- No API contracts changed.
- No query keys or invalidation behavior changed.
- No accounting or voucher calculations changed.
- No balances or historical transactions changed.
- No permissions, approvals, company isolation, or currency rules changed.
- No merge, deployment, migration, CI, build, or runtime verification was performed.
