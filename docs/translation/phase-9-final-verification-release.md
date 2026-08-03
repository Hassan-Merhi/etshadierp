# Phase 9 — Final verification and production release

## Purpose

Phase 9 converts the completed multilingual implementation into one reproducible release decision. It does not add translation behavior or change stored business data. It verifies the stacked English, Arabic and French program from Phase 1 through Phase 8 against the database, browser, security and production-readiness gates required before merge and deployment.

## Release gates

The Phase 9 workflow runs the following checks on one exact source head:

1. dependency installation, lockfile integrity and production dependency validation;
2. repository-pinned formatting for Phase 9 release files;
3. TypeScript, production build and lint;
4. Phase 8 and Phase 9 RTL, accessibility and release contracts;
5. production-readiness, server-bundle, observability, memory-stabilization, mobile-routing, bandwidth and Program 7D checks;
6. disposable PostgreSQL schema preparation and application startup migrations;
7. local production-server health checks and multilingual Puppeteer smoke tests;
8. full backend tests, API smoke sweep and backend coverage thresholds;
9. full frontend tests and frontend coverage thresholds;
10. exact untranslated-text baseline enforcement;
11. focused security checks, critical production dependency audit and verified/unknown secret scanning.

The workflow records every result and fails at the end when any required gate is not successful, allowing unrelated failures to be distinguished from Phase 9 implementation failures.

## Browser matrix

The multilingual browser smoke covers:

- English in LTR;
- Arabic in RTL;
- French in LTR;
- 390 × 844 phone viewport;
- 768 × 1024 tablet viewport;
- 1440 × 900 desktop viewport.

Every case checks document language and direction, application direction metadata, root horizontal overflow, stale-asset recovery, login control visibility, touch-target height and LTR preservation for identifiers, amounts, numeric fields, email and telephone fields. When release credentials are supplied, the same checks run across the configured authenticated ERP routes.

## Final untranslated baseline

`config/i18n-phase9-final-release.json` is the exact approved release baseline:

- 22,430 detected candidates;
- 12,545 actionable findings;
- 9,885 reviewed exclusions;
- 0 unclassified findings.

The Phase 9 verifier requires exact repository and per-module equality. A release cannot silently raise, lower or reclassify this baseline. Any later reduction requires an intentionally reviewed baseline update in a separate change.

## Safety

Phase 9 introduces no SQL migration, database schema change, accounting entry, inventory movement, costing change, permission change, company-isolation change or stored multilingual business-value mutation. PostgreSQL is disposable verification infrastructure only.

## Release sequence

The translation pull requests remain stacked and must merge in order. Phase 9 targets the Phase 8 branch. After all Phase 9 gates are green, merge the stack from Phase 1 through Phase 9, run the deployment, and repeat the health and multilingual smoke checks against production before declaring release complete.
