# Phase 14 — final RTL and translation release gate

## RTL hardening

Arabic sets the document direction to RTL. A global stylesheet aligns dialogs, menus, listboxes, tables, headings and form controls for RTL while isolating business identifiers such as article codes, account codes, container numbers and voucher numbers in LTR.

## Classified missing-text audit

`scripts/audit-i18n-phase14.mjs` scans TypeScript and TSX sources for likely user-facing English literals in JSX, interface attributes, notifications, validation messages and server messages. The audit separates unresolved literals from:

- exact labels already handled by the compatibility translation dictionaries;
- protected business values and identifiers;
- translation source files and tests;
- routes, HTTP methods, formats, code fragments, CSS utilities and other reviewed technical tokens.

Every finding is assigned to an ERP module and a classification. The generated JSON and Markdown reports are uploaded by the I18n Audit workflow and the Markdown summary is shown directly in GitHub Actions.

## Reviewed ratchet

`config/i18n-phase14-baseline.json` records the reviewed detector version, audit-policy digest, total unresolved ceiling, a separate ceiling for every module and a zero-unclassified ceiling.

The release gate fails when:

- the detector or policy changes without a fresh review;
- the repository-wide unresolved backlog grows;
- any individual module grows, even if another module decreases;
- a new module appears without a reviewed ceiling;
- any candidate is left unclassified.

The executable classifier contract in `scripts/verify-i18n-audit-classifier.mjs` verifies representative true positives, compatibility-covered labels and technical false positives before the full audit runs.

## Regression protection

`tests/phase14-i18n-release-gate.test.ts` verifies:

- the RTL stylesheet is loaded globally;
- Arabic-only RTL remains part of the language contract;
- business identifiers remain protected;
- placeholders, titles and accessibility labels remain translatable;
- the classified audit, policy, reviewed module baseline and classifier contract remain connected to CI;
- discovery mode cannot accidentally replace enforcement in the release workflow.

## Release condition

The rollout is complete only after CI, Security and the classified I18n Audit pass on the final branch head. Each later translation phase must lower the relevant module ceiling when unresolved literals are migrated to explicit translation keys or reviewed trilingual dictionaries.
