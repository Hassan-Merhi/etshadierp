/**
 * SP Sales Form Export — V2 (from-scratch ExcelJS, no template)
 *
 * Data sources:
 *   Opening stock : calculateHistoricalLocationInventory(locationId, companyId, dayBefore(fromDate))
 *   Closing stock : calculateHistoricalLocationInventory(locationId, companyId, toDate)
 *   Daily sales   : sales_items + vouchers (ERP POS) — same tables the inventory helper reverses,
 *                   guaranteeing opening − sales + offloads ≈ closing
 *   Opening cash  : voucher_entries SUM(debit-credit) as of dayBefore(fromDate) for cashAccountId
 *
 * Sheet order (5 sheets — Ageing removed in V2):
 *   1. Costing         — hidden
 *   2. Sales           — hidden
 *   3. ENTRY           — visible  ← main page
 *   4. Summary         — visible
 *   5. Summary-Itemwise— hidden
 */

import ExcelJS from "exceljs";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { calculateHistoricalLocationInventory } from "../routes/helpers/inventoryHistoryHelpers";

// ── Public interface ──────────────────────────────────────────────────────────
export interface SpSalesFormV2Params {
  companyId: number;
  locationId?: number;
  fromDate: string;      // YYYY-MM-DD
  toDate: string;        // YYYY-MM-DD
  locationName?: string;
  supplierName?: string;
  cashAccountId?: number; // optional: opening cash from ledger as-of dayBefore(fromDate)
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
const YELLOW_GRP  = "FFFFFF2C";  // group column / subtotal rows
const PURPLE_QTY  = "FFD9D2FF";  // qty columns
const BRIGHT_YLW  = "FFFFD966";  // sale price columns
const OPEN_BLUE   = "FFDAE8F5";  // opening stock columns
const CLOSE_GRN   = "FFD5E8D4";  // closing stock columns
const TOTALS_ORG  = "FFFFBF00";  // avg monthly
const ALT_ROW     = "FFF8F8F8";
const WHITE       = "FFFFFFFF";
const CASH_PINK   = "FFFFD9FF";  // CASH sub-header
const BANK_GRN    = "FFD9FFD9";  // BANK sub-header

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
const leftAl: Partial<ExcelJS.Alignment> = { horizontal: "left", vertical: "middle" };
const NUM = "#,##0.00";            // kept for Costing / Summary sheets
const NUM4 = "#,##0.0000";         // kept for Costing / Summary sheets
const QTY_FMT   = "#,##0";        // ENTRY — quantities, whole units only
const MONEY_FMT  = '"$"#,##0';    // ENTRY — monetary values, whole dollars (no .00)
const MONEY4_FMT = '"$"#,##0.0000'; // NOT used in ENTRY; reserved for hidden sheets

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
      AND v.deleted_at   IS NULL
      AND v.voucher_type = 'Sales'
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

// ── Cash account opening balance ─────────────────────────────────────────────
async function fetchCashAccountBalance(
  accountId: number,
  companyId: number,
  asOfDate: string
): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(ve.debit_amount - ve.credit_amount), 0) AS balance
    FROM   voucher_entries ve
    JOIN   vouchers        v  ON v.id = ve.voucher_id
    WHERE  ve.account_id = ${accountId}
      AND  v.company_id  = ${companyId}
      AND  v.voucher_date <= ${asOfDate}::date
      AND  v.deleted_at  IS NULL
  `);
  const rows = (res as any).rows ?? (res as any[]);
  return pn(rows[0]?.balance ?? 0);
}

// ── Build item registry ───────────────────────────────────────────────────────
function buildItemRegistry(
  openMap: Map<number, InvEntry>,
  closeMap: Map<number, InvEntry>,
  salesRows: ReturnType<typeof fetchSalesData> extends Promise<infer T> ? T : never,
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

  // Compute totals + avgMonthly
  for (const [, row] of registry) {
    for (const ds of row.salesByDate.values()) {
      row.totalQty   += ds.qty;
      row.totalSales += ds.totalSales;
      row.totalCost  += ds.totalCost;
    }
    row.avgMonthlyQty = dayCount > 0 ? (row.totalQty / dayCount) * 30 : 0;
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

const FIXED_LEFT   = 5;  // A=RowNum, B=Name, C=Code, D=OpenQty, E=Cost/Bag
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

async function buildEntrySheet(
  wb: ExcelJS.Workbook,
  items: ItemRow[],
  dates: string[],
  dayCount: number,
  params: SpSalesFormV2Params,
  openingCashBalance: number | null   // null = no account selected (manual input on day 0)
): Promise<void> {
  const ws = wb.addWorksheet("ENTRY");
  // FIXED_LEFT = 5: A=RowNum, B=ItemName, C=Code, D=OpenQty, E=Cost/Bag
  const dayBase    = FIXED_LEFT + 1;   // = 6 — first Qty column for day 0
  const totalCols  = FIXED_LEFT + dayCount * COLS_PER_DAY + AFTER_DATES;
  const closeQtyCol = dayBase + dayCount * COLS_PER_DAY;

  // ── Print / freeze / filter ──────────────────────────────────────────────────
  ws.pageSetup.orientation    = "landscape";
  ws.pageSetup.fitToPage      = true;
  ws.pageSetup.fitToWidth     = 1;
  ws.pageSetup.fitToHeight    = 0;
  ws.pageSetup.printTitlesRow = "1:3";
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  ws.views     = [{ state: "frozen", xSplit: 3, ySplit: 3, activeCell: "F4" }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: totalCols } };

  // ── Column widths ────────────────────────────────────────────────────────────
  ws.getColumn(1).width = 6;   // A: Row#
  ws.getColumn(2).width = 28;  // B: Item Name
  ws.getColumn(3).width = 14;  // C: Item Code
  ws.getColumn(4).width = 10;  // D: Open Qty
  ws.getColumn(5).width = 10;  // E: Cost/Bag
  for (let d = 0; d < dayCount; d++) {
    const b = dayBase + d * COLS_PER_DAY;
    ws.getColumn(b).width   = 8;   // Qty
    ws.getColumn(b+1).width = 9;   // Sale Price
    ws.getColumn(b+2).width = 9;   // Profit/Bag
  }
  ws.getColumn(closeQtyCol).width   = 11;
  ws.getColumn(closeQtyCol+1).width = 12;
  ws.getColumn(closeQtyCol+2).width = 14;

  // ── Group items (preserve sort order from buildItemRegistry) ─────────────────
  const groupOrderedNames: string[] = [];
  const groupedItems = new Map<string, ItemRow[]>();
  for (const item of items) {
    const g = item.groupName || "(Ungrouped)";
    if (!groupedItems.has(g)) { groupedItems.set(g, []); groupOrderedNames.push(g); }
    groupedItems.get(g)!.push(item);
  }

  // ── Pre-compute row layout ───────────────────────────────────────────────────
  interface GroupBound {
    groupName: string; items: ItemRow[];
    firstRow: number; lastRow: number; subtotalRow: number;
  }
  const groupBounds: GroupBound[] = [];
  const subtotalRowNums: number[] = [];
  let nextRow = 4;

  for (const gName of groupOrderedNames) {
    const gItems = groupedItems.get(gName)!;
    const firstRow = nextRow;
    nextRow += gItems.length;
    const lastRow      = nextRow - 1;
    const subtotalRow  = nextRow;
    subtotalRowNums.push(subtotalRow);
    groupBounds.push({ groupName: gName, items: gItems, firstRow, lastRow, subtotalRow });
    nextRow++;
  }
  const totalRowNum = nextRow++;

  // Cash / payments layout (2 blank gap after TOTAL)
  const cashHdrRow    = totalRowNum + 2;
  const cashSubHdrRow = cashHdrRow + 1;
  const openCashRow   = cashSubHdrRow + 1;
  const depositRow    = openCashRow + 1;
  const receiptRow    = depositRow + 1;
  const paymentsHdrRow = receiptRow + 2;

  // ════════ Row 1 — Title ════════════════════════════════════════════════════
  ws.mergeCells(1, 1, 1, Math.min(totalCols, 30));
  const titleCell = ws.getCell(1, 1);
  const loc = params.locationName || "All Locations";
  const sup = params.supplierName || "";
  titleCell.value     = `${sup}${sup ? " — " : ""}Sales Form  |  ${loc}  |  ${params.fromDate} to ${params.toDate}`;
  titleCell.fill      = fill(DARK_BLUE);
  titleCell.font      = wFont(12);
  titleCell.alignment = ctr;
  ws.getRow(1).height = 24;

  // ════════ Row 2 — Group headers ════════════════════════════════════════════
  ws.getRow(2).height = 15;
  ws.mergeCells(2, 1, 2, 3);  // A-C: Item (Group column removed)
  applyCell(ws, 2, 1, "Item", fill(DARK_BLUE), wFont(), ctr);
  ws.mergeCells(2, 4, 2, 5);  // D-E: Opening Stock
  applyCell(ws, 2, 4, "Opening Stock", fill(OPEN_BLUE), boldSm, ctr);
  for (let d = 0; d < dayCount; d++) {
    const b = dayBase + d * COLS_PER_DAY;
    ws.mergeCells(2, b, 2, b + 2);
    applyCell(ws, 2, b, fmtDate(dates[d]), d % 2 === 0 ? fill(GREEN_HDR) : fill(ORANGE_HDR), wFont(9), ctr);
  }
  ws.mergeCells(2, closeQtyCol, 2, closeQtyCol + 1);
  applyCell(ws, 2, closeQtyCol, "Closing Stock", fill(CLOSE_GRN), boldSm, ctr);
  applyCell(ws, 2, closeQtyCol + 2, "Avg/Mo", fill(TOTALS_ORG), boldSm, ctr);

  // ════════ Row 3 — Sub-headers ═══════════════════════════════════════════════
  ws.getRow(3).height = 14;
  const hdr3: Array<{ col: number; label: string; f?: ExcelJS.Fill }> = [
    { col: 1, label: "#",           f: fill(DARK_BLUE) },
    { col: 2, label: "Item Name",   f: fill(DARK_BLUE) },  // Group column removed
    { col: 3, label: "Item Code",   f: fill(DARK_BLUE) },
    { col: 4, label: "Open Qty",    f: fill(OPEN_BLUE) },
    { col: 5, label: "Cost / Bag",  f: fill(OPEN_BLUE) },
  ];
  for (let d = 0; d < dayCount; d++) {
    const b  = dayBase + d * COLS_PER_DAY;
    const df = d % 2 === 0 ? fill(GREEN_HDR) : fill(ORANGE_HDR);
    hdr3.push({ col: b,   label: "Qty",       f: fill(PURPLE_QTY) });
    hdr3.push({ col: b+1, label: "Sale Price", f: fill(BRIGHT_YLW) });
    hdr3.push({ col: b+2, label: "Profit/Bag", f: df });
  }
  hdr3.push({ col: closeQtyCol,   label: "Close Qty",    f: fill(CLOSE_GRN) });
  hdr3.push({ col: closeQtyCol+1, label: "Close Value",  f: fill(CLOSE_GRN) });
  hdr3.push({ col: closeQtyCol+2, label: "Avg Mo. Sales",f: fill(TOTALS_ORG) });
  for (const h of hdr3) {
    const c = ws.getCell(3, h.col);
    c.value     = h.label;
    c.font      = [1, 2, 3].includes(h.col) ? wFont(9) : boldSm;
    c.alignment = ctr; c.border = thin;
    if (h.f) c.fill = h.f;
  }

  // ════════ Item rows + group subtotals ═══════════════════════════════════════
  let itemCounter = 0;

  for (const gb of groupBounds) {
    // ── Item rows ──────────────────────────────────────────────────────────────
    gb.items.forEach((item, gIdx) => {
      const r      = gb.firstRow + gIdx;
      const altFl  = itemCounter % 2 === 1 ? fill(ALT_ROW) : undefined;
      itemCounter++;
      ws.getRow(r).height = 14;

      // A: Row number (locked)
      setCellVal(ws, r, 1, itemCounter, boldSm, altFl ?? fill(WHITE), right);
      ws.getCell(r, 1).protection = { locked: true };

      // B: Item Name (locked) — Group column removed
      setCellVal(ws, r, 2, item.itemName, normSm, altFl, leftAl);
      ws.getCell(r, 2).protection = { locked: true };

      // C: Item Code (locked)
      setCellVal(ws, r, 3, item.itemCode, normSm, altFl, leftAl);
      ws.getCell(r, 3).protection = { locked: true };

      // D: Opening Qty (locked, no dollar sign)
      setCellNum(ws, r, 4, item.openQty ? Math.round(item.openQty) : null, altFl ?? fill(OPEN_BLUE), QTY_FMT);
      ws.getCell(r, 4).protection = { locked: true };

      // E: Cost/Bag (locked, dollar sign, whole dollars)
      setCellNum(ws, r, 5, r4(item.openRate) || null, altFl ?? fill(OPEN_BLUE), MONEY_FMT);
      ws.getCell(r, 5).protection = { locked: true };

      // Build list of qty cell addresses for closing-qty and avg formulas
      // Day base = 6, so day-0 Qty = F, day-1 Qty = I, day-2 Qty = L, …
      const qtyCellRefs = Array.from({ length: dayCount }, (_, d) => `${colLetter(dayBase + d * COLS_PER_DAY)}${r}`);

      // Daily blocks
      for (let d = 0; d < dayCount; d++) {
        const b  = dayBase + d * COLS_PER_DAY;
        const ds = item.salesByDate.get(dates[d]);
        const qtyVal    = ds && ds.qty > 0 ? Math.round(ds.qty)                            : null;
        const priceVal  = ds && ds.qty > 0 ? r4(ds.totalSales / ds.qty)                  : null;
        const profitVal = ds && ds.qty > 0 ? r4((ds.totalSales - ds.totalCost) / ds.qty) : null;
        const qL = colLetter(b), pL = colLetter(b + 1);

        // Qty — UNLOCKED, no $ sign
        const qC = ws.getCell(r, b);
        qC.value = qtyVal; qC.numFmt = QTY_FMT; qC.font = normSm;
        qC.alignment = right; qC.border = thin; qC.fill = fill(PURPLE_QTY);
        qC.protection = { locked: false };

        // Sale Price — UNLOCKED, $ sign, whole dollars
        const pC = ws.getCell(r, b + 1);
        pC.value = priceVal; pC.numFmt = MONEY_FMT; pC.font = normSm;
        pC.alignment = right; pC.border = thin; pC.fill = fill(BRIGHT_YLW);
        pC.protection = { locked: false };

        // Profit/Bag — formula, locked, $ sign, whole dollars
        // =IF(OR(QtyCell="",PriceCell=""),0,PriceCell-$E{r})  ← returns 0 (not "") so SUMPRODUCT works
        const prC = ws.getCell(r, b + 2);
        prC.value     = { formula: `IF(OR(${qL}${r}="",${pL}${r}=""),0,${pL}${r}-$E${r})`, result: profitVal ?? 0 } as any;
        prC.numFmt    = MONEY_FMT; prC.font = normSm;
        prC.alignment = right; prC.border = thin;
        prC.protection = { locked: true };
      }

      // Closing Qty — formula =D{r}-SUM(qty refs)  ← D = Opening Qty (col 4); can go negative
      const cqC = ws.getCell(r, closeQtyCol);
      cqC.value = { formula: `D${r}-SUM(${qtyCellRefs.join(",")})`, result: Math.round(item.closeQty) } as any;
      cqC.numFmt = QTY_FMT; cqC.font = normSm; cqC.alignment = right; cqC.border = thin;
      cqC.fill = fill(CLOSE_GRN); cqC.protection = { locked: true };

      // Closing Value — formula =CloseQtyCell * $E{r}  ← $E = Cost/Bag (col 5)
      const cvC = ws.getCell(r, closeQtyCol + 1);
      cvC.value = { formula: `${colLetter(closeQtyCol)}${r}*$E${r}`, result: r2(item.closeValue) || 0 } as any;
      cvC.numFmt = MONEY_FMT; cvC.font = normSm; cvC.alignment = right; cvC.border = thin;
      cvC.fill = fill(CLOSE_GRN); cvC.protection = { locked: true };

      // Avg Monthly — live formula so it recalculates when user types daily Qty
      // =ROUND(SUM(all daily Qty cells)*30/dayCount,0) → whole units, auto-recalcs
      const avgC = ws.getCell(r, closeQtyCol + 2);
      avgC.value = {
        formula: `ROUND(SUM(${qtyCellRefs.join(",")})*30/${dayCount},0)`,
        result: Math.round(item.avgMonthlyQty),
      } as any;
      avgC.numFmt = QTY_FMT; avgC.font = normSm; avgC.alignment = right; avgC.border = thin;
      avgC.fill = fill(TOTALS_ORG); avgC.protection = { locked: true };
    });

    // ── Group subtotal row ─────────────────────────────────────────────────────
    const stRow = gb.subtotalRow;
    ws.getRow(stRow).height = 14;

    // Style every cell in the subtotal row first, then merge A-C
    for (let col = 1; col <= totalCols; col++) {
      const c = ws.getCell(stRow, col);
      c.fill = fill(YELLOW_GRP); c.font = boldSm; c.border = thin;
      c.alignment = right; c.protection = { locked: true };
    }
    ws.mergeCells(stRow, 1, stRow, 3);  // A-C (Group column removed)
    const stLabel = ws.getCell(stRow, 1);
    stLabel.value = gb.groupName; stLabel.fill = fill(YELLOW_GRP);
    stLabel.font  = { ...boldSm, color: { argb: "FF333333" } };
    stLabel.alignment = leftAl;

    // Opening Qty sum (col D = 4)
    const dL = colLetter(4);
    ws.getCell(stRow, 4).value = {
      formula: `SUM(${dL}${gb.firstRow}:${dL}${gb.lastRow})`,
      result: Math.round(gb.items.reduce((s, i) => s + i.openQty, 0)),
    } as any;
    ws.getCell(stRow, 4).numFmt = QTY_FMT; ws.getCell(stRow, 4).alignment = right;

    // Per-day group totals:
    //   Qty   = SUM formula (live)
    //   Sales = SUMPRODUCT(qty, salePrice) — no IF(ISNUMBER); blank qty cells treated as 0 by Excel
    //   Profit = SUMPRODUCT(qty, profitBag) — profitBag col returns 0 (not "") for no-sale days
    for (let d = 0; d < dayCount; d++) {
      const b   = dayBase + d * COLS_PER_DAY;
      const qL  = colLetter(b), pL = colLetter(b + 1), prL = colLetter(b + 2);
      const qtyTot  = Math.round(gb.items.reduce((s, i) => s + (i.salesByDate.get(dates[d])?.qty        ?? 0), 0));
      const salTot  = r2(gb.items.reduce((s, i) => s + (i.salesByDate.get(dates[d])?.totalSales ?? 0), 0));
      const cstTot  = r2(gb.items.reduce((s, i) => s + (i.salesByDate.get(dates[d])?.totalCost  ?? 0), 0));
      const profTot = r2(salTot - cstTot);

      // Qty — SUM formula (whole units)
      ws.getCell(stRow, b).value = { formula: `SUM(${qL}${gb.firstRow}:${qL}${gb.lastRow})`, result: qtyTot } as any;
      ws.getCell(stRow, b).numFmt = QTY_FMT; ws.getCell(stRow, b).alignment = right;

      // Total Sales — SUMPRODUCT(qtyRange, salePriceRange); blank cells = 0 in Excel
      ws.getCell(stRow, b + 1).value = {
        formula: `SUMPRODUCT(${qL}${gb.firstRow}:${qL}${gb.lastRow},${pL}${gb.firstRow}:${pL}${gb.lastRow})`,
        result: salTot || 0,
      } as any;
      ws.getCell(stRow, b + 1).numFmt = MONEY_FMT; ws.getCell(stRow, b + 1).alignment = right;

      // Total Profit — SUMPRODUCT(qtyRange, profitBagRange); profitBag returns 0 for no-sale days
      ws.getCell(stRow, b + 2).value = {
        formula: `SUMPRODUCT(${qL}${gb.firstRow}:${qL}${gb.lastRow},${prL}${gb.firstRow}:${prL}${gb.lastRow})`,
        result: profTot || 0,
      } as any;
      ws.getCell(stRow, b + 2).numFmt = MONEY_FMT; ws.getCell(stRow, b + 2).alignment = right;
    }

    // Closing Qty/Value sums (close qty can be negative — no clamping)
    const cqL = colLetter(closeQtyCol), cvL = colLetter(closeQtyCol + 1);
    ws.getCell(stRow, closeQtyCol).value = {
      formula: `SUM(${cqL}${gb.firstRow}:${cqL}${gb.lastRow})`,
      result: Math.round(gb.items.reduce((s, i) => s + i.closeQty, 0)),
    } as any;
    ws.getCell(stRow, closeQtyCol).numFmt = QTY_FMT; ws.getCell(stRow, closeQtyCol).alignment = right;

    ws.getCell(stRow, closeQtyCol + 1).value = {
      formula: `SUM(${cvL}${gb.firstRow}:${cvL}${gb.lastRow})`,
      result: r2(gb.items.reduce((s, i) => s + i.closeValue, 0)),
    } as any;
    ws.getCell(stRow, closeQtyCol + 1).numFmt = MONEY_FMT; ws.getCell(stRow, closeQtyCol + 1).alignment = right;
  }

  // ════════ Grand TOTAL row (green) ════════════════════════════════════════════
  ws.getRow(totalRowNum).height = 16;
  for (let col = 1; col <= totalCols; col++) {
    const c = ws.getCell(totalRowNum, col);
    c.fill = fill(GREEN_HDR); c.font = { ...boldSm, color: { argb: WHITE } };
    c.border = thin; c.alignment = right; c.protection = { locked: true };
  }
  ws.mergeCells(totalRowNum, 1, totalRowNum, 3);  // A-C (Group column removed)
  const totLbl = ws.getCell(totalRowNum, 1);
  totLbl.value = "TOTAL"; totLbl.fill = fill(GREEN_HDR);
  totLbl.font  = wFont(); totLbl.alignment = ctr;

  if (items.length > 0) {
    const stNumRefs = (col: number) => subtotalRowNums.map(sr => `${colLetter(col)}${sr}`).join(",");

    // Opening Qty (col D = 4)
    ws.getCell(totalRowNum, 4).value = {
      formula: `SUM(${stNumRefs(4)})`,
      result: Math.round(items.reduce((s, i) => s + i.openQty, 0)),
    } as any;
    ws.getCell(totalRowNum, 4).numFmt = QTY_FMT; ws.getCell(totalRowNum, 4).font = { ...boldSm, color: { argb: WHITE } };

    // Per-day grand totals (SUM of category subtotal rows so they cascade from live formulas)
    for (let d = 0; d < dayCount; d++) {
      const b = dayBase + d * COLS_PER_DAY;
      const qtyTot  = Math.round(items.reduce((s, i) => s + (i.salesByDate.get(dates[d])?.qty        ?? 0), 0));
      const salTot  = r2(items.reduce((s, i) => s + (i.salesByDate.get(dates[d])?.totalSales ?? 0), 0));
      const profTot = r2(items.reduce((s, i) => {
        const ds = i.salesByDate.get(dates[d]);
        return s + ((ds?.totalSales ?? 0) - (ds?.totalCost ?? 0));
      }, 0));

      ws.getCell(totalRowNum, b).value = { formula: `SUM(${stNumRefs(b)})`, result: qtyTot } as any;
      ws.getCell(totalRowNum, b).numFmt = QTY_FMT; ws.getCell(totalRowNum, b).font = { ...boldSm, color: { argb: WHITE } };

      ws.getCell(totalRowNum, b + 1).value = { formula: `SUM(${stNumRefs(b + 1)})`, result: salTot || 0 } as any;
      ws.getCell(totalRowNum, b + 1).numFmt = MONEY_FMT; ws.getCell(totalRowNum, b + 1).font = { ...boldSm, color: { argb: WHITE } };

      ws.getCell(totalRowNum, b + 2).value = { formula: `SUM(${stNumRefs(b + 2)})`, result: profTot || 0 } as any;
      ws.getCell(totalRowNum, b + 2).numFmt = MONEY_FMT; ws.getCell(totalRowNum, b + 2).font = { ...boldSm, color: { argb: WHITE } };
    }

    // Closing totals (can be negative — no clamping)
    ws.getCell(totalRowNum, closeQtyCol).value = { formula: `SUM(${stNumRefs(closeQtyCol)})`, result: Math.round(items.reduce((s, i) => s + i.closeQty, 0)) } as any;
    ws.getCell(totalRowNum, closeQtyCol).numFmt = QTY_FMT; ws.getCell(totalRowNum, closeQtyCol).font = { ...boldSm, color: { argb: WHITE } };

    ws.getCell(totalRowNum, closeQtyCol + 1).value = { formula: `SUM(${stNumRefs(closeQtyCol + 1)})`, result: r2(items.reduce((s, i) => s + i.closeValue, 0)) } as any;
    ws.getCell(totalRowNum, closeQtyCol + 1).numFmt = MONEY_FMT; ws.getCell(totalRowNum, closeQtyCol + 1).font = { ...boldSm, color: { argb: WHITE } };
  }

  // ════════ Cash & Bank section ════════════════════════════════════════════════

  const NUM_PAYMENT_ROWS = 10;
  const payFirst    = paymentsHdrRow + 1;
  const payLast     = paymentsHdrRow + NUM_PAYMENT_ROWS;
  const totalPayRow = payLast + 1;
  const balanceRow  = totalPayRow + 1;

  // Helper: write label cell (A-C merged) for a cash-section row
  const setCashLabel = (row: number, label: string, bgColor: string, textColor?: string) => {
    ws.getRow(row).height = 13;
    ws.mergeCells(row, 1, row, 3);
    const lbl = ws.getCell(row, 1);
    lbl.value      = label;
    lbl.font       = textColor ? { ...boldSm, color: { argb: textColor } } : boldSm;
    lbl.fill       = fill(bgColor);
    lbl.border     = thin;
    lbl.alignment  = leftAl;
    lbl.protection = { locked: true };
  };

  // Section header
  ws.getRow(cashHdrRow).height = 16;
  ws.mergeCells(cashHdrRow, 1, cashHdrRow, totalCols);
  applyCell(ws, cashHdrRow, 1, "CASH & BANK SUMMARY", fill(DARK_BLUE), wFont(), ctr);

  // CASH / BANK sub-headers per day
  ws.getRow(cashSubHdrRow).height = 13;
  ws.mergeCells(cashSubHdrRow, 1, cashSubHdrRow, 3);
  ws.getCell(cashSubHdrRow, 1).border = thin;
  for (let d = 0; d < dayCount; d++) {
    const b = dayBase + d * COLS_PER_DAY;
    const cashC = ws.getCell(cashSubHdrRow, b);
    cashC.value = "CASH"; cashC.fill = fill(CASH_PINK); cashC.font = boldSm;
    cashC.alignment = ctr; cashC.border = thin; cashC.protection = { locked: true };
    const bankC = ws.getCell(cashSubHdrRow, b + 1);
    bankC.value = "BANK"; bankC.fill = fill(BANK_GRN); bankC.font = boldSm;
    bankC.alignment = ctr; bankC.border = thin; bankC.protection = { locked: true };
  }

  // ── Opening Cash row ──────────────────────────────────────────────────────────
  setCashLabel(openCashRow, "Opening Cash", WHITE);
  for (let d = 0; d < dayCount; d++) {
    const b = dayBase + d * COLS_PER_DAY;
    const cashC = ws.getCell(openCashRow, b);
    cashC.numFmt = MONEY_FMT; cashC.fill = fill(CASH_PINK); cashC.border = thin;
    cashC.alignment = right; cashC.font = boldSm;
    const bankC = ws.getCell(openCashRow, b + 1);
    bankC.numFmt = MONEY_FMT; bankC.fill = fill(BANK_GRN); bankC.border = thin;
    bankC.alignment = right; bankC.font = boldSm;
    if (d === 0) {
      // First day: account balance or blank manual input
      cashC.value = openingCashBalance !== null ? openingCashBalance : null;
      cashC.protection = { locked: openingCashBalance !== null };
      bankC.value = null;
      bankC.protection = { locked: false };
    } else {
      // Subsequent days: link to previous day Balance Cash
      const prevCL = colLetter(dayBase + (d - 1) * COLS_PER_DAY);
      const prevBL = colLetter(dayBase + (d - 1) * COLS_PER_DAY + 1);
      cashC.value = { formula: `${prevCL}${balanceRow}`, result: null } as any;
      cashC.protection = { locked: true };
      bankC.value = { formula: `${prevBL}${balanceRow}`, result: null } as any;
      bankC.protection = { locked: true };
    }
  }

  // ── Deposit row ───────────────────────────────────────────────────────────────
  //   CASH col: user enters deposit (unlocked)
  //   BANK col: formula mirrors CASH deposit (locked)
  setCashLabel(depositRow, "Cash deposit in Bank (Enter Only in Cash Column)", WHITE, "FFCC0000");
  for (let d = 0; d < dayCount; d++) {
    const b  = dayBase + d * COLS_PER_DAY;
    const cL = colLetter(b);
    const cashC = ws.getCell(depositRow, b);
    cashC.value = null; cashC.numFmt = MONEY_FMT; cashC.fill = fill(CASH_PINK);
    cashC.border = thin; cashC.alignment = right;
    cashC.protection = { locked: false };
    const bankC = ws.getCell(depositRow, b + 1);
    bankC.value = { formula: `${cL}${depositRow}`, result: null } as any;
    bankC.numFmt = MONEY_FMT; bankC.fill = fill(BANK_GRN);
    bankC.border = thin; bankC.alignment = right;
    bankC.protection = { locked: true };
  }

  // ── Receipt from Credit Sales row ────────────────────────────────────────────
  //   CASH col: user enters receipt (unlocked)
  //   BANK col: blank / locked
  setCashLabel(receiptRow, "Receipt from Credit Sales", BRIGHT_YLW);
  for (let d = 0; d < dayCount; d++) {
    const b = dayBase + d * COLS_PER_DAY;
    const cashC = ws.getCell(receiptRow, b);
    cashC.value = null; cashC.numFmt = MONEY_FMT; cashC.fill = fill(BRIGHT_YLW);
    cashC.border = thin; cashC.alignment = right;
    cashC.protection = { locked: false };
    const bankC = ws.getCell(receiptRow, b + 1);
    bankC.value = null; bankC.numFmt = MONEY_FMT; bankC.fill = fill(BANK_GRN);
    bankC.border = thin; bankC.alignment = right;
    bankC.protection = { locked: true };
  }

  // ════════ Payments section ════════════════════════════════════════════════════
  ws.getRow(paymentsHdrRow).height = 16;
  ws.mergeCells(paymentsHdrRow, 1, paymentsHdrRow, totalCols);
  applyCell(ws, paymentsHdrRow, 1, "PAYMENTS", fill(DARK_BLUE), wFont(), ctr);

  // Payment rows 1 – NUM_PAYMENT_ROWS (unlocked input)
  for (let p = 1; p <= NUM_PAYMENT_ROWS; p++) {
    const pr = paymentsHdrRow + p;
    ws.getRow(pr).height = 13;
    ws.mergeCells(pr, 1, pr, 3);
    const lbl = ws.getCell(pr, 1);
    lbl.value = `Payment ${p}`; lbl.font = normSm; lbl.fill = fill(WHITE);
    lbl.border = thin; lbl.alignment = leftAl; lbl.protection = { locked: true };
    for (let d = 0; d < dayCount; d++) {
      const b = dayBase + d * COLS_PER_DAY;
      const cashC = ws.getCell(pr, b);
      cashC.value = null; cashC.numFmt = MONEY_FMT;
      cashC.fill = fill(BRIGHT_YLW); cashC.border = thin; cashC.alignment = right;
      cashC.protection = { locked: false };
      const bankC = ws.getCell(pr, b + 1);
      bankC.value = null; bankC.numFmt = MONEY_FMT;
      bankC.fill = fill(BANK_GRN); bankC.border = thin; bankC.alignment = right;
      bankC.protection = { locked: false };
    }
  }

  // ── Total Payments row (locked SUM formulas) ──────────────────────────────────
  ws.getRow(totalPayRow).height = 14;
  ws.mergeCells(totalPayRow, 1, totalPayRow, 3);
  const tpLbl = ws.getCell(totalPayRow, 1);
  tpLbl.value = "Total Payments"; tpLbl.font = { ...boldSm, color: { argb: WHITE } };
  tpLbl.fill = fill(DARK_BLUE); tpLbl.border = thin; tpLbl.alignment = leftAl;
  tpLbl.protection = { locked: true };
  for (let d = 0; d < dayCount; d++) {
    const b  = dayBase + d * COLS_PER_DAY;
    const cL = colLetter(b), bL = colLetter(b + 1);
    const cashC = ws.getCell(totalPayRow, b);
    cashC.value = { formula: `SUM(${cL}${payFirst}:${cL}${payLast})`, result: 0 } as any;
    cashC.numFmt = MONEY_FMT; cashC.fill = fill(DARK_BLUE); cashC.border = thin;
    cashC.alignment = right; cashC.font = { ...boldSm, color: { argb: WHITE } };
    cashC.protection = { locked: true };
    const bankC = ws.getCell(totalPayRow, b + 1);
    bankC.value = { formula: `SUM(${bL}${payFirst}:${bL}${payLast})`, result: 0 } as any;
    bankC.numFmt = MONEY_FMT; bankC.fill = fill(DARK_BLUE); bankC.border = thin;
    bankC.alignment = right; bankC.font = { ...boldSm, color: { argb: WHITE } };
    bankC.protection = { locked: true };
  }

  // ── Balance Cash row (locked formulas) ────────────────────────────────────────
  //   Cash  = OpeningCash + DailyTotalSales − CashDeposit + ReceiptFromCredit − TotalCashPayments
  //   Bank  = OpeningBank + BankDeposit     − TotalBankPayments
  //   Note  : DailyTotalSales is the TOTAL row's Sales column (same letter as BANK col,
  //           but referenced at totalRowNum — not the cash-section bank col).
  ws.getRow(balanceRow).height = 14;
  ws.mergeCells(balanceRow, 1, balanceRow, 3);
  const balLbl = ws.getCell(balanceRow, 1);
  balLbl.value = "Balance Cash"; balLbl.font = { ...boldSm, color: { argb: WHITE } };
  balLbl.fill = fill(GREEN_HDR); balLbl.border = thin; balLbl.alignment = leftAl;
  balLbl.protection = { locked: true };
  for (let d = 0; d < dayCount; d++) {
    const b  = dayBase + d * COLS_PER_DAY;
    const cL = colLetter(b), bL = colLetter(b + 1);
    // cL = CASH column; bL = BANK column (= same column as Total Sales in item/TOTAL rows)
    const cashC = ws.getCell(balanceRow, b);
    cashC.value = {
      formula: `${cL}${openCashRow}+${bL}${totalRowNum}-${cL}${depositRow}+${cL}${receiptRow}-${cL}${totalPayRow}`,
      result:  0,
    } as any;
    cashC.numFmt = MONEY_FMT; cashC.fill = fill(GREEN_HDR); cashC.border = thin;
    cashC.alignment = right; cashC.font = { ...boldSm, color: { argb: WHITE } };
    cashC.protection = { locked: true };
    const bankC = ws.getCell(balanceRow, b + 1);
    bankC.value = {
      formula: `${bL}${openCashRow}+${bL}${depositRow}-${bL}${totalPayRow}`,
      result:  0,
    } as any;
    bankC.numFmt = MONEY_FMT; bankC.fill = fill(GREEN_HDR); bankC.border = thin;
    bankC.alignment = right; bankC.font = { ...boldSm, color: { argb: WHITE } };
    bankC.protection = { locked: true };
  }

  // ── Protect sheet (allow filter, lock all except unlocked cells above) ───────
  await ws.protect("", {
    selectLockedCells:   true,
    selectUnlockedCells: true,
    autoFilter:          true,
  });
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

// Ageing sheet removed (V2 workbook: Costing, Sales, ENTRY, Summary, Summary-Itemwise)

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
  const { companyId, locationId, fromDate, toDate, cashAccountId } = params;

  console.log(`[spSalesFormExportV2] start companyId=${companyId} locationId=${locationId ?? "all"} ${fromDate}→${toDate}`);

  // Build date list
  const startDate = toUtcDate(fromDate);
  const endDate   = toUtcDate(toDate);
  const dayCount  = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
  const dates     = Array.from({ length: dayCount }, (_, i) => dateStr(addDays(startDate, i)));
  const dayBefore = dateStr(addDays(startDate, -1));

  // Fetch all data in parallel (no ageing fetch — Ageing sheet removed in V2)
  const [openMap, closeMap, salesRows, openingCashBalance] = await Promise.all([
    fetchInventory(companyId, locationId, dayBefore),
    fetchInventory(companyId, locationId, toDate),
    fetchSalesData(companyId, locationId, fromDate, toDate),
    cashAccountId ? fetchCashAccountBalance(cashAccountId, companyId, dayBefore) : Promise.resolve(null),
  ]);
  console.log(`[spSalesFormExportV2] cashAccountId=${cashAccountId ?? "none"} openingCashBalance=${openingCashBalance ?? "n/a (manual)"}`);
  console.log(`[spSalesFormExportV2] openItems=${openMap.size} closeItems=${closeMap.size} saleRows=${salesRows.length} dayCount=${dayCount}`);

  // Build item registry
  const items = buildItemRegistry(openMap, closeMap, salesRows, dayCount);

  console.log(`[spSalesFormExportV2] totalItems=${items.length}`);

  // Build workbook (sheet order per spec)
  const wb = new ExcelJS.Workbook();
  wb.creator  = "System SP Export V2";
  wb.created  = new Date();
  wb.modified = new Date();
  // Force full recalculation when Excel opens the file
  (wb as any).calcProperties = { fullCalcOnLoad: true };

  buildCostingSheet(wb, items);                                    // 1. Costing — hidden
  buildSalesSheet(wb, items, dates);                               // 2. Sales — hidden
  await buildEntrySheet(wb, items, dates, dayCount, params, openingCashBalance); // 3. ENTRY — visible (async for ws.protect)
  buildSummarySheet(wb, items, dates, params);                     // 4. Summary — visible
  buildSummaryItemwiseSheet(wb, items, dayCount);                  // 5. Summary-Itemwise — hidden

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
