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
| 4 | Forms and dialogs | Implemented | `agent/mobile-responsive-phase-4-forms-dialogs` / PR #420 | Final CI validation pending |
| 5 | Tables and mobile data lists | Implemented | `agent/mobile-responsive-phase-5-tables-data-lists` / PR #422 | Final CI validation pending |
| 6 | Core ERP mobile conversion | Implemented | `agent/mobile-responsive-phase-6-core-erp` / PR #430 | Final CI validation pending |
| 7 | Factory mobile conversion | Implemented | `agent/mobile-responsive-phase-7-factory` / PR #447 | Final CI and rendered validation pending |
| 8 | POS mobile and tablet redesign | Implemented | `agent/mobile-responsive-phase-8-pos` / PR #452 | Final CI and rendered validation pending |
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

## Phase 5 completion record

### Delivered

- Converted the shared table wrapper into a keyboard-focusable, labelled horizontal scroll region without changing table markup or row data.
- Added touch panning, contained overscroll, visible focus treatment, and an assistive description for wide tables.
- Added an optional minimum table width so individual pages can preserve critical columns without causing page-level overflow.
- Increased phone header and cell spacing while retaining the existing compact desktop density.
- Preserved sticky table headers and improved their opaque mobile background for readable scrolling.
- Added semantic responsive data-list primitives for card-style mobile representations of complex rows.
- Added labelled definition fields, responsive metadata grids, touch-sized row actions, and an accessible empty state.
- Made pagination horizontally contained, touch-sized, and icon-compact on phones while preserving text labels on larger screens.
- Standardized generic horizontal-scroll regions with shared data attributes and accessible descriptions.
- Added focused regression tests and a standalone Phase 5 source-contract verifier.

### Deliberately unchanged

- Table data, sorting, filtering, selection, row actions, pagination state, and page-size behavior.
- API requests, caching, query keys, permissions, accounting, inventory, factory calculations, and database schema.
- Desktop table column order and existing page-specific table implementations.
- Page-by-page table-to-card decisions, which remain part of the Core ERP, Factory, POS, and reports conversion phases.

### Remaining verification

- Complete TypeScript, production build, lint, formatting, tests, smoke, coverage, Security, I18n, and CircleCI checks.
- Verify representative narrow and wide tables at 320 px, 360 px, 390 px, phone landscape, tablet, and desktop widths.
- Verify keyboard focus, horizontal scrolling, sticky headers, pagination, long values, and row actions.
- Confirm pages that need card-style rows can adopt the responsive data-list primitives without changing business behavior.

## Phase 6 completion record

### Delivered

- Added reusable core ERP page, header, action, filter, summary, and content primitives for Accounts, Inventory, Customers, Suppliers, vouchers, Daybook, and transaction screens.
- Made shared tabs horizontally scrollable, touch-sized, and semantically labelled on phones while preserving the existing desktop pill and underline layouts.
- Made shared period filters full-width on phones, constrained their menus to the viewport, and reduced the custom range calendar from two months to one month on mobile devices.
- Converted Daybook filters to a responsive core ERP grid with full-width phone controls and horizontally contained active-filter chips.
- Converted Stock Item History to the shared core ERP page, action, summary, table, and mobile data-list contracts.
- Added keyboard activation for tappable stock-history month cards without changing the month navigation target.
- Preserved the existing desktop monthly table while adding an explicit minimum-width scroll contract.
- Added browser-level containment for core ERP pages, filters, summaries, actions, and responsive tab lists.
- Added focused source-contract coverage and a standalone Phase 6 verifier.

### Deliberately unchanged

- Daybook query parameters, filter state, voucher ordering, amount visibility, and row actions.
- Stock Item History API requests, date/year filtering, monthly calculations, totals, chart data, and navigation routes.
- Account, inventory, customer, supplier, voucher, and transaction business rules.
- Permissions, company isolation, caching, accounting, inventory quantities, costing, and database schema.
- Factory, POS, and report-specific page conversions, which remain in later phases.

### Remaining verification

- Complete TypeScript, production build, lint, exact formatting, focused tests, full tests, smoke, coverage, Security, I18n, and CircleCI checks.
- Verify Daybook, All Daybook, Stock Item History, Accounts, Inventory, Customers, Suppliers, and vouchers at 320 px, 360 px, 390 px, phone landscape, tablet, and desktop widths.
- Verify tab scrolling, custom date selection, on-screen keyboard behavior, long stock names, large amounts, empty states, and keyboard activation.
- Retarget to `main` only after Phases 4 and 5 merge in order.

## Phase 7 completion record

### Delivered

- Added reusable Factory mobile page, header, action, workflow, scanner, live-status, and sticky action-bar primitives.
- Applied phone-safe touch targets, input sizing, safe-area spacing, width containment, form containment, and local scroll boundaries to the entire Factory workspace.
- Converted Bale Stock Entry page headers, actions, production summaries, and section tabs to mobile-first layouts.
- Converted the stock-entry product scanner into an accessible combobox and listbox with keyboard navigation, large touch results, live errors, and a result panel that participates in phone layout instead of being clipped by the viewport.
- Added semantic mobile cart cards with labelled quantity, weight, worker, logo, and removal controls.
- Preserved the existing desktop cart table with an explicit local horizontal-scroll contract.
- Made location, entry date, worker group, customer logo, totals, and confirmation controls responsive across phone, tablet, and desktop breakpoints.
- Kept the final Confirm & Print Labels action visible through a safe-area-aware mobile action bar.
- Added focused source-contract tests and a standalone Phase 7 verifier.

### Deliberately unchanged

- Stock-entry API requests, mutation payloads, quantity calculations, warehouse selection rules, worker assignment, and validation behavior.
- Draft restoration, product creation, label design, label generation, browser printing, and WhatsApp behavior.
- Factory permissions, routes, company isolation, inventory balances, costing, accounting, and database schema.
- Existing desktop two-column stock-entry layout and desktop cart table.

### Remaining verification

- Complete TypeScript, production build, lint, exact formatting, focused tests, full tests, smoke, coverage, Security, I18n, and CircleCI checks.
- Verify the Factory workspace and Bale Stock Entry at 320 px, 360 px, 390 px, phone landscape, tablet, and desktop widths.
- Verify scanner autofocus, physical barcode scanner input, on-screen keyboard behavior, arrow-key selection, touch product selection, long product names, cart quantity and weight controls, worker and logo selectors, confirmation safeguards, and label printing.
- Retarget to `main` only after Phases 4, 5, and 6 merge in order.

## Phase 8 completion record

### Delivered

- Applied phone-safe touch targets, safe-area spacing, width containment, responsive form boundaries, and bounded dialog/listbox behavior to the POS shell.
- Corrected the full-height POS route boundary so POS users landing on `/`, administrators using `/pos`, and transaction editors using `/pos/edit/:id` receive the intended sales canvas.
- Added a compact mobile POS identity header while preserving the existing desktop sidebar, navigation, company selector, currency selector, theme control, search, synchronization, and logout behavior.
- Separated the desktop page header and save action from the phone/tablet checkout flow so users no longer see duplicated save controls.
- Converted mobile product search into an accessible combobox and listbox with large touch results, long-name wrapping, stock status, and viewport-bounded scrolling.
- Made location, sale date, credit/customer, cash/bank, and payment-account controls responsive across phone and tablet widths.
- Converted mobile cart rows into readable cards with large decrement/increment controls, quantity and rate inputs, calculated totals, long-code wrapping, and touch-sized removal actions.
- Kept the final checkout action visible in a safe-area-aware fixed bottom bar while preserving the existing save handler and pending/valid-item safeguards.
- Converted POS transfer-order filters, route summaries, item counts, status badges, and view/adjust actions to phone- and tablet-safe layouts.
- Added focused source-contract tests and a standalone Phase 8 verifier.

### Deliberately unchanged

- POS API requests, save mutation payloads, inventory deduction, accounting postings, pricing calculations, exchange-rate behavior, credit restrictions, and payment-account rules.
- Supplier Partner cash/bank-only behavior, POS-user location assignment, drafts, autosave, last-sold-price behavior, zero-stock warnings, and customer selection data.
- Desktop `SaleGrid`, `InventoryPicker`, keyboard navigation, checkout strip, transaction export, invoice printing, stock printing, and WhatsApp delivery.
- POS permissions, company isolation, routes, database schema, and SQL.

### Remaining verification

- Complete TypeScript, production build, lint, exact formatting, focused tests, full tests, smoke, coverage, Security, I18n, and CircleCI checks.
- Verify POS sales and transfer orders at 320 px, 360 px, 390 px, phone landscape, tablet portrait, tablet landscape, desktop, and wide desktop widths.
- Verify POS-user `/` routing, admin `/pos` routing, transaction editing, physical barcode scanners, typed search, long product names, low/out-of-stock indicators, quantity and rate editing, customer selection, payment selectors, fixed checkout, save safeguards, transfer-order view/adjust behavior, printing, and WhatsApp dialogs.
- Retarget to `main` only after Phases 4 through 7 merge in order.

## Internal SQL ledger

| Phase | SQL used |
| --- | --- |
| 1 | None |
| 2 | None |
| 3 | None |
| 4 | None |
| 5 | None |
| 6 | None |
| 7 | None |
| 8 | None |

Do not provide this ledger as the final SQL report until every phase is complete.
