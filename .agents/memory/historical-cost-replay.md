---
name: Historical Cost Replay Engine
description: Spec, design decisions, and gotchas for the historical raw-material cost replay system
---

## What it does
Replays every container receipt, raw-material adjustment, and mix-batch consumption event in
strict chronological order per supplier to compute the correct moving-average rate at each
moment, then diffs stored source/batch/bale costs against those historical rates.

## Files
- `server/services/factory/historicalCostReplay.ts` — main engine (previewHistoricalCostReplay, applyHistoricalCostReplay, captureReplaySnapshot, computeReplayFingerprint)
- `server/services/factory/mixSourcePricingBasis.ts` — resolveMixSourcePricingBasis / resolveSourceType
- Two new routes in `server/routes/factory/raw-stock/rawStockRecalcRoutes.ts`:
  - GET  /api/factory/raw-stock/recalc/historical-replay
  - POST /api/factory/raw-stock/recalc/historical-replay/apply  (dry-run + apply with signed token)
- New "Historical Replay" tab in `client/src/pages/factory/production-raw-stock/RawStockRecalculate.tsx`

## Pricing-basis resolver — CRITICAL RULE
`resolveMixSourcePricingBasis` takes priority over stored `sourceType`:
1. `sourceBatchId` → BATCH
2. `supplierId` → SUPPLIER_LOCKED_RATE  (even when containerId is also set — FIFO provenance only)
3. `containerId` → CONTAINER_DIRECT
4. none → MANUAL_REVIEW

Historical `sourceType` values are NOT trustworthy; many old rows have "CONTAINER" when supplierId is
also set. Always resolve from column values, not the sourceType string.

## Cascade guard (rawStockCostCascade.ts)
`cascadeContainerCostChange` now checks pricing basis before updating source cost.
Only CONTAINER_DIRECT sources are updated with the container's new rate.
SUPPLIER_LOCKED_RATE sources are skipped — the cascade records `supplierIdsRequiringReplay`.
This prevents the historic corruption where a container rate was written onto FIFO supplier sources.

## sourceType fix in factoryMixBatchRoutes.ts
All three source insertion sites (CREATE path ×2, EDIT path ×1) now use:
  supplierId + containerId → "SUPPLIER_FIFO"
  supplierId only → "SUPPLIER"
  containerId only → "CONTAINER_DIRECT"
  sourceBatchId → "BATCH"
Old rows with "CONTAINER" when supplierId is also present are still in the DB — handled by the resolver.

## Moving-average replay rules
- RECEIPT: newRate = (remaining × oldRate + receiptKg × canonicalRate) / (remaining + receiptKg)
- ADD with USD cost: same formula with adjustKg × costPerKgUsd
- ADD without USD cost (or non-USD): increase remaining only, rate unchanged
- REMOVE / DEDUCT: decrease remaining only, rate unchanged
- BATCH_CONSUMPTION: record expectedRateAtBatch = currentRate, then decrease remaining

## Safe-to-repair gate
A supplier timeline is safe only when:
- No events have missing effective dates
- replayRemainingKg matches getAuthoritativeSupplierRemainingKg within 0.001 kg

Ambiguous same-date ordering (receipt + consumption on same date) is noted but does NOT block
repair — receipts are sorted before consumptions on the same date.

## Apply pattern
- GET preview: pure read, no writes
- POST apply with `{ dryRun: true }`: issues HMAC signed token (15 min TTL) via signRepairToken
- POST apply with `{ dryRun: false, confirmationToken }`: verifies token + fingerprint,
  acquires advisory lock (namespace 9003), writes inside a transaction,
  saves undo snapshot to factory_recalc_undo_log, logs audit.

**Why:** Prevents accidental double-apply; fingerprint confirms DB state hasn't changed between preview and apply.
