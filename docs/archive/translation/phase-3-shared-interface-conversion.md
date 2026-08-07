# Phase 3 — shared interface conversion

## Scope

Phase 3 converts the shared application shell and reusable interface surfaces to reviewed English, Arabic and French coverage. It is intentionally limited to interface copy that appears across modules, including:

- application navigation and command-palette entries;
- shared dialogs, confirmation prompts and keyboard shortcuts;
- notifications, status labels and error states;
- offline preparation, queue and synchronization messages;
- shared date, pagination, import and table controls;
- reusable Factory, accounting and administration dialogs that live in shared components.

Module-specific page conversion remains in later phases.

## Reviewed result

The Phase 2 audit reported 527 actionable shared-UI occurrences across 471 unique detected values. Phase 3 reviewed every value:

- 461 unique user-facing phrases now have approved English, Arabic and French entries;
- 10 technical or library strings were documented as non-interface exclusions;
- the shared-UI actionable ratchet is reduced from 527 to 0;
- repeated shared phrases also reduce translation debt in the operational modules where they are reused;
- the repository-wide actionable ceiling is reduced from 17,923 to 16,445.

The reviewed catalog is divided into five focused source segments so navigation, workflow, offline/import and status copy can be reviewed without creating another translation god-file.

## Runtime behavior

The Phase 3 catalog is an exact allowlist. The compatibility bridge can translate approved shared phrases even when a legacy component renders them in a plain `div` or `span`, while arbitrary text remains untouched.

Dynamic interface messages preserve their embedded business reference while translating the surrounding sentence. Covered examples include company-switch messages, batch identifiers, voucher numbers, weights, unread-message counts and offline queue counts.

The existing protected-data selectors still take precedence. Stock names, stock groups, account names, article codes, account codes, container numbers, voucher numbers, table business rows and explicitly protected values are never translated by this bridge.

## Audit enforcement

Detector version 4 adds the five reviewed Phase 3 catalog segments as compatibility translation sources and records the ten technical exclusions. CI fails if shared UI introduces any new actionable literal because the module ceiling is now zero. Every other module ceiling was also lowered to the exact post-Phase-3 audited count, preventing any of the cross-module reductions from being lost.

## Regression coverage

The Phase 3 contract verifies:

- 461 unique reviewed translation entries;
- non-empty English, Arabic and French values;
- exact shared navigation, status and offline translations;
- direct Arabic-to-French and French-to-English switching;
- dynamic message translation without modifying embedded business references;
- unknown business values remaining untranslated;
- protected runtime selectors remaining in place;
- the shared-UI audit ceiling remaining zero.

No database schema, accounting calculations, inventory quantities, costing, permissions, company isolation or stored business values are changed by this phase.
