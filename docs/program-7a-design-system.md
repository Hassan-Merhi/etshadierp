# Program 7A — Design System

Branch: `integration/programs-1-to-6-validation`

## Objective

Create a stable shared UI foundation without changing ERP workflows, accounting behavior, inventory behavior, costing, permissions, routing, or data contracts.

## Existing foundation confirmed

- Theme values are centralized in `client/src/index.css`.
- Light and dark mode share semantic CSS-variable contracts.
- Semantic success, warning, information, and destructive tokens exist.
- ERP, Factory, and Properties module identity colors are tokenized.
- Radius, shadows, typography, borders, cards, popovers, inputs, and navigation colors are tokenized.
- Core controls use shared Radix/shadcn-style components under `client/src/components/ui`.
- Buttons use one shared variant and size contract with focus-visible, disabled, hover, and active behavior.

## Completed work

### Shared page states

Added `client/src/components/ui/page-state.tsx` with:

- `PageState`
- `LoadingState`
- `EmptyState`
- `ErrorState`

The primitives provide one reusable structure for icon, heading, description, and optional recovery action. They use semantic theme tokens, shared buttons, responsive spacing, status semantics, and polite loading announcements.

### Regression protection

Added `scripts/verify-program7a-design-system.mjs` to guard:

- required semantic tokens
- dark-mode token scope
- shared button variants and keyboard focus treatment
- shared loading, empty, and error-state primitives
- baseline status accessibility semantics

## Adoption rule

New screens should use the shared primitives. Existing workflow-heavy screens should be migrated during their owning UI phases rather than through a broad mechanical rewrite. This prevents visual cleanup from accidentally changing forms, permissions, mutation behavior, table logic, or accounting and inventory workflows.

## Deliberate non-goals

Phase 7A does not:

- redesign individual financial screens; that belongs to 7B
- redesign factory and inventory screens; that belongs to 7C
- perform the full responsive and accessibility pass; that belongs to 7D
- change business calculations or API behavior
- merge, deploy, or run production migrations

## Completion status

Program 7A is implementation-complete. The shared token foundation, control contract, page-state primitives, adoption boundary, and regression guard are in place.
