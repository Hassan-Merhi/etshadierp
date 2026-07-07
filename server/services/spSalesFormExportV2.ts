/**
 * SP Sales Form Export — V2 (from-scratch ExcelJS, no template)
 *
 * Data sources:
 *   Opening stock : calculateHistoricalLocationInventory(locationId, companyId, dayBefore(fromDate))
 *   Closing stock : calculateHistoricalLocationInventory(locationId, companyId, toDate)
 *   Daily sales   : sales_items + vouchers (ERP POS) — same tables the inventory helper reverses,
 *                   guaranteeing opening − sales + offloads ≈ closing
 *   Ageing dates  : earliest container_offload_items.offloaded_at per stock item
 *
 * Sheet order (mirrors supplier workbook):
 *   1. Costing         — hidden
 *   2. Sales           — hidden
 *   3. ENTRY           — visible  ← main page
 *   4. Summary         — visible
 *   5. Ageing          — visible
 *   6. Summary-Itemwise— hidden
 */

import ExcelJS from "exceljs";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { calculateHistoricalLocationInventory } from "../routes/helpers/inventoryHistoryHelpers";

// ── Public interface ──────────────────────────────────────────────────────────
export interface SpSalesFormV2Params {
  companyId: number;
  locationId?: number;
  fromDate: string;   // YYYY-MM-DD
  toDate: string;     // YYYY-MM-DD
  locationName?: string;
  supplierName?: string;
}

// ── Internal types ────────────────────────────────────────────────────────────
interface DaySale   { qty: number; totalSales: number; totalCost: number }
interface InvEntry  { stockItemId: number; stockItemCode: string; stockItemName: string; stockGroupName: string; stockItemUom: string; quantity: number; averageRate: number; totalValue: number }

interface ItemRow {
  stockItemId  : number;
  itemCode     : string;
  itemName     : string;
  groupName    : string;
  itemUom      : string;
  openQty      : number;
  openRate     : number;
  openValue    : number;
  salesByDate  : Map<string, DaySale>;
  closeQty     : number;
  closeRate    : number;
  closeValue   : number;
  // computed
  totalQty     : number;
  totalSales   : number;
  totalCost    : number;
  avgMonthlyQty: number;
  ageDate      : Date | null;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────
const pn  = (v: unknown): number => { const n = parseFloat(String(v ?? "0")); return isNaN(n) ? 0 : n; };
const r2  = (n: number): number   => Math.round((n + Number.EPSILON) * 100) / 100;
const r4  = (n: number): number   => Math.round((n + Number.EPSILON) * 10000) / 10000;

function colLetter(n: number): string {
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}
function toUtcDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(d: Date, n: number): Date { return new Date(d.getTime() + n * 86_400_000); }
function dateStr(d: Date): string { return d.toISOString().slice(0, 10); }
function fmtDate(s: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [, m, dd] = s.split("-").map(Number);
  return `${dd}-${months[m-1]}`;
}

// ── Style constants ───────────────────────────────────────────────────────────
const DARK_BLUE   = "FF1F3864";
const MID_BLUE    = "FF2F5597";
const ORANGE_HDR  = "FFFF9900";
const GREEN_HDR   = "FF70AD47";
const YELLOW_GRP  = "FFFFFF2C";  // group column
const PURPLE_QTY  = "FFD9D2FF";  // qty columns
const BRIGHT_YLW  = "FFFFD966";  // sale price columns
const OPEN_BLUE   = "FFDAE8F5";  // opening stock columns
const CLOSE_GRN   = "FFD5E8D4";  // closing stock columns
const TOTALS_ORG  = "FFFFBF00";  // totals row
const ALT_ROW     = "FFF8F8F8";
const WHITE       = "FFFFFFFF";

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
function wFont(sz = 10): Partial<ExcelJS.Font> { return { color: { argb: WHITE }, bold: true, size: sz }; }
const boldSm: Partial<ExcelJS.Font> = { bold: true, size: 9 };
const normSm: Partial<ExcelJS.Font> = { size: 9 };
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  left:   { style: "thin", color: { argb: "FFD0D0D0" } },
  right:  { style: "thin", color: { argb: "FFD0D0D0" } },
};
const ctr: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" };
const right: Partial<ExcelJS.Alignment> = { horizontal: "right", vertical: "middle" };
const NUM = "#,##0.00";
const NUM4 = "#,##0.0000";

// ── Data fetch functions ──────────────────────────────────────────────────────

async function fetchInventory(
  companyId: number,
  locationId: number | undefined,
  asOfDate: string
): Promise<Map<number, InvEntry>> {
  const result = new Map<number, InvEntry>();

  let locationIds: number[];
  if (locationId) {
    locationIds = [locationId];
  } else {
    const res = await db.execute(sql`SELECT id FROM locations WHERE company_id = ${companyId} AND deleted_at IS NULL`);
    locationIds = ((res as any).rows ?? (res as any[])).map((r: any) => Number(r.id));
  }

  await Promise.all(locationIds.map(async (locId) => {
    const rows = await calculateHistoricalLocationInventory(locId, companyId, asOfDate);
    for (const row of rows) {
      const qty = pn(row.quantity), val = pn(row.totalValue), rate = pn(row.averageRate);
      const ex = result.get(row.stockItemId);
      if (!ex) {
        result.set(row.stockItemId, {
          stockItemId: row.stockItemId,
          stockItemCode: row.stockItemCode ?? "",
          stockItemName: row.stockItemName ?? "",
          stockGroupName: row.stockGroupName ?? "",
          stockItemUom: row.stockItemUom ?? "",
          quantity: qty, averageRate: rate, totalValue: val,
        });
      } else {
        const newQty = ex.quantity + qty, newVal = ex.totalValue + val;
        ex.quantity = newQty; ex.totalValue = newVal;
        ex.averageRate = newQty > 0 ? newVal / newQty : 0;
        if (!ex.stockGroupName && row.stockGroupName) ex.stockGroupName = row.stockGroupName;
      }
    }
  }));

  return result;
}

async function fetchSalesData(
  companyId: number,
  locationId: number | undefined,
  fromDate: string,
  toDate: string
): Promise<Array<{ stockItemId: number; itemCode: string; itemName: string; groupName: string; uom: string; saleDate: string; qty: number; totalSales: number; totalCost: number }>> {
  const locFilter = locationId ? sql` AND v.location_id = ${locationId}` : sql``;
  const res = await db.execute(sql`
    SELECT
      si.stock_item_id                                     AS stock_item_id,
      sk.code                                              AS item_code,
      sk.name                                              AS item_name,
      COALESCE(sg.name, '')                                AS group_name,
      COALESCE(sk.uom, '')                                 AS uom,
      v.voucher_date::text                                 AS sale_date,
      SUM(si.quantity)::numeric                            AS qty,
      SUM(si.total_sales)::numeric                         AS total_sales,
      SUM(si.total_cost)::numeric                          AS total_cost
    FROM  sales_items  si
    JOIN  vouchers     v  ON v.id  = si.voucher_id
    JOIN  stock_items  sk ON sk.id = si.stock_item_id
    LEFT  JOIN stock_groups sg ON sg.id = sk.stock_group_id
    WHERE v.company_id   = ${companyId}
      AND v.optional     = false
      AND v.voucher_date BETWEEN ${fromDate}::date AND ${toDate}::date
      ${locFilter}
    GROUP BY si.stock_item_id, sk.code, sk.name, COALESCE(sg.name,''), COALESCE(sk.uom,''), v.voucher_date
    ORDER BY COALESCE(sg.name,''), sk.name, v.voucher_date
  `);
  const rows = (res as any).rows ?? (res as any[]);
  return rows.map((r: any) => ({
    stockItemId: Number(r.stock_item_id),
    itemCode:    String(r.item_code ?? ""),
    itemName:    String(r.item_name ?? ""),
    groupName:   String(r.group_name ?? ""),
    uom:         String(r.uom ?? ""),
    saleDate:    String(r.sale_date),
    qty:         pn(r.qty),
    totalSales:  pn(r.total_sales),
    totalCost:   pn(r.total_cost),
  }));
}

async function fetchAgeingDates(
  companyId: number,
  locationId: number | undefined
): Promise<Map<number, Date>> {
  // Ageing = days since earliest container offload for each stock item.
  // Best available date — exact lot tracking not implemented; see spec note.
  const locFilter = locationId ? sql` AND co.location_id = ${locationId}` : sql``;
  const res = await db.execute(sql`
    SELECT coi.stock_item_id, MIN(co.offloaded_at) AS earliest_date
    FROM   container_offload_items coi
    JOIN   container_offloads      co ON co.id = coi.offload_id
    JOIN   containers              c  ON c.id  = co.container_id
    WHERE  c.company_id = ${companyId}
      ${locFilter}
    GROUP  BY coi.stock_item_id
  `);
  const rows = (res as any).rows ?? (res as any[]);
  const map = new Map<number, Date>();
  for (const r of rows) {
    if (r.earliest_date) map.set(Number(r.stock_item_id), new Date(r.earliest_date));
  }
  return map;
}

// ── Build item registry ───────────────────────────────────────────────────────
function buildItemRegistry(
  openMap: Map<number, InvEntry>,
  closeMap: Map<number, InvEntry>,
  salesRows: ReturnType<typeof fetchSalesData> extends Promise<infer T> ? T : never,
  ageMap: Map<number, Date>,
  dayCount: number
): ItemRow[] {
  const registry = new Map<number, ItemRow>();

  function ensure(id: number, code: string, name: string, group: string, uom: string): ItemRow {
    if (!registry.has(id)) {
      registry.set(id, {
        stockItemId: id, itemCode: code, itemName: name, groupName: group, itemUom: uom,
        openQty: 0, openRate: 0, openValue: 0,
        salesByDate: new Map(),
        closeQty: 0, closeRate: 0, closeValue: 0,
        totalQty: 0, totalSales: 0, totalCost: 0, avgMonthlyQty: 0,
        ageDate: null,
      });
    }
    const row = registry.get(id)!;
    if (!row.itemCode && code) row.itemCode = code;
    if (!row.itemName && name) row.itemName = name;
    if (!row.groupName && group) row.groupName = group;
    return row;
  }

  for (const [id, inv] of openMap) {
    const row = ensure(id, inv.stockItemCode, inv.stockItemName, inv.stockGroupName, inv.stockItemUom);
    row.openQty = inv.quantity; row.openRate = inv.averageRate; row.openValue = inv.totalValue;
  }
  for (const [id, inv] of closeMap) {
    const row = ensure(id, inv.stockItemCode, inv.stockItemName, inv.stockGroupName, inv.stockItemUom);
    row.closeQty = inv.quantity; row.closeRate = inv.averageRate; row.closeValue = inv.totalValue;
    if (!row.openRate && inv.averageRate) row.openRate = inv.averageRate;
  }
  for (const sale of salesRows) {
    const row = ensure(sale.stockItemId, sale.itemCode, sale.itemName, sale.groupName, sale.uom);
    const ex = row.salesByDate.get(sale.saleDate) ?? { qty: 0, totalSales: 0, totalCost: 0 };
    ex.qty += sale.qty; ex.totalSales += sale.totalSales; ex.totalCost += sale.totalCost;
    row.salesByDate.set(sale.saleDate, ex);
  }

  // Compute totals + set ageing + avgMonthly
  for (const [id, row] of registry) {
    for (const ds of row.salesByDate.values()) {
      row.totalQty   += ds.qty;
      row.totalSales += ds.totalSales;
      row.totalCost  += ds.totalCost;
    }
    row.avgMonthlyQty = dayCount > 0 ? (row.totalQty / dayCount) * 30 : 0;
    row.ageDate = ageMap.get(id) ?? null;
    // If openRate is still 0 but closeRate is set, use closeRate as cost basis
    if (!row.openRate && row.closeRate) row.openRate = row.closeRate;
  }

  // Sort by group, then item name
  return Array.from(registry.values()).sort((a, b) => {
    const gCmp = (a.groupName || "~").localeCompare(b.groupName || "~");
    return gCmp !== 0 ? gCmp : a.itemName.localeCompare(b.itemName);
  });
}

// ── Sheet builders ────────────────────────────────────────────────────────────

const FIXED_LEFT   = 6;  // A=RowNum, B=Group, C=Name, D=Code, E=OpenQty, F=Cost/Bag
const COLS_PER_DAY = 3;  // Qty, SalePrice, Profit/Bag
const AFTER_DATES  = 3;  // CloseQty, CloseVal, AvgMonthlySales

function buildCostingSheet(wb: ExcelJS.Workbook, items: ItemRow[]): void {
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

function buildSalesSheet(wb: ExcelJS.Workbook, items: ItemRow[], dates: string[]): void {
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

function buildEntrySheet(
  wb: ExcelJS.Workbook,
  items: ItemRow[],
  dates: string[],
  dayCount: number,
  params: SpSalesFormV2Params
): void {
  const ws = wb.addWorksheet("ENTRY");
  const totalCols = FIXED_LEFT + dayCount * COLS_PER_DAY + AFTER_DATES;

  // ── Print settings ──────────────────────────────────────────────────────────
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.fitToPage   = true;
  ws.pageSetup.fitToWidth  = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.pageSetup.printTitlesRow = "1:3";
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };

  // ── Frozen panes: top 3 rows + first 4 columns ──────────────────────────────
  ws.views = [{ state: "frozen", xSplit: 4, ySplit: 3, activeCell: "E4" }];

  // ── Auto-filter on header row 3 ─────────────────────────────────────────────
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: totalCols } };

  // ── Column widths ───────────────────────────────────────────────────────────
  ws.getColumn(1).width = 6;   // A: Row#
  ws.getColumn(2).width = 18;  // B: Group
  ws.getColumn(3).width = 28;  // C: Item Name
  ws.getColumn(4).width = 14;  // D: Code
  ws.getColumn(5).width = 10;  // E: Opening Stock
  ws.getColumn(6).width = 10;  // F: Cost/Bag
  for (let d = 0; d < dayCount; d++) {
    const b = FIXED_LEFT + 1 + d * COLS_PER_DAY;
    ws.getColumn(b).width = 8;    // Qty
    ws.getColumn(b+1).width = 9;  // Sale Price
    ws.getColumn(b+2).width = 9;  // Profit/Bag
  }
  const closeQtyCol = FIXED_LEFT + 1 + dayCount * COLS_PER_DAY;
  ws.getColumn(closeQtyCol).width   = 11;
  ws.getColumn(closeQtyCol+1).width = 12;
  ws.getColumn(closeQtyCol+2).width = 14;

  // ════════ Row 1 — Title ════════════════════════════════════════════════════
  ws.mergeCells(1, 1, 1, Math.min(totalCols, 30));
  const titleCell = ws.getCell(1, 1);
  const loc = params.locationName || "All Locations";
  const sup = params.supplierName || "";
  titleCell.value = `${sup}${sup ? " — " : ""}Sales Form  |  ${loc}  |  ${params.fromDate} to ${params.toDate}`;
  titleCell.font      = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill      = fill(DARK_BLUE);
  titleCell.font      = { ...wFont(12) };
  ws.getRow(1).height = 24;

  // ════════ Row 2 — Group headers ════════════════════════════════════════════
  ws.getRow(2).height = 15;

  // A–D: Item info
  ws.mergeCells(2, 1, 2, 4);
  applyCell(ws, 2, 1, "Item", fill(DARK_BLUE), wFont(), ctr);

  // E–F: Opening Stock
  ws.mergeCells(2, 5, 2, 6);
  applyCell(ws, 2, 5, "Opening Stock", fill(OPEN_BLUE), boldSm, ctr);

  // Daily blocks: alternating green/orange headers
  for (let d = 0; d < dayCount; d++) {
    const b = FIXED_LEFT + 1 + d * COLS_PER_DAY;
    ws.mergeCells(2, b, 2, b + 2);
    const hfill = d % 2 === 0 ? fill(GREEN_HDR) : fill(ORANGE_HDR);
    applyCell(ws, 2, b, fmtDate(dates[d]), hfill, wFont(9), ctr);
  }

  // Closing
  ws.mergeCells(2, closeQtyCol, 2, closeQtyCol + 1);
  applyCell(ws, 2, closeQtyCol, "Closing Stock", fill(CLOSE_GRN), boldSm, ctr);

  // Avg Monthly
  applyCell(ws, 2, closeQtyCol + 2, "Avg/Mo", fill(TOTALS_ORG), boldSm, ctr);

  // ════════ Row 3 — Column sub-headers ═══════════════════════════════════════
  ws.getRow(3).height = 14;
  const hdr3: Array<{ col: number; label: string; f?: ExcelJS.Fill }> = [
    { col: 1, label: "#",             f: fill(DARK_BLUE) },
    { col: 2, label: "Group",         f: fill(YELLOW_GRP) },
    { col: 3, label: "Item Name",     f: fill(DARK_BLUE) },
    { col: 4, label: "Item Code",     f: fill(DARK_BLUE) },
    { col: 5, label: "Open Qty",      f: fill(OPEN_BLUE) },
    { col: 6, label: "Cost / Bag",    f: fill(OPEN_BLUE) },
  ];
  for (let d = 0; d < dayCount; d++) {
    const b = FIXED_LEFT + 1 + d * COLS_PER_DAY;
    const df = d % 2 === 0 ? fill(GREEN_HDR) : fill(ORANGE_HDR);
    hdr3.push({ col: b,   label: "Qty",        f: fill(PURPLE_QTY) });
    hdr3.push({ col: b+1, label: "Sale Price",  f: fill(BRIGHT_YLW) });
    hdr3.push({ col: b+2, label: "Profit/Bag",  f: df });
  }
  hdr3.push({ col: closeQtyCol,   label: "Close Qty",      f: fill(CLOSE_GRN) });
  hdr3.push({ col: closeQtyCol+1, label: "Close Value",     f: fill(CLOSE_GRN) });
  hdr3.push({ col: closeQtyCol+2, label: "Avg Mo. Sales",   f: fill(TOTALS_ORG) });

  for (const h of hdr3) {
    const c = ws.getCell(3, h.col);
    c.value     = h.label;
    c.font      = [1,3,4].includes(h.col) ? wFont(9) : boldSm;
    c.alignment = ctr;
    c.border    = thin;
    if (h.f) c.fill = h.f;
  }

  // ════════ Data rows ════════════════════════════════════════════════════════
  items.forEach((item, idx) => {
    const r = 4 + idx;
    const altFill = idx % 2 === 1 ? fill(ALT_ROW) : undefined;
    ws.getRow(r).height = 14;

    // Fixed left columns
    setCellVal(ws, r, 1, idx + 1, boldSm, altFill ?? fill(WHITE), right);
    setCellVal(ws, r, 2, item.groupName || "", boldSm, altFill ?? fill(YELLOW_GRP), { horizontal: "left", vertical: "middle" });
    setCellVal(ws, r, 3, item.itemName, normSm, altFill, { horizontal: "left", vertical: "middle" });
    setCellVal(ws, r, 4, item.itemCode, normSm, altFill, { horizontal: "left", vertical: "middle" });
    setCellNum(ws, r, 5, r2(item.openQty)  || null, altFill ?? fill(OPEN_BLUE), NUM);
    setCellNum(ws, r, 6, r4(item.openRate) || null, altFill ?? fill(OPEN_BLUE), NUM4);

    // Daily blocks
    for (let d = 0; d < dayCount; d++) {
      const b  = FIXED_LEFT + 1 + d * COLS_PER_DAY;
      const ds = item.salesByDate.get(dates[d]);
      const qtyVal   = ds && ds.qty > 0 ? r2(ds.qty) : null;
      const priceVal = ds && ds.qty > 0 ? r4(ds.totalSales / ds.qty) : null;
      const profitVal= ds && ds.qty > 0 ? r4((ds.totalSales - ds.totalCost) / ds.qty) : null;

      const qFill = altFill ?? fill(PURPLE_QTY);
      const pFill = altFill ?? fill(BRIGHT_YLW);
      const prFill= altFill;  // Profit/Bag = white (no fill)

      setCellNum(ws, r, b,   qtyVal,   qFill,  NUM);
      setCellNum(ws, r, b+1, priceVal, pFill,  NUM4);

      // Profit/Bag as formula =IF(OR(QtyCell="",PriceCell=""),"",PriceCell-$F{r})
      const qL = colLetter(b), pL = colLetter(b+1);
      const profCell = ws.getCell(r, b+2);
      profCell.value      = { formula: `IF(OR(${qL}${r}="",${pL}${r}=""),"",${pL}${r}-$F${r})`, result: profitVal ?? "" } as any;
      profCell.numFmt     = NUM4;
      profCell.font       = normSm;
      profCell.alignment  = right;
      profCell.border     = thin;
      if (prFill) profCell.fill = prFill;
    }

    // Closing Stock (backend-calculated, no formula since other movements exist)
    setCellNum(ws, r, closeQtyCol,   r2(item.closeQty)   || null, altFill ?? fill(CLOSE_GRN), NUM);
    setCellNum(ws, r, closeQtyCol+1, r2(item.closeValue)  || null, altFill ?? fill(CLOSE_GRN), NUM);
    setCellNum(ws, r, closeQtyCol+2, r2(item.avgMonthlyQty) || null, altFill ?? fill(TOTALS_ORG), NUM);
  });

  // ════════ Totals footer row ════════════════════════════════════════════════
  if (items.length > 0) {
    const footR = 4 + items.length;
    ws.getRow(footR).height = 15;

    // Label
    const lc = ws.getCell(footR, 1);
    lc.value     = "TOTAL";
    lc.font      = wFont();
    lc.fill      = fill(DARK_BLUE);
    lc.alignment = ctr;

    for (let col = 2; col <= totalCols; col++) {
      const c = ws.getCell(footR, col);
      c.fill = fill(TOTALS_ORG); c.font = boldSm; c.border = thin;
      c.alignment = right; c.numFmt = NUM;
    }
    // Opening Qty sum
    const eL = colLetter(5);
    ws.getCell(footR, 5).value = { formula: `SUM(${eL}4:${eL}${footR-1})`, result: r2(items.reduce((s, i) => s + i.openQty, 0)) } as any;

    // Per-day qty sums
    for (let d = 0; d < dayCount; d++) {
      const qCol = FIXED_LEFT + 1 + d * COLS_PER_DAY;
      const ql = colLetter(qCol);
      ws.getCell(footR, qCol).value = {
        formula: `SUM(${ql}4:${ql}${footR-1})`,
        result: r2(items.reduce((s, i) => s + (i.salesByDate.get(dates[d])?.qty ?? 0), 0)),
      } as any;
    }

    // Closing sums
    const cqL = colLetter(closeQtyCol), cvL = colLetter(closeQtyCol+1);
    ws.getCell(footR, closeQtyCol).value   = { formula: `SUM(${cqL}4:${cqL}${footR-1})`, result: r2(items.reduce((s,i) => s + i.closeQty, 0)) } as any;
    ws.getCell(footR, closeQtyCol+1).value = { formula: `SUM(${cvL}4:${cvL}${footR-1})`, result: r2(items.reduce((s,i) => s + i.closeValue, 0)) } as any;
  }
}

function buildSummarySheet(
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

function buildAgeingSheet(
  wb: ExcelJS.Workbook,
  items: ItemRow[],
  toDate: string
): void {
  const ws = wb.addWorksheet("Ageing");
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2 }];
  ws.columns = [
    { header: "Group",     key: "grp",   width: 18 },
    { header: "Code",      key: "code",  width: 14 },
    { header: "Item Name", key: "name",  width: 28 },
    { header: "Close Qty", key: "cqty",  width: 11 },
    { header: "Close Val", key: "cval",  width: 13 },
    { header: "0–30 d",    key: "b030",  width: 10 },
    { header: "31–60 d",   key: "b3160", width: 10 },
    { header: "61–90 d",   key: "b6190", width: 10 },
    { header: "91–120 d",  key: "b91",   width: 10 },
    { header: "121+ d",    key: "b121",  width: 10 },
  ];

  ws.mergeCells("A1:J1");
  applyCell(ws, 1, 1, `Stock Ageing — as of ${toDate}  (based on earliest offload date per item)`, fill(DARK_BLUE), wFont(), ctr);
  ws.getRow(1).height = 18;

  ws.getRow(2).eachCell(c => { c.fill = fill(MID_BLUE); c.font = wFont(9); c.alignment = ctr; c.border = thin; });
  ws.getRow(2).height = 14;

  const toDateD = toUtcDate(toDate);
  items.forEach((item, i) => {
    if (item.closeQty <= 0 && !item.ageDate) return;
    const r = i + 3;
    const days = item.ageDate ? Math.floor((toDateD.getTime() - item.ageDate.getTime()) / 86_400_000) : 9999;
    const buckets = [0, 0, 0, 0, 0];
    const cq = r2(item.closeQty);
    if      (days <= 30)  buckets[0] = cq;
    else if (days <= 60)  buckets[1] = cq;
    else if (days <= 90)  buckets[2] = cq;
    else if (days <= 120) buckets[3] = cq;
    else                  buckets[4] = cq;

    const row = ws.getRow(r);
    row.values = [item.groupName, item.itemCode, item.itemName,
      cq||null, r2(item.closeValue)||null,
      buckets[0]||null, buckets[1]||null, buckets[2]||null, buckets[3]||null, buckets[4]||null];
    if (i % 2 === 1) row.eachCell(c => { c.fill = fill(ALT_ROW); });
    [4,5,6,7,8,9,10].forEach(c => { ws.getCell(r,c).numFmt = NUM; ws.getCell(r,c).alignment = right; });
    row.height = 13;
  });
}

function buildSummaryItemwiseSheet(
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

// ── Cell helpers ──────────────────────────────────────────────────────────────
function applyCell(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: unknown,
  f?: ExcelJS.Fill,
  font?: Partial<ExcelJS.Font>,
  align?: Partial<ExcelJS.Alignment>
): void {
  const c = ws.getCell(row, col);
  c.value     = value as ExcelJS.CellValue;
  if (f)     c.fill      = f;
  if (font)  c.font      = font;
  if (align) c.alignment = align;
  c.border    = thin;
}

function setCellVal(
  ws: ExcelJS.Worksheet,
  row: number, col: number,
  value: unknown,
  font?: Partial<ExcelJS.Font>,
  f?: ExcelJS.Fill,
  align?: Partial<ExcelJS.Alignment>
): void {
  const c = ws.getCell(row, col);
  c.value     = value as ExcelJS.CellValue;
  if (font)  c.font      = font;
  if (f)     c.fill      = f;
  if (align) c.alignment = align;
  c.border    = thin;
}

function setCellNum(
  ws: ExcelJS.Worksheet,
  row: number, col: number,
  value: number | null,
  f?: ExcelJS.Fill,
  numFmt = NUM
): void {
  const c = ws.getCell(row, col);
  c.value     = value;
  c.numFmt    = numFmt;
  c.font      = normSm;
  c.alignment = right;
  c.border    = thin;
  if (f) c.fill = f;
}

// ── Error scanner ─────────────────────────────────────────────────────────────
const EXCEL_ERRORS = ["#REF!","#DIV/0!","#VALUE!","#NAME?","#N/A"];

function scanErrors(wb: ExcelJS.Workbook): Array<{ sheet: string; cell: string; value: string }> {
  const found: Array<{ sheet: string; cell: string; value: string }> = [];
  for (const ws of wb.worksheets) {
    if ((ws as any).state === "hidden" || (ws as any).state === "veryHidden") continue;
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        let check = "";
        const v = cell.value;
        if (typeof v === "string") check = v;
        else if (v && typeof v === "object" && "result" in v) check = String((v as any).result ?? "");
        if (EXCEL_ERRORS.some(e => check.includes(e))) {
          found.push({ sheet: ws.name, cell: cell.address, value: check });
        }
      });
    });
  }
  return found;
}

// ── Main export function ──────────────────────────────────────────────────────
export async function generateSpSalesFormExcelV2(params: SpSalesFormV2Params): Promise<Buffer> {
  const { companyId, locationId, fromDate, toDate } = params;

  console.log(`[spSalesFormExportV2] start companyId=${companyId} locationId=${locationId ?? "all"} ${fromDate}→${toDate}`);

  // Build date list
  const startDate = toUtcDate(fromDate);
  const endDate   = toUtcDate(toDate);
  const dayCount  = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
  const dates     = Array.from({ length: dayCount }, (_, i) => dateStr(addDays(startDate, i)));
  const dayBefore = dateStr(addDays(startDate, -1));

  // Fetch all data in parallel
  const [openMap, closeMap, salesRows, ageMap] = await Promise.all([
    fetchInventory(companyId, locationId, dayBefore),
    fetchInventory(companyId, locationId, toDate),
    fetchSalesData(companyId, locationId, fromDate, toDate),
    fetchAgeingDates(companyId, locationId),
  ]);

  console.log(`[spSalesFormExportV2] openItems=${openMap.size} closeItems=${closeMap.size} saleRows=${salesRows.length} dayCount=${dayCount}`);

  // Build item registry
  const items = buildItemRegistry(openMap, closeMap, salesRows, ageMap, dayCount);

  console.log(`[spSalesFormExportV2] totalItems=${items.length}`);

  // Build workbook (sheet order per spec)
  const wb = new ExcelJS.Workbook();
  wb.creator  = "System SP Export V2";
  wb.created  = new Date();
  wb.modified = new Date();

  buildCostingSheet(wb, items);          // 1. Costing — hidden
  buildSalesSheet(wb, items, dates);     // 2. Sales — hidden
  buildEntrySheet(wb, items, dates, dayCount, params);  // 3. ENTRY — visible
  buildSummarySheet(wb, items, dates, params);           // 4. Summary — visible
  buildAgeingSheet(wb, items, toDate);                   // 5. Ageing — visible
  buildSummaryItemwiseSheet(wb, items, dayCount);        // 6. Summary-Itemwise — hidden

  // Error scan — fail fast on visible-sheet errors
  const errors = scanErrors(wb);
  if (errors.length > 0) {
    const detail = errors.map(e => `${e.sheet}!${e.cell}: ${e.value}`).join(", ");
    console.error(`[spSalesFormExportV2] Excel errors found: ${detail}`);
    throw new Error(`Excel formula errors detected in export: ${detail}`);
  }

  const buf = await wb.xlsx.writeBuffer();
  console.log(`[spSalesFormExportV2] done bufferSize=${buf.byteLength}`);
  return Buffer.from(buf);
}
