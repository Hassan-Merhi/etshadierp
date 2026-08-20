import { describe, expect, it, vi } from "vitest";
import {
  STATUS_ACTIVE,
  calcDelayDays,
  ccySym,
  containerCost,
  fmtAmt,
  fmtDate,
  isOverdue,
  num,
} from "./utils";

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
    expect(containerCost({ currencyCode: "EUR", finalPayableAmount: "125", ratePerKg: "2", totalKg: "50" } as any))
      .toEqual({ symbol: "€", amount: 125 });
    expect(containerCost({ currencyCode: "USD", finalPayableAmount: "0", ratePerKg: "2.5", totalKg: "40" } as any))
      .toEqual({ symbol: "$", amount: 100 });
  });

  it("calculates delay only for past valid ETAs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 12));
    expect(calcDelayDays({ arrivalDate: "2026-08-18" } as any)).toBe(2);
    expect(isOverdue({ arrivalDate: "2026-08-18" } as any)).toBe(true);
    expect(calcDelayDays({ arrivalDate: "2026-08-21" } as any)).toBe(0);
    expect(calcDelayDays({ arrivalDate: null } as any)).toBe(0);
    expect(calcDelayDays({ arrivalDate: "invalid" } as any)).toBe(0);
    vi.useRealTimers();
  });

  it("keeps only the live OTW statuses in the active set", () => {
    expect(STATUS_ACTIVE.has("PENDING")).toBe(true);
    expect(STATUS_ACTIVE.has("IN_TRANSIT")).toBe(true);
    expect(STATUS_ACTIVE.has("ARRIVED")).toBe(true);
    expect(STATUS_ACTIVE.has("OFFLOADED")).toBe(false);
  });
});
