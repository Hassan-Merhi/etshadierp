import ExcelJS from "exceljs";
import { ItemRow } from "./types";
import { r2, r4 } from "./styleHelpers";
import { fill, wFont, ctr, right, ALT_ROW, DARK_BLUE, NUM, NUM4 } from "./constants";

export function buildCostingSheet(wb: ExcelJS.Workbook, items: ItemRow[]): void {
  const ws = wb.addWorksheet("Costing", { state: "hidden" });
  ws.columns = [
    { header: "Group",        key: "group",    width: 20 },
    { header: "Item Name",    key: "name",     width: 30 },
    { header: "Item Code",    key: "code",     width: 14 },
    { header: "Opening Qty",  key: "openQty",  width: 12 },
    { header: "Opening Value",key: "openVal",  width: 14 },
    { header: "Avg Cost",     key: "avgCost",  width: 12 },
    { header: "Closing Qty",  key: "closeQty", width: 12 },
    { header: "Closing Value",key: "closeVal", width: 14 },
  ];
  ws.getRow(1).eachCell(c => { c.fill = fill(DARK_BLUE); c.font = wFont(); c.alignment = ctr; });
  ws.getRow(1).height = 16;

  items.forEach((item, i) => {
    const r = i + 2;
    const openQty = r2(item.openQty), openVal = r2(item.openValue);
    const closeQty = r2(item.closeQty);
    const row = ws.getRow(r);
    row.values = [
      item.groupName, item.itemName, item.itemCode,
      openQty || null, openVal || null,
      null, // Avg Cost formula below
      closeQty || null,
      null, // Closing Value formula below
    ];
    if (i % 2 === 1) row.eachCell(c => { c.fill = fill(ALT_ROW); });
    // Avg Cost: =IF(D{r}=0,0,E{r}/D{r})
    const avgCell = ws.getCell(r, 6);
    avgCell.value = openQty > 0
      ? { formula: `IF(D${r}=0,0,E${r}/D${r})`, result: r4(item.openRate) } as any
      : 0;
    avgCell.numFmt = NUM4;
    // Closing Value: =G{r}*F{r}
    const clvCell = ws.getCell(r, 8);
    clvCell.value = { formula: `G${r}*F${r}`, result: r2(item.closeValue) } as any;
    clvCell.numFmt = NUM;
    [4,5,6,7,8].forEach(c => { ws.getCell(r, c).numFmt = c === 6 ? NUM4 : NUM; ws.getCell(r, c).alignment = right; });
    row.height = 13;
  });
}
