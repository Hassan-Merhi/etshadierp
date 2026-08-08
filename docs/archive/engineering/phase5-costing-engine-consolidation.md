# Phase 5 — Costing Engine Consolidation

Phase 5 establishes one factory costing policy for container landed cost, supplier raw-material rates, mix-batch sources, batch headers, and bale valuation. It consolidates arithmetic and precision without changing the finalized business rules for ownership, quantities, accounting, or historical production.

## One precision policy

`server/services/factory/factoryCostingEngine.ts` is the pure arithmetic boundary for factory costing. It defines one precision policy:

- quantity: 3 decimal places;
- normal cost/rate: 6 decimal places;
- persisted supplier locked rate: 8 decimal places;
- persisted total value: 6 decimal places.

The engine validates finite, non-negative quantities and values, calculates quantity × rate lines, aggregates weighted source cost, applies moving averages and inventory-value deltas, and formats persisted values consistently. It has no database or schema dependency.

## Event-driven locked supplier rate

A supplier’s `currentRawMaterialCostPerKgUsd` remains an event-driven locked supplier rate. It is not recomputed because stock was consumed, reserved, edited in a mix batch, or allocated through FIFO.

A real receipt changes the rate through the centralized moving-average function. The pre-receipt basis is the supplier’s authoritative remaining kg, including valid quantity adjustments. Already-consumed historical stock never re-enters the moving average.

A legacy null rate may still be derived once from stable receipt history and persisted. All subsequent normal reads use the persisted value.

## Container landed cost

`computeContainerLandedCost` remains the authoritative calculation for material, freight, duty, commission, other charges, and additional charges in native currency and USD. Its arithmetic now uses the shared validation and precision primitives.

Fixed landed value continues to be allocated across the original agreed quantity (`totalKg || declaredKg || actualReceivedKg`). A partial first receipt and later receipts therefore retain the same landed cost/kg instead of changing the denominator after each delivery.

Unconfirmed cross-currency freight, commission, or charges remain unresolved rather than silently defaulting to an incorrect FX rate.

## Remaining inventory only

A landed-cost correction changes the supplier locked rate only by the value that still belongs to inventory. The central engine calculates the corrected remaining-container value, derives the exact value delta, and spreads that delta across the supplier’s authoritative remaining kg.

Late post-offload freight, commission, duty, and charge adjustments follow the same rule: consumed production is not placed back into the supplier’s current inventory average. When the supplier has no remaining stock, the explicit corrected container rate is the fallback display rate.

## Source pricing basis

Supplier-backed mix-batch sources always use the supplier locked rate captured at the consumption event. A `containerId` on a supplier-backed FIFO source is provenance and quantity attribution only; it is not the cost basis.

Container-direct sources may follow an approved container landed-cost correction because those rows are explicitly priced from that individual container. Batch-sourced rows retain their upstream batch basis. Ambiguous historical sources remain subject to manual review or historical replay.

## Persisted source total authority

A mix-batch header is derived from the persisted source total values. `factory_mix_batch_sources.total_cost` is authoritative when present; quantity × source rate is a compatibility fallback for legacy rows and is also checked for mismatch.

Mix-batch creation and supplier deduction use the same weighted aggregation primitive as correction cascades. Client-provided supplier cost fields cannot override the locked server rate. Quantity and total value are deducted proportionally, preserving supplier cost/kg through consumption.

## Batch and bale cascade

Open batch headers and associated bale costs are recomputed from all current source values using Decimal arithmetic and the shared precision policy.

Container corrections update only container-direct source values. Supplier-backed source history is not overwritten with an individual container rate.

Closed and completed batches preserve bale history unless an explicit approved operation includes completed production. Their batch headers still reconcile to their own persisted source values so the header does not drift from its source detail.

## Read-only costing-integrity diagnostic

Administrators and Developers can inspect the full persisted valuation chain through:

`GET /api/factory/raw-stock/diagnostics/costing-integrity`

The read-only costing-integrity diagnostic reports:

- source total mismatches against quantity × source rate;
- batch-header mismatches against aggregated source values;
- bale rate or total mismatches against the batch rate;
- calculation errors that require manual review.

The diagnostic performs no insert, update, delete, repair, or lazy backfill.

## Compatibility retained

- Existing offload, continuation-receipt, mix-batch, post-offload-charge, recalculation, and historical-replay APIs remain in place.
- Existing supplier ownership and FIFO quantity behavior remain unchanged.
- Existing USD and native-currency landed-cost outputs remain available.
- Existing completed-batch safeguards remain in place.
- No production database migration is introduced by this phase.
- Existing compatibility exports such as `COST_SCALE`, `applyOffloadMovingAverage`, `cascadeContainerCostChange`, and `recomputeBatchAndCascadeBales` remain available.

## Verification boundary

The branch contains pure engine tests, source-level consolidation contracts, and a static verifier covering the central engine, supplier rates, landed cost, correction cascades, mix-batch costing, diagnostics, and policy documentation.

Per the owner’s instruction, CI checks were not run. The added tests and verifier were not executed, and no formatting, lint, TypeScript, build, database, browser, migration, or deployment result is claimed.

## Merge boundary

Phase 5 remains on its own draft branch and must not be merged automatically. It should remain unmerged until the owner decides how to handle the earlier draft phases and explicitly authorizes a merge. No CI gate is being requested or represented as completed.
