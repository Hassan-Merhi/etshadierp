# Program 6D — Database Query Optimization

Branch: `integration/programs-1-to-6-validation`

## Objective

Reduce database latency, memory pressure, and repeated query work without changing accounting totals, inventory quantities, costing, company isolation, transaction ordering, or historical records.

## Implemented review tooling

The branch now contains a reproducible, read-only query-review workflow:

```bash
npm run audit:program-6d
node scripts/run-program6d-query-review.mjs
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

## Verified existing optimizations

The following high-impact areas were reviewed and are already optimized or intentionally bounded:

- Factory Daybook uses bounded pagination, full-filter counts, stable ordering, and server-side filters.
- Inventory list uses bounded pagination, independent counts, explicit fields, deterministic ordering, and server-side company/location/group/search filters.
- Stock-item management supports server-side filtering and pagination while selector-only callers use a field-limited endpoint.
- Accounts loads independent company/account entity sets in parallel and calculates balance summaries from full filtered data.
- Net-profit company metadata, account metadata, voucher-entry reads, and parent-company lookup are already issued concurrently.
- Stock movement summary is year-bounded and drill-down is month-bounded; neither is an open-ended history response.

## Net-profit aggregation review

`server/routes/stats/statsNetProfitRoutes.ts` currently materializes two voucher-entry result sets and uses them only to build three debit/credit maps:

- ledger-account balances are scoped by the ledger account's current company so migrated accounts carry their historical balance;
- supplier and employee balances are scoped by the voucher's company;
- supplier totals count only pure-debit or pure-credit rows, excluding mixed FX settlement rows.

A grouped SQL rewrite is technically possible, but it is not safe to replace through static inspection alone. It requires before/after reconciliation against real migrated-account, supplier, employee, and as-of-date datasets. The existing implementation remains unchanged until that evidence is available.

This is an explicit safety decision, not an overlooked optimization. `scripts/verify-program6d-query-safety.mjs` protects both company-attribution rules and the supplier pure-side filtering semantics.

## Index decision

No index was added in Program 6D because no production-like `EXPLAIN (ANALYZE, BUFFERS)` evidence was available. Adding speculative indexes would violate the phase's own acceptance rules and could add write and storage cost without improving the actual plans.

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

## Current completion boundary

Completed in the branch:

- static query-risk scanner;
- reproducible report runner;
- classification validator with strict high-severity gate;
- query-safety regression guard;
- review of the carried-over net-profit materialization candidate;
- explicit prohibition on speculative indexes and unsafe accounting rewrites.

Still requiring a runnable checkout with production-like database evidence before Program 6D can be marked fully complete:

- persist the scanner's current JSON output;
- classify every high-severity finding from that exact output;
- compare net-profit grouped-SQL results against the current implementation for migrated accounts, suppliers, employees, and as-of dates;
- collect query plans before any index change.

## Non-goals

Program 6D must not:

- recalculate or repair historical accounting or inventory data;
- change FIFO, average-rate, landed-cost, or other costing policy;
- weaken company isolation or authorization;
- replace full-dataset financial totals with visible-page totals;
- merge to `main` or deploy automatically.
