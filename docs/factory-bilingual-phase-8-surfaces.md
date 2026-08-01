# Factory bilingual catalog — Phase 8 remaining surfaces

Issue: #347  
Status: Phase 8 complete  
Base: Phase 7 PR #362

## Shared delivery model

Phase 8 does not add page-specific fallback rules. A single company-scoped response adapter now resolves Factory product/category text through `shared/factoryBilingualContract.ts` for JSON-backed screens and payloads.

The selected language is read from:

1. explicit `?lang=en|ar`;
2. `x-factory-catalog-language`;
3. the persistent `factory_catalog_language` cookie;
4. English default.

A Factory-wide English/Arabic selector is mounted in `FactoryShell`. Changing it persists the browser preference and refetches active Factory queries.

## Covered surfaces

The adapter covers current Factory and legacy parallel APIs for:

- Bale Explorer product/category responses;
- barcode and article-code lookup;
- bale labels, relabeling and reprint preparation payloads;
- Stock Entry, scanning and printing payloads;
- bale history, movement history and tracking;
- daily scans, ground scans, pressing and production views;
- Factory stock, location inventory and stock-entry history;
- proformas, customer orders, pending/finalized invoices and invoice detail;
- invoice/container loading status and scanning payloads;
- allocation V2/V3/V5 and dispatch batches;
- production, stock and worker reports;
- Factory POS, removals and bale recodes;
- WhatsApp attachment preparation data;
- backup, import preparation and offline payloads;
- legacy bale transfers, bale ledger, customer invoice and container-loading APIs.

Phase 7 remains the binary-document owner for invoice PDF, Excel and loading-list exports.

## Resolution rules

- product ID first;
- normalized exact article code second;
- never match by English or Arabic name;
- finalized/copied rows use requested snapshot, opposite snapshot, catalog, then article code;
- live catalog rows use requested catalog language, opposite language, then article code;
- category text uses the same shared resolver;
- responses retain additive `displayName`, `displayProductName`, `displayCategoryName`, `language` and `direction` fields;
- legacy display fields are replaced only for interactive read payloads so existing screens immediately show the selected language;
- backup, offline and preparation payloads keep original stored fields and receive additive bilingual display fields only.

## Safety

The adapter is GET-only and company-scoped. It never writes catalog or linked rows and never changes article codes, quantities, weights, prices, costs, allocations, stock, statuses, vouchers, journals, payments, balances or accounting data.

## Dependency closure

All groups in `config/factory-bilingual-dependencies.json` are now owned by Phases 1–8. Phase 9 remains diagnostics, safety verification and release proof rather than additional product-surface implementation.

## Verification policy

Per instruction, no GitHub Actions, CircleCI, TypeScript checks, builds, tests, browser checks, PDF checks, Excel checks or database checks were run during this phase.
