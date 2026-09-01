import ExcelJS from "exceljs";
import { ItemRow, SpSalesFormV2Params } from "./types";
import { r2, applyCell } from "./styleHelpers";
import { fill, wFont, boldSm, normSm, right, ctr, thin, DARK_BLUE, MID_BLUE, ALT_ROW, NUM } from "./constants";

export function buildSummarySheet(
  wb: ExcelJS.Workbook,
  items: ItemRow[],
  dates: string[],
  params: SpSalesFormV2Params
): void {
  const ws = wb.addWorksheet("Summary");
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 6 }];
  ws.getColumn(1).width = 26; ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 20; ws.getColumn(4).width = 14; ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 14; ws.getColumn(7).width = 14;

  // ── Header block ────────────────────────────────────────────────────────────
  ws.mergeCells("A1:G1");
  applyCell(ws, 1, 1, "SUPPLIER PARTNER — SALES SUMMARY", fill(DARK_BLUE), wFont(13), ctr);
  ws.getRow(1).height = 22;

  const meta: [string, string][] = [
    ["Company / Supplier", params.supplierName || ""],
    ["Location",           params.locationName || "All Locations"],
    ["Period From",        params.fromDate],
    ["Period To",          params.toDate],
    ["Generated At",       new Date().toLocaleString("en-GB")],
  ];
  meta.forEach(([k, v], i) => {
    ws.getCell(i + 2, 1).value = k;
    ws.getCell(i + 2, 1).font = boldSm;
    ws.getCell(i + 2, 2).value = v;
    ws.getCell(i + 2, 2).font = normSm;
    ws.getRow(i + 2).height = 13;
  });

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const totalOpenQty   = items.reduce((s, i) => s + i.openQty, 0);
  const totalOpenVal   = items.reduce((s, i) => s + i.openValue, 0);
  const totalSoldQty   = items.reduce((s, i) => s + i.totalQty, 0);
  const totalRevenue   = items.reduce((s, i) => s + i.totalSales, 0);
  const totalProfit    = items.reduce((s, i) => s + (i.totalSales - i.totalCost), 0);
  const totalCloseQty  = items.reduce((s, i) => s + i.closeQty, 0);
  const totalCloseVal  = items.reduce((s, i) => s + i.closeValue, 0);

  const kpis: [string, number, string][] = [
    ["Total Opening Stock Qty",   r2(totalOpenQty),  NUM],
    ["Total Opening Stock Value", r2(totalOpenVal),  NUM],
    ["Total Sold Qty",            r2(totalSoldQty),  NUM],
    ["Total Sales Revenue",       r2(totalRevenue),  NUM],
    ["Total Gross Profit",        r2(totalProfit),   NUM],
    ["Total Closing Stock Qty",   r2(totalCloseQty), NUM],
    ["Total Closing Stock Value", r2(totalCloseVal), NUM],
  ];

  const kpiStartRow = 8;
  ws.mergeCells(kpiStartRow, 1, kpiStartRow, 7);
  applyCell(ws, kpiStartRow, 1, "KEY METRICS", fill(MID_BLUE), wFont(), ctr);
  ws.getRow(kpiStartRow).height = 16;

  kpis.forEach(([label, val, fmt], i) => {
    const r = kpiStartRow + 1 + i;
    ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = boldSm;
    ws.getCell(r, 2).value = val;   ws.getCell(r, 2).numFmt = fmt; ws.getCell(r, 2).font = normSm;
    if (i % 2 === 0) ws.getRow(r).eachCell(c => { c.fill = fill(ALT_ROW); });
    ws.getRow(r).height = 13;
  });

  // ── Daily Summary ───────────────────────────────────────────────────────────
  const dailyStart = kpiStartRow + 1 + kpis.length + 2;
  ws.mergeCells(dailyStart, 1, dailyStart, 7);
  applyCell(ws, dailyStart, 1, "DAILY SALES SUMMARY", fill(MID_BLUE), wFont(), ctr);
  ws.getRow(dailyStart).height = 16;

  const dHdr = dailyStart + 1;
  const dHdrs = ["Date","Qty Sold","Sales Revenue","Cost","Gross Profit","Avg Sale Price"];
  dHdrs.forEach((h, i) => {
    const c = ws.getCell(dHdr, i + 1);
    c.value = h; c.fill = fill(DARK_BLUE); c.font = wFont(9); c.alignment = ctr; c.border = thin;
  });
  ws.getRow(dHdr).height = 14;

  const dailyTotals = new Map<string, { qty: number; sales: number; cost: number }>();
  for (const item of items) {
    for (const [d, ds] of item.salesByDate) {
      const ex = dailyTotals.get(d) ?? { qty: 0, sales: 0, cost: 0 };
      ex.qty += ds.qty; ex.sales += ds.totalSales; ex.cost += ds.totalCost;
      dailyTotals.set(d, ex);
    }
  }
  dates.forEach((d, i) => {
    const r = dHdr + 1 + i;
    const dt = dailyTotals.get(d) ?? { qty: 0, sales: 0, cost: 0 };
    const profit = dt.sales - dt.cost;
    const avgPrice = dt.qty > 0 ? dt.sales / dt.qty : 0;
    const row = ws.getRow(r);
    row.values = [d, r2(dt.qty)||null, r2(dt.sales)||null, r2(dt.cost)||null, r2(profit)||null, r2(avgPrice)||null];
    if (dt.qty === 0) row.eachCell(c => { c.font = { ...normSm, color: { argb: "FFAAAAAA" } }; });
    if (i % 2 === 1) row.eachCell(c => { c.fill = fill(ALT_ROW); });
    [2,3,4,5,6].forEach(c => { ws.getCell(r,c).numFmt = NUM; ws.getCell(r,c).alignment = right; });
    row.height = 13;
  });

  // ── Group Summary ───────────────────────────────────────────────────────────
  const grpStart = dHdr + 1 + dates.length + 2;
  ws.mergeCells(grpStart, 1, grpStart, 7);
  applyCell(ws, grpStart, 1, "STOCK GROUP SUMMARY", fill(MID_BLUE), wFont(), ctr);
  ws.getRow(grpStart).height = 16;

  const ghdr = grpStart + 1;
  ["Group","Open Qty","Sold Qty","Revenue","Profit","Close Qty","Close Value"].forEach((h, i) => {
    const c = ws.getCell(ghdr, i + 1);
    c.value = h; c.fill = fill(DARK_BLUE); c.font = wFont(9); c.alignment = ctr; c.border = thin;
  });
  ws.getRow(ghdr).height = 14;

  const groupMap = new Map<string, { openQty: number; soldQty: number; revenue: number; profit: number; closeQty: number; closeVal: number }>();
  for (const item of items) {
    const g = item.groupName || "(Ungrouped)";
    const ex = groupMap.get(g) ?? { openQty: 0, soldQty: 0, revenue: 0, profit: 0, closeQty: 0, closeVal: 0 };
    ex.openQty  += item.openQty;
    ex.soldQty  += item.totalQty;
    ex.revenue  += item.totalSales;
    ex.profit   += item.totalSales - item.totalCost;
    ex.closeQty += item.closeQty;
    ex.closeVal += item.closeValue;
    groupMap.set(g, ex);
  }
  Array.from(groupMap.entries()).forEach(([g, v], i) => {
    const r = ghdr + 1 + i;
    ws.getRow(r).values = [g, r2(v.openQty)||null, r2(v.soldQty)||null, r2(v.revenue)||null, r2(v.profit)||null, r2(v.closeQty)||null, r2(v.closeVal)||null];
    if (i % 2 === 1) ws.getRow(r).eachCell(c => { c.fill = fill(ALT_ROW); });
    [2,3,4,5,6,7].forEach(c => { ws.getCell(r,c).numFmt = NUM; ws.getCell(r,c).alignment = right; });
    ws.getRow(r).height = 13;
  });
}
