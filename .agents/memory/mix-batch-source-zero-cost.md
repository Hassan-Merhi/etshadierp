---
name: Mix-batch-source-level zero cost is a different bug than container-level cost drift
description: A container's own stored landed cost can be perfectly correct while its factory_mix_batch_sources rows still carry cost 0, dragging every batch that drew from it toward zero. Read this before extending the raw-stock recalc tool.
---

## The bug shape

`factory_mix_batches.costPerKg` is a weighted average over `factory_mix_batch_sources`.
Some historical sources (mostly tied to an "opening balance" container and one
`SUPPLIER`-direct source with no container link) were created with
`costPerKg = 0` / `totalCost = 0` even though `weightKg > 0` — the source row
was simply never priced at creation time.

**Why this evades the container-level recalc tool:** the existing
container-cost-mismatch detector (`getRawStockRecalcPreview` /
`computeCorrectContainerCost`) only flags a container when the CONTAINER's own
stored cost differs from the recomputed correct one. If the container's own
cost already happens to be right (e.g. an OPENING_BALANCE container with a
manually-entered correct rate), the container never shows up as "changed" in
that tool, so its cascade never runs, so the zero-cost source rows downstream
never get touched — even though they are unambiguously wrong.

## How to apply

- Detect this class of bug directly at the `factory_mix_batch_sources` level:
  `costPerKg <= 0 AND weightKg > 0`, independent of whether the parent
  container shows a diff.
- For container-linked sources, the fix is unambiguous: copy the container's
  CURRENT `factory_raw_stock.costPerKg` (run any needed container-level recalc
  first, then this repair reads the corrected value).
- For direct-`SUPPLIER` sources with no container link, there is no stored
  historical rate to recover — never auto-guess one; require an explicit
  admin-entered rate, and never let that manual-rate path apply to a
  container-linked source that already has a real answer on file.
- Recompute the batch's blended cost from ALL its sources after fixing one,
  then cascade to bales — reuse `recomputeBatchAndCascadeBales` (extracted
  from `rawStockCostCascade.ts`) rather than duplicating the weighted-average
  + bale-cascade logic a third time.
