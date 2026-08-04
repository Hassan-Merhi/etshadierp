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
| 2 | Mobile navigation and top bar | Complete and merged | `agent/mobile-responsive-phase-2-navigation` / PR #411 | Full GitHub and CircleCI verification passed |
| 3 | Shared page headers, filters, and actions | Complete and merged | `agent/mobile-responsive-phase-3-page-controls` / PR #416 | Full GitHub CI, Security, I18n, CircleCI, tests, smoke, and coverage passed |
| 4 | Forms and dialogs | Implemented | `agent/mobile-responsive-phase-4-current-main` / PR pending | Final CI validation pending |
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
- Repaired CircleCI's changed-source formatting comparison for shallow pull-request checkouts.

### Deliberately unchanged

- Company selection behavior, offline synchronization, and server session handling.
- Route permissions and role-based navigation visibility.
- ERP, Factory, Properties, and Supplier Partner navigation data.
- Desktop sidebar width, collapse behavior, and keyboard shortcut.
- API routes, database schema, and business calculations.

### Validation

- GitHub CI, Security, and I18n passed.
- CircleCI static-build, security-readiness, and PostgreSQL regression passed.
- Pull request was conflict-free and merged.

## Phase 3 completion record

### Delivered

- Made shared page action groups use a compact one-column layout on the narrowest phones and two columns where space permits.
- Preserved the existing wrapped horizontal desktop action layout.
- Made shared filter toolbars stack cleanly on phones while retaining wrapped desktop filters.
- Ensured shared toolbar inputs and select triggers can shrink without forcing page-level horizontal overflow.
- Added minimum-width containment for shared toolbar children and action controls.
- Made shared form action bars use the same predictable phone grid and desktop row behavior.
- Added focused source-contract coverage for the shared control layout.

### Deliberately unchanged

- Page-specific filtering behavior and query parameters.
- Button handlers, navigation targets, permissions, APIs, accounting, costing, and database schema.
- Existing desktop page content order.

### Validation

- TypeScript, production build, lint, and formatting passed.
- Database schema preparation and startup migrations passed.
- Backend tests, API smoke sweep, and backend coverage passed.
- Frontend tests, frontend coverage, and the coverage ratchet passed.
- Security, I18n, and all CircleCI jobs passed.
- Pull request was conflict-free and merged.

## Phase 4 completion record

### Delivered

- Made base dialogs use the shared visual-viewport height so phone browser chrome and on-screen keyboards cannot push modal content off screen.
- Added a reusable scrollable `DialogBody` region for structured long forms and workflow dialogs.
- Made confirmation dialogs use phone-safe width, bounded height, local scrolling, wrapping text, reduced-motion behavior, and full-width touch actions.
- Made top, bottom, left, and right sheets respect the mobile visual viewport and prevent page-level overflow.
- Added touch-sized sheet close controls and predictable stacked phone actions while preserving desktop footer alignment.
- Made select triggers and options touch-sized on phones and constrained select menus to the available viewport.
- Added reusable auto-fitting `FormGrid`, `FormSection`, and `FormSectionLegend` primitives.
- Improved form error relationships, scroll positioning, and long label, description, and error wrapping.
- Added focused regression contracts and extended the shared dialog/form verifier.

### Deliberately unchanged

- Form submission handlers, validation schemas, default values, and payloads.
- Dialog open/close state, confirmation behavior, and destructive-action safeguards.
- APIs, queries, mutations, permissions, accounting, inventory, costing, and database schema.
- Desktop modal widths and page-specific form ordering.

### Remaining verification

- Complete TypeScript, production build, lint, formatting, tests, smoke, coverage, Security, I18n, and CircleCI checks.
- Verify representative long forms and dialogs at 320 px, 360 px, 390 px, phone landscape, tablet, and desktop widths.
- Verify on-screen keyboard access to focused fields and submit/cancel actions.
- Verify long select lists, confirmation dialogs, and side sheets remain locally scrollable without page-level horizontal overflow.

## Internal SQL ledger

| Phase | SQL used |
| --- | --- |
| 1 | None |
| 2 | None |
| 3 | None |
| 4 | None |

Do not provide this ledger as the final SQL report until every phase is complete.
