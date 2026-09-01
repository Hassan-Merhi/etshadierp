import { describe, expect, it } from "vitest";
import {
  addInventoryValues,
  divideInventoryValues,
  inventoryMoney,
  inventoryQuantity,
  inventoryUnitCost,
  multiplyInventoryValues,
  roundInventoryValue,
  subtractInventoryValues,
  toInventoryDecimal,
  weightedAverageInventoryCost,
} from "./inventoryMath";

describe("inventoryMath", () => {
  it("converts valid database and request values to Decimal", () => {
    expect(toInventoryDecimal("12.345").toString()).toBe("12.345");
    expect(toInventoryDecimal(8.5).toString()).toBe("8.5");
  });

  it("uses zero for null, empty, invalid, and non-finite values", () => {
    expect(toInventoryDecimal(null).toString()).toBe("0");
    expect(toInventoryDecimal("").toString()).toBe("0");
    expect(toInventoryDecimal("not-a-number").toString()).toBe("0");
    expect(toInventoryDecimal(Number.POSITIVE_INFINITY).toString()).toBe("0");
  });

  it("uses a valid caller fallback for invalid input", () => {
    expect(toInventoryDecimal("invalid", "7.25").toString()).toBe("7.25");
    expect(toInventoryDecimal("invalid", "also-invalid").toString()).toBe("0");
  });

  it("adds decimal values without binary floating-point drift", () => {
    expect(addInventoryValues("0.1", "0.2", "0.3").toString()).toBe("0.6");
  });

  it("subtracts decimal values exactly", () => {
    expect(subtractInventoryValues("10.10", "0.20").toString()).toBe("9.9");
  });

  it("multiplies quantities and rates exactly", () => {
    expect(multiplyInventoryValues("19.5", "12.7258").toString()).toBe("248.1531");
    expect(multiplyInventoryValues().toString()).toBe("0");
  });

  it("divides safely and applies a fallback for zero divisors", () => {
    expect(divideInventoryValues("10", "4").toString()).toBe("2.5");
    expect(divideInventoryValues("10", 0, "9.75").toString()).toBe("9.75");
  });

  it("calculates moving weighted-average cost exactly", () => {
    const result = weightedAverageInventoryCost("10", "2.10", "5", "3.30");
    expect(result.toString()).toBe("2.5");
  });

  it("preserves negative quantities for reversal calculations", () => {
    const result = weightedAverageInventoryCost("10", "4", "-2", "4");
    expect(result.toString()).toBe("4");
  });

  it("uses the supplied fallback when combined quantity is zero", () => {
    const result = weightedAverageInventoryCost("5", "2", "-5", "3", "2.75");
    expect(result.toString()).toBe("2.75");
  });

  it("rounds quantities, unit costs, and money with explicit precision", () => {
    expect(inventoryQuantity("1.2345")).toBe("1.235");
    expect(inventoryUnitCost("1.2345675")).toBe("1.234568");
    expect(inventoryMoney("343.5966")).toBe("343.60");
  });

  it("rejects invalid rounding precision", () => {
    expect(() => roundInventoryValue("1", -1)).toThrow(RangeError);
    expect(() => roundInventoryValue("1", 1.5)).toThrow(RangeError);
  });
});
