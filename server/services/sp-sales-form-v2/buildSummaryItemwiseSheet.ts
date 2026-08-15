import ExcelJS from "exceljs";
import { ItemRow } from "./types";
import { r2, r4 } from "./styleHelpers";
import { fill, wFont, ctr, right, ALT_ROW, DARK_BLUE, NUM, NUM4 } from "./constants";

export function buildSummaryItemwiseSheet(
  wb: ExcelJS.Workbook,
  items: ItemRow[],
  dayCount: number
): void {
  const ws = wb.addWorksheet("Summary-Itemwise", { state: "hidden" });
  ws.columns = [
    { header: "Group",             key: "grp",    width: 18 },
    { header: "Item Code",         key: "code",   width: 14 },
    { header: "Item Name",         key: "name",   width: 28 },
    { header: "Opening Qty",       key: "oqty",   width: 12 },
    { header: "Cost / Bag",        key: "cost",   width: 12 },
    { header: "Sold Qty",          key: "sold",   width: 12 },
    { header: "Avg Sale Price",    key: "avgp",   width: 12 },
    { header: "Sales Value",       key: "sval",   width: 13 },
    { header: "Profit Value",      key: "prof",   width: 13 },
    { header: "Closing Qty",       key: "cqty",   width: 12 },
    { header: "Closing Value",     key: "cval",   width: 13 },
    { header: "Avg Monthly Sales", key: "avgmo",  width: 14 },
  ];
  ws.getRow(1).eachCell(c => { c.fill = fill(DARK_BLUE); c.font = wFont(9); c.alignment = ctr; });
  ws.getRow(1).height = 14;

  items.forEach((item, i) => {
    const r = i + 2;
    const avgPrice = item.totalQty > 0 ? item.totalSales / item.totalQty : 0;
    const profit   = item.totalSales - item.totalCost;
    const row = ws.getRow(r);
    row.values = [
      item.groupName, item.itemCode, item.itemName,
      r2(item.openQty)||null, r4(item.openRate)||null,
      r2(item.totalQty)||null, r4(avgPrice)||null,
      r2(item.totalSales)||null, r2(profit)||null,
      r2(item.closeQty)||null, r2(item.closeValue)||null,
      r2(item.avgMonthlyQty)||null,
    ];
    if (i % 2 === 1) row.eachCell(c => { c.fill = fill(ALT_ROW); });
    [4,5,6,7,8,9,10,11,12].forEach(c => {
      ws.getCell(r,c).numFmt = [5,7].includes(c) ? NUM4 : NUM;
      ws.getCell(r,c).alignment = right;
    });
    row.height = 13;
  });
}
