---
name: Mix-batch stable supplier cost rate
description: Supplier cost/kg used for mix-batch costing must be weighted by received kg, never remaining/available kg.
---

A supplier's raw-material cost/kg used when creating/editing/topping-up a mix
batch must be `SUM(receivedKg * costPerKgUsd) / SUM(receivedKg)` across that
supplier's non-deleted offloaded `factory_raw_stock` rows — a stable rate that
only moves on a new container offload or a landed-cost correction.

**Why:** the routes previously weighted by remaining kg (`receivedKg - usedKg`)
instead of received kg. Since consumption is FIFO (drains the cheapest/oldest
container first), the "remaining" weighting silently drifted the effective rate
upward after every mix-batch deduction — same bug shape as
raw-stock-value-per-row-basis.md (remaining-stock recompute vs. per-row/received basis).

**How to apply:** any place that derives a supplier's cost/kg for costing
purposes (mix-batch create/edit/top-up, source-display fallbacks) must call
`getStableSupplierCost()` in `server/services/factory/rawStockStableCost.ts`
rather than inlining a weighted-average loop. FIFO logic is still fine and
required for deciding *which* raw-stock row's `usedKg` gets debited — just
never let it influence the *rate*.
