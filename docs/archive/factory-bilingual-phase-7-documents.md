# Factory bilingual catalog — Phase 7 documents

Issue: #347  
Status: Phase 7 complete  
Base: Phase 6 bilingual snapshots

## User choices

The Factory invoice detail screen now provides explicit document-language actions for:

- English PDF
- Arabic PDF
- English Excel
- Arabic Excel
- English loading list
- Arabic loading list
- English and Arabic PDF without charges

Every action sends `lang=en` or `lang=ar`. Requests without an explicit language continue through the existing legacy export routes unchanged.

## Shared document contract

`server/services/factoryDocumentLanguage.ts` owns:

- language parsing;
- translated invoice, loading, total, freight, charge, status, and notes labels;
- snapshot-first product-name resolution;
- status translation;
- Arabic PDF font discovery;
- RTL Excel worksheet configuration.

No export route implements an independent product-name fallback.

## Snapshot behavior

Document product names resolve in this order:

- Arabic document: Arabic snapshot, English snapshot, article code.
- English document: English snapshot, Arabic snapshot, article code.

The stored order-line or loading-line snapshots are authoritative. Later catalog edits cannot rename finalized documents after Phase 6 has populated their snapshots.

## PDF behavior

Arabic PDFs:

- use an installed Arabic-capable font when available;
- render translated headings, metadata labels, statuses, totals, freight, and charges;
- right-align Arabic text;
- preserve the same order rows, quantities, weights, prices, charges, and totals as English.

## Excel behavior

Arabic workbooks:

- use Arabic sheet and column headings;
- set the worksheet to right-to-left;
- right-align content;
- keep quantities, weights, prices, charges, and totals as numeric cells with numeric formatting;
- retain the same `noCharges` and price-visibility behavior as English.

## Security and compatibility

- Every query is scoped to the active Factory company and order ID.
- Existing authentication and export price-hiding checks remain authoritative.
- `noCharges=1` is supported in both languages.
- Content-Disposition filenames identify the selected language.
- Every bilingual document export creates an audit event containing company, order, user, format, language, and no-charge mode.
- Requests without `lang=en|ar` are passed to the legacy handlers, preserving all existing callers.

## Commercial safety

Phase 7 creates document bytes only. It does not update products, orders, bales, stock, quantities, weights, prices, charges, costing, allocations, vouchers, journals, payments, customer balances, or accounting records.

## Verification policy

Per instruction, tests and build checks are retained for the final combined verification phase and were not executed during this phase.
