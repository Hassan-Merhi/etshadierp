# Properties Mode Navigation Registry

## Purpose

This document is the authoritative navigation contract for the Properties company shell. It records every routed Properties screen, normal entry point, permission boundary, deterministic parent, Escape target, visible Back target, direct-link behavior, and compatibility exception before implementation changes begin.

Phase 1 is documentation and classification only. It does not change rental, property, voucher, accounting, ledger, analytics, or administrative business logic.

## Shell and fallback behavior

| Concern | Current behavior | Phase target |
| --- | --- | --- |
| Company shell | A company with `companyType === "properties"` renders `PropertiesShell`. | Preserve. |
| Namespaced routes | Normal workspace routes live under `/properties/*`. | Preserve and make canonical. |
| External shell exceptions | `/my-settings` and `/balance-repair` are allowed outside `/properties/*`. | Preserve compatibility; evaluate canonical aliases in Phase 4. |
| Wrong-mode route | A Properties company entering a non-Properties route is redirected to `/properties/daybook`. | Preserve safe landing; use replacement navigation where possible. |
| Unknown Properties route | The Properties route switch redirects to `/properties/daybook`. | Preserve safe fallback while distinguishing known retired aliases in Phase 4. |
| Root Back behavior | Root pages should not expose arbitrary browser-history Back behavior. | Enforce through deterministic parent registration in Phase 3. |

## Sidebar structure

### Pinned daily work

| Label | Route | Permission | Classification |
| --- | --- | --- | --- |
| Daybook | `/properties/daybook` | Properties user | Root |
| Agent Ledger | `/properties/agents` | Properties user | Root |

### Rentals section

| Label | Route | Permission | Current classification | Proposed parent |
| --- | --- | --- | --- | --- |
| Properties (Warehouses) | `/properties/rental/warehouses` | Properties user | Root sibling | Rentals hub or rental root |
| Shops Rented | `/properties/rental/shops` | Properties user | Root sibling | Rentals hub or rental root |
| Payments Log | `/properties/rental/payments` | Properties user | Root sibling | Rentals hub or rental root |
| Cash Transfer | `/properties/transfer` | Developer only | Root sibling | Rentals hub or Daybook, decision in Phase 2 |

### Accounting section

| Label | Route | Permission | Classification |
| --- | --- | --- | --- |
| Accounts | `/properties/accounts` | Properties user | Root |
| Vouchers | `/properties/vouchers` | Properties user | Root |
| Analytics | `/properties/analytics` | Properties user | Root |

### Footer links

| Label | Route | Permission | Classification |
| --- | --- | --- | --- |
| My Settings | `/my-settings` | Authenticated user | Shell exception / root |
| Settings | `/properties/settings` | Admin or Developer | Root |

## Complete route inventory

| Route pattern | Screen | Permission | Normal entry | Current deterministic parent | Proposed parent |
| --- | --- | --- | --- | --- | --- |
| `/properties/dashboard` | Properties dashboard | Properties user | Hidden | None | Root or retire decision |
| `/properties/daybook` | Properties daybook | Properties user | Pinned | None | Root |
| `/properties/agents` | Agent ledger | Properties user | Pinned | None | Root |
| `/properties/rental/warehouses` | Properties / warehouses | Properties user | Rentals sidebar | None | Rentals hub/root |
| `/properties/rental/shops` | Shops rented | Properties user | Rentals sidebar | None | Rentals hub/root |
| `/properties/rental/payments` | Rental payments log | Properties user | Rentals sidebar | None | Rentals hub/root |
| `/properties/create` | Create property | Properties user | Contextual action | None | Warehouses |
| `/properties/transfer` | Company cash transfer | Developer | Rentals sidebar | None | Rentals hub or Daybook |
| `/properties/accounts` | Accounts | Properties user | Accounting sidebar | None | Root |
| `/properties/ledger-monthly/:accountId` | Monthly account ledger | Properties user | Accounts drill-down | Accounts | Accounts |
| `/properties/ledger-vouchers/:accountId/:year/:month` | Monthly ledger vouchers | Properties user | Monthly ledger drill-down | Exact monthly ledger | Exact monthly ledger |
| `/properties/vouchers` | Vouchers | Properties user | Accounting sidebar | None | Root |
| `/properties/voucher-detail/:voucherId` | Voucher detail | Properties user | Voucher drill-down | Vouchers | Vouchers |
| `/properties/vouchers/:id/edit` | Voucher edit | Properties user | Voucher action | Vouchers | Vouchers |
| `/properties/analytics` | Properties analytics | Properties user | Accounting sidebar | None | Root |
| `/properties/settings` | Properties settings | Admin or Developer | Footer | None | Root |
| `/properties/net-position-details` | Net position details | Admin or Developer | Settings/analytics drill-down | Settings | Settings |
| `/properties/deleted-items` | Deleted items | Admin or Developer | Hidden admin tool | None | Settings |
| `/properties/orphaned-records` | Orphaned records | Admin or Developer | Hidden admin tool | None | Settings |
| `/properties/chatbot-settings` | Chatbot settings | Admin or Developer | Hidden admin tool | None | Settings |
| `/properties/import-cycle-diagnostics` | Import-cycle diagnostics | Admin or Developer | Hidden admin tool | Settings | Settings |
| `/properties/inventory-repair` | Inventory repair | Admin or Developer | Hidden admin tool | None | Settings |
| `/properties/company-data-reset` | Company data reset | Admin or Developer | Hidden admin tool | None | Settings |
| `/properties/account-groups` | Account groups | Admin or Developer | Hidden admin/account tool | None | Accounts or Settings; decision in Phase 3 |
| `/balance-repair` | Balance repair | Admin or Developer | Shell exception | None | Properties Settings |
| `/my-settings` | Personal settings | Authenticated user | Footer | None | Root |

## Existing parent-route coverage

The shared parent registry currently covers only:

- Voucher detail → Vouchers
- Voucher edit → Vouchers
- Ledger voucher list → exact monthly ledger
- Monthly ledger → Accounts
- Net position details → Settings
- Import-cycle diagnostics → Settings

Missing Properties mappings are intentionally deferred to Phase 3 after the rental hierarchy is decided.

## Navigation decisions for later phases

### Decision A — Rentals structure

Phase 2 must choose one canonical model:

1. **Recommended: shared Rentals hub**
   - Hub sections: Warehouses, Shops, Payments
   - Direct links remain valid
   - Tab/section changes replace history
   - Create Property returns to Warehouses
   - Cash Transfer returns to the hub or Daybook

2. **Fallback: Shops as operational parent**
   - Warehouses and Payments return to Shops
   - No new hub component
   - Smaller implementation, but less semantically clean

The shared Rentals hub is preferred because all three pages are currently equal sidebar siblings and belong to one workflow.

### Decision B — Dashboard

`/properties/dashboard` exists but has no normal sidebar entry. Phase 2 must determine whether it is:

- A supported root that should be pinned or linked,
- A contextual/legacy screen that remains direct-link only, or
- A retired route that should redirect canonically.

No decision should be made by deleting the route without confirming its current usage.

### Decision C — Account Groups

`/properties/account-groups` can reasonably return to either Accounts or Settings. Recommended rule:

- If it is part of chart-of-accounts management, parent = Accounts.
- If it is treated as administrative configuration, parent = Settings.

Phase 3 will verify the screen intent before registering the parent.

## Back, Escape, and browser history contract

For Properties Mode, later phases must preserve these rules:

1. Close the newest open dialog, menu, popover, command palette, or layered control first.
2. Do not navigate away while an editable control is actively handling Escape.
3. On child pages, Escape and the visible Back button use the same deterministic parent.
4. Root pages do not expose a Back action based only on browser history.
5. Section or tab changes within a hub replace history instead of adding repetitive entries.
6. Direct links to valid child screens remain supported.
7. Invalid or retired aliases canonicalize with replacement history.

## Permission contract

| Role | Expected Properties navigation access |
| --- | --- |
| Regular Properties user | Daily work, rentals, accounts, vouchers, analytics, My Settings |
| Admin | Regular access plus Properties Settings and admin repair/diagnostic routes |
| Developer | Admin access plus Company Cash Transfer |

Unauthorized routes must resolve to a safe permitted Properties page and must not leak hidden page content before redirect.

## Phased implementation plan

### Phase 1 — Registry and inventory

- Complete this route registry.
- Record sidebar, hidden, permission-gated, detail, compatibility, and fallback routes.
- Identify unresolved hierarchy decisions.
- No business-logic changes.

### Phase 2 — Rentals navigation structure

- Implement the chosen shared Rentals hierarchy.
- Standardize section state and direct-link behavior.
- Map Create Property to Warehouses.
- Decide Dashboard status.

### Phase 3 — Back and Escape hierarchy

- Register every missing deterministic parent.
- Align PageHeader Back and Escape behavior.
- Add parent-route regression tests.

### Phase 4 — Canonical aliases and redirects

- Normalize My Settings and Balance Repair compatibility routes.
- Canonicalize retired or invalid links using replacement history.
- Preserve permission boundaries and safe fallback behavior.

### Phase 5 — Final regression verification

- Verify direct entry, Back, Forward, Escape, visible Back, permissions, and unknown routes.
- Reconcile with latest `main`.
- Confirm the diff remains navigation-only.

## Phase 1 completion criteria

Phase 1 is complete when:

- Every Properties route in `PropertiesRoutes.tsx` is represented here.
- Every normal sidebar destination is represented here.
- Permission boundaries are explicit.
- Existing and proposed deterministic parents are explicit.
- Shell exceptions and fallback behavior are explicit.
- Unresolved design decisions are documented for later phases.
- No rental, property, accounting, voucher, ledger, analytics, or admin business logic changes are included.
