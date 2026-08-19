import { describe, expect, it } from "vitest";
import {
  assertValidPdfBuffer,
  normalizeStatementDate,
  statementDateKey,
  validateStatementDateRange,
} from "../server/lib/accountStatementExportSafety";

describe("account statement export safety", () => {
  it("normalizes Date objects without producing Invalid Date / NaN", () => {
    const source = new Date(2026, 7, 19, 15, 42, 10);
    const normalized = normalizeStatementDate(source);

    expect(normalized).toBeInstanceOf(Date);
    expect(normalized?.getFullYear()).toBe(2026);
    expect(normalized?.getMonth()).toBe(7);
    expect(normalized?.getDate()).toBe(19);
    expect(Number.isNaN(normalized?.getTime() ?? NaN)).toBe(false);
    expect(statementDateKey(source)).toBe("2026-08-19");
  });

  it("normalizes date strings and timestamp strings to the same date key", () => {
    expect(statementDateKey("2026-08-05")).toBe("2026-08-05");
    expect(statementDateKey("2026-08-05T13:10:11.000Z")).toBe("2026-08-05");
  });

  it("rejects impossible or reversed filter ranges", () => {
    expect(validateStatementDateRange("2026-02-30", "2026-08-19")).toEqual({
      ok: false,
      message: "startDate must be a valid date in YYYY-MM-DD format",
    });
    expect(validateStatementDateRange("2026-08-20", "2026-08-19")).toEqual({
      ok: false,
      message: "startDate cannot be after endDate",
    });
    expect(validateStatementDateRange("2026-08-01", "2026-08-19")).toEqual({ ok: true });
  });

  it("accepts a real PDF buffer and rejects empty/non-PDF output", () => {
    expect(() => assertValidPdfBuffer(Buffer.from("%PDF-1.7\nstatement"))).not.toThrow();
    expect(() => assertValidPdfBuffer(Buffer.alloc(0))).toThrow(/invalid or empty PDF buffer/);
    expect(() => assertValidPdfBuffer(Buffer.from("not-a-pdf"))).toThrow(/invalid or empty PDF buffer/);
  });
});
