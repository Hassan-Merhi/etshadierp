# ERP Navigation Audit Status

## Phase 1 — Complete

- Added `docs/erp-navigation-registry.md` as the authoritative ERP navigation contract.
- Mapped ERP shell roots, pinned links, sidebar sections, hubs, tabs, nested detail routes, permissions, compatibility aliases, Escape targets, visible Back targets, and browser-history rules.
- Preserved all permissions, APIs, accounting, inventory, costing, and business logic.

## Phase 2 — Complete

- Standardized Tracking, Inventory, Stock, Parties, and Sales Tools hub state.
- Hub tab changes replace view state rather than adding browser-history entries.
- Added validated values, deterministic defaults, and `popstate` synchronization.

## Phase 3 — Complete

- Completed deterministic ERP parent mappings for nested details and tools.
- Confirmed the shared Escape priority: layered controls, editable fields, then the newest page handler.
- Added ERP parent-route regression coverage.

## Phase 4 — Complete

- Visible PageHeader Back controls now appear only when an explicit or registered deterministic parent exists.
- Back controls and Escape therefore use the same parent contract instead of letting root pages navigate to an arbitrary browser entry.
- Invalid and retired hub deep-link values are canonicalized with `history.replaceState` to the supported default tab.
- Legacy `/combined-inventory` state now resolves cleanly to Inventory By Location instead of leaving an unsupported `tab=combined` URL.
- Updated hub navigation tests for direct entry, replacement history, valid tabs, and retired-tab canonicalization.

## Remaining phase

- Phase 5 — Final regression verification and reconciliation with the latest `main`.
