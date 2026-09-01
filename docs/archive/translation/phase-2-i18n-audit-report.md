# Phase 2 — reviewed untranslated-text audit

Reviewed on 2026-08-02 from discovery head `74fe5bd7612cfae0e6a78f11cb37c787b7dcc560`.

## Why the old 9,110 number was not a completion measure

The previous Phase 14 script used a broad line-based regular expression and one repository-wide ceiling of 9,110. It mixed real interface copy with comparison operators, code fragments, technical tokens and text already translated by the compatibility dictionaries. Passing that check only meant the raw number had not increased.

Phase 2 replaces that ceiling with a classified report and a per-module ratchet.

## Reviewed totals

| Classification | Count |
|---|---:|
| All detected candidates | 22,429 |
| Unresolved user-facing literals | 17,923 |
| Already covered by the compatibility translator | 3,460 |
| Other reviewed technical/non-interface exclusions | 1,046 |
| Unclassified | 0 |

The 17,923 unresolved literals are the explicit-key migration backlog for later phases. They were already present in the application; Phase 2 makes them measurable and does not introduce new interface copy.

## Unresolved backlog by module

| Module | Unresolved literals |
|---|---:|
| Factory | 6,944 |
| Accounting | 1,929 |
| Inventory and logistics | 1,773 |
| Administration, users and settings | 1,344 |
| Other client screens | 1,101 |
| Containers and purchasing | 1,081 |
| Sales and POS | 948 |
| Payroll | 730 |
| Backend messages | 621 |
| Shared UI | 527 |
| Reports and exports | 354 |
| Properties and rentals | 294 |
| Supplier Partner | 269 |
| Shared contracts | 8 |

## Highest-priority files

| File | Unresolved literals |
|---|---:|
| `client/src/pages/factory/production-raw-stock/RawStockRecalculate.tsx` | 136 |
| `client/src/pages/AnalyticsLegacy.tsx` | 128 |
| `client/src/pages/ContainerDetail.tsx` | 127 |
| `client/src/pages/factory/FactoryWorkers.tsx` | 122 |
| `client/src/pages/SupplierProfitCheck.tsx` | 106 |
| `client/src/pages/factory/FactoryPendingInvoiceVerify.tsx` | 105 |
| `client/src/components/CommandPalette.tsx` | 99 |
| `client/src/pages/factory/FactorySettings.tsx` | 99 |
| `client/src/pages/settings/DataToolsTab.tsx` | 96 |
| `client/src/pages/factory/FactoryWorkerDetail.tsx` | 94 |
| `client/src/pages/factory/BalesHistory.tsx` | 89 |
| `client/src/pages/vouchers/StockTransferForm.tsx` | 85 |
| `client/src/pages/factory/FactoryContainerLoadingScan.tsx` | 83 |
| `shared/permissionConfig.ts` | 83 |
| `client/src/pages/ImportStockItems.tsx` | 79 |
| `client/src/pages/factory/FactoryInvoiceDetail.tsx` | 78 |
| `client/src/pages/StockTransferOrder.tsx` | 77 |
| `client/src/pages/BaleProducts.tsx` | 74 |
| `client/src/pages/factory/DailyProductionReport.tsx` | 71 |
| `client/src/pages/factory/FactoryPayroll.tsx` | 70 |

## Classification rules

The audit now distinguishes:

- unresolved JSX text, interface attributes, labels, notifications, validation messages and server-facing messages;
- exact English labels already covered by `sharedInterfaceTranslations` or `accountingDocumentTranslations`;
- protected business values and identifiers marked with the approved `data-*` contracts;
- translation dictionaries and test fixtures;
- routes, HTTP methods, MIME types, date formats, SQL/code fragments, CSS utility strings, acronyms and sample data.

Every candidate receives a module and a classification. The release gate requires zero unclassified findings.

## Enforced ratchet

`config/i18n-phase14-baseline.json` now stores:

- detector version and audit-policy digest;
- the reviewed total unresolved ceiling;
- a separate unresolved ceiling for every module;
- a zero-unclassified ceiling.

CI fails when:

- the detector or policy changes without a fresh review;
- the total unresolved backlog grows;
- any individual module grows even when the repository total does not;
- a new module appears without a reviewed baseline;
- any candidate is left unclassified.

The I18n Audit workflow also uploads the JSON and Markdown reports for every run, making later cleanup phases measurable file by file.
