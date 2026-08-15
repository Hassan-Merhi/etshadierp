/**
 * The monthly net-position workbook.
 *
 * This helper is what a company owner actually receives: the HTTP route streams
 * it to the browser and the scheduler sends it over WhatsApp every month. It had
 * no coverage, so the month-boundary walk that decides which snapshots are taken
 * — and the period each income statement is measured over — could drift without
 * anything failing.
 *
 * The two figures the workbook is built from are loaded from the database, so
 * they are stubbed here. Everything downstream of them is the real code, and the
 * workbook it produces is opened again and read back.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

const calculateNetPositionAsOf = vi.fn();
const calculateIncomeStatementForPeriod = vi.fn();

vi.mock("../server/helpers/calculateNetPositionAsOf", () => ({
  calculateNetPositionAsOf: (...args: unknown[]) => calculateNetPositionAsOf(...args),
}));
vi.mock("../server/helpers/calculateIncomeStatementForPeriod", () => ({
  calculateIncomeStatementForPeriod: (...args: unknown[]) => calculateIncomeStatementForPeriod(...args),
}));

const { fmtMonthLabel, generateMonthEnds, generateNetPositionExcel } =
  await import("../server/helpers/generateNetPositionExcel");

function snapshot(netPosition: number) {
  return {
    forUsTotal: netPosition > 0 ? netPosition : 0,
    onUsTotal: netPosition < 0 ? -netPosition : 0,
    netPosition,
    netPositionLabel: netPosition >= 0 ? "Net Receivable" : "Net Payable",
    forUsLines: [
      { label: "Customers", value: 1200, category: "Receivables", side: "forUs" as const },
      { label: "Cash", value: 800, category: "Cash & Bank", side: "forUs" as const },
    ],
    onUsLines: [{ label: "Suppliers", value: 500, category: "Payables", side: "onUs" as const }],
  };
}

function incomeStatement(netProfit: number) {
  return {
    totalRevenue: 5000,
    revenueLines: [{ label: "Sales", value: 5000, category: "Revenue" }],
    totalDirectExp: 2000,
    directExpLines: [{ label: "Purchases", value: 2000, category: "Direct Expense" }],
    totalIndirectExp: 500,
    indirectExpLines: [{ label: "Rent", value: 500, category: "Indirect Expense" }],
    totalGeneralExp: 100,
    generalExpLines: [{ label: "Bank Charges", value: 100, category: "Expense" }],
    totalExpenses: 2600,
    grossProfit: 3000,
    netProfit,
  };
}

beforeEach(() => {
  calculateNetPositionAsOf.mockReset();
  calculateIncomeStatementForPeriod.mockReset();
});

describe("month end walk", () => {
  it("lists every month end inside the range", () => {
    expect(generateMonthEnds("2026-01-01", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("uses the leap day when February has one", () => {
    expect(generateMonthEnds("2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });

  it("finishes on a part month with the end date itself", () => {
    // The reader asked for a period ending mid-month; the last snapshot is
    // taken on that day rather than being dropped or rounded to month end.
    expect(generateMonthEnds("2026-01-01", "2026-03-15")).toEqual(["2026-01-31", "2026-02-28", "2026-03-15"]);
  });

  it("still reports a range that ends before its first month end", () => {
    // A fortnight inside one month is a legitimate thing to ask for, and it is
    // answered with a snapshot on the requested end date.
    expect(generateMonthEnds("2026-01-05", "2026-01-20")).toEqual(["2026-01-20"]);
  });

  it("returns nothing when the range ends before it starts", () => {
    expect(generateMonthEnds("2026-03-01", "2026-01-31")).toEqual([]);
  });

  it("starts from the month containing the start date, not from its day", () => {
    expect(generateMonthEnds("2026-05-17", "2026-06-30")).toEqual(["2026-05-31", "2026-06-30"]);
  });
});

describe("month labels", () => {
  it("names the month and year of a date", () => {
    expect(fmtMonthLabel("2026-01-31")).toBe("Jan 2026");
    expect(fmtMonthLabel("2026-11-30")).toBe("Nov 2026");
  });
});

describe("net position workbook", () => {
  it("refuses a range with no month end in it", async () => {
    await expect(generateNetPositionExcel(1, "Test Company", "2026-03-01", "2026-01-31")).rejects.toThrow(
      "No months in range"
    );
    // Nothing is loaded for a range that cannot produce a snapshot.
    expect(calculateNetPositionAsOf).not.toHaveBeenCalled();
  });

  it("measures each income statement over the period since the previous snapshot", async () => {
    calculateNetPositionAsOf.mockImplementation(async () => snapshot(1000));
    calculateIncomeStatementForPeriod.mockImplementation(async () => incomeStatement(400));

    await generateNetPositionExcel(7, "Test Company", "2026-01-10", "2026-03-31");

    // The first period runs from the requested start date; each later one picks
    // up the day after the previous snapshot, so no day is counted twice and
    // none is skipped.
    expect(calculateIncomeStatementForPeriod.mock.calls.map((call) => call.slice(1))).toEqual([
      ["2026-01-10", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-31"],
    ]);
    expect(calculateNetPositionAsOf.mock.calls.map((call) => call[1])).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("builds a readable workbook with an overview and a sheet per month", async () => {
    const positions = [1000, 1500, 900];
    let index = 0;
    calculateNetPositionAsOf.mockImplementation(async () => snapshot(positions[index++] ?? 0));
    calculateIncomeStatementForPeriod.mockImplementation(async () => incomeStatement(250));

    const buffer = await generateNetPositionExcel(7, "Test Company", "2026-01-01", "2026-03-31");
    expect(buffer.byteLength).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const names = workbook.worksheets.map((sheet) => sheet.name);
    expect(names[0]).toBe("Overview");
    expect(names).toContain("Jan 2026");
    expect(names).toContain("Mar 2026");

    const overview = workbook.getWorksheet("Overview")!;
    expect(String(overview.getCell("A1").value)).toContain("Test Company");
    expect(String(overview.getCell("A2").value)).toContain("2026-01-01");
  });

  it("reports a net payable company without inverting its own sign", async () => {
    calculateNetPositionAsOf.mockImplementation(async () => snapshot(-2500));
    calculateIncomeStatementForPeriod.mockImplementation(async () => incomeStatement(-800));

    const buffer = await generateNetPositionExcel(7, "Owing Company", "2026-01-01", "2026-01-31");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const overview = workbook.getWorksheet("Overview")!;
    const values: unknown[] = [];
    overview.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => values.push(cell.value)));

    // The headline number is written as a magnitude and the direction is
    // carried by the label beside it, so a company that owes money is never
    // shown as if it were owed money.
    expect(values).toContain(2500);
    expect(values).toContain("Net Payable");
    expect(values).not.toContain("Net Receivable");
  });
});
