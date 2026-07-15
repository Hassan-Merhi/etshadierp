---
name: Model A reservedKg is exposure, not a second deduction
description: Why "reservedKg > remainingKg" is not a valid bug signature in the factory raw-material Model A costing system, and what the real proof of a double-subtraction looks like.
---

In the factory raw-material Model A system, `usedKg` on `factory_raw_stock` already reflects mix-batch consumption. A container's real free kg is always `receivedKg - usedKg`. `reservedKg` (sum of active, non-closed mix-batch source weight against a container) is informational exposure only — it must never be subtracted a second time.

A naive reconciliation check that flags any container where `reservedKg > remainingKg` produces guaranteed false positives: a fully-consumed container (e.g. 1000 received / 1000 used) legitimately has `reservedKg == 1000` too (it was fully reserved by the batch that consumed it), which trivially exceeds its own remaining kg (0).

**Why:** hit a real production false-positive this way (container ECMU7025820 / batch FMB-2026-0004) before this was understood as a structural, not incidental, property of Model A.

**How to apply:** the only valid proof of a real double-subtraction is when a displayed/calculated free-kg figure is lower than `receivedKg - usedKg` by (approximately) `reservedKg` — i.e. discrepancy ≈ `-reservedKg`. Use `detectDoubleReservedDeduction()` in `server/services/factory/rawMaterialReconciliation.ts` for this exact check; never resurrect the raw `reserved - remaining > EPS` comparison.
