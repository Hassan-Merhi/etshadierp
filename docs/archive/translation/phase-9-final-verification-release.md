# Phase 9 — Final verification and production release

## Purpose

Phase 9 provides one reproducible release decision for the English, Arabic and French program on current `main`. It does not add stored translations, modify business data, or alter accounting and inventory behavior.

The original stacked Phase 9 branch is fully contained in `main` and is hundreds of commits behind the current application. The release infrastructure therefore runs against the current consolidated source instead of reviving that historical branch.

## Manual release only

`.github/workflows/phase9-final-release.yml` is intentionally available through `workflow_dispatch` only. It does not run automatically for pull requests, branch pushes, or the implementation merge.

A release operator must deliberately start the workflow after configuring:

- `PHASE9_ERP_SMOKE_USERNAME`;
- `PHASE9_ERP_SMOKE_PASSWORD`.

Authenticated browser coverage is mandatory for a successful release result. Missing credentials, login redirects, or route substitutions fail the browser gate.

## Release gates

The manual Phase 9 workflow checks one exact source head through:

1. dependency installation, lockfile integrity and production dependency validation;
2. repository-pinned formatting;
3. TypeScript, production build and lint;
4. Phase 8 and Phase 9 source contracts;
5. current-main multilingual reconciliation for Phases 4–8;
6. production-readiness, server-bundle, observability, stabilization, mobile-routing, bandwidth and Program 7D checks;
7. disposable PostgreSQL schema preparation and application startup migrations;
8. local production-server health checks and multilingual Puppeteer smoke tests;
9. full backend tests, API smoke sweep and backend coverage thresholds;
10. full frontend tests and frontend coverage thresholds;
11. untranslated-text release-ratchet enforcement;
12. focused security checks, critical production dependency audit and verified/unknown secret scanning.

Every result is recorded and the final step fails unless every required gate succeeds.

## Browser matrix

The multilingual browser smoke covers:

- English in LTR;
- Arabic in RTL;
- French in LTR;
- 390 × 844 phone viewport;
- 768 × 1024 tablet viewport;
- 1440 × 900 desktop viewport.

Each case checks document language and direction, application metadata, horizontal overflow, stale-asset recovery, touch-target visibility, protected LTR values, declared sidebar edge mirroring, and skip-link focus on `main-content`.

Authenticated routes are exact by default. The release workflow does not treat a login-only smoke run as a successful production release.

## Untranslated-text release ratchet

`config/i18n-phase9-final-release.json` uses schema version 2.

The release ratchet requires:

- detector version 9;
- zero unclassified findings;
- total actionable findings no higher than the reviewed cap of 12,545;
- no per-module actionable increase above its reviewed cap;
- zero actionable findings to remain zero for Supplier Partner, Properties and Rentals, Reports and Exports, backend messages and shared UI;
- the reviewed module set to remain unchanged.

Candidate and reviewed-exclusion totals are reported as evidence but are not locked to brittle exact values. Adding an approved translated phrase can legitimately change those totals without weakening the actionable regression boundary.

## Safety

Phase 9 introduces no SQL migration, database schema change, accounting entry, inventory movement, costing change, permission change, company-isolation change or stored multilingual business-value mutation. PostgreSQL is disposable verification infrastructure only.

## Release status

The release infrastructure is implemented on current `main`. No CI, build, TypeScript, lint, database, browser, security or automated test command was executed during this reconciliation, as requested. Therefore no green production-release attestation is recorded by this implementation change itself.
