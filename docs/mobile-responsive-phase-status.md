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
| 1 | Global responsive foundation | Complete and merged | `agent/mobile-responsive-phase-1-foundation` / PR #403 | Full CI, Security, I18n, tests, and coverage passed |
| 2 | Mobile navigation and top bar | Implemented | `agent/mobile-responsive-phase-2-navigation` / PR #411 | Node 22 static-build and shallow-checkout diagnostics passed; final clean-branch validation in progress |
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
- Added shared mobile viewport-height handling for legacy and modern mobile browsers.
- Added safe-area variables for notches, browser chrome, and installed-app layouts.
- Added global width and overflow containment for the application root and main workspace.
- Added local horizontal-scroll containment for tables and wide data regions.
- Added touch manipulation and mobile input sizing to prevent accidental double-taps and iOS input zoom.
- Added mobile dialog and popover viewport constraints.
- Added reduced-motion compatibility.
- Confirmed the existing responsive page, toolbar, action, grid, accessibility, and horizontal-scroll primitives remain available for later phases.

### Validation

- Type-check passed.
- Production build passed.
- Lint and changed-file formatting passed.
- Database schema preparation and startup migrations passed.
- Backend tests, API smoke sweep, and backend coverage passed.
- Frontend tests and frontend coverage passed.
- Coverage ratchet, Security, and I18n audits passed.

## Phase 2 completion record

### Delivered

- Kept the company switcher directly visible in the phone top bar instead of hiding it behind another control.
- Removed phone-header crowding by moving logout, theme, currency, synchronization, search, and module actions into a dedicated mobile controls sheet.
- Preserved the existing desktop top bar layout and keyboard search affordance.
- Added a larger mobile navigation trigger and explicit accessible labels for icon-only controls.
- Automatically closes the mobile sidebar after route navigation so the destination page becomes visible immediately.
- Constrained the company menu to the mobile viewport and added touch-sized company rows.
- Constrained the mobile sidebar to the viewport, added safe-area padding, restored an explicit close button, and increased navigation touch targets.
- Repaired CircleCI's changed-source formatting comparison so shallow pull-request checkouts recover history before computing the `main` merge base.

### Deliberately unchanged

- Company selection behavior, offline synchronization, and server session handling.
- Route permissions and role-based navigation visibility.
- ERP, Factory, Properties, and Supplier Partner navigation data.
- Desktop sidebar width, collapse behavior, and keyboard shortcut.
- API routes, database schema, and business calculations.

### Validation completed

- The complete CircleCI static-build command sequence passed under Node.js 22.14.
- The original shallow-checkout failure was reproduced and traced to a missing Git merge base.
- The repaired shallow-checkout sequence passed before the permanent CircleCI configuration change was applied.
- Security and I18n audits passed on the clean Phase 2 implementation before the CI repair commit.

### Remaining verification

- Complete the final TypeScript, build, lint, format, tests, coverage, Security, I18n, and CircleCI checks on the clean Phase 2 branch.
- Verify the top bar at 320 px, 360 px, 390 px, phone landscape, tablet, desktop, and wide desktop.
- Verify company switching online and offline from a phone viewport.
- Verify sidebar links close the drawer in ERP, Factory, Properties, and Supplier Partner modes.
- Verify module-specific `extraActions` remain available in the mobile controls sheet.

## Internal SQL ledger

| Phase | SQL used |
| --- | --- |
| 1 | None |
| 2 | None |

Do not provide this ledger as the final SQL report until every phase is complete.
