# Bandwidth Phase 3 — Database Query Pressure

## Scope

Phase 3 reduces repeated and fan-out database work behind the highest-cost bandwidth endpoints. It does not change accounting formulas, supplier opening-balance ownership, stock quantities, factory costing, posting, permissions, schemas, or deletion behavior.

## Supplier balance batching

Accounts and Payables previously called the canonical supplier-balance helper once per supplier. Each helper call then executed its own voucher-entry query.

Concurrent supplier balance requests are now collected during the same JavaScript turn and loaded through one company-scoped SQL query using `supplier_id = ANY($1::int[])`. Results are grouped back to the original supplier promises, preserving the existing entry shape, parent/child company rules, multi-currency fields, and signed balance calculation.

## Expensive read coalescing

The existing server read microcache now protects the current production query-pressure hotspots:

- `/api/accounts/all`
- `/api/factory/suppliers/with-balances`
- `/api/factory/raw-stock`
- `/api/factory/raw-stock/available-containers`
- `/api/factory/mix-batches`
- `/api/factory/bale-ledger`
- `/api/factory/production-value-report`
- `/api/factory/containers`
- `/api/factory/bale-products`
- `/api/factory/workers`
- `/api/ledger-accounts`
- existing Daybook and reporting paths

Identical simultaneous reads share the first response. Successful responses receive endpoint-specific 3–30 second TTLs. Cache keys include the complete URL, user, current company, factory company, and role.

## Write safety

Every POST, PUT, PATCH, and DELETE clears cached reads before execution and again when the response finishes or closes. A write generation prevents a read that started before a mutation from repopulating stale data. Pending coalesced readers are released when a write begins.

The server cache is limited to 128 entries and 5 MB per response. `Cache-Control: no-cache`, `Cache-Control: no-store`, and `X-Bypass-Request-Storm-Guard` bypass it.

## Verification

Run:

```bash
npm run verify:bandwidth
```

Targeted tests cover the expanded read microcache and prove concurrent supplier balance requests collapse into one SQL query while remaining isolated by company.

Live success still requires merge, deployment, and production bandwidth snapshots below 50 MB of API responses in every five-minute reporting window.
