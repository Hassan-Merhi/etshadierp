import { describe, expect, it } from "vitest";
import {
  GOLDEN_COAST_PHASE4_CUTOVER_DATE,
  GoldenCoastPhase4Error,
  assertGoldenCoastPostCutoverMutationDates,
  reconcileGoldenCoastOpeningInventory,
  summarizeGoldenCoastOpeningInventory,
} from "./goldenCoastPhase4Cutover";

describe("Golden Coast Phase 4 cutover hardening", () => {
  it("summarizes opening FIFO inventory by quantity and weighted value", () => {
    expect(
      summarizeGoldenCoastOpeningInventory([
        { stockItemId: 1, locationId: 10, articleCode: "A", quantity: "4", averageRate: "12.50" },
        { stockItemId: 2, locationId: 11, articleCode: "B", quantity: "2", averageRate: "25" },
      ])
    ).toEqual({ rowCount: 2, totalQuantity: "6.0000", totalValueUsd: "100.00" });
  });

  it("reconciles the opening FIFO bridge to Phase 3 Stock in Hand", () => {
    const result = reconcileGoldenCoastOpeningInventory({
      stockInHandOpeningUsd: "100.00",
      rows: [
        { stockItemId: 1, locationId: 10, articleCode: "A", quantity: "4", averageRate: "12.50" },
        { stockItemId: 2, locationId: 11, articleCode: "B", quantity: "2", averageRate: "25" },
      ],
    });
    expect(result.reconciled).toBe(true);
    expect(result.differenceUsd).toBe("0.00");
  });

  it("fails reconciliation when inventory would not tie to the Phase 3 opening journal", () => {
    const result = reconcileGoldenCoastOpeningInventory({
      stockInHandOpeningUsd: "99.00",
      rows: [{ stockItemId: 1, locationId: 10, articleCode: "A", quantity: "4", averageRate: "25" }],
    });
    expect(result.reconciled).toBe(false);
    expect(result.differenceUsd).toBe("1.00");
  });

  it("rejects invalid lot identity and negative cost", () => {
    expect(() =>
      summarizeGoldenCoastOpeningInventory([
        { stockItemId: 0, locationId: 10, articleCode: "A", quantity: "1", averageRate: "1" },
      ])
    ).toThrow(GoldenCoastPhase4Error);
    expect(() =>
      summarizeGoldenCoastOpeningInventory([
        { stockItemId: 1, locationId: 10, articleCode: "A", quantity: "1", averageRate: "-1" },
      ])
    ).toThrow(GoldenCoastPhase4Error);
  });

  it("blocks explicitly dated pre-cutover writes but permits cutover and later dates", () => {
    expect(() => assertGoldenCoastPostCutoverMutationDates({ saleDate: "2026-08-31" })).toThrow(
      `Pre-cutover Golden Coast records are read-only; saleDate cannot be before ${GOLDEN_COAST_PHASE4_CUTOVER_DATE}`
    );
    expect(() => assertGoldenCoastPostCutoverMutationDates({ saleDate: "2026-09-01" })).not.toThrow();
    expect(() => assertGoldenCoastPostCutoverMutationDates({ offloadDate: "2026-09-02" })).not.toThrow();
  });
});
