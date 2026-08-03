# Phase 5 — Properties and Rentals interface conversion

## Scope

Phase 5 converts the complete Properties and Rentals translation backlog to reviewed English, Arabic and French coverage. It includes:

- Properties workspace and warehouse dashboard labels;
- rented-shop and unit lists;
- tenant, lease, guarantee and payment dialogs;
- monthly rent accrual, reversal and reconciliation messages;
- scheduled-payment, deletion and contract lifecycle messages;
- net-position, available, payable and cash-transfer summaries;
- Properties and Rentals backend validation and diagnostic messages.

## Reviewed result

The Phase 4 audit reported 246 actionable Properties and Rentals occurrences across 186 unique detected values.

Phase 5 classifies every value:

- 182 user-facing phrases receive reviewed English, Arabic and French coverage;
- 4 partial JavaScript-expression fragments are documented technical exclusions;
- the Properties and Rentals module ceiling falls from 246 to 0;
- shared property, accounting and payment vocabulary removes another 487 occurrences from other modules;
- the repository-wide actionable ceiling falls from 14,802 to 14,069;
- unclassified findings remain at 0.

## Catalog structure

The catalog is split into three focused source files covering:

1. dashboard, account, contract and guarantee copy;
2. payments, accruals and operational states;
3. unit, tenant, sharing and lease-management copy.

This keeps the module reviewable and avoids creating a new translation god-file.

## Dynamic message safety

The template engine translates only reviewed message structures and preserves embedded business values, including:

- payment amounts and dates;
- contract and ledger identifiers;
- unit location groups and unit numbers;
- voucher and accrual references;
- month/year values and billing dates;
- diagnostic counts and payment-group identifiers.

The engine supports direct switching between English, Arabic and French without losing the captured values.

## Protected business data

The runtime bridge remains an exact allowlist. Unknown values are not translated.

Existing protection markers remain authoritative, and Phase 5 adds explicit markers for property names, unit names, tenant names and contract references. Stock names, stock groups, account names, article/account codes, container numbers, voucher numbers and all other stored business values remain unchanged.

## Audit enforcement

Detector version 6 includes the three Phase 5 catalog files as reviewed compatibility sources and records the four technical expression fragments. The Properties and Rentals module ceiling is zero, so any new untranslated literal in that module fails the audit until reviewed.

All affected module ceilings are lowered to their exact post-Phase-5 audited counts.

## Regression coverage

Phase 5 tests verify:

- exactly 182 unique reviewed entries;
- non-empty English, Arabic and French values;
- dashboard, contract, guarantee and payment translations;
- direct Arabic/French switching;
- preservation of dynamic amounts, dates, contract ids and unit references;
- unknown property, tenant and contract values remaining untranslated;
- the Properties and Rentals audit ceiling remaining zero.

No database schema, rent calculation, accounting entry, payment behavior, contract state, permission, company isolation or stored business value is changed by this phase.
