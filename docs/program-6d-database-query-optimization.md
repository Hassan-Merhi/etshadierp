# Program 6D — Database Query Optimization

Branch: `integration/programs-1-to-6-validation`

## Objective

Reduce database latency, memory pressure, and repeated query work without changing accounting totals, inventory quantities, costing, company isolation, transaction ordering, or historical records.

## Status: COMPLETE

All completion criteria met as of 2026-07-19:

- every high-severity scanner finding is classified in `docs/program-6d-query-classifications.json`;
- strict validation passes (0 unresolved high-severity findings);
- real database reconciliation passes with zero unexplained differences (995/995 cases);
- migrated-account semantics are covered (57 cases across companies with cross-company vouchers);
- mixed-FX supplier semantics are covered where data exists;
- query-plan evidence is recorded in `tmp/program6d-query-plans-final.json`;
- every applied optimization is evidence-backed;
- no unsafe or speculative index was added.

## Implemented review tooling

The branch contains a reproducible, read-only query-review workflow:

```bash
npm run audit:program-6d
node scripts/run-program6d-query-review.mjs --report=tmp/program6d-report.json
node scripts/validate-program6d-query-classifications.mjs \
  --report=tmp/program6d-report.json \
  --classifications=docs/program-6d-query-classifications.json \
  --strict
node scripts/verify-program6d-query-safety.mjs
```

The scanner reports possible N+1 database calls, broad selects, potentially unbounded reads, and sequential-query candidates. Every result is a review candidate, not proof that a query is wrong.

The classification validator recognizes:

1. **Verified optimization** — evidence shows a safe bounded, batched, indexed, field-limited, or parallel implementation.
2. **Intentional full read** — the complete result is required and the dataset is operationally bounded.
3. **Transaction-order dependency** — sequential execution is required for locks, writes, calculated balances, or read-after-write behavior.
4. **False positive** — the static scanner matched code that is not a database risk.
5. **Deferred** — evidence is insufficient or production-like data is required.

Strict validation intentionally fails while a high-severity finding is unclassified or deferred.

## Scanner results (final)

| Metric | Initial | Final |
|---|---|---|
| Files scanned | 423 | 423 |
| Total findings | 5745 | 5743 |
| High-severity findings | 910 | 910 |
| Classified | 0 | 910 |
| Unresolved high-severity | 910 | 0 |

Finding breakdown by category:

| Category | Severity | Count |
|---|---|---|
| possible-n-plus-one | high | 671 |
| select-star | high | 239 |
| possibly-unbounded-read | medium | 2608 |
| broad-select | medium | 1707 |
| sequential-query-candidate | low | 520 |

## Verified existing optimizations

The following high-impact areas were reviewed and are already optimized or intentionally bounded:

- Factory Daybook uses bounded pagination, full-filter counts, stable ordering, and server-side filters.
- Inventory list uses bounded pagination, independent counts, explicit fields, deterministic ordering, and server-side company/location/group/search filters.
- Stock-item management supports server-side filtering and pagination while selector-only callers use a field-limited endpoint.
- Accounts loads independent company/account entity sets in parallel and calculates balance summaries from full filtered data.
- Net-profit company metadata, account metadata, voucher-entry reads, and parent-company lookup are already issued concurrently.
- Stock movement summary is year-bounded and drill-down is month-bounded; neither is an open-ended history response.

## Net-profit aggregation — applied optimization

### Evidence collected

**Reconciliation** (`scripts/reconcile-program6d-net-profit.mjs`):

| Metric | Value |
|---|---|
| Cases tested | 995 |
| Cases passed | 995 |
| Cases failed | 0 |
| Max absolute difference | 1.86e-9 (IEEE 754 float64 accumulation noise, not semantic) |
| Companies covered | 10 |
| Historical dates covered | 21 |
| Migrated-account cases | 57 |
| Mixed-FX cases | 0 (no mixed-FX supplier data present in test companies) |

The 4 initial failures before EPSILON adjustment were IEEE 754 rounding artifacts: JavaScript iterative `+=` and PostgreSQL `SUM(numeric)` accumulate in different orders, producing sub-nanosecond differences. Maximum observed diff: 1.86×10⁻⁹ — 100,000× smaller than 1 cent. EPSILON was set to 1×10⁻⁷ to account for float64 accumulation limits while still catching any real semantic mismatch ≥ 0.0000001.

**Query-plan evidence** (`tmp/program6d-query-plans-final.json`):

| Company | Current exec (2 queries) | Candidate exec (3 queries) | Current rows | Candidate rows | Row reduction |
|---|---|---|---|---|---|
| 1 (largest) | 14.68 ms | 12.47 ms | 26,114 | 192 | 99.3% |
| 12 | 9.90 ms | 7.36 ms | 7,925 | 190 | 97.6% |
| 8 | 6.13 ms | 3.73 ms | 3,681 | 50 | 98.6% |

### Change applied

**File:** `server/routes/stats/statsNetProfitRoutes.ts`

Replaced two large per-row entry materialisations (26K rows for company 1) with three grouped-SQL queries using `pool.query()`. The grouped queries preserve all 10 rules from the specification:

1. Ledger-account balances attributed by account's `company_id` (migrated-account rule).
2. Migrated accounts retain historical balance attribution.
3. Supplier and employee balances attributed by voucher's `company_id`.
4. Supplier totals use SQL CASE expressions counting only pure-debit or pure-credit rows.
5. Mixed debit+credit FX settlement rows excluded from supplier totals (CASE contributes 0).
6–10. Date boundaries, company filters, reversal/deletion/status/historical rules, decimal precision, and empty-result behavior all preserved.

`pool.query()` is used instead of Drizzle ORM `sql<>` templates to avoid the `::cast-in-sql-template` issue documented in the project memory.

### Import change

`pool` added to the import from `../../db` in `statsNetProfitRoutes.ts`.

### Safety guard update

`scripts/verify-program6d-query-safety.mjs` updated to check for the new SQL patterns:
- `la.company_id = $1` (ledger-account company scoping)
- `v.company_id    = $1` (voucher company scoping for supplier/employee)
- `ve.credit_amount::numeric = 0` (mixed FX exclusion)
- `ve.debit_amount::numeric  = 0` (mixed FX exclusion)

## Index decision

Do not add an index from static inspection alone. No index was added in Program 6D because the query-plan evidence did not show a case where an index would provide meaningful benefit beyond what is already in place. The existing indexes on `vouchers.company_id`, `voucher_entries.voucher_id`, `voucher_entries.ledger_account_id`, `ledger_accounts.company_id`, `voucher_entries.supplier_id`, and `voucher_entries.employee_id` are sufficient for the grouped-SQL queries.

Before adding an index, record:

- scanned and estimated rows;
- filter and join columns;
- sort requirements;
- existing usable indexes;
- expected write/storage cost;
- before/after plan evidence.

## Safety gates

### N+1 removal

A looped read may be replaced with a batched read only when:

- all rows remain company-scoped;
- authorization behavior remains identical;
- missing-row behavior is preserved;
- result ordering is preserved when visible to callers;
- duplicate identifiers are handled identically;
- the replacement does not widen historical access.

### Field-limited selects

Selecting fewer columns is safe only after confirming every direct and indirect consumer. Do not omit fields used for money, exchange-rate, quantity, stock, costing, valuation, reconciliation, authorization, or concurrency decisions.

### Bounded reads and pagination

Pagination must not change totals or balances. Summary values must be calculated over the complete filtered dataset in SQL, never from the visible page.

### Parallel reads

Use `Promise.all` only when reads are independent. Keep sequential execution when a transaction lock, write/read dependency, balance calculation, costing rule, sequence, or audit behavior relies on ordering.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/audit-program6d-database-query-risks.mjs` | Static scanner |
| `scripts/run-program6d-query-review.mjs` | Report runner |
| `scripts/validate-program6d-query-classifications.mjs` | Classification validator |
| `scripts/verify-program6d-query-safety.mjs` | Safety guard |
| `scripts/reconcile-program6d-net-profit.mjs` | Real-DB reconciliation (READ ONLY) |
| `scripts/collect-program6d-query-plans.mjs` | Query-plan evidence collector (READ ONLY) |

## Non-goals

Program 6D must not:

- recalculate or repair historical accounting or inventory data;
- change FIFO, average-rate, landed-cost, or other costing policy;
- weaken company isolation or authorization;
- replace full-dataset financial totals with visible-page totals;
- merge to `main` or deploy automatically.
