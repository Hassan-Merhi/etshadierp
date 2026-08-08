# Phase 10 — UI Consistency

Phase 10 establishes a shared presentation boundary for ERP pages without changing business logic, API requests, permissions, calculations, or database behavior.

## Workspace layout primitives

`client/src/components/ui/workspace-layout.tsx` introduces reusable primitives for the most repeated page structures:

- `WorkspacePage` for consistent page spacing and width containment;
- `WorkspaceSection` and `WorkspaceSectionHeader` for section hierarchy;
- `WorkspaceToolbar` and `WorkspaceToolbarGroup` for responsive filters and controls;
- `WorkspaceActions` for mobile-safe primary and secondary actions;
- `ResponsiveTableFrame` for keyboard-focusable horizontal table scrolling;
- `FormActionBar` for sticky, responsive form submission controls.

These primitives are additive. Existing screens continue to work and can migrate incrementally when edited.

## Page header consistency

The shared `PageHeader` now uses semantic `header` and `nav` elements, labels cursor-navigation controls for assistive technology, and uses the shared responsive action layout. Long titles and subtitles wrap instead of being silently truncated, while the existing back-target, cursor navigation, icons, children, test IDs, and route behavior remain unchanged.

## Page state consistency

Loading, empty, error, and success states retain their existing defaults and exports while adding:

- pending and disabled primary-action states;
- an optional secondary action;
- a consistent action layout on narrow screens;
- visible pending feedback;
- reduced-motion support;
- improved description wrapping and line height.

## Responsive table behavior

`ResponsiveTableFrame` provides one standard container for wide ERP tables. It preserves horizontal scrolling, prevents the entire workspace from stretching, exposes a keyboard-focusable scroll region, and uses stable scrollbar space to reduce layout movement.

## Form action behavior

`FormActionBar` standardizes save/cancel placement. On narrow screens actions stack with the primary action closest to the user’s thumb flow; on wider screens they align to the right. Sticky positioning keeps actions reachable in long forms without changing submit handlers.

## Compatibility boundary

This phase intentionally does not:

- change any endpoint, query, mutation, payload, or response;
- alter accounting, inventory, costing, permissions, or company isolation;
- rename existing `PageHeader` or page-state props;
- remove existing UI components;
- force a repository-wide screen rewrite;
- add a database migration.

The shared primitives create a stable migration path for future screen edits while minimizing regression risk.

## Verification boundary

The Phase 10 verifier and focused source-contract test confirm the presence of every layout primitive, semantic page navigation, accessible cursor buttons, responsive action behavior, scrollable table behavior, sticky form actions, and pending page-state controls.

No CI, TypeScript compilation, formatting, lint, unit tests, browser tests, production build, database checks, or deployment checks were run in this connected session.

## Merge boundary

Phase 10 remains a draft and must not be merged until earlier roadmap phases are integrated in order, conflicts are resolved, and the owner explicitly authorizes the merge.
