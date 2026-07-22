import { describe, expect, it } from "vitest";
import { allocateWholeUnitsByWeight } from "../server/services/smartTransferAllocation";

describe("allocateWholeUnitsByWeight", () => {
  it("hits the requested whole-unit target without exceeding capacities", () => {
    const result = allocateWholeUnitsByWeight(
      [
        { id: "A", capacity: 30, weight: 5, priority: 0 },
        { id: "B", capacity: 20, weight: 3, priority: 1 },
        { id: "C", capacity: 10, weight: 1, priority: 2 },
      ],
      41
    );

    const total = Array.from(result.values()).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(41);
    expect(result.get("A")).toBeLessThanOrEqual(30);
    expect(result.get("B")).toBeLessThanOrEqual(20);
    expect(result.get("C")).toBeLessThanOrEqual(10);
  });

  it("returns a short allocation when total capacity is below the target", () => {
    const result = allocateWholeUnitsByWeight(
      [
        { id: "Hadi 1", capacity: 7, weight: 7 },
        { id: "Hadi 2", capacity: 5, weight: 5 },
        { id: "Hadi 3", capacity: 3, weight: 3 },
        { id: "Hadi 4", capacity: 2, weight: 2 },
      ],
      100
    );

    expect(Array.from(result.values()).reduce((sum, value) => sum + value, 0)).toBe(17);
    expect(result.get("Hadi 1")).toBe(7);
    expect(result.get("Hadi 2")).toBe(5);
    expect(result.get("Hadi 3")).toBe(3);
    expect(result.get("Hadi 4")).toBe(2);
  });

  it("can split an item across four source locations", () => {
    const result = allocateWholeUnitsByWeight(
      [
        { id: "1", capacity: 40, weight: 40 },
        { id: "2", capacity: 30, weight: 30 },
        { id: "3", capacity: 20, weight: 20 },
        { id: "4", capacity: 10, weight: 10 },
      ],
      50
    );

    expect(Array.from(result.values()).reduce((sum, value) => sum + value, 0)).toBe(50);
    expect(Array.from(result.values()).filter((value) => value > 0)).toHaveLength(4);
    expect(result.get("1")).toBeGreaterThan(result.get("4") ?? 0);
  });

  it("ignores invalid or fractional capacity beyond whole units", () => {
    const result = allocateWholeUnitsByWeight(
      [
        { id: "A", capacity: 3.9, weight: 1 },
        { id: "B", capacity: -5, weight: 10 },
        { id: "C", capacity: Number.NaN, weight: 10 },
      ],
      10
    );

    expect(result.get("A")).toBe(3);
    expect(result.has("B")).toBe(false);
    expect(result.has("C")).toBe(false);
  });
});
