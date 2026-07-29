import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Phase 5 factory costing consolidation contracts", () => {
  it("routes supplier locked-rate changes and legacy fallback through the central engine", () => {
    const lockedRate = source("server/services/factory/rawStockLockedRate.ts");
    const stableFallback = source("server/services/factory/rawStockStableCost.ts");

    expect(lockedRate).toContain('from "./factoryCostingEngine"');
    expect(lockedRate).toContain("calculateMovingAverageRate");
    expect(lockedRate).toContain("formatFactoryLockedRate");
    expect(lockedRate).toContain("calculateCostLine");
    expect(lockedRate).not.toContain("oldRemaining.times(oldLockedRate)");
    expect(stableFallback).toContain("calculateWeightedAverageCost");
    expect(stableFallback).not.toContain("weightedCostSumD");
  });

  it("routes correction, batch, and bale valuation through the same primitives", () => {
    const cascade = source("server/services/factory/rawStockCostCascade.ts");

    expect(cascade).toContain("calculateRemainingInventoryCorrection");
    expect(cascade).toContain("calculateRateAfterInventoryValueDelta");
    expect(cascade).toContain("calculateWeightedAverageCost");
    expect(cascade).toContain("calculateCostLine");
    expect(cascade).toContain('basis !== "CONTAINER_DIRECT"');
    expect(cascade).not.toContain("dTotalCost = dTotalCost.plus");
  });

  it("uses central precision for landed-cost and mix-batch services", () => {
    const landedCost = source("server/services/factory/containerLandedCost.ts");
    const mixBatch = source("server/services/factory/mixBatchCostingIntegrityService.ts");

    expect(landedCost).toContain("FACTORY_COST_PRECISION");
    expect(landedCost).toContain("calculateCostLine");
    expect(mixBatch).toContain("calculateWeightedAverageCost");
    expect(mixBatch).toContain("calculateCostLine");
  });

  it("exposes a read-only Admin/Developer costing-integrity report", () => {
    const routes = source("server/routes/factory/raw-stock/rawStockDiagnosticRoutes.ts");
    const service = source("server/services/factory/factoryCostingConsistencyService.ts");

    expect(routes).toContain('"/api/factory/raw-stock/diagnostics/costing-integrity"');
    expect(routes).toContain('requireRole("Admin", "Developer")');
    expect(routes).toContain("getFactoryCostingConsistencyReport");
    expect(service).toContain("sourceValueMismatchCount");
    expect(service).toContain("batchHeaderMismatchCount");
    expect(service).toContain("baleMismatchCount");
    expect(service).not.toContain(".update(");
    expect(service).not.toContain(".insert(");
    expect(service).not.toContain(".delete(");
  });

  it("keeps the central costing engine pure and independent of database schemas", () => {
    const engine = source("server/services/factory/factoryCostingEngine.ts");

    expect(engine).toContain("calculateMovingAverageRate");
    expect(engine).toContain("calculateRemainingInventoryCorrection");
    expect(engine).toContain("calculateWeightedAverageCost");
    expect(engine).not.toContain("@shared/schema");
    expect(engine).not.toContain("../../db");
  });
});
