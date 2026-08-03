# Phase 6 — Reports and Exports translation conversion

## Objective

Convert the reviewed Reports and Exports backlog to approved English, Arabic and French coverage without translating stored business identifiers or changing report calculations, export contents, delivery behavior or access controls.

## Reviewed scope

The Phase 5 classified audit reported:

- 301 actionable Reports and Exports occurrences;
- 248 unique user-facing values;
- 0 unclassified findings.

The findings covered:

- chat-report titles, totals, summaries and comparison labels;
- Net Profit and GIT report screens;
- container, purchasing, stock, payroll, rental and accounting report labels;
- export capacity, attachment, archive and download messages;
- QZ Tray and Zebra printing guidance;
- WhatsApp export, delivery and configuration messages;
- generated report headings containing dynamic company, account, customer, supplier, worker, container and voucher references.

## Implementation

Phase 6 adds a four-part reviewed catalog and a dedicated translation engine.

The engine:

- translates exact approved values directly between English, Arabic and French;
- supports dynamic templates in all three source languages;
- orders templates by specificity so complete export and report messages win over shorter overlapping labels;
- preserves leading and trailing whitespace;
- returns `null` for unknown values rather than guessing;
- runs before the earlier compatibility catalogs in the transitional application translator.

## Protected values

Dynamic templates preserve embedded values, including:

- container numbers and tracking references;
- account, customer and supplier names;
- worker names and profile references;
- purchase-order, voucher and ledger references;
- dates, years, counts, weights and monetary values;
- WhatsApp chat and recipient identifiers;
- export queue sizes, attachment sizes and status details.

Existing business-value protection markers remain authoritative. Stock item names, stock group names, account names, article codes, account codes, container numbers, voucher numbers, property names, unit names, tenant names and contract references are not translated as stored data.

## Audit result

Adding the 248 reviewed values removes all 301 Reports and Exports findings. Reused report and delivery vocabulary removes another 364 occurrences from other modules.

The reviewed actionable ceiling changes from 14,069 to 13,404, and the Reports and Exports module ceiling changes from 301 to 0.

## Safety boundaries

This phase does not change:

- database schemas or migrations;
- report calculations or query filters;
- accounting entries, inventory quantities, costing or balances;
- export file generation, archive retention or download authorization;
- WhatsApp credentials, recipients or delivery routing;
- printer selection, label dimensions or barcode data;
- company isolation, permissions or stored business values.

## Verification contract

Phase 6 includes behavior tests that require:

- exactly 248 unique reviewed English entries;
- non-empty Arabic and French coverage for every entry;
- correct static report, print and WhatsApp translations;
- preservation of dynamic identifiers and values;
- direct Arabic-to-French and French-to-Arabic switching;
- rejection of unknown stock, account and container identifiers;
- a detector-version 7 baseline with `reports-exports` locked at zero.
