# Program 6B — Daybook, Accounts, and Reports Audit

Branch: `integration/programs-1-to-6-validation`

## Scope

Reduce accounting/reporting response size and repeated database work without changing balances, totals, reconciliation semantics, company isolation, or historical records.

## Findings

### Factory Daybook

`GET /api/factory/daybook` already has an opt-in paginated implementation in `server/routes/factory/factoryDaybookPaginationRoutes.ts`.

Current safeguards:

- Default page size: 100
- Maximum page size: 250
- Server-side date, transaction type, currency, search, amount, optional-status, role, and own-only filters
- Full filtered count calculated independently of the returned page
- Stable date/id ordering
- Pagination metadata in both JSON and response headers
- Legacy unpaginated behavior preserved when pagination parameters are absent

This route should not be rewritten. Program 6B work should preserve this compatibility bridge and move remaining frontend consumers to the paginated mode.

### Ledger Accounts

`GET /api/ledger-accounts` already pushes `accountType` and `search` filters into SQL, which avoids unnecessary application-side filtering. However, the no-filter path still returns the complete company account list through `storage.getAllLedgerAccounts(...)`.

Compatibility risk:

Many forms use the endpoint as a complete account selector. Changing the default response from an array to a paginated envelope would break those consumers.

Required safe migration:

1. Keep the existing array response for selector-style callers.
2. Add explicit bounded/list-specific modes rather than changing the default contract.
3. Bound page size and search length.
4. Select only fields required by each list or selector.
5. Compute counts and summaries independently of page size.
6. Migrate only confirmed heavy callers.
7. Keep static verification preventing accidental removal of the compatibility path.

#### Caller classification checkpoint

The main Accounts balance table does **not** use `/api/ledger-accounts`; it uses the balance-aware `/api/accounts/all` contract. Its direct ledger call exists only for the Parent Group combobox and currently downloads the full company ledger before filtering groups in the browser.

`scripts/audit-program6b-ledger-account-callers.mjs` now inventories every frontend call site and classifies it as a parent-group selector, filtered selector, search selector, offline/prefetch consumer, management list, or legacy full selector. The script fails when:

- the Accounts caller is no longer recognizable as a parent-group-only selector; or
- a management-list caller is found still using the legacy unbounded endpoint.

Run it with:

```bash
node scripts/audit-program6b-ledger-account-callers.mjs
```

This guard establishes the migration boundary before adding a lightweight parent-group contract and prevents broad endpoint changes that could break voucher, import, setup, or offline selectors.

### Reports

Reports fall into two groups:

- Interactive reports: must use bounded server-side date/filter inputs and return summaries separately from detail pages.
- Exports: remain user-triggered and are handled under Program 6F resource controls.

No financial report should calculate totals from only the visible page. Totals must be calculated from the full filtered dataset in SQL or a dedicated summary query.

## Phase 6B acceptance criteria

- Daybook heavy-screen consumers use pagination.
- Parent-group and other narrow selectors use field-limited contracts where safe, while legacy selector callers retain compatibility.
- Interactive heavy reports expose bounded detail pages plus full-filter summaries.
- No total, balance, debit, credit, or reconciliation value depends on page size.
- Company and role filtering is applied before count, summary, and detail queries.
- Static verification covers pagination limits, caller classification, and compatibility behavior.

## Safety rules

- Do not cache financial API responses.
- Do not alter posting logic.
- Do not alter opening balances or ledger balances.
- Do not change historical transactions.
- Do not merge or deploy automatically.
