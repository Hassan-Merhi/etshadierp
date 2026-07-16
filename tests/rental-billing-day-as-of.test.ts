/**
 * Tests for rentalPeriodService billing-day and as-of date logic.
 */
import { describe, it, expect } from "vitest";
import {
  getRentalBillingDay,
  getRentalPeriodDueDate,
  isRentalPeriodDue,
  isPaymentEffective,
  getMonthRange,
  getDuePeriods,
} from "../server/services/rental/rentalPeriodService";

describe("getRentalBillingDay", () => {
  it("extracts the day-of-month from a string date", () => {
    expect(getRentalBillingDay("2026-07-20")).toBe(20);
    expect(getRentalBillingDay("2024-01-01")).toBe(1);
    expect(getRentalBillingDay("2025-03-31")).toBe(31);
  });

  it("handles a Date object", () => {
    expect(getRentalBillingDay(new Date("2026-07-15T00:00:00Z"))).toBe(15);
  });
});

describe("getRentalPeriodDueDate", () => {
  it("returns YYYY-MM-DD for a standard billing day", () => {
    expect(getRentalPeriodDueDate(2026, 7, 20)).toBe("2026-07-20");
    expect(getRentalPeriodDueDate(2026, 1, 1)).toBe("2026-01-01");
  });

  it("clamps billing day to month-end when month is shorter", () => {
    // February 2026 has 28 days
    expect(getRentalPeriodDueDate(2026, 2, 31)).toBe("2026-02-28");
    expect(getRentalPeriodDueDate(2026, 2, 30)).toBe("2026-02-28");
    expect(getRentalPeriodDueDate(2024, 2, 31)).toBe("2024-02-29"); // leap year
    // April has 30 days
    expect(getRentalPeriodDueDate(2026, 4, 31)).toBe("2026-04-30");
  });

  it("handles end-of-month billing days correctly", () => {
    expect(getRentalPeriodDueDate(2026, 7, 31)).toBe("2026-07-31");
    expect(getRentalPeriodDueDate(2026, 6, 31)).toBe("2026-06-30");
  });
});

describe("isRentalPeriodDue", () => {
  it("returns false for July billing-day 20 when today is July 16", () => {
    // This is the core case from the spec: billing day 20, today 2026-07-16
    expect(isRentalPeriodDue(2026, 7, 20, "2026-07-16")).toBe(false);
  });

  it("returns true for July billing-day 20 when today is July 20", () => {
    expect(isRentalPeriodDue(2026, 7, 20, "2026-07-20")).toBe(true);
  });

  it("returns true for July billing-day 20 when today is July 21", () => {
    expect(isRentalPeriodDue(2026, 7, 20, "2026-07-21")).toBe(true);
  });

  it("returns true for past months regardless of billing day", () => {
    expect(isRentalPeriodDue(2026, 6, 20, "2026-07-16")).toBe(true);
    expect(isRentalPeriodDue(2026, 1, 25, "2026-07-16")).toBe(true);
    expect(isRentalPeriodDue(2025, 12, 28, "2026-07-16")).toBe(true);
  });

  it("returns false for future months", () => {
    expect(isRentalPeriodDue(2026, 8, 1, "2026-07-16")).toBe(false);
    expect(isRentalPeriodDue(2027, 1, 1, "2026-07-16")).toBe(false);
  });

  it("handles billing day 1 correctly", () => {
    expect(isRentalPeriodDue(2026, 7, 1, "2026-07-01")).toBe(true);
    expect(isRentalPeriodDue(2026, 7, 1, "2026-06-30")).toBe(false);
  });
});

describe("isPaymentEffective", () => {
  it("returns false for a future payment date", () => {
    expect(isPaymentEffective("2026-07-20", "2026-07-16")).toBe(false);
  });

  it("returns true for a same-day payment", () => {
    expect(isPaymentEffective("2026-07-16", "2026-07-16")).toBe(true);
  });

  it("returns true for a past payment date", () => {
    expect(isPaymentEffective("2026-07-01", "2026-07-16")).toBe(true);
  });
});

describe("getMonthRange", () => {
  it("returns a range across a year boundary", () => {
    const range = getMonthRange(2025, 11, 2026, 2);
    expect(range).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });

  it("returns a single month when from === to", () => {
    const range = getMonthRange(2026, 7, 2026, 7);
    expect(range).toEqual([{ year: 2026, month: 7 }]);
  });
});

describe("getDuePeriods", () => {
  it("returns only periods whose billing date has arrived", () => {
    // Contract started 2026-01-20 (billingDay=20), as-of 2026-07-16
    // Jan–Jun are fully due (all 6 months). Jul-20 is NOT due (asOf=Jul-16).
    const periods = getDuePeriods("2026-01-20", 20, "2026-07-16");
    expect(periods.length).toBe(6);
    expect(periods[0]).toEqual({ year: 2026, month: 1, dueDate: "2026-01-20" });
    expect(periods[5]).toEqual({ year: 2026, month: 6, dueDate: "2026-06-20" });
  });

  it("includes the current month when billing day has arrived", () => {
    const periods = getDuePeriods("2026-01-20", 20, "2026-07-20");
    expect(periods.length).toBe(7);
    expect(periods[6]).toEqual({ year: 2026, month: 7, dueDate: "2026-07-20" });
  });

  it("handles billing day 1 (always due by 1st of month)", () => {
    const periods = getDuePeriods("2026-01-01", 1, "2026-07-16");
    expect(periods.length).toBe(7); // Jan through Jul
  });

  it("clamps to month-end for short months", () => {
    const periods = getDuePeriods("2026-01-31", 31, "2026-03-01");
    // Jan-31 is due, Feb (clamped to Feb-28) is due by Mar-01
    expect(periods.some((p) => p.month === 1 && p.dueDate === "2026-01-31")).toBe(true);
    expect(periods.some((p) => p.month === 2 && p.dueDate === "2026-02-28")).toBe(true);
  });
});
