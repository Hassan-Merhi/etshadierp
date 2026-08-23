# Phase 3 — Translation & UI Polish

Phase 3 closes the classified untranslated-text backlog with real runtime English, French, and Arabic coverage.

## Starting point

The Phase 5-complete head measured 11,991 actionable occurrences representing 8,197 unique visible strings. The older reviewed baseline remained pinned at 11,995, so four literals had already been removed by unrelated cleanup.

## Completion contract

- Every classified actionable literal is covered by an English/French/Arabic runtime translation entry.
- Interpolated messages translate their fixed UI copy while preserving dynamic business values such as customer names, supplier names, codes, quantities, dates, voucher numbers, and container numbers.
- Known UI values inside select options and table cells may translate, while arbitrary business values and protected identifiers remain untouched.
- The classified untranslated-text ratchet is reduced to the genuinely earned post-cleanup count, with a target of zero.
- TypeScript, lint, translation contracts, RTL/accessibility verification, and repository CI must remain green.
- One-time translation-generation machinery is removed before merge; only permanent runtime coverage, tests, and this completion record remain.
