import { describe, expect, it } from "vitest";
import {
  buildGoldenCoastExistingPositionCarryForwardPlan,
  type ExistingPositionCarryForwardAccounts,
} from "./goldenCoastExistingPositionCarryForward";

const accounts: ExistingPositionCarryForwardAccounts = {
  stockInHandAccountId: 10,
  stockOtwAccountId: 11,
  openingBalanceClearingAccountId: 12,
};

describe("Golden Coast existing-position carry-forward planner", () => {
  it("carries the existing stock position without touching partner capital", () => {
    const plan = buildGoldenCoastExistingPositionCarryForwardPlan({
      companyId: 10,
      accounts,
      inventory: [
        {
          inventoryId: 101,
          locationId: 201,
          locationName: "Hadi 1",
          stockItemId: 301,
          articleCode: "A-1",
          description: "Item A",
          quantity: "10",
          averageRate: "20",
        },
        {
          inventoryId: 102,
          locationId: 202,
          locationName: "Hadi 2",
          stockItemId: 302,
          articleCode: "B-1",
          description: "Item B",
          quantity: "5",
          averageRate: "30",
        },
      ],
      otwContainers: [
        { containerId: 401, containerNumber: "MRKU6172417", valueUsd: "45.75" },
        { containerId: 402, containerNumber: "MRSU9022769", valueUsd: "54.25" },
      ],
    });

    expect(plan.stockInHandUsd).toBe("350.00");
    expect(plan.stockOtwUsd).toBe("100.00");
    expect(plan.totalPositionUsd).toBe("450.00");
    expect(plan.inventoryRowCount).toBe(2);
    expect(plan.fifoMovementCount).toBe(2);
    expect(plan.locations).toEqual([
      { locationId: 201, locationName: "Hadi 1", quantity: "10.0000", valueUsd: "200.00", rowCount: 1 },
      { locationId: 202, locationName: "Hadi 2", quantity: "5.0000", valueUsd: "150.00", rowCount: 1 },
    ]);
    expect(plan.journalEntries).toEqual([
      expect.objectContaining({ ledgerAccountId: 10, debitAmount: "350.00", creditAmount: "0.00" }),
      expect.objectContaining({ ledgerAccountId: 11, debitAmount: "100.00", creditAmount: "0.00" }),
      expect.objectContaining({ ledgerAccountId: 12, debitAmount: "0.00", creditAmount: "450.00" }),
    ]);
  });

  it("skips zero-quantity rows while preserving their location summary", () => {
    const plan = buildGoldenCoastExistingPositionCarryForwardPlan({
      companyId: 10,
      accounts,
      inventory: [
        {
          inventoryId: 101,
          locationId: 201,
          locationName: "Depot",
          stockItemId: 301,
          articleCode: "A-1",
          quantity: "0",
          averageRate: "0",
        },
      ],
      otwContainers: [{ containerId: 401, containerNumber: "MRKU6172417", valueUsd: "1" }],
    });

    expect(plan.fifoMovementCount).toBe(0);
    expect(plan.locations).toEqual([
      { locationId: 201, locationName: "Depot", quantity: "0.0000", valueUsd: "0.00", rowCount: 1 },
    ]);
    expect(plan.totalPositionUsd).toBe("1.00");
  });

  it("rejects positive inventory with no valuation", () => {
    expect(() =>
      buildGoldenCoastExistingPositionCarryForwardPlan({
        companyId: 10,
        accounts,
        inventory: [
          {
            inventoryId: 101,
            locationId: 201,
            stockItemId: 301,
            articleCode: "A-1",
            quantity: "1",
            averageRate: "0",
          },
        ],
        otwContainers: [],
      })
    ).toThrow(/zero average rate/);
  });

  it("rejects duplicate stock item/location snapshots", () => {
    expect(() =>
      buildGoldenCoastExistingPositionCarryForwardPlan({
        companyId: 10,
        accounts,
        inventory: [
          {
            inventoryId: 101,
            locationId: 201,
            stockItemId: 301,
            articleCode: "A-1",
            quantity: "1",
            averageRate: "10",
          },
          {
            inventoryId: 102,
            locationId: 201,
            stockItemId: 301,
            articleCode: "A-1",
            quantity: "2",
            averageRate: "10",
          },
        ],
        otwContainers: [],
      })
    ).toThrow(/duplicate stock item\/location/);
  });
});
