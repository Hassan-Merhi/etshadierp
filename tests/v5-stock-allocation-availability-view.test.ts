import { describe, expect, it } from "vitest";
import { projectV5AllocationAvailabilityPayload } from "../server/routes/factory/stock-allocation-v5/availability-view";

describe("V5 stock allocation compact availability view", () => {
  it("preserves only articleCode and freeToPromise for Customer Loading", () => {
    const payload = {
      rows: [
        {
          articleCode: "HMD-1",
          productName: "Sample Bale",
          categoryName: "Bales",
          stockAvailable: 40,
          totalLoaded: 8,
          expectedToLoad: 20,
          freeToPromise: 12,
          totalKg: 1800,
          isGarbageOrWipers: false,
          proformaDetails: [
            {
              proformaId: 11,
              proformaName: "Large customer proforma",
              customerId: 9,
              customerName: "Customer Name",
              lineQty: 20,
              containerCount: 3,
              totalExpected: 60,
              containers: Array.from({ length: 20 }, (_, index) => ({
                orderId: index + 1,
                containerName: `Container ${index + 1}`,
                status: "LOADING",
                expectedQty: 20,
                loadedQty: 8,
                remainingQty: 12,
              })),
            },
          ],
        },
        {
          articleCode: "HMD-2",
          productName: "Zero Bale",
          stockAvailable: 0,
          totalLoaded: 0,
          expectedToLoad: 0,
          freeToPromise: 0,
          totalKg: 0,
          proformaDetails: [],
        },
        {
          articleCode: "HMD-3",
          productName: "Short Bale",
          stockAvailable: 2,
          totalLoaded: 1,
          expectedToLoad: 5,
          freeToPromise: -4,
          totalKg: 90,
          proformaDetails: [],
        },
      ],
      totals: {
        stockAvailable: 42,
        totalLoaded: 9,
        expectedToLoad: 25,
        freeToPromise: 8,
        totalKg: 1890,
        shortageCount: 1,
      },
      productNames: {
        "HMD-1": "Sample Bale",
        "HMD-2": "Zero Bale",
        "HMD-3": "Short Bale",
      },
    };

    const projected = projectV5AllocationAvailabilityPayload(payload);

    expect(projected).toEqual({
      rows: [
        { articleCode: "HMD-1", freeToPromise: 12 },
        { articleCode: "HMD-2", freeToPromise: 0 },
        { articleCode: "HMD-3", freeToPromise: -4 },
      ],
    });

    const fullBytes = Buffer.byteLength(JSON.stringify(payload));
    const compactBytes = Buffer.byteLength(JSON.stringify(projected));
    expect(compactBytes).toBeLessThan(fullBytes * 0.15);
  });

  it("leaves non-allocation error payloads unchanged", () => {
    const error = { message: "No company selected" };
    expect(projectV5AllocationAvailabilityPayload(error)).toBe(error);
  });
});
