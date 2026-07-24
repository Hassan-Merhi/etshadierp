/**
 * Unit tests for server/lib/dateUtils.ts — the business-date helpers. The key
 * contract: getCompanyBusinessDate resolves "today" in the COMPANY's configured
 * timezone (the company-wide source of truth for date-scoped data), independent
 * of any user's clock; getClientDate reads the browser's X-Client-Date header.
 *
 * A fixed system time makes the timezone boundaries deterministic.
 */
import type { Request } from "express";
import { getClientDate, getCompanyBusinessDate } from "../server/lib/dateUtils";

// 02:00 UTC — before midnight in the Americas, already mid-morning in Asia.
const FIXED = new Date("2026-01-15T02:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCompanyBusinessDate", () => {
  it("returns UTC today when no timezone is configured", () => {
    expect(getCompanyBusinessDate(null)).toBe("2026-01-15");
    expect(getCompanyBusinessDate(undefined)).toBe("2026-01-15");
    expect(getCompanyBusinessDate("")).toBe("2026-01-15");
  });

  it("rolls back a day for a western timezone that is still on the 14th", () => {
    // 02:00 UTC = 21:00 (Jan 14) in New York (UTC-5).
    expect(getCompanyBusinessDate("America/New_York")).toBe("2026-01-14");
  });

  it("stays on the 15th for an eastern timezone", () => {
    // 02:00 UTC = 11:00 (Jan 15) in Tokyo (UTC+9).
    expect(getCompanyBusinessDate("Asia/Tokyo")).toBe("2026-01-15");
  });

  it("falls back to UTC today for an invalid timezone string", () => {
    expect(getCompanyBusinessDate("Not/ARealZone")).toBe("2026-01-15");
  });
});

describe("getClientDate", () => {
  function reqWith(header?: string): Request {
    return { headers: header === undefined ? {} : { "x-client-date": header } } as unknown as Request;
  }

  it("returns a well-formed X-Client-Date header verbatim", () => {
    expect(getClientDate(reqWith("2026-02-02"))).toBe("2026-02-02");
  });

  it("falls back to UTC today when the header is missing", () => {
    expect(getClientDate(reqWith())).toBe("2026-01-15");
  });

  it("falls back to UTC today when the header is malformed", () => {
    expect(getClientDate(reqWith("02/02/2026"))).toBe("2026-01-15");
    expect(getClientDate(reqWith("2026-2-2"))).toBe("2026-01-15");
  });
});
