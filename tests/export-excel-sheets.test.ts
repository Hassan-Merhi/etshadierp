/**
 * The full-data export's sheet builder.
 *
 * Every table in a company's export goes through one function that infers the
 * columns from the rows, guesses a number format from the column name, and
 * splits sheets that exceed Excel's practical row budget. It carries an explicit
 * memory contract in its comments — column-level styles rather than per-cell
 * ones, because per-cell styling has crashed this export before — and it had no
 * test holding any of it in place.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { addSheet } from "../server/services/export-excel/sheet-helpers";
import { addSummarySheet } from "../server/services/export-excel/summary-sheet";

function workbook() {
  return new ExcelJS.Workbook();
}

describe("export sheet columns", () => {
  it("titles each column from its database key", () => {
    const wb = workbook();
    addSheet(wb, "Vouchers", [{ voucher_number: "V-1", total_amount: "10.00" }]);

    const ws = wb.getWorksheet("Vouchers")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Voucher Number", "Total Amount"]);
  });

  it("collects keys across sparse rows instead of only the first one", () => {
    const wb = workbook();
    addSheet(wb, "Sparse", [{ a: 1 }, { b: 2 }, { c: 3 }]);

    const ws = wb.getWorksheet("Sparse")!;
    // A row that carries a column the first row lacked would otherwise lose it
    // silently, and an export that drops a column is hard to notice.
    expect(ws.getRow(1).values).toEqual([undefined, "A", "B", "C"]);
    expect(ws.rowCount).toBe(4);
  });

  it("formats money columns with two decimals and quantities with three", () => {
    const wb = workbook();
    addSheet(wb, "Formats", [{ total_amount: 1, quantity: 2, voucher_number: "V-1" }]);

    const ws = wb.getWorksheet("Formats")!;
    expect(ws.getColumn(1).style?.numFmt).toBe("#,##0.00");
    expect(ws.getColumn(2).style?.numFmt).toBe("#,##0.###");
    expect(ws.getColumn(3).style?.numFmt).toBeUndefined();
  });

  it("gives exchange rates the precision they are stored with", () => {
    const wb = workbook();
    addSheet(wb, "Rates", [{ fx_rate_to_usd: 1.234567, exchange_rate: 0.000123 }]);

    // Both column names contain "rate", which the money pattern also matches.
    // Tested in that order the rate was shown rounded to two decimals, which
    // for a rate is a different number.
    const ws = wb.getWorksheet("Rates")!;
    expect(ws.getColumn(1).style?.numFmt).toBe("#,##0.000000");
    expect(ws.getColumn(2).style?.numFmt).toBe("#,##0.000000");
  });

  it("keeps styling at the column level", () => {
    const wb = workbook();
    addSheet(
      wb,
      "Bulk",
      Array.from({ length: 50 }, (_, index) => ({ total_amount: index }))
    );

    const ws = wb.getWorksheet("Bulk")!;
    // The memory contract: the format is declared once on the column and the
    // rows inherit it. Per-cell fills and formats here have crashed the export
    // on large companies, so no data row may set one of its own.
    expect(ws.getColumn(1).style?.numFmt).toBe("#,##0.00");
    expect(ws.getCell(2, 1).numFmt).toBe("#,##0.00");
    expect(ws.getCell(2, 1).model.style?.fill).toBeUndefined();
    expect(ws.getRow(2).height).toBeUndefined();
  });
});

describe("export sheet values", () => {
  it("writes dates as readable timestamps and objects as JSON", () => {
    const wb = workbook();
    addSheet(wb, "Values", [
      {
        created_at: new Date("2026-03-04T05:06:07.000Z"),
        changes: { before: 1, after: 2 },
        note: null,
      },
    ]);

    const ws = wb.getWorksheet("Values")!;
    expect(ws.getCell(2, 1).value).toBe("2026-03-04 05:06:07");
    expect(ws.getCell(2, 2).value).toBe('{"before":1,"after":2}');
    // A null is written as an empty cell rather than the text "null".
    expect(ws.getCell(2, 3).value).toBe("");
  });

  it("hides a sheet that has no rows rather than omitting it", () => {
    const wb = workbook();
    addSheet(wb, "Empty", []);

    const ws = wb.getWorksheet("Empty")!;
    // The sheet still exists, so a reader can tell the table was exported and
    // was genuinely empty, rather than wondering whether it was skipped.
    expect(ws.state).toBe("hidden");
    expect(ws.rowCount).toBe(0);
  });

  it("truncates a long table name to what Excel accepts", () => {
    const wb = workbook();
    const longName = "supplier_proforma_line_items_and_charges_extended";
    addSheet(wb, longName, [{ a: 1 }]);

    const [sheet] = wb.worksheets;
    expect(sheet.name.length).toBeLessThanOrEqual(31);
    expect(longName.startsWith(sheet.name)).toBe(true);
  });

  it("filters on the header row", () => {
    const wb = workbook();
    addSheet(wb, "Filtered", [{ a: 1, b: 2 }]);

    expect(wb.getWorksheet("Filtered")!.autoFilter).toEqual({
      from: { row: 1, column: 1 },
      to: { row: 1, column: 2 },
    });
  });
});

describe("export summary sheet", () => {
  it("counts each category, including the ones that are absent", () => {
    const wb = workbook();
    addSummarySheet(wb, {
      company: { name: "Test Company" },
      locations: [{ id: 1 }, { id: 2 }],
      vouchers: [{ id: 1 }],
      voucherEntries: null,
    } as never);

    const ws = wb.getWorksheet("SUMMARY")!;
    const rows: Array<[string, unknown]> = [];
    ws.eachRow((row) => rows.push([String(row.getCell(1).value), row.getCell(2).value]));
    const byLabel = new Map(rows);

    expect(String(rows[0][0])).toContain("Test Company");
    expect(byLabel.get("Locations")).toBe(2);
    expect(byLabel.get("Vouchers")).toBe(1);
    // A missing collection is zero rows, not a missing line: the reader is
    // entitled to see that the category was considered.
    expect(byLabel.get("Voucher Entries")).toBe(0);
  });

  it("survives a company with nothing in it", () => {
    const wb = workbook();
    addSummarySheet(wb, {} as never);

    expect(wb.getWorksheet("SUMMARY")!.rowCount).toBeGreaterThan(4);
  });
});
