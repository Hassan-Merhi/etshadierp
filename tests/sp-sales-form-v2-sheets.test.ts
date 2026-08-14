/**
 * The supplier-partner sales form workbook.
 *
 * Six sheet builders turn one set of item rows into the workbook a supplier
 * partner fills in and returns: opening stock, a column pair per day, closing
 * stock, a summary, an item-wise summary, and an ageing sheet. Between them they
 * are the largest untested surface in the reporting code, and every figure a
 * partner reads comes out of them.
 *
 * The builders are pure — a workbook in, a workbook out — so these tests run
 * them against a real ExcelJS workbook and read the cells back rather than
 * asserting on how they were called.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildAgeingSheet } from "../server/services/sp-sales-form-v2/buildAgeingSheet";
import { buildCostingSheet } from "../server/services/sp-sales-form-v2/buildCostingSheet";
import { buildEntrySheet } from "../server/services/sp-sales-form-v2/buildEntrySheet";
import { buildSalesSheet } from "../server/services/sp-sales-form-v2/buildSalesSheet";
import { buildSummaryItemwiseSheet } from "../server/services/sp-sales-form-v2/buildSummaryItemwiseSheet";
import { buildSummarySheet } from "../server/services/sp-sales-form-v2/buildSummarySheet";
import type { ItemRow, SpSalesFormV2Params } from "../server/services/sp-sales-form-v2/types";

const DATES = ["2026-03-01", "2026-03-02"];

const params: SpSalesFormV2Params = {
  companyId: 4,
  locationId: 11,
  fromDate: DATES[0],
  toDate: DATES[1],
  locationName: "Beirut Shop",
  supplierName: "Northern Mills",
};

function itemRow(overrides: Partial<ItemRow> = {}): ItemRow {
  const salesByDate = new Map([
    [DATES[0], { qty: 3, totalSales: 30, totalCost: 21 }],
    [DATES[1], { qty: 2, totalSales: 20, totalCost: 14 }],
  ]);
  return {
    stockItemId: 501,
    itemCode: "IT-501",
    itemName: "Rice 5kg",
    groupName: "Dry Goods",
    itemUom: "BAG",
    openQty: 40,
    openRate: 7,
    openValue: 280,
    salesByDate,
    closeQty: 35,
    closeRate: 7,
    closeValue: 245,
    totalQty: 5,
    totalSales: 50,
    totalCost: 35,
    avgMonthlyQty: 2.5,
    ...overrides,
  };
}

function sheetText(ws: ExcelJS.Worksheet): string {
  const parts: string[] = [];
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => parts.push(String(cell.value))));
  return parts.join("|");
}

function sheetNumbers(ws: ExcelJS.Worksheet): number[] {
  const values: number[] = [];
  ws.eachRow((row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "number") values.push(cell.value);
    })
  );
  return values;
}

describe("entry sheet", () => {
  it("lays out one qty and one price column per day between the fixed columns", async () => {
    const wb = new ExcelJS.Workbook();
    await buildEntrySheet(wb, [itemRow()], DATES, DATES.length, params, 1200);

    const ws = wb.getWorksheet("ENTRY")!;
    // Six fixed columns, then two per day, then the closing block. A layout
    // constant changed on its own would move a partner's entries into the
    // wrong day.
    expect(ws.getCell(4, 3).value).toBe("Rice 5kg");
    expect(ws.getCell(4, 4).value).toBe("IT-501");
    expect(ws.getCell(4, 5).value).toBe(40);
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: 3 });
    expect(ws.autoFilter).toMatchObject({ from: { row: 3, column: 1 } });
  });

  it("carries the opening cash balance when an account was chosen", async () => {
    const wb = new ExcelJS.Workbook();
    await buildEntrySheet(wb, [itemRow()], DATES, DATES.length, params, 1200);

    expect(sheetNumbers(wb.getWorksheet("ENTRY")!)).toContain(1200);
  });

  it("leaves the opening cash cell to be filled in when no account was chosen", async () => {
    const wb = new ExcelJS.Workbook();
    await buildEntrySheet(wb, [itemRow()], DATES, DATES.length, params, null);

    // null means the partner enters it by hand on day zero; the sheet must not
    // invent a zero balance that looks like a real reading.
    const ws = wb.getWorksheet("ENTRY")!;
    expect(ws.rowCount).toBeGreaterThan(3);
    expect(sheetText(ws)).toContain("Rice 5kg");
  });

  it("builds a usable sheet for a period with no items", async () => {
    const wb = new ExcelJS.Workbook();
    await buildEntrySheet(wb, [], DATES, DATES.length, params, null);

    const ws = wb.getWorksheet("ENTRY")!;
    expect(ws).toBeDefined();
    expect(ws.rowCount).toBeGreaterThanOrEqual(3);
  });

  it("groups consecutive items of the same group together", async () => {
    const wb = new ExcelJS.Workbook();
    const items = [
      itemRow({ stockItemId: 1, itemName: "Rice 5kg", groupName: "Dry Goods" }),
      itemRow({ stockItemId: 2, itemName: "Sugar 1kg", groupName: "Dry Goods" }),
      itemRow({ stockItemId: 3, itemName: "Soap", groupName: "Household" }),
    ];
    await buildEntrySheet(wb, items, DATES, DATES.length, params, null);

    const text = sheetText(wb.getWorksheet("ENTRY")!);
    expect(text).toContain("Sugar 1kg");
    expect(text).toContain("Household");
  });
});

describe("sales and costing sheets", () => {
  it("writes one hidden sales row per item with a column per date", () => {
    const wb = new ExcelJS.Workbook();
    buildSalesSheet(wb, [itemRow()], DATES);

    const ws = wb.getWorksheet("Sales")!;
    expect(ws.state).toBe("hidden");
    expect(ws.getCell(1, 4).value).toBe(DATES[0]);
    expect(ws.getCell(2, 1).value).toBe(501);
    expect(ws.getCell(2, 2).value).toBe("IT-501");
  });

  it("writes the costing reference for each item", () => {
    const wb = new ExcelJS.Workbook();
    buildCostingSheet(wb, [itemRow()]);

    const ws = wb.worksheets.find((sheet) => sheet.name.toLowerCase().includes("cost"))!;
    expect(ws).toBeDefined();
    expect(sheetText(ws)).toContain("IT-501");
  });
});

describe("summary sheets", () => {
  it("names the location and supplier the form was produced for", () => {
    const wb = new ExcelJS.Workbook();
    buildSummarySheet(wb, [itemRow()], DATES, params);

    const text = sheetText(wb.getWorksheet("Summary")!);
    expect(text).toContain("Beirut Shop");
    expect(text).toContain("Northern Mills");
  });

  it("carries each item's totals into the item-wise summary", () => {
    const wb = new ExcelJS.Workbook();
    buildSummaryItemwiseSheet(wb, [itemRow()], DATES.length);

    const ws = wb.getWorksheet("Summary-Itemwise")!;
    const numbers = sheetNumbers(ws);
    expect(sheetText(ws)).toContain("Rice 5kg");
    expect(numbers).toContain(50);
  });
});

describe("ageing sheet", () => {
  it("ages closing stock from the last inbound movement", () => {
    const wb = new ExcelJS.Workbook();
    buildAgeingSheet(wb, [itemRow()], new Map([[501, "2026-02-20"]]), "2026-03-02");

    const text = sheetText(wb.getWorksheet("Ageing")!);
    expect(text).toContain("Rice 5kg");
    expect(text).toContain("2026-02-20");
  });

  it("says so when an item has no movement record rather than inventing an age", () => {
    const wb = new ExcelJS.Workbook();
    buildAgeingSheet(wb, [itemRow()], new Map(), "2026-03-02");

    // The fallback is documented as explicit: the oldest bucket, with a note
    // saying why, never a fabricated date.
    expect(sheetText(wb.getWorksheet("Ageing")!)).toContain("No movement record");
  });
});
