import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  monthEnds: vi.fn(),
  monthLabel: vi.fn(),
  netPosition: vi.fn(),
  income: vi.fn(),
}));

vi.mock("../server/helpers/generateNetPositionExcel", () => ({
  generateMonthEnds: harness.monthEnds,
  fmtMonthLabel: harness.monthLabel,
}));

vi.mock("../server/helpers/calculateNetPositionAsOf", () => ({
  calculateNetPositionAsOf: harness.netPosition,
}));

vi.mock("../server/helpers/calculateIncomeStatementForPeriod", () => ({
  calculateIncomeStatementForPeriod: harness.income,
}));

import { generateAllCompaniesNetPositionExcel } from "../server/helpers/generateAllCompaniesNetPositionExcel";

beforeEach(() => {
  vi.clearAllMocks();
  harness.monthEnds.mockReturnValue(["2026-01-31", "2026-02-28"]);
  harness.monthLabel.mockImplementation((date: string) => (date === "2026-01-31" ? "Jan 2026" : "Feb 2026"));
  harness.netPosition.mockImplementation(async (companyId: number, date: string) => ({
    netPosition: companyId === 1 ? 1250 : -450,
    forUsTotal: date === "2026-01-31" ? 2000 : 2100,
    onUsTotal: companyId === 1 ? 750 : 2550,
  }));
  harness.income.mockImplementation(async (companyId: number, from: string, to: string) => ({
    totalRevenue: companyId === 1 ? 1000.126 : 500.444,
    totalExpenses: from === "2026-01-01" ? 400.111 : to === "2026-02-28" ? 250.222 : 100,
  }));
});

describe("all-companies net position workbook", () => {
  it("builds monthly net-position, income, and per-company sheets", async () => {
    const workbook = await generateAllCompaniesNetPositionExcel(
      [
        { id: 1, name: "Alpha & Co." },
        { id: 2, name: "Beta / Trading" },
      ],
      "2026-01-01",
      "2026-02-28"
    );

    expect(Buffer.isBuffer(workbook)).toBe(true);
    expect(workbook.subarray(0, 2).toString()).toBe("PK");
    expect(workbook.length).toBeGreaterThan(5000);
    expect(harness.netPosition).toHaveBeenCalledTimes(4);
    expect(harness.income).toHaveBeenCalledTimes(4);
    expect(harness.income).toHaveBeenCalledWith(1, "2026-01-01", "2026-01-31");
    expect(harness.income).toHaveBeenCalledWith(1, "2026-02-01", "2026-02-28");
  });

  it("rejects an empty month range before calculating company data", async () => {
    harness.monthEnds.mockReturnValueOnce([]);

    await expect(generateAllCompaniesNetPositionExcel([{ id: 1, name: "Alpha" }], "2026-02-01", "2026-01-01")).rejects.toThrow(
      "No months in range"
    );
    expect(harness.netPosition).not.toHaveBeenCalled();
    expect(harness.income).not.toHaveBeenCalled();
  });
});
