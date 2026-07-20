# Program 6C — Inventory Payload Review Protocol

## Purpose

This document defines the required review process for findings produced by:

```bash
node scripts/audit-program6c-inventory-payloads.mjs --json
node scripts/audit-program6c-inventory-payloads.mjs --strict --json
```

The goal is to reduce oversized location-inventory and stock-history responses without changing accounting, stock quantities, costing, company isolation, mutation behavior, or historical records.

## Scope

The scanner covers references to:

- location-inventory endpoints;
- stock movement endpoints;
- inventory history endpoints;
- stock ledgers and transaction-history endpoints.

A scanner finding is a review candidate, not proof that an endpoint is unsafe. Every high-severity finding must be inspected before application code is changed.

## Required classification

Record one classification for each reviewed finding ID.

### `verified-unbounded-read`

Use only when the route can return an unrestricted number of rows and the client does not already impose a server-side bound.

Required evidence:

- route path and handler location;
- query construction location;
- current ordering;
- current company, location, item, and date filters;
- representative or measured row count;
- client fields actually consumed;
- proposed response contract.

### `bounded-by-design`

Use when the route is already bounded by a hard server maximum, a required item/location/date filter, or a naturally small dataset.

Required evidence:

- the bound or required filter;
- where it is enforced on the server;
- why a caller cannot bypass it;
- expected maximum row count.

### `mutation-or-cache-reference`

Use for mutations and React Query cache-key references that do not retrieve response payloads.

Required evidence:

- operation type;
- confirmation that no list payload is returned or consumed.

### `false-positive`

Use when the matched string is not an inventory list request or route.

Required evidence:

- explanation of the surrounding code;
- the actual runtime behavior.

### `deferred`

Use only when safe classification requires representative data, query plans, or runtime traces that are not available.

Required evidence:

- exact missing evidence;
- owner or environment needed;
- risk of changing the route without that evidence.

## Safety requirements for pagination

Pagination may be added only when all of the following are preserved:

1. Company isolation is enforced before rows are selected.
2. Existing location, stock-item, status, and date filters retain identical semantics.
3. Ordering is deterministic and includes a stable tie-breaker.
4. Totals and brought-forward values are computed over the full filtered dataset, not only the visible page.
5. Running balances are either calculated server-side over the full ordered dataset or returned with an explicit page opening balance.
6. Historical rows are not rewritten, summarized destructively, or dropped.
7. Existing mutation endpoints and cache invalidations remain unchanged unless separately reviewed.
8. Default limits are conservative and maximum limits are enforced server-side.

Offset pagination is acceptable for bounded administrative lists. Cursor pagination is preferred for large append-only movement histories when stable ordering can be guaranteed.

## Safety requirements for filters

Server-side filters must be explicit and validated. Do not rely on client-side filtering of a full response.

Recommended filters where supported by existing behavior:

- `locationId`;
- `stockItemId` or `itemId`;
- `dateFrom` and `dateTo`;
- status or movement type;
- search text;
- page or cursor plus limit.

Do not introduce a mandatory filter if an existing screen legitimately requires the complete bounded dataset.

## Response-shape rules

A paginated response should use an explicit object instead of a bare array, for example:

```ts
{
  items,
  total,
  page,
  limit,
  totalPages,
}
```

For ledgers or histories with running values, include any required opening context explicitly:

```ts
{
  items,
  total,
  page,
  limit,
  openingQuantity,
  openingValue,
}
```

Only add opening fields when the existing screen calculates or displays running quantities or values. Their calculation must use the same historical ordering and precision as the current implementation.

## Field selection

Reducing selected columns is allowed only after every caller is checked.

Never remove fields used for:

- inventory quantities;
- valuation or cost per unit;
- source-document traceability;
- company or location isolation;
- status interpretation;
- historical ordering;
- export generation.

Prefer a dedicated lightweight endpoint when different callers require materially different contracts.

## Verification checklist

For every runtime change, compare the old and new behavior using the same company, filters, and data snapshot.

Verify:

- identical total matching rows;
- identical row ordering;
- identical quantities and units;
- identical monetary values and precision;
- identical running balances and brought-forward values;
- identical source-document links;
- identical handling of deleted, reversed, voided, or historical records;
- identical empty-state behavior;
- no cross-company or cross-location leakage;
- mutation and invalidation behavior unchanged.

Add focused automated coverage for the route contract and at least one consuming screen or query helper whenever pagination or response shape changes.

## Completion criteria for Program 6C payload work

This portion of Program 6C is complete only when:

- the scanner has been executed against the current branch;
- every high-severity finding has a documented classification;
- verified unbounded reads have safe server-side bounds or documented justification;
- affected clients consume the bounded contract;
- full-dataset totals and running values remain correct;
- focused regression tests pass;
- remaining deferred findings identify the exact external blocker.
