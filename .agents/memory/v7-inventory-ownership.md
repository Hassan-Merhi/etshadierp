---
name: V7 Historical Replay Inventory Ownership
description: Phase V7 of the historical raw-material cost replay engine — inventory_supplier_id column, CONTAINER_DIRECT consumption fix, zero-boundary clamp, valuation_basis, financial impact preview.
---

## Root bug (fixed in V7)
`buildBatchConsumptionEvents` only created consumption events for `SUPPLIER_LOCKED_RATE` sources (`supplierId != null`). CONTAINER_DIRECT sources (supplierId=null, containerId set, sourceBatchId=null) were silently skipped, so the supplier's moving-average timeline never saw those batches' consumption — their remaining stock was overstated, diluting the locked rate downward.

## Fix
- Added `inventory_supplier_id` column to `factory_mix_batch_sources` (migration `20260721_001_factory_mix_batch_sources_inventory_supplier.sql`).
- Backfill: supplier_id → inventorySupplierId; container's supplier_id → inventorySupplierId for CONTAINER_DIRECT; null for BATCH sources.
- `buildBatchConsumptionEvents` now uses `inventorySupplierId` (not `supplierId`) to decide which supplier's timeline gets the consumption deduction. Includes both SUPPLIER_LOCKED_RATE and CONTAINER_DIRECT sources.
- `closureFinal.ts → buildSelectedSupplierBatchClosure` also updated to use `inventorySupplierId` for root batch detection.

## Key design rule
`inventorySupplierId` = **inventory ownership** (whose kg were consumed).
`supplierId` = **pricing basis** (whose locked rate determines the source cost).
These are SEPARATE concerns — never conflate them. `resolveMixSourcePricingBasis` is unchanged.

## Zero-inventory boundary clamp
After `BATCH_CONSUMPTION` or `REMOVE_ADJUSTMENT`, if `|remaining| ≤ 0.001 kg`, clamp to 0. This prevents tiny rounding residuals from creating phantom negative stock that dilutes the next receipt's rate. Real over-consumption (> 0.001 kg negative) is preserved and reported as `TIMELINE_QUANTITY_MISMATCH`.

## valuation_basis for ADD adjustments
Column `valuation_basis VARCHAR(30)` added to `factory_raw_material_adjustments`. Values:
- `QUANTITY_ONLY` — adds kg, rate unchanged
- `VALUED_TRANSFER` — blends kg + USD value into moving average
- `OPENING_BALANCE` — establishes opening stock when remaining=0; treated as VALUED_TRANSFER otherwise
- `null` with cost > 0 → `ADJUSTMENT_VALUATION_UNCLASSIFIED` → supplier blocked from apply

## Algorithm version bump
`REPLAY_ALGORITHM_VERSION = "HISTORICAL_COST_REPLAY_V7_INVENTORY_OWNERSHIP"` (was `v6-final-static-safety`). All v6 tokens are automatically invalidated by the version check in `exactApplyFinal.ts`.

## Financial impact preview (Phase 11)
`HistoricalReplayPreviewResult.financialImpact` now includes:
- `currentRawMaterialAsset` — from DB (sum of per-row remaining × cost_per_kg_usd + ADD adjustments)
- `projectedRawMaterialAsset` — current + sum(replayRemainingKg × endingExpectedRate − authRemainingKg × currentStoredRate)
- `currentNetPosition` / `projectedNetPosition` — null (filled by route layer from net position service)
- `supplierImpacts` — per-supplier breakdown

## V7 summary gates
Three new `ReplaySummary` fields gating apply:
- `unresolvedInventorySupplierSources` — non-BATCH sources with null inventorySupplierId
- `unclassifiedValuedAdjustments` — ADD adjustments with cost > 0 and no valuationBasis
- `incompleteMixedBatchSupplierScopes` — batches with participating suppliers not in replay scope

## normalizeReplayWriteScope fix
Added `[...new Set(batch.reasons)].sort()` — deduplicates blocked-batch reasons before sorting. Was only sorting before.

## Test pattern for SourceInfo in tests
All test `SourceInfo` objects must include `inventorySupplierId`. Convention:
- SUPPLIER_LOCKED_RATE: `inventorySupplierId: supplierId`
- CONTAINER_DIRECT without supplier: `inventorySupplierId: null`
- BATCH: `inventorySupplierId: null`

## INSERT paths updated
All 6 source INSERT sites now set `inventorySupplierId`:
- `factoryMixBatchRoutes.ts` (3x): `(sr.sourceBatchId != null) ? null : (sr.supplierId ?? null)`  
  Note: `sr.supplierId` is already the container's supplier for container-linked sources (populated from `ctnSupplierId2` upstream in the route).
- `rawStockOffloadRoutes.ts` (2x): `container.supplierId || null` / `lockedContainer.supplierId || null`
- `rawStockBalanceRoutesLegacy.ts` (1x): `containerSupplierId ?? null`

## Migration applied
`20260721_001_factory_mix_batch_sources_inventory_supplier.sql` applied to local DB. Backfill updated 1768 rows from supplier_id and 0 rows from container supplier (all CONTAINER_DIRECT rows already had null container.supplier_id in local DB — prod may differ).
