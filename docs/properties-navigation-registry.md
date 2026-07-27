# Properties Mode Navigation Registry

## Purpose

This document is the authoritative navigation contract for the Properties company shell. It records every route, its visibility, permission boundary, canonical parent, and compatibility behavior. Navigation changes must not alter property, rental, payment, voucher, ledger, accounting, analytics, permission, API, balance, or administrative business logic.

## Operational roots

- `/properties/daybook` — default Properties landing and unknown-route fallback.
- `/properties/agents` — Agent Ledger root.
- `/properties/rentals` — shared Rentals hub.
- `/properties/accounts` — Accounting accounts root.
- `/properties/vouchers` — Vouchers root.
- `/properties/analytics` — Analytics root.
- `/properties/settings` — Admin/Developer settings root.
- `/my-settings` — compatibility user-settings route outside the Properties namespace.

## Rentals hub

Canonical route: `/properties/rentals`

Validated tabs:

- `tab=warehouses` — default tab, renders warehouse rental management.
- `tab=shops` — renders shop rental management.
- `tab=payments` — renders the rental payment log.

Tab changes are view-state changes and use `history.replaceState`. Browser Back therefore returns to meaningful page transitions rather than cycling through hub tabs.

Legacy routes are preserved as replacement redirects:

- `/properties/rental/warehouses` → `/properties/rentals?tab=warehouses`
- `/properties/rental/shops` → `/properties/rentals?tab=shops`
- `/properties/rental/payments` → `/properties/rentals?tab=payments`

## Deterministic parent hierarchy

### Rentals

- `/properties/create` → `/properties/rentals?tab=warehouses`
- `/properties/transfer` → `/properties/rentals`
- Legacy warehouse route → exact Warehouses tab
- Legacy shop route → exact Shops tab
- Legacy payments route → exact Payments tab

### Accounting

- `/properties/voucher-detail/:voucherId` → `/properties/vouchers`
- `/properties/vouchers/:id/edit` → `/properties/vouchers`
- `/properties/ledger-vouchers/:accountId/:year/:month` → `/properties/ledger-monthly/:accountId`
- `/properties/ledger-monthly/:accountId` → `/properties/accounts`
- `/properties/account-groups` → `/properties/accounts`

### Administration

The following return to `/properties/settings`:

- `/properties/net-position-details`
- `/properties/import-cycle-diagnostics`
- `/properties/inventory-repair`
- `/properties/company-data-reset`
- `/properties/orphaned-records`
- `/properties/deleted-items`
- `/properties/chatbot-settings`

Root pages intentionally return no registered parent so Back and Escape do not invent arbitrary history destinations.

## Dashboard decision

`/properties/dashboard` remains available as a hidden compatibility route. Repository usage proves route-table and command-palette access but does not establish it as the operational landing page. `/properties/daybook` remains the company landing page and unknown-route fallback.

## Sidebar contract

Pinned:

- Daybook
- Agent Ledger

Rentals:

- Warehouses → `/properties/rentals?tab=warehouses`
- Shops → `/properties/rentals?tab=shops`
- Payments Log → `/properties/rentals?tab=payments`
- Cash Transfer → `/properties/transfer` for authorized users

Accounting:

- Accounts
- Vouchers
- Analytics

Footer:

- My Settings
- Settings for Admin/Developer

## Permission boundaries

- Developer only: Cash Transfer route.
- Admin/Developer: Settings and administrative tools.
- General authenticated Properties users: Daybook, Agent Ledger, Rentals, Accounts, Vouchers, Analytics, and My Settings.

## Compatibility and fallback rules

- `/my-settings` and `/balance-repair` remain shell exceptions until canonical aliases are introduced in Phase 4.
- Known legacy rental routes redirect to exact canonical tabs with replacement history.
- Invalid hub tab values normalize to the default Warehouses tab without adding browser history.
- Unknown Properties routes fall back to Daybook.

## Back, Escape, and browser history contract

1. Close the newest open dialog, menu, popover, command palette, or layered control first.
2. Do not navigate away while an editable control is actively handling Escape.
3. On child pages, Escape and visible Back use the same deterministic parent.
4. Root pages do not expose a Back action based only on browser history.
5. Tab changes inside the Rentals hub replace history.
6. Direct links to valid child screens remain supported.
7. Invalid or retired aliases canonicalize with replacement history.

## Scope protection

No navigation phase may change rental contracts, tenants, units, scheduled rent, guarantees, payments, accruals, balances, vouchers, ledgers, reports, APIs, permissions, or company data behavior.
