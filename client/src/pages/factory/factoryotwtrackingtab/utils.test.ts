import { describe, expect, it, vi } from "vitest";
import type { ContainerWithSupplier } from "./types";
import { STATUS_ACTIVE, calcDelayDays, ccySym, containerCost, fmtAmt, fmtDate, isOverdue, num } from "./utils";

// These helpers read only the handful of fields set per case, so each fixture
// is a partial container widened once here rather than at every call site.
const container = (fields: Partial<ContainerWithSupplier>) => fields as ContainerWithSupplier;

describe("factory OTW tracking helpers", () => {
  it("normalizes currency symbols and numeric values", () => {
    expect(ccySym(undefined)).toBe("$");
    expect(ccySym("EUR")).toBe("€");
    expect(ccySym("ZAR")).toBe("ZAR");
    expect(num("12.5")).toBe(12.5);
    expect(num(undefined)).toBe(0);
    expect(num("not-a-number")).toBe(0);
    expect(fmtAmt("$", 0)).toBe("—");
    expect(fmtAmt("$", 12.5)).toContain("12.50");
  });

  it("formats plain ISO dates without timezone drift", () => {
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("2026-10-05")).toBe("05 Oct 26");
    expect(fmtDate("bad-date")).toBe("—");
  });

  it("uses final payable amount when present and otherwise rate times weight", () => {
    expect(
      containerCost(container({ currencyCode: "EUR", finalPayableAmount: "125", ratePerKg: "2", totalKg: "50" }))
    ).toEqual({ symbol: "€", amount: 125 });
    expect(
      containerCost(container({ currencyCode: "USD", finalPayableAmount: "0", ratePerKg: "2.5", totalKg: "40" }))
    ).toEqual({ symbol: "$", amount: 100 });
  });

  it("calculates delay only for past valid ETAs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 12));
    expect(calcDelayDays(container({ arrivalDate: "2026-08-18" }))).toBe(2);
    expect(isOverdue(container({ arrivalDate: "2026-08-18" }))).toBe(true);
    expect(calcDelayDays(container({ arrivalDate: "2026-08-21" }))).toBe(0);
    expect(calcDelayDays(container({ arrivalDate: null }))).toBe(0);
    expect(calcDelayDays(container({ arrivalDate: "invalid" }))).toBe(0);
    vi.useRealTimers();
  });

  it("keeps only the live OTW statuses in the active set", () => {
    expect(STATUS_ACTIVE.has("PENDING")).toBe(true);
    expect(STATUS_ACTIVE.has("IN_TRANSIT")).toBe(true);
    expect(STATUS_ACTIVE.has("ARRIVED")).toBe(true);
    expect(STATUS_ACTIVE.has("OFFLOADED")).toBe(false);
  });
});
