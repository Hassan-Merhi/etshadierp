import ExcelJS from "exceljs";
import { ItemRow } from "./types";
import { toUtcDate } from "./dateHelpers";
import { r2, applyCell } from "./styleHelpers";
import { fill, ctr, right, thin, boldSm, normSm, DARK_BLUE, GREEN_HDR, YELLOW_GRP, PURPLE_QTY, ALT_ROW, WHITE, wFont, NUM } from "./constants";

// ── Ageing sheet ──────────────────────────────────────────────────────────────
// Buckets each item's Closing Qty into 0-30/31-60/61-90/91-120/121+ days based
// on the best-available last-inbound-movement date (see fetchAgeingData()
// in dataFetchers.ts). Items with no movement record fall into 121+ with an
// explicit "No movement record" note in the Ageing Basis column — this is a
// documented fallback, never a fabricated age.
export function buildAgeingSheet(
  wb: ExcelJS.Workbook,
  items: ItemRow[],
  ageingMap: Map<number, string>,
  toDate: string
): void {
  const ws = wb.addWorksheet("Ageing");
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
  ws.pageSetup.orientation    = "landscape";
  ws.pageSetup.fitToPage      = true;
  ws.pageSetup.fitToWidth     = 1;
  ws.pageSetup.fitToHeight    = 0;
  ws.pageSetup.printTitlesRow = "1:1";

  ws.columns = [
    { header: "Group",           key: "grp",   width: 18 },
    { header: "Item Code",       key: "code",  width: 14 },
    { header: "Item Name",       key: "name",  width: 28 },
    { header: "Closing Qty",     key: "cqty",  width: 12 },
    { header: "Closing Value",   key: "cval",  width: 13 },
    { header: "0-30 Days Qty",   key: "b1",    width: 12 },
    { header: "31-60 Days Qty",  key: "b2",    width: 12 },
    { header: "61-90 Days Qty",  key: "b3",    width: 12 },
    { header: "91-120 Days Qty", key: "b4",    width: 12 },
    { header: "121+ Days Qty",   key: "b5",    width: 12 },
    { header: "Ageing Basis",    key: "basis", width: 28 },
  ];
  ws.getRow(1).eachCell(c => { c.fill = fill(DARK_BLUE); c.font = wFont(9); c.alignment = ctr; c.border = thin; });
  ws.getRow(1).height = 16;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };

  const toDateMs = toUtcDate(toDate).getTime();

  const bucketTotals = [0, 0, 0, 0, 0];
  let rowIdx = 2;
  for (const item of items) {
    const closeQty = r2(item.closeQty);
    if (closeQty === 0 && item.closeValue === 0) continue; // skip zero-stock items entirely

    const lastMoveStr = ageingMap.get(item.stockItemId);
    let bucket = 4; // default → 121+ (undetermined)
    let basis: string;
    if (lastMoveStr) {
      const days = Math.floor((toDateMs - toUtcDate(lastMoveStr).getTime()) / 86_400_000);
      if (days <= 30) bucket = 0;
      else if (days <= 60) bucket = 1;
      else if (days <= 90) bucket = 2;
      else if (days <= 120) bucket = 3;
      else bucket = 4;
      basis = `Last stock-in ${lastMoveStr} (${Math.max(days, 0)}d)`;
    } else {
      basis = "No movement record — defaulted to 121+";
    }

    const buckets = [null, null, null, null, null] as Array<number | null>;
    buckets[bucket] = closeQty || null;
    bucketTotals[bucket] += closeQty;

    const r = rowIdx++;
    const row = ws.getRow(r);
    row.values = [
      item.groupName, item.itemCode, item.itemName,
      closeQty || null, r2(item.closeValue) || null,
      ...buckets, basis,
    ];
    ws.getCell(r, 1).fill = fill(YELLOW_GRP); // Group column — yellow
    ws.getCell(r, 4).fill = fill(PURPLE_QTY); // Closing Qty — light purple
    [6,7,8,9,10].forEach(c => { ws.getCell(r, c).fill = fill(PURPLE_QTY); }); // bucket qty cols — light purple
    if ((rowIdx - 2) % 2 === 1) row.eachCell(c => { if (!c.fill || (c.fill as any).fgColor?.argb === undefined) c.fill = fill(ALT_ROW); });
    [4,5,6,7,8,9,10].forEach(c => { ws.getCell(r, c).numFmt = NUM; ws.getCell(r, c).alignment = right; ws.getCell(r, c).border = thin; });
    ws.getCell(r, 11).font = normSm; ws.getCell(r, 11).border = thin;
    ws.getCell(r, 2).border = thin; ws.getCell(r, 3).border = thin; ws.getCell(r, 1).border = thin;
    row.height = 13;
  }

  // Totals row
  const totRow = rowIdx;
  ws.mergeCells(totRow, 1, totRow, 3);
  applyCell(ws, totRow, 1, "TOTAL", fill(GREEN_HDR), { ...boldSm, color: { argb: WHITE } }, ctr);
  const grandCloseQty = items.reduce((s, i) => s + r2(i.closeQty), 0);
  const grandCloseVal = items.reduce((s, i) => s + r2(i.closeValue), 0);
  applyCell(ws, totRow, 4, r2(grandCloseQty) || null, fill(GREEN_HDR), { ...boldSm, color: { argb: WHITE } }, right);
  ws.getCell(totRow, 4).numFmt = NUM;
  applyCell(ws, totRow, 5, r2(grandCloseVal) || null, fill(GREEN_HDR), { ...boldSm, color: { argb: WHITE } }, right);
  ws.getCell(totRow, 5).numFmt = NUM;
  [0,1,2,3,4].forEach((b, i) => {
    const c = ws.getCell(totRow, 6 + i);
    c.value = r2(bucketTotals[b]) || null; c.numFmt = NUM;
    c.fill = fill(GREEN_HDR); c.font = { ...boldSm, color: { argb: WHITE } }; c.alignment = right; c.border = thin;
  });
  ws.getCell(totRow, 11).fill = fill(GREEN_HDR); ws.getCell(totRow, 11).border = thin;
  ws.getRow(totRow).height = 16;
}
