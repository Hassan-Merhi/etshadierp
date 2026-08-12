import { describe, expect, it } from "vitest";

import { buildPaymentAllocations } from "../client/src/pages/properties/property-rental/utils";
import { clampRentalPeriodToContractStart } from "../server/services/rental/rentalPeriodService";

describe("rental payment contract-start allocation", () => {
  it("starts a prepaid multi-month payment at the contract start month", () => {
    const allocations = buildPaymentAllocations(1800, 600, "2026-08-12", undefined, "2026-09-01");

    expect(allocations).toEqual([
      { year: 2026, month: 9, chunk: 600 },
      { year: 2026, month: 10, chunk: 600 },
      { year: 2026, month: 11, chunk: 600 },
    ]);
  });

  it("never clamps a valid allocation later than the contract start month", () => {
    expect(clampRentalPeriodToContractStart(2026, 8, "2026-09-01")).toEqual({ year: 2026, month: 9 });
    expect(clampRentalPeriodToContractStart(2026, 9, "2026-09-20")).toEqual({ year: 2026, month: 9 });
    expect(clampRentalPeriodToContractStart(2027, 1, "2026-09-01")).toEqual({ year: 2027, month: 1 });
  });
});
