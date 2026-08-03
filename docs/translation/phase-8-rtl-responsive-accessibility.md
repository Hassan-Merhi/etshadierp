# Phase 8 — RTL, responsive layout and accessibility hardening

## Goal

Make the existing English, Arabic and French application language system safe to use across ERP, Factory, Properties and POS layouts without changing stored business data or any business calculation.

Arabic is the only right-to-left application language. English and French remain left-to-right.

## Direction contract

Phase 8 adds one document-direction helper that synchronizes the selected application language across:

- the `<html>` language and direction attributes;
- the `<body>` direction used by portal content;
- application language and direction data attributes used by stable CSS selectors;
- Radix dialogs, sheets, menus, listboxes and popovers rendered outside the React root.

Language changes apply immediately without reloading. A polite live region announces the new application language to assistive technology.

## Protected business values

The RTL interface does not rewrite or reverse stored business values.

Names such as companies, customers, suppliers, accounts, stock items, properties, units, tenants and workers use bidi isolation so mixed Arabic, Latin and numeric content remains readable. Values that must retain left-to-right order are explicitly isolated as LTR, including:

- article and account codes;
- container, voucher, document and contract references;
- IDs, paths and status codes;
- dates, telephone numbers and email addresses;
- currency values, tabular numbers and numeric form inputs.

The translation compatibility bridge and all existing `data-business-value` protections remain authoritative.

## Shared layout hardening

The changes are centralized in shared primitives rather than repeated across hundreds of pages:

- application top-bar controls use logical alignment and remain horizontally reachable on narrow screens;
- desktop and mobile sidebars move to the logical Arabic side;
- dialog and sheet close buttons, headings and action footers use logical RTL positions;
- only intentional directional icons are mirrored;
- tables and grids follow the interface direction while protected numbers and references remain LTR;
- popovers and dialogs are constrained to the viewport;
- horizontal data regions use contained scrolling and stable scrollbars.

## Accessibility

Phase 8 adds or strengthens:

- translated skip links in ERP, Factory, Properties and POS;
- a focused `main-content` destination in every application mode;
- a polite language-change live region;
- visible keyboard focus fallback;
- coarse-pointer touch targets;
- reduced-motion behavior;
- forced-colors focus visibility;
- keyboard-discoverable horizontal data regions;
- bidi-safe POS usernames and directional back navigation.

## Safety

This phase does not change:

- database schema or SQL;
- accounting entries, balances or reports;
- inventory quantities, costing or stock movement;
- permissions, company isolation or authentication;
- language preference persistence;
- stored names, codes, references or other business values.

## Verification contract

Phase 8 is guarded by:

- unit tests for English, Arabic and French document-direction synchronization;
- source contracts for business-value isolation and LTR identifiers;
- shared dialog, sheet, sidebar, top-bar and scroll-region contracts;
- translated skip-link coverage in all four application shells;
- POS directional-control and business-value checks;
- the existing Phase 14 trilingual release gate;
- the Program 7D accessibility and responsive verifier.
