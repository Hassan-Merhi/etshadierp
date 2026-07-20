# Program 17 — UI Consistency

## Objective

Improve visual consistency, responsive behavior, loading/empty states, and financial-screen usability without changing calculations, API contracts, permissions, navigation, mutations, query behavior, or persistence.

## Phase 17A — Shared UI Foundations

### Completed

- Added `client/src/components/ui/page-shell.tsx` with a standard responsive page container, action grouping, financial report header support, and one tabular-number class.
- Added `client/src/components/ui/display-state.tsx` with accessible reusable loading rows and empty states.
- Established a standard page rhythm: `p-3 sm:p-6`, six-unit vertical spacing, one `PageHeader`, and action controls inside the header action slot.
- Established financial display rules: right alignment, monospace figures, and `tabular-nums` for stable comparison.
- Added keyboard-focus treatment for interactive report rows.
- Preserved the existing Tailwind, Radix, shadcn, theme-token, and dark-mode architecture.

## Phase 17B — Financial Screen Consistency

### Completed

- Migrated `OpeningStockSummary.tsx` and `ClosingStockSummary.tsx` to the shared page and display-state primitives.
- Removed duplicate back buttons that appeared beside a `PageHeader` that already owns navigation.
- Moved company context and report description into the standard subtitle position.
- Moved period and carry-forward actions into the shared header action area.
- Replaced bespoke loading skeleton loops with `LoadingRows`.
- Replaced plain text empty messages with accessible `EmptyState` components.
- Converted clickable report rows from generic `div` elements to semantic buttons with keyboard focus.
- Standardized financial number alignment and tabular numeral rendering.
- Preserved report calculations, date filters, query keys, endpoint URLs, drill-down URLs, carry-forward mutation behavior, invalidations, dialog wording, test IDs, and responsive column visibility.

## Phase 17C — Factory and Inventory Consistency

### Completed

- Migrated `FactoryStockBaleList.tsx` to `PageShell`, `PageActions`, `LoadingRows`, and `EmptyState`.
- Removed its duplicate inline back button while retaining the existing custom escape/back navigation behavior.
- Moved available and locked counts into the standard header action area.
- Standardized bale-weight number rendering with the shared financial-number class.
- Added visible keyboard focus to the weight-correction control.
- Preserved the bale query, article/location filters, back URL behavior, weight-edit dialog, invalidation key, status badges, table columns, and test IDs.

## Phase 17D — POS and Receiving Consistency

### Completed

- Migrated `PendingLoadings.tsx`, the receiving/loading continuation surface, to the shared page and display-state primitives.
- Moved the primary “Start New Loading” action into the standard header action area.
- Added the same action to the empty state so the recovery path remains obvious.
- Standardized loading placeholders, empty-state semantics, date and quantity numeral alignment, page spacing, and responsive action placement.
- Preserved the 30-second refresh interval, loading query key, creation URL, resume URL, notes, badges, card IDs, and existing route behavior.

## Architecture and adoption rules

- New list/report/workflow pages should use `PageShell` unless a full-screen scanner or canvas requires a different layout.
- A page should render one `PageHeader`; duplicate adjacent navigation buttons should not be added.
- Primary filters and actions belong in the header action slot when space permits.
- Loading and empty states should use the shared primitives unless the workflow needs domain-specific recovery content.
- Monetary, rate, quantity, and comparable numeric columns should use tabular numerals; financial columns should also use the shared financial-number class.
- Interactive rows and inline controls must retain keyboard focus visibility.

## Explicitly deferred

The following broad changes require interactive browser and visual regression verification and were not guessed in Program 17:

- shared sidebar/module-header extraction across ERP, Factory, and Properties;
- conversion of every legacy page and table to the new primitives;
- global dialog-footer conversion across destructive and accounting workflows;
- visual redesign of monolithic POS, voucher, payroll, accounts, daybook, scanner, and production screens;
- removal of legacy stock-allocation versions and routes;
- design-token replacement for all historic hard-coded module accent colors.

These deferrals do not block Program 17 completion: the shared primitives exist and representative financial, factory/inventory, and POS/receiving workflows now demonstrate the required ownership and adoption pattern without changing business behavior.

## Safety

- No calculations, balances, quantities, rates, totals, query enablement, mutations, permissions, API requests, route paths, or persistence behavior changed.
- No CI, GitHub Actions, deployment, runtime browser testing, visual regression testing, or production checks were run.

## Status

- Active branch: `quality/program-17-ui-consistency`
- Phase 17A: complete.
- Phase 17B: complete.
- Phase 17C: complete.
- Phase 17D: complete.
- Program 17: complete and ready to merge.
