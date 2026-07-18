# Program 6D — Database Query Optimization

Branch: `integration/programs-1-to-6-validation`

## Objective

Reduce database latency, memory pressure, and repeated query work without changing accounting totals, inventory quantities, costing, company isolation, transaction ordering, or historical records.

## Existing audit entrypoint

Run the read-only scanner with:

```bash
npm run audit:program-6d
```

Equivalent direct commands:

```bash
node scripts/audit-program6d-database-query-risks.mjs
node scripts/audit-program6d-database-query-risks.mjs --json
node scripts/audit-program6d-database-query-risks.mjs --strict --json
```

The scanner reports possible N+1 database calls, broad selects, potentially unbounded reads, and sequential-query candidates. Every result is a review candidate, not proof that a query is wrong.

## Required review record

Before changing a reported query, record:

- endpoint, service, job, or mutation using the query
- company and authorization predicates
- whether the query runs inside a transaction
- expected maximum row count
- fields actually consumed by the caller
- current SQL or Drizzle query shape
- query plan or equivalent database evidence when an index is proposed
- invariants that must remain unchanged
- rollback path

## Classification rules

Classify each finding as one of:

1. **Verified optimization** — evidence shows a safe bounded, batched, indexed, field-limited, or parallel implementation.
2. **Intentional full read** — the complete result is required and the dataset is operationally bounded.
3. **Transaction-order dependency** — sequential execution is required for locks, writes, calculated balances, or read-after-write behavior.
4. **False positive** — the static scanner matched code that is not a database risk.
5. **Deferred** — evidence is insufficient or production-like data is required.

Do not remove a finding from review merely because it is inconvenient to reproduce.

## Optimization safety gates

### N+1 removal

A looped read may be replaced with a batched read only when:

- all rows remain company-scoped
- authorization behavior remains identical
- missing-row behavior is preserved
- result ordering is preserved when visible to callers
- duplicate identifiers are handled identically
- the replacement does not widen historical access

### Field-limited selects

Selecting fewer columns is safe only after confirming every direct and indirect consumer. Do not omit fields used for:

- money or exchange-rate calculations
- quantity, stock, or negative-stock decisions
- costing and valuation
- audit or reconciliation output
- authorization or company isolation
- optimistic concurrency or update checks

### Bounded reads and pagination

Pagination must not change totals or balances. Summary values must be calculated over the complete filtered dataset in SQL, never from the visible page.

A bounded list must define deterministic ordering and preserve existing filters. Cursor or offset pagination must not silently omit rows used by exports, reconciliation, or historical views.

### Parallel reads

Use `Promise.all` only when the reads are independent. Keep sequential execution when:

- either query depends on the previous result
- a transaction lock or snapshot order matters
- the first operation writes data read by the second
- balance, costing, sequence, or audit calculations rely on ordering
- failure handling previously stopped later work

### Indexes

Do not add an index from static inspection alone. Require a query plan and document:

- scanned rows and estimated rows
- filter and join columns
- sort requirements
- existing usable indexes
- expected write/storage cost
- before/after plan evidence

Prefer the smallest evidence-backed index. Avoid redundant or overlapping indexes.

## Verification requirements

For accounting and reporting changes, compare before and after:

- totals and subtotals
- brought-forward and closing balances
- debit and credit equality
- reconciliation output
- date and company filters
- historical drill-down rows

For inventory and factory changes, compare before and after:

- quantity on hand
- average rate and total value
- negative-stock behavior
- supplier and location isolation
- container, bale, and stock-movement history
- costing precision

## Current remaining work

1. Run the audit in a checked-out repository and retain the JSON output.
2. Classify high-severity results first.
3. Fix only verified N+1 and unbounded-query cases.
4. Gather query-plan evidence before adding indexes.
5. Parallelize only proven-independent reads.
6. Record intentional exceptions and before/after evidence.
7. Add focused regression coverage for every behavior-affecting optimization.

## Non-goals

Program 6D must not:

- recalculate or repair historical accounting or inventory data
- change FIFO, average-rate, landed-cost, or other costing policy
- weaken company isolation or authorization
- replace full-dataset financial totals with visible-page totals
- merge to `main` or deploy automatically
