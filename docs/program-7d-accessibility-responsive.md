# Program 7D — Accessibility and responsive behavior

Status: complete

## Scope completed

- Added a keyboard-visible skip-link primitive for bypassing repeated navigation.
- Added responsive action groups that stack safely on narrow screens and return to inline alignment on larger screens.
- Added an auto-fit responsive grid that avoids fixed column-count assumptions.
- Added labelled landmark-region support for main, navigation, and section content.
- Added keyboard-focusable horizontal scroll regions for wide financial, inventory, and operational tables.
- Preserved the existing shared focus-ring contract and semantic design tokens.

## Safety boundary

This phase is presentation-only. It does not change routing, permissions, mutations, API requests, accounting, inventory, costing, offload, transfer, reconciliation, or historical data behavior.

Adoption remains incremental in workflow-heavy screens so accessibility improvements do not become broad mechanical rewrites.

## Regression safeguard

`scripts/verify-program7d-accessibility-responsive.mjs` checks for the shared primitives, visible keyboard focus, labelled scroll regions, responsive action behavior, and content-driven responsive grids.

No CI, build, runtime verification, deployment, migration, or merge was performed as part of this phase.
