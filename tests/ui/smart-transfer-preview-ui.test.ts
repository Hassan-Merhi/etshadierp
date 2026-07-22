import { describe, expect, it } from "vitest";
import { mergeSmartPreviewLines, validateSmartPreviewLines } from "@/components/stock-transfer/smartTransferPreviewUi";

const base = {
  stockItemId: 10,
  stockItemName: "CB1",
  stockItemCode: "CB1",
  uom: "BALE",
  sourceLocationId: 1,
  sourceLocationName: "Hadi 1",
  suggestedQuantity: 10,
  availableAtSource: 50,
  sourceAverageRate: 25,
};

describe("smart transfer preview UI helpers", () => {
  it("merges duplicate item/source lines before importing into the order editor", () => {
    const result = mergeSmartPreviewLines([
      base,
      { ...base, suggestedQuantity: 7 },
      { ...base, sourceLocationId: 2, sourceLocationName: "Hadi 2", suggestedQuantity: 5 },
    ]);

    expect(result).toHaveLength(2);
    expect(result.find((line) => line.sourceLocationId === 1)?.quantity).toBe(17);
    expect(result.find((line) => line.sourceLocationId === 2)?.quantity).toBe(5);
  });

  it("rejects combined duplicate quantities above the source availability", () => {
    const errors = validateSmartPreviewLines([
      { ...base, suggestedQuantity: 30, availableAtSource: 50 },
      { ...base, suggestedQuantity: 25, availableAtSource: 50 },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("requested 55");
    expect(errors[0]).toContain("only 50 is available");
  });

  it("requires positive whole quantities", () => {
    const errors = validateSmartPreviewLines([
      { ...base, suggestedQuantity: 1.5 },
      { ...base, sourceLocationId: 2, sourceLocationName: "Hadi 2", suggestedQuantity: 0 },
    ]);

    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error.includes("positive whole number"))).toBe(true);
  });
});
