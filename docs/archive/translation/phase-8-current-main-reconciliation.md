# Phase 8 — current-main RTL and accessibility reconciliation

## Result

The original Phase 8 branch is fully contained in current `main`. The old stacked branch was not reused because it is hundreds of commits behind the current application.

The current-main audit found and repaired shared issues introduced or left exposed after the original Phase 8 work.

## Repairs

### Skip navigation

The shared skip link now resolves its hash target, focuses the actual `main-content` landmark, scrolls it into view, and updates the URL hash without reloading. Keyboard users therefore arrive at the page content instead of only moving the viewport.

### Dialog focus

The shared dialog no longer suppresses Radix close-focus behavior. Closing a dialog returns focus to the element that opened it unless a specific consumer intentionally overrides that behavior.

### Horizontal data regions

Focusable horizontal data regions now support Left and Right Arrow scrolling when the region itself has focus. Nested inputs and controls retain their own key behavior, and reduced-motion preferences are respected.

### RTL sheets and sidebars

Arabic RTL mirroring now handles both declared sides independently:

- left sheets and sidebars move to the physical right;
- right sheets and sidebars move to the physical left;
- mobile sidebars follow the same rule;
- entrance and exit translation direction matches the mirrored edge;
- border placement follows the visible edge.

English and French remain LTR.

### Stored business values

The RTL isolation rules now match both the older and current translation-protection attributes, including `data-stock-name`, `data-stock-item-name`, `data-stock-group`, and `data-stock-group-name`. Codes, references, dates, quantities, money values, email addresses, phone numbers, and other ordered identifiers remain LTR and bidi-isolated.

## Safety

No database schema, SQL, accounting, inventory, costing, permission, authentication, company-isolation, or stored business-data behavior changed.

## Verification status

The current-main source contract was updated and `scripts/verify-phase8-current-main-reconciliation.mjs` was added for later execution. No CI, build, TypeScript, lint, browser, or automated test command was run during this implementation, as requested.
