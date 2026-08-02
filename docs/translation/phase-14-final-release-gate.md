# Phase 14 — final RTL and translation release gate

## RTL hardening

Arabic sets the document direction to RTL. A global stylesheet aligns dialogs, menus, listboxes, tables, headings and form controls for RTL while isolating business identifiers such as article codes, account codes, container numbers and voucher numbers in LTR.

## Missing-text audit

`scripts/audit-i18n-phase14.mjs` scans TypeScript and TSX sources for likely visible English JSX and interface attributes. `config/i18n-phase14-baseline.json` provides a one-way ceiling so newly introduced untranslated literals can fail the release gate instead of silently increasing.

## Regression protection

`tests/phase14-i18n-release-gate.test.ts` verifies:

- the RTL stylesheet is loaded globally;
- Arabic-only RTL remains part of the language contract;
- business identifiers remain protected;
- placeholders, titles and accessibility labels remain translatable;
- the audit script and baseline exist and can fail when the ceiling is exceeded.

## Release condition

The rollout is complete only after CI and Security pass on the final branch head. The audit baseline should be lowered whenever additional legacy literals are migrated into the reviewed trilingual dictionaries.
