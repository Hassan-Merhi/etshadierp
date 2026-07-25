# Inventory Cost-Memory Policy

Status: authoritative documentation for the current implementation

Reviewed against baseline commit: `3872e2eaf16be020ca7a4d16234830604582af0e`

Date: 2026-07-25

## Purpose

This document resolves a conflict between the current inventory implementation and older skipped-test/TODO descriptions.

It documents existing behavior only. It does not authorize a costing change, historical repair, database update, or test unskip without executable verification.

## Authoritative invariant

For an inventory row:

- When `quantity > 0`, `totalValue` must be non-negative and `averageRate` represents the positive on-hand stock cost.
- When `quantity <= 0`, `totalValue` must be `0` because there is no positive on-hand asset value.
- When `quantity <= 0`, `averageRate` may preserve the last valid non-negative rate as **cost memory**.
- `averageRate` must never be negative.
- Negative-stock shortage quantities are tracked separately through `inventory_negative_layers`.
- A later incoming receipt settles negative layers and uses the incoming rate for the settlement/cost calculation.

Therefore, the intended rule is:

```text
quantity <= 0  =>  totalValue = 0 and averageRate >= 0
```

It is **not**:

```text
quantity <= 0  =>  totalValue = 0 and averageRate = 0
```

## Why cost memory is preserved

Zeroing the rate when quantity reaches zero or becomes negative would discard the last known cost basis. The current negative-stock model uses a non-negative remembered rate for provisional costing and tracks incremental shortages separately until future receipts settle them.

Preserving the rate does not place an asset value on negative stock because `totalValue` remains zero.

## Current implementation evidence

`server/inventoryHelper.ts` documents and implements the following behavior:

- `inventory.totalValue` is valued only for positive on-hand quantity.
- `averageRate` is preserved as cost memory when quantity is zero or negative.
- outgoing stock that crosses below zero creates only the incremental shortage layer;
- incoming stock settles oldest negative layers before valuing remaining positive stock;
- exact reversal normalizes value to zero while retaining the previous valid rate.

Existing-row updates use `SELECT ... FOR UPDATE`, protecting normal read-modify-write operations on an already-created inventory row.

## Current regression evidence

`tests/inventory-hardening.test.ts` contains active assertions that:

- stock below zero has `totalValue = 0`;
- cost memory remains non-negative;
- exact reversal to zero preserves the prior rate;
- repeated matched receipt and exact-reversal cycles remain stable;
- positive stock continues to satisfy the quantity × rate = value equation;
- an adjustment does not alter another item at the same location.

These active tests represent the newer business rule.

## Stale references that must not drive a production change

The following older descriptions conflict with the current policy:

- the skipped `inventory.test.ts` case titled `qty <= 0 implies total_value = 0 and rate = 0`;
- two `factory-container-lifecycle.test.ts` TODO messages that identify preserved `averageRate` as the cause preventing reverse/re-offload coverage;
- the older skipped-test summary in `docs/testing.md` that recommends forcing `averageRate = 0` whenever quantity is non-positive.

Those references are historical and are superseded by this policy and the active inventory-hardening tests.

## What remains unverified

Preserving cost memory does not by itself prove every route-level reversal workflow. Separate integration coverage is still required for:

- Supplier Partner offload reversal;
- Supplier Partner re-offload after reversal;
- standard factory container offload/reversal/re-offload;
- purchase and sales voucher reversal when stock crosses zero;
- stock-transfer edit and deletion reversal;
- concurrent first-time creation of the same inventory row;
- prepaid, paid-now, and unpaid SP offload charge combinations.

These are test-coverage gaps, not permission to change costing logic.

## Safe test-alignment plan

When an executable test runner is available:

1. Rewrite the stale skipped inventory assertion to expect `totalValue = 0` and preserved non-negative cost memory.
2. Rewrite SP reverse/re-offload TODO descriptions so they do not prescribe zeroing `averageRate`.
3. Implement route-level reversal tests with exact quantity, value, voucher, and idempotency assertions.
4. Seed `sp_prepaid_charges` and payment accounts for partial-charge lifecycle coverage.
5. Run the complete backend suite before unskipping any legacy case.

## Prohibited shortcut

Do not change `server/inventoryHelper.ts` merely to satisfy the older `rate = 0` descriptions. Such a change would alter the established negative-stock costing policy and could affect historical reversals, future receipt settlement, mix-batch costing, and valuation reports.
