# Program 6B — Daybook, Accounts, and Reports Audit

Branch: `integration/programs-1-to-6-validation`

## Scope

Reduce accounting/reporting response size and repeated database work without changing balances, totals, reconciliation semantics, company isolation, or historical records.

## Completed implementation

### Factory Daybook

`GET /api/factory/daybook` retains its opt-in paginated implementation in `server/routes/factory/factoryDaybookPaginationRoutes.ts`.

Safeguards:

- Default page size: 100
- Maximum page size: 250
- Server-side date, transaction type, currency, search, amount, optional-status, role, and own-only filters
- Full filtered count calculated independently of the returned page
- Stable date/id ordering
- Pagination metadata in JSON and response headers
- Legacy unpaginated behavior preserved when pagination parameters are absent

The heavy Factory Daybook screen already uses this bounded contract. Totals and result counts remain based on the complete filtered dataset.

### Ledger Accounts and Parent Groups

The legacy `GET /api/ledger-accounts` array contract remains intact for voucher forms, imports, setup screens, offline preparation, and other complete selectors.

A field-limited endpoint is now registered before the legacy `/:id` route:

`GET /api/ledger-accounts/parent-groups`

It returns only:

- explicitly tagged `subType = "Group"` accounts;
- legacy accounts referenced as a parent by another live account; and
- fields required by the Parent Group combobox.

It preserves company isolation, excludes deleted accounts, and excludes hidden accounts unless explicitly requested. The Accounts Parent Group request is redirected to this endpoint while the original Accounts implementation and balance-aware `/api/accounts/all` contract remain byte-for-byte preserved in `AccountsLegacy.tsx`.

### Accounts balances and statements

The Accounts list continues to use `/api/accounts/all`, including its as-of-date and balance semantics. Account statements retain:

- stored opening-balance side handling;
- pre-period net balance;
- brought-forward balance; and
- running and closing balances derived from the complete filtered statement result.

No visible-page-only total was introduced.

### Reports

The audited net-profit endpoint is a single summary response, not a detail list. Pagination is therefore not applicable and would create incorrect page-dependent financial totals.

The endpoint already retains:

- a short company/date keyed cache;
- parallel independent reads; and
- one complete summary response.

Its remaining raw voucher-entry aggregation is classified under Program 6D database-query optimization because migrated-account attribution depends on account-company ownership rather than only voucher-company ownership. Replacing it without query-plan and reconciliation evidence would be an unsafe accounting change. Program 6B therefore preserves the existing summary semantics and explicitly prevents page-dependent totals; Program 6D owns the evidence-backed SQL aggregation rewrite.

Exports remain user-triggered and are handled under Program 6F resource controls.

## Verification guards

- `scripts/verify-program6b-financial-pagination.mjs`
- `scripts/audit-program6b-ledger-account-callers.mjs`
- shared bounded-pagination unit coverage

These guards protect:

- Daybook page-size limits, complete filtered counts, and deterministic ordering;
- Accounts brought-forward and pre-period balance semantics;
- field-limited parent-group selection and legacy group compatibility;
- preservation of the legacy ledger selector contract; and
- summary reports remaining independent of page size.

## Phase 6B acceptance result

- Daybook heavy-screen pagination: complete.
- Parent-group field-limited selector contract: complete.
- Accounts Parent Group migration: complete.
- Legacy selector compatibility: complete.
- Interactive report page-independence: complete.
- Totals, balances, debit, credit, and reconciliation isolation from page size: guarded.
- SQL aggregation requiring query-plan evidence: transferred to Program 6D, not silently changed.

## Safety rules retained

- Do not cache general financial API responses.
- Do not alter posting logic.
- Do not alter opening balances or ledger balances.
- Do not change historical transactions.
- Do not merge or deploy automatically.
