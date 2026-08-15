/**
 * The spreadsheet compatibility layer.
 *
 * Every client-side export in the app builds its sheet through these helpers,
 * which reimplement the small part of the old SheetJS API the code was written
 * against on top of ExcelJS. The cell-address arithmetic is the part that goes
 * wrong quietly: an off-by-one in the column encoder does not throw, it just
 * writes the data one column across in every export that uses it.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readFromBuffer, utils } from "./excelHelper";

describe("cell addressing", () => {
  it("encodes column numbers as spreadsheet letters", () => {
    expect(utils.encode_col(0)).toBe("A");
    expect(utils.encode_col(25)).toBe("Z");
    // The wrap from single to double letters is where an off-by-one hides.
    expect(utils.encode_col(26)).toBe("AA");
    expect(utils.encode_col(51)).toBe("AZ");
    expect(utils.encode_col(701)).toBe("ZZ");
  });

  it("encodes a cell from its zero-based row and column", () => {
    expect(utils.encode_cell({ r: 0, c: 0 })).toBe("A1");
    expect(utils.encode_cell({ r: 9, c: 27 })).toBe("AB10");
  });

  it("round-trips a range through encode and decode", () => {
    const range = { s: { r: 0, c: 0 }, e: { r: 9, c: 27 } };
    const encoded = utils.encode_range(range);

    expect(encoded).toBe("A1:AB10");
    expect(utils.decode_range(encoded)).toEqual(range);
  });

  it("decodes an unparseable range to the first cell rather than throwing", () => {
    // Callers pass sheet metadata straight in; a malformed range must not take
    // the whole export down.
    expect(utils.decode_range("not-a-range")).toEqual({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } });
  });
});

describe("sheet building", () => {
  it("takes headers from the first row when none are given", () => {
    const sheet = utils.json_to_sheet([{ name: "Rice", qty: 3 }]);
    expect(sheet.headers).toEqual(["name", "qty"]);
  });

  it("keeps caller-supplied headers and their order", () => {
    const sheet = utils.json_to_sheet([{ name: "Rice", qty: 3 }], { header: ["qty", "name"] });
    expect(sheet.headers).toEqual(["qty", "name"]);
  });

  it("returns an empty sheet for no data", () => {
    expect(utils.json_to_sheet([])).toEqual({ data: [], headers: [] });
    expect(utils.json_to_sheet([], { header: ["a"] })).toEqual({ data: [], headers: ["a"] });
  });

  it("writes added rows at the requested origin", () => {
    const sheet = utils.aoa_to_sheet([["a"]]);
    utils.sheet_add_aoa(sheet, [["b", "c"]], { origin: "B3" });

    expect(sheet.aoa[0]).toEqual(["a"]);
    expect(sheet.aoa[2]).toEqual([undefined, "b", "c"]);
  });

  it("defaults an unrecognised origin to the top-left cell", () => {
    const sheet = utils.aoa_to_sheet([]);
    utils.sheet_add_aoa(sheet, [["x"]], { origin: "??" });

    expect(sheet.aoa[0]).toEqual(["x"]);
  });
});

describe("workbook assembly", () => {
  it("writes an array-of-arrays sheet row for row", () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([["Title"], ["a", "b"]]), "Report");

    const ws = workbook.getWorksheet("Report")!;
    expect(ws.getCell(1, 1).value).toBe("Title");
    expect(ws.getCell(2, 2).value).toBe("b");
  });

  it("writes a header row and one row per record, in header order", () => {
    const workbook = utils.book_new();
    const sheet = utils.json_to_sheet([{ name: "Rice", qty: 3 }], { header: ["qty", "name"] });
    utils.book_append_sheet(workbook, sheet, "Items");

    const ws = workbook.getWorksheet("Items")!;
    expect(ws.getRow(1).values).toEqual([undefined, "qty", "name"]);
    expect(ws.getRow(2).values).toEqual([undefined, 3, "Rice"]);
  });

  it("writes an empty cell for a field a record does not have", () => {
    const workbook = utils.book_new();
    const sheet = utils.json_to_sheet([{ name: "Rice" }], { header: ["name", "qty"] });
    utils.book_append_sheet(workbook, sheet, "Items");

    // A missing field must not shift the remaining values one column left.
    expect(workbook.getWorksheet("Items")!.getRow(2).values).toEqual([undefined, "Rice", ""]);
  });

  it("applies requested column widths", () => {
    const workbook = utils.book_new();
    const sheet = utils.aoa_to_sheet([["a", "b"]]) as Record<string, unknown>;
    sheet["!cols"] = [{ wch: 30 }, {}];
    utils.book_append_sheet(workbook, sheet, "Widths");

    expect(workbook.getWorksheet("Widths")!.getColumn(1).width).toBe(30);
  });

  it("reads a workbook back out of a buffer", async () => {
    const source = new ExcelJS.Workbook();
    source.addWorksheet("Data").addRow(["value"]);
    const buffer = await source.xlsx.writeBuffer();

    const parsed = await readFromBuffer(buffer as ArrayBuffer);
    expect(parsed.getWorksheet("Data")!.getCell(1, 1).value).toBe("value");
  });
});
