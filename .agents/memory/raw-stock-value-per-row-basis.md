---
name: Raw stock value must be summed per-row, not avg-cost × remaining
description: Why "What We Have" net-position raw material value must match the Raw Materials page, and the specific calculation shape that keeps them in sync.
---

Remaining raw-material stock value for a supplier must be the SUM of each individual
receipt/container row's own `(received_kg - used_kg) * cost_per_kg`, accumulated
incrementally as rows are processed — never `remaining_kg * (a received-weighted average
cost per kg across ALL that supplier's receipts)`.

**Why:** Once a supplier has two or more receipts at different cost/kg, the average-cost
re-derivation misattributes whatever kg was actually consumed onto every other receipt in
the blend, silently inflating or deflating the total. This caused the factory ERP's
"What We Have" (net position) card to show a different "Factory Raw Material Stock" total
than the Raw Materials page's "Available (Free) → Value (USD)" column for the same data —
a ~$275 drift on one real dataset, exactly reproducing
`(1000@$1.00 + 1000@$1.50, 500 used from the $1.50 lot)` → row-sum $1750 vs
avg-then-multiply $1875.

**How to apply:** Any place that re-derives a supplier's/material's raw-stock dollar value
(net position, dashboards, reports) must track and sum per-row remaining value directly —
mirroring `server/routes/factory/raw-stock/rawStockReceiptRoutes.ts`'s
`_remainingValueLocal`/`_remainingValueUsd` accumulation pattern — rather than reconstructing
it from a blended average cost times total remaining kg. Manual adjustments and
manual-supplier batch consumption (no source container) are the one legitimate place to draw
down value at the *current blended remaining* cost/kg (not received-weighted), since there's
no specific row to attribute usage to.
