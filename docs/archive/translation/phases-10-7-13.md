# Translation phases 10, 7 and 13

## Phase 10 — accounting, vouchers and daybook

The reviewed exact-label dictionary now covers chart of accounts, general ledger, trial balance, financial statements, journal entries, payment/receipt/journal/contra vouchers, debit/credit, opening/closing balances, posting, reconciliation and voucher actions in English, Arabic and French.

Stored account names and account codes remain business data and are explicitly excluded from automatic translation. Only interface labels are translated unless an explicit translated account-name field is added in a future data migration.

## Phase 7 — historical documents

Factory document actions now expose English, Arabic and French PDF, Excel and loading-list downloads. French requests use `lang=fr`, allowing server document resolvers to select French snapshot fields with the established French → English → Arabic → article-code fallback. Finalized historical snapshot values remain preferred over live catalog values.

## Phase 13 — errors, exports and sharing

The exact-label dictionary includes validation, authorization, request, import, export, print and file errors, plus PDF, Excel, print-preview and WhatsApp sharing actions. The compatibility translator applies these only to reviewed UI text, placeholders, titles and accessibility labels.

## Safety

No quantities, costs, prices, stock, vouchers, journals, balances, account names, account codes, document numbers or user-entered values are mutated.
