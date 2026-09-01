---
name: Per-KG 6-decimal-place precision upgrade
description: Which factory columns were changed to scale 6, what was left alone, and the decimal.js production bundling fix.
---

## Schema columns changed to numeric(x,6) (July 2026)
- factory_containers.rate_per_kg: 7→6
- factory_containers.rate_per_kg_usd: 7→6
- factory_raw_material_adjustments.cost_per_kg: 4→6
- factory_mix_batches.cost_per_kg: 4→6
- factory_container_commissions.commission_rate: 4→6
- customer_proforma_lines.price_per_kg: 4→6
- customer_order_lines.price_per_kg: 4→6
- factory_settings.labor_cost_per_kg: 4→6 (precision stays 10)
- factory_settings.overhead_per_kg: 4→6 (precision stays 10)

## Columns intentionally NOT changed
- factory_raw_stock.cost_per_kg / cost_per_kg_usd: already scale 6
- factory_mix_batch_sources.cost_per_kg: already scale 7 — leave at 7
- factory_bales.cost_per_kg: already scale 7 — leave at 7
- All FX-rate columns: stay at scale 8 (spec requirement)
- Legacy tables (production_raw_stock, mix_batches, mix_batch_sources, production_bales): no active routes — not changed

## Idempotent DB migrations in server/index.ts
ALTER TABLE … ALTER COLUMN … TYPE numeric(x,6) USING ROUND(col::numeric, 6)
Safe to re-run: PostgreSQL accepts TYPE change to same type silently; ROUND is a no-op on already-6dp values.

## Code changes
- rawStockCostCascade.ts: toFixed(7) → toFixed(6) for batch/bale/source costPerKg + totalCost
- rawStockOffloadRoutes.ts:
  - Added import Decimal from "decimal.js"
  - Per-KG division via Decimal: dInclusiveCostPerKg, dCostPerKgUsd
  - DB writes use .toDecimalPlaces(6).toFixed(6) for per-KG fields
  - Mix-batch source INSERT now uses USD costPerKg (dCostPerKgUsd), NOT native-currency
  - Daybook description uses .toFixed(6) not .toFixed(4)
- rawStockRecalc.ts: Decimal-based totalCost for mix-batch source writes (was .toFixed(2))

## Mix-batch source USD rule
**Why:** The cascade reads source.totalCost to compute blended batch cost using USD for bale
valuation. Writing native-currency cost into sources skews multi-container batches blending
different base currencies.
**How to apply:** Any new code inserting factoryMixBatchSources must use USD cost/kg and USD
totalCost — NOT the native-currency inclusive cost/kg.

## Decimal.js production bundling fix (July 2026)
**Problem:** package-lock.json has 56 packages with resolved URLs pointing to
package-firewall.replit.local (internal Replit proxy). Render cannot access that URL, so
newly-added packages fail to install properly, causing "Cannot find package decimal.js/index.js"
crash on startup.
**Fix:** scripts/build-server.mjs — esbuild plugin that intercepts `import from 'decimal.js'`
and resolves it to the local decimal.mjs file, bundling it inline. package.json build script
now runs this instead of the inline esbuild CLI command.
**Why bundling works:** No runtime package resolution needed, immune to node_modules issues on Render.
**How to apply:** If any other NEW npm package hits the same Render crash, add it to the
onResolve filter in scripts/build-server.mjs. Long-term: regenerate package-lock.json with
public npm registry URLs to fix all 56 packages.
