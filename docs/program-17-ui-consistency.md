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

## Deferred UI work

The following work requires broader interactive and visual regression verification and is assigned to later Program 17 phases:

- shared sidebar/module-header extraction across ERP, Factory, and Properties;
- migration of the remaining financial pages to the shared report primitives;
- table-toolbar and pagination presentation unification;
- dialog footer standardization across destructive and accounting workflows;
- factory, inventory, POS, receiving, and scanner-specific layout consistency;
- decomposition of very large screens where layout and business state are tightly coupled.

## Safety

- No calculations, balances, quantities, rates, totals, query enablement, mutations, permissions, API requests, route paths, or persistence behavior changed.
- No CI, GitHub Actions, deployment, runtime browser testing, visual regression testing, or production checks were run.

## Status

- Active branch: `quality/program-17-ui-consistency`
- Phase 17A: complete.
- Phase 17B: complete.
- Program 17 remains unmerged until later phases are completed.
