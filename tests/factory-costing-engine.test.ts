import { describe, expect, it } from "vitest";
import {
  FactoryCostingError,
  calculateCostLine,
  calculateMovingAverageRate,
  calculateProportionalInventoryValueDelta,
  calculateRateAfterInventoryValueDelta,
  calculateRemainingInventoryCorrection,
  calculateWeightedAverageCost,
  factoryRatesEqual,
  formatFactoryLockedRate,
  formatFactoryQuantity,
  formatFactoryRate,
  formatFactoryTotal,
} from "../server/services/factory/factoryCostingEngine";

describe("factory costing engine", () => {
  it("uses authoritative remaining quantity for a new-receipt moving average", () => {
    const rate = calculateMovingAverageRate({
      existingQuantityKg: "7000",
      existingRatePerKg: "0.28",
      incomingQuantityKg: "10000",
      incomingRatePerKg: "0.40",
    });

    expect(rate.toNumber()).toBeCloseTo((7000 * 0.28 + 10000 * 0.4) / 17000, 12);
  });

  it("does not move a rate when quantity is consumed without a value event", () => {
    const before = calculateRateAfterInventoryValueDelta({
      inventoryQuantityKg: "8000",
      currentRatePerKg: "0.625",
      valueDelta: "0",
      fallbackRatePerKg: "9",
    });

    expect(before.toFixed()).toBe("0.625");
  });

  it("applies a landed-cost correction only to remaining container value", () => {
    const correction = calculateRemainingInventoryCorrection({
      supplierRemainingKg: "10000",
      currentLockedRatePerKg: "0.50",
      correctedContainerRemainingKg: "2000",
      oldCorrectedContainerRemainingValue: "800",
      newContainerRatePerKg: "0.60",
    });

    expect(correction.valueDelta.toFixed()).toBe("400");
    expect(correction.newLockedRatePerKg.toFixed()).toBe("0.54");
  });

  it("uses the corrected explicit rate when the supplier has no remaining stock", () => {
    const correction = calculateRemainingInventoryCorrection({
      supplierRemainingKg: "0",
      currentLockedRatePerKg: "0.42",
      correctedContainerRemainingKg: "0",
      oldCorrectedContainerRemainingValue: "0",
      newContainerRatePerKg: "0.71",
    });

    expect(correction.newLockedRatePerKg.toFixed()).toBe("0.71");
  });

  it("uses persisted source totalCost as the batch valuation authority", () => {
    const result = calculateWeightedAverageCost([
      { quantityKg: "100", unitCostPerKg: "2", totalCost: "200" },
      { quantityKg: "50", unitCostPerKg: "4", totalCost: "210" },
    ]);

    expect(result.totalQuantityKg.toFixed()).toBe("150");
    expect(result.totalCost.toFixed()).toBe("410");
    expect(result.weightedUnitCostPerKg.toNumber()).toBeCloseTo(410 / 150, 12);
    expect(result.sourceMismatchCount).toBe(1);
  });

  it("falls back to quantity times unit cost for legacy sources without totalCost", () => {
    const result = calculateWeightedAverageCost([
      { quantityKg: "100", unitCostPerKg: "0.25" },
      { quantityKg: "300", unitCostPerKg: "0.50" },
    ]);

    expect(result.totalCost.toFixed()).toBe("175");
    expect(result.weightedUnitCostPerKg.toFixed()).toBe("0.4375");
  });

  it("calculates the still-in-inventory share of a late charge", () => {
    const delta = calculateProportionalInventoryValueDelta({
      oldFullValue: "10000",
      newFullValue: "11200",
      remainingKg: "2500",
      valuationKg: "10000",
    });

    expect(delta.toFixed()).toBe("300");
  });

  it("uses one shared precision policy", () => {
    expect(formatFactoryQuantity("1.23456")).toBe("1.235");
    expect(formatFactoryRate("0.12345678")).toBe("0.123457");
    expect(formatFactoryLockedRate("0.123456789")).toBe("0.12345679");
    expect(formatFactoryTotal("12.3456789")).toBe("12.345679");
    expect(factoryRatesEqual("0.1234564", "0.12345649")).toBe(true);
  });

  it("rejects negative quantities and costs", () => {
    expect(() => calculateCostLine("-1", "2")).toThrow(FactoryCostingError);
    expect(() => calculateWeightedAverageCost([{ quantityKg: "1", totalCost: "-2" }])).toThrow(
      FactoryCostingError,
    );
  });
});
