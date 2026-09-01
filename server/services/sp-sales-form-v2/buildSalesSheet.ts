import ExcelJS from "exceljs";
import { ItemRow } from "./types";
import { r2 } from "./styleHelpers";
import { fill, wFont, ctr, ALT_ROW, MID_BLUE, NUM } from "./constants";

export function buildSalesSheet(wb: ExcelJS.Workbook, items: ItemRow[], dates: string[]): void {
  const ws = wb.addWorksheet("Sales", { state: "hidden" });
  ws.getCell(1, 1).value = "StockItemId";
  ws.getCell(1, 2).value = "Item Code";
  ws.getCell(1, 3).value = "Item Name";
  dates.forEach((d, i) => {
    ws.getCell(1, 4 + i).value = d;
    ws.getColumn(4 + i).width = 10;
  });
  ws.getRow(1).eachCell(c => { c.fill = fill(MID_BLUE); c.font = wFont(9); c.alignment = ctr; });
  ws.getRow(1).height = 15;
  ws.getColumn(1).width = 12; ws.getColumn(2).width = 14; ws.getColumn(3).width = 28;

  items.forEach((item, i) => {
    const r = i + 2;
    ws.getCell(r, 1).value = item.stockItemId;
    ws.getCell(r, 2).value = item.itemCode;
    ws.getCell(r, 3).value = item.itemName;
    dates.forEach((d, di) => {
      const ds = item.salesByDate.get(d);
      ws.getCell(r, 4 + di).value = ds && ds.qty > 0 ? r2(ds.qty) : null;
      ws.getCell(r, 4 + di).numFmt = NUM;
    });
    if (i % 2 === 1) ws.getRow(r).eachCell(c => { c.fill = fill(ALT_ROW); });
    ws.getRow(r).height = 13;
  });
}
