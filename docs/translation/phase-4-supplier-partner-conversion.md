# Phase 4 — Supplier Partner interface conversion

## Scope

Phase 4 converts the complete Supplier Partner translation backlog to reviewed English, Arabic and French coverage. It includes:

- Supplier Partner overview, reporting, setup and alias screens;
- GC Lshi migration previews, account plans, opening balances and rollback history;
- profit-and-loss, payable, profit-split and sales-form actions;
- migration preparation, final synchronization, cutover, rollback and recovery messages;
- validation, verification and reconciliation messages returned by Supplier Partner APIs.

## Reviewed result

The Phase 3 classified audit reported 261 actionable Supplier Partner occurrences across 230 unique values. Phase 4 reviews all 230 values and lowers the Supplier Partner module ratchet from 261 to zero.

The catalog is split into four focused files:

1. migration and aliases;
2. reports and setup;
3. cutover safety;
4. verification and recovery.

## Dynamic message safety

Migration and cutover messages contain business references that must never be translated. The Phase 4 template engine translates only the reviewed sentence structure and preserves captured values, including:

- company names and company codes;
- voucher numbers and amounts;
- migration, cutover and run identifiers;
- account subtype lists;
- location, cash-account and user identifiers;
- row, voucher, container and reconciliation counts;
- period values and operational status values.

English source templates use their existing `${...}` expressions for audit ownership. Arabic and French templates use indexed placeholders. At runtime, the engine compiles all three language forms and can switch directly between English, Arabic and French without losing embedded values.

## Protected business data

The existing runtime protection contract remains authoritative. Supplier names, account names, stock item names, stock groups, article codes, account codes, container numbers, voucher numbers and explicitly marked business values remain unchanged.

Unknown text is not translated. The compatibility bridge operates only on the reviewed exact catalog and compiled reviewed templates.

## Audit enforcement

Detector version 5 includes the four Supplier Partner catalog segments as reviewed compatibility sources. The Supplier Partner module ceiling is zero, so any new untranslated Supplier Partner literal fails the audit until it is explicitly reviewed.

## Regression coverage

Phase 4 tests verify:

- exactly 230 unique reviewed entries;
- non-empty English, Arabic and French values;
- migration, reporting and setup translations;
- direct switching between translated languages;
- preservation of company names, voucher numbers, amounts and migration counts;
- recognition of reviewed dynamic messages;
- unknown supplier/account values and article codes remaining untranslated;
- the Supplier Partner module ratchet remaining zero.

No database schema, migration behavior, accounting entry, inventory quantity, costing, permission, company isolation or stored business value is changed by this phase.
