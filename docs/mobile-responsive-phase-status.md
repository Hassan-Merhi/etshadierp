# Mobile Responsiveness Program Status

This document is the source of truth for converting the existing ERP web application into a phone-, tablet-, and desktop-friendly system without changing accounting, inventory, factory, or database behavior.

## Execution rules

1. Complete phases in order unless a later phase is an isolated prerequisite.
2. Use one focused branch and pull request per phase.
3. Preserve desktop behavior while adding mobile and tablet behavior.
4. Do not change APIs, accounting formulas, permissions, or database schemas unless the phase explicitly requires it.
5. Run TypeScript and the most relevant responsive checks before marking a phase complete when CI or a runnable preview is available.
6. Update this file after every phase with the branch, pull request, validation, and remaining risks.
7. Record SQL in the internal SQL ledger, but do not present SQL to the user until all phases are complete.
8. If a phase needs no SQL, record `None` in the ledger.

## Phase status

| Phase | Scope | Status | Branch / PR | Validation |
| --- | --- | --- | --- | --- |
| 1 | Global responsive foundation | Complete | `agent/mobile-responsive-phase-1-foundation` | Static source review complete; PR checks and rendered viewport smoke required when available |
| 2 | Mobile navigation and top bar | Not started | — | — |
| 3 | Shared page headers, filters, and actions | Not started | — | — |
| 4 | Forms and dialogs | Not started | — | — |
| 5 | Tables and mobile data lists | Not started | — | — |
| 6 | Core ERP mobile conversion | Not started | — | — |
| 7 | Factory mobile conversion | Not started | — | — |
| 8 | POS mobile and tablet redesign | Not started | — | — |
| 9 | Dashboards, reports, and charts | Not started | — | — |
| 10 | Mobile performance and offline behavior | Not started | — | — |
| 11 | Full responsive regression verification | Not started | — | — |

## Phase 1 completion record

### Delivered

- Restored browser zoom by removing the restrictive maximum-scale viewport setting.
- Added shared viewport-height handling for legacy and modern mobile browsers.
- Added safe-area variables for notches, browser chrome, and installed-app layouts.
- Added global width and overflow containment for the application root and main workspace.
- Added local horizontal-scroll containment for tables and wide data regions.
- Added touch manipulation and mobile input sizing to prevent accidental double-taps and iOS input zoom.
- Added mobile dialog and popover viewport constraints.
- Added reduced-motion compatibility.
- Added reusable responsive page, section, form-grid, toolbar, action, sticky mobile-action, and horizontal-scroll primitives.

### Deliberately unchanged

- Business calculations and accounting behavior.
- API routes and request payloads.
- Database schema and SQL migrations.
- Desktop navigation structure.
- Individual page-specific table transformations, which belong to Phases 3–9.

### Remaining verification

- Run `npm run check` or the repository TypeScript check on the phase branch.
- Run `scripts/run-responsive-browser-smoke.mjs` against a branch preview.
- Verify phone portrait and landscape, tablet portrait and landscape, desktop, and wide desktop.
- Confirm no page-level component overrides conflict with the shared mobile dialog sizing.

## Internal SQL ledger

| Phase | SQL used |
| --- | --- |
| 1 | None |

Do not provide this ledger as the final SQL report until every phase is complete.
