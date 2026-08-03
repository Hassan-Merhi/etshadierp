import { describe, expect, it } from "vitest";
import {
  deriveEstimatedDeliveryDate,
  deriveLastLocation,
  deriveLastStatus,
  type ParcelsAppShipment,
} from "../server/lib/parcelsAppClient";

function shipment(overrides: Partial<ParcelsAppShipment> = {}): ParcelsAppShipment {
  return {
    trackingId: "TCNU2271060",
    done: true,
    ...overrides,
  };
}

describe("ParcelsApp shipment parsing", () => {
  it("ignores malformed attribute rows instead of throwing", () => {
    const data = shipment({
      attributes: [
        {} as any,
        { l: undefined, val: "invalid" } as any,
        { l: null, val: "invalid" } as any,
        { l: "status", val: "IN TRANSIT" },
        { l: "location", val: "Dar es Salaam" },
      ],
    });

    expect(() => deriveLastStatus(data)).not.toThrow();
    expect(deriveLastStatus(data)).toBe("IN TRANSIT");
    expect(deriveLastLocation(data)).toBe("Dar es Salaam");
  });

  it("falls back to the latest state when no valid attribute is present", () => {
    const data = shipment({
      attributes: [{ val: "missing label" } as any],
      states: [
        {
          date: "2026-08-03T10:00:00.000Z",
          status: "CONTAINER DEPARTURE",
          location: "Shanghai",
          description: "Loaded on vessel",
        },
      ],
    });

    expect(deriveLastStatus(data)).toBe("CONTAINER DEPARTURE");
    expect(deriveLastLocation(data)).toBe("Shanghai");
  });

  it("matches plain-object attribute keys case-insensitively", () => {
    const data = shipment({
      attributes: {
        Status: "ARRIVED",
        Location: "Lubumbashi",
      },
    });

    expect(deriveLastStatus(data)).toBe("ARRIVED");
    expect(deriveLastLocation(data)).toBe("Lubumbashi");
  });

  it("skips malformed ETA attributes and uses the next valid value", () => {
    const data = shipment({
      attributes: [
        { l: undefined, val: "2026-08-10" } as any,
        { l: "estimatedArrival", val: "2026-08-20T14:00:00.000Z" },
      ],
    });

    expect(deriveEstimatedDeliveryDate(data)).toBe("2026-08-20");
  });
});
