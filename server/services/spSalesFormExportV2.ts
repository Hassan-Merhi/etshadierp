/**
 * SP Sales Form Export V2
 *
 * Clean from-scratch ExcelJS export using real system data:
 *   - Opening / closing stock from calculateHistoricalLocationInventory()
 *     (matches the Location Inventory page — reverses movements after the target date)
 *   - Daily sales from sp_sale_lines / sp_sales (status = 'posted')
 *
 * Produces a 3-sheet workbook: ENTRY (main), Daily Sales (raw), Summary (by item).
 * No template dependency; supports any date range.
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

// ── Pure helpers ──────────────────────────────────────────────────────────────

function pn(v: unknown): number {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? 0 : n;
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function toUtcDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtDate(s: string): string {
  // YYYY-MM-DD → D-MMM
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [, m, dd] = s.split("-").map(Number);
  return `${dd}-${months[m - 1]}`;
}

// ── Inventory helpers ─────────────────────────────────────────────────────────

interface InvEntry {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
  quantity: number;
  averageRate: number;
  totalValue: number;
}

/** Get historical inventory for one location (or all locations aggregated). */
async function getInventory(
  companyId: number,
  locationId: number | undefined,
  asOfDate: string
): Promise<Map<number, InvEntry>> {
  const result = new Map<number, InvEntry>();

  let locationIds: number[];
  if (locationId) {
    locationIds = [locationId];
  } else {
    // All active locations for this company
    const locRes = await db.execute(
      sql`SELECT id FROM locations WHERE company_id = ${companyId} AND deleted_at IS NULL`
    );
    locationIds = ((locRes as any).rows ?? (locRes as any[])).map((r: any) => Number(r.id));
  }

  await Promise.all(
    locationIds.map(async (locId) => {
      const rows = await calculateHistoricalLocationInventory(locId, companyId, asOfDate);
      for (const row of rows) {
        const qty = pn(row.quantity);
        const val = pn(row.totalValue);
        const rate = pn(row.averageRate);
        const existing = result.get(row.stockItemId);
        if (!existing) {
          result.set(row.stockItemId, {
            stockItemId: row.stockItemId,
            stockItemCode: row.stockItemCode ?? "",
            stockItemName: row.stockItemName ?? "",
            stockItemUom: row.stockItemUom ?? "",
            quantity: qty,
            averageRate: rate,
            totalValue: val,
          });
        } else {
          const newQty = existing.quantity + qty;
          const newVal = existing.totalValue + val;
          existing.quantity = newQty;
          existing.totalValue = newVal;
          existing.averageRate = newQty > 0 ? newVal / newQty : 0;
        }
      }
    })
  );

  return result;
}

// ── Main export function ──────────────────────────────────────────────────────

export async function generateSpSalesFormExcelV2(params: SpSalesFormV2Params): Promise<Buffer> {
  const { companyId, locationId, fromDate, toDate, locationName = "", supplierName = "" } = params;

  // ── Build date list ─────────────────────────────────────────────────────────
  const startDate = toUtcDate(fromDate);
  const endDate   = toUtcDate(toDate);
  const dayCount  = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
  const dates: string[] = Array.from({ length: dayCount }, (_, i) => dateStr(addDays(startDate, i)));

  console.log(`[spSalesFormExportV2] fromDate=${fromDate} toDate=${toDate} dayCount=${dayCount} locationId=${locationId ?? "all"}`);

  // ── Day-before fromDate for opening stock ───────────────────────────────────
  const dayBeforeFrom = dateStr(addDays(startDate, -1));

  // ── Parallel: sales data + opening inventory + closing inventory ────────────
  const salesLocFilter = locationId ? sql` AND mv.location_id = ${locationId}` : sql``;

  const [salesRes, openingMap, closingMap] = await Promise.all([
    db.execute(sql`
      SELECT
        sl.stock_item_id                                                       AS stock_item_id,
        COALESCE(si.code, sl.article_code)                                     AS item_code,
        MAX(COALESCE(si.name, sl.description, sl.article_code))                AS item_name,
        MAX(COALESCE(si.uom, ''))                                              AS item_uom,
        s.sale_date::text                                                      AS sale_date,
        SUM(sl.qty_sold)::numeric                                              AS qty,
        SUM(sl.qty_sold * sl.sale_price_per_unit)::numeric                     AS total_sales,
        SUM(sl.qty_sold * sl.final_unit_cost_usd)::numeric                     AS total_cost
      FROM  sp_sale_lines          sl
      JOIN  sp_sales               s    ON sl.sale_id     = s.id
      LEFT  JOIN sp_stock_movements mv  ON mv.id          = sl.movement_id
      LEFT  JOIN stock_items        si  ON si.id          = sl.stock_item_id
      WHERE sl.company_id = ${companyId}
        AND s.status      = 'posted'
        AND s.sale_date BETWEEN ${fromDate}::date AND ${toDate}::date
        ${salesLocFilter}
      GROUP BY sl.stock_item_id, COALESCE(si.code, sl.article_code), s.sale_date
      ORDER BY COALESCE(si.code, sl.article_code), s.sale_date
    `),
    getInventory(companyId, locationId, dayBeforeFrom),
    getInventory(companyId, locationId, toDate),
  ]);

  const salesRows = (salesRes as any).rows ?? (salesRes as any[]);

  // ── Build item registry ─────────────────────────────────────────────────────
  // Canonical key: stockItemId (number) when available, else string article code.
  // We keep a registry map: canonicalKey → ItemData

  interface DaySales { qty: number; totalSales: number; totalCost: number }
  interface ItemData {
    stockItemId: number | null;
    itemCode: string;
    itemName: string;
    itemUom: string;
    openQty: number;
    openRate: number;
    openValue: number;
    closeQty: number;
    closeRate: number;
    closeValue: number;
    salesByDate: Map<string, DaySales>;
  }

  const registry = new Map<string, ItemData>();

  function canonicalKey(stockItemId: number | null | undefined, itemCode: string): string {
    return stockItemId != null ? `id:${stockItemId}` : `code:${itemCode}`;
  }

  function getOrCreate(
    stockItemId: number | null,
    itemCode: string,
    itemName: string,
    itemUom: string
  ): ItemData {
    const key = canonicalKey(stockItemId, itemCode);
    if (!registry.has(key)) {
      registry.set(key, {
        stockItemId,
        itemCode,
        itemName,
        itemUom,
        openQty: 0, openRate: 0, openValue: 0,
        closeQty: 0, closeRate: 0, closeValue: 0,
        salesByDate: new Map(),
      });
    }
    return registry.get(key)!;
  }

  // Seed from opening inventory
  for (const [id, inv] of openingMap) {
    const item = getOrCreate(id, inv.stockItemCode, inv.stockItemName, inv.stockItemUom);
    item.openQty   = inv.quantity;
    item.openRate  = inv.averageRate;
    item.openValue = inv.totalValue;
    if (item.itemCode === "" && inv.stockItemCode) item.itemCode = inv.stockItemCode;
    if (item.itemName === "" && inv.stockItemName) item.itemName = inv.stockItemName;
  }

  // Seed from closing inventory
  for (const [id, inv] of closingMap) {
    const key = canonicalKey(id, inv.stockItemCode);
    if (!registry.has(key)) {
      getOrCreate(id, inv.stockItemCode, inv.stockItemName, inv.stockItemUom);
    }
    const item = registry.get(key)!;
    item.closeQty   = inv.quantity;
    item.closeRate  = inv.averageRate;
    item.closeValue = inv.totalValue;
    if (item.itemCode === "" && inv.stockItemCode) item.itemCode = inv.stockItemCode;
    if (item.itemName === "" && inv.stockItemName) item.itemName = inv.stockItemName;
  }

  // Seed from sales
  for (const row of salesRows) {
    const sid = row.stock_item_id != null ? Number(row.stock_item_id) : null;
    const code = String(row.item_code ?? "");
    const name = String(row.item_name ?? code);
    const uom  = String(row.item_uom ?? "");
    const item = getOrCreate(sid, code, name, uom);
    if (item.itemName === "" && name) item.itemName = name;

    const saleDate = String(row.sale_date);
    const existing = item.salesByDate.get(saleDate) ?? { qty: 0, totalSales: 0, totalCost: 0 };
    existing.qty        += pn(row.qty);
    existing.totalSales += pn(row.total_sales);
    existing.totalCost  += pn(row.total_cost);
    item.salesByDate.set(saleDate, existing);
  }

  // Sort items by item code
  const items = Array.from(registry.values()).sort((a, b) =>
    a.itemCode.localeCompare(b.itemCode, undefined, { numeric: true })
  );

  // ── Build ExcelJS workbook ──────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "System SP Export V2";
  wb.created = new Date();

  // ── Styles ──────────────────────────────────────────────────────────────────
  const headerFill: ExcelJS.Fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: "FF2D5A8E" },
  };
  const subHeaderFill: ExcelJS.Fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: "FF4472C4" },
  };
  const altRowFill: ExcelJS.Fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: "FFF2F7FF" },
  };
  const dayColFill: ExcelJS.Fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: "FFFFF9E6" },
  };
  const closingFill: ExcelJS.Fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: "FFE8F5E9" },
  };
  const totalsFill: ExcelJS.Fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: "FFFFF3E0" },
  };
  const whiteFont: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true, size: 10 };
  const boldFont: Partial<ExcelJS.Font> = { bold: true, size: 10 };
  const thinBorder: Partial<ExcelJS.Borders> = {
    bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
    right:  { style: "thin", color: { argb: "FFD0D0D0" } },
  };

  // ════════════════════════════════════════════════════════════════════════════
  // Sheet 1: ENTRY
  // ════════════════════════════════════════════════════════════════════════════
  const entryWs = wb.addWorksheet("ENTRY");

  // Fixed columns: A=Code, B=Name, C=Open Qty, D=Open Rate, E=Open Value
  // Then 3 cols per date: Qty, Price, Profit
  // Then: Close Qty, Close Rate, Close Value, Total Qty, Total Rev, Total Cost, Gross Profit
  const FIXED_LEFT = 5;  // cols A-E
  const COLS_PER_DAY = 3;
  const FIXED_RIGHT = 7; // Close Qty, Close Rate, Close Val, Total Qty, Total Rev, Total Cost, Gross Profit
  const TOTAL_COLS = FIXED_LEFT + dayCount * COLS_PER_DAY + FIXED_RIGHT;

  // Row 1: Title
  entryWs.mergeCells(1, 1, 1, Math.min(TOTAL_COLS, 20));
  const titleCell = entryWs.getCell(1, 1);
  titleCell.value = `${supplierName} — Sales Form  |  ${locationName || "All Locations"}  |  ${fromDate} to ${toDate}`;
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  entryWs.getRow(1).height = 22;

  // Row 2: Group headers
  const grpRow = entryWs.getRow(2);
  grpRow.height = 16;

  // A-E group header
  entryWs.mergeCells(2, 1, 2, 2);
  const hItem = entryWs.getCell(2, 1);
  hItem.value = "Item";
  hItem.fill = headerFill; hItem.font = whiteFont; hItem.alignment = { horizontal: "center" };

  entryWs.mergeCells(2, 3, 2, 5);
  const hOpen = entryWs.getCell(2, 3);
  hOpen.value = "Opening Stock";
  hOpen.fill = subHeaderFill; hOpen.font = whiteFont; hOpen.alignment = { horizontal: "center" };

  // Day group headers
  for (let d = 0; d < dayCount; d++) {
    const baseCol = FIXED_LEFT + 1 + d * COLS_PER_DAY;
    entryWs.mergeCells(2, baseCol, 2, baseCol + COLS_PER_DAY - 1);
    const dc = entryWs.getCell(2, baseCol);
    dc.value = fmtDate(dates[d]);
    dc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBDD7EE" } };
    dc.font = { bold: true, size: 9 };
    dc.alignment = { horizontal: "center" };
  }

  // Closing / Totals group headers
  const closeStartCol = FIXED_LEFT + 1 + dayCount * COLS_PER_DAY;
  entryWs.mergeCells(2, closeStartCol, 2, closeStartCol + 2);
  const hClose = entryWs.getCell(2, closeStartCol);
  hClose.value = "Closing Stock";
  hClose.fill = closingFill; hClose.font = boldFont; hClose.alignment = { horizontal: "center" };

  const totStartCol = closeStartCol + 3;
  entryWs.mergeCells(2, totStartCol, 2, totStartCol + 3);
  const hTot = entryWs.getCell(2, totStartCol);
  hTot.value = "Period Totals";
  hTot.fill = totalsFill; hTot.font = boldFont; hTot.alignment = { horizontal: "center" };

  // Row 3: Column sub-headers
  const subHdrRow = entryWs.getRow(3);
  subHdrRow.height = 14;
  const subHeaders: { col: number; label: string; fill?: ExcelJS.Fill }[] = [
    { col: 1, label: "Code",      fill: headerFill },
    { col: 2, label: "Item Name", fill: headerFill },
    { col: 3, label: "Open Qty",  fill: subHeaderFill },
    { col: 4, label: "Avg Rate",  fill: subHeaderFill },
    { col: 5, label: "Open Val",  fill: subHeaderFill },
  ];
  for (let d = 0; d < dayCount; d++) {
    const base = FIXED_LEFT + 1 + d * COLS_PER_DAY;
    subHeaders.push({ col: base,     label: "Qty",       fill: dayColFill });
    subHeaders.push({ col: base + 1, label: "Price/U",   fill: dayColFill });
    subHeaders.push({ col: base + 2, label: "Profit/U",  fill: dayColFill });
  }
  subHeaders.push({ col: closeStartCol,     label: "Close Qty",  fill: closingFill });
  subHeaders.push({ col: closeStartCol + 1, label: "Close Rate", fill: closingFill });
  subHeaders.push({ col: closeStartCol + 2, label: "Close Val",  fill: closingFill });
  subHeaders.push({ col: totStartCol,     label: "Total Qty",   fill: totalsFill });
  subHeaders.push({ col: totStartCol + 1, label: "Revenue",     fill: totalsFill });
  subHeaders.push({ col: totStartCol + 2, label: "Cost",        fill: totalsFill });
  subHeaders.push({ col: totStartCol + 3, label: "Profit",      fill: totalsFill });

  for (const sh of subHeaders) {
    const c = entryWs.getCell(3, sh.col);
    c.value = sh.label;
    if (sh.fill) c.fill = sh.fill;
    c.font = { bold: true, size: 9 };
    c.alignment = { horizontal: "center", wrapText: true };
    c.border = thinBorder;
  }

  // Column widths
  entryWs.getColumn(1).width = 14;
  entryWs.getColumn(2).width = 28;
  for (let d = 0; d < dayCount; d++) {
    const base = FIXED_LEFT + 1 + d * COLS_PER_DAY;
    entryWs.getColumn(base).width = 8;
    entryWs.getColumn(base + 1).width = 9;
    entryWs.getColumn(base + 2).width = 9;
  }
  for (let i = 3; i <= 5; i++) entryWs.getColumn(i).width = 11;
  entryWs.getColumn(closeStartCol).width = 10;
  entryWs.getColumn(closeStartCol + 1).width = 10;
  entryWs.getColumn(closeStartCol + 2).width = 11;
  for (let i = 0; i < 4; i++) entryWs.getColumn(totStartCol + i).width = 12;

  // Freeze header rows
  entryWs.views = [{ state: "frozen", xSplit: 2, ySplit: 3, activeCell: "C4" }];

  // Data rows
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rowNum = 4 + i;
    const rowFill = i % 2 === 1 ? altRowFill : undefined;

    let totalQty = 0, totalSales = 0, totalCost = 0;
    for (const [, ds] of item.salesByDate) {
      totalQty   += ds.qty;
      totalSales += ds.totalSales;
      totalCost  += ds.totalCost;
    }

    const rowData: (string | number | null)[] = [
      item.itemCode,
      item.itemName,
      r2(item.openQty) || null,
      item.openQty > 0 ? r2(item.openRate) : null,
      r2(item.openValue) || null,
    ];

    for (const date of dates) {
      const ds = item.salesByDate.get(date);
      if (ds && ds.qty > 0) {
        const avgPrice = ds.totalSales / ds.qty;
        const avgCost  = ds.totalCost  / ds.qty;
        rowData.push(r2(ds.qty));
        rowData.push(r2(avgPrice));
        rowData.push(r2(avgPrice - avgCost));
      } else {
        rowData.push(null, null, null);
      }
    }

    rowData.push(
      r2(item.closeQty) || null,
      item.closeQty > 0 ? r2(item.closeRate) : null,
      r2(item.closeValue) || null,
      r2(totalQty) || null,
      r2(totalSales) || null,
      r2(totalCost) || null,
      r2(totalSales - totalCost) || null
    );

    const row = entryWs.getRow(rowNum);
    row.values = ["", ...rowData]; // col index is 1-based; start values from col 1
    // Actually set each cell explicitly to avoid the empty col-0 offset
    for (let c = 0; c < rowData.length; c++) {
      const cell = entryWs.getCell(rowNum, c + 1);
      cell.value = rowData[c];
      if (rowFill) cell.fill = rowFill;
      cell.border = thinBorder;
      if (c >= 2) {
        cell.numFmt = "#,##0.00";
        cell.alignment = { horizontal: "right" };
      }
      if (c === 0) cell.font = { bold: true, size: 9 };
      else cell.font = { size: 9 };
    }
    // Style day columns
    for (let d = 0; d < dayCount; d++) {
      const base = FIXED_LEFT + 1 + d * COLS_PER_DAY;
      for (let j = 0; j < 3; j++) {
        const cell = entryWs.getCell(rowNum, base + j);
        if (!rowFill) cell.fill = dayColFill;
      }
    }
    // Style closing columns
    for (let j = 0; j < 3; j++) {
      const cell = entryWs.getCell(rowNum, closeStartCol + j);
      if (!rowFill) cell.fill = closingFill;
    }
    // Style totals columns
    for (let j = 0; j < 4; j++) {
      const cell = entryWs.getCell(rowNum, totStartCol + j);
      if (!rowFill) cell.fill = totalsFill;
    }
    row.height = 14;
  }

  // Totals footer row
  if (items.length > 0) {
    const footRow = 4 + items.length;
    const foot = entryWs.getRow(footRow);
    foot.height = 15;
    const fCell = entryWs.getCell(footRow, 1);
    fCell.value = "TOTAL";
    fCell.font = boldFont;
    fCell.fill = headerFill;
    fCell.font = { ...whiteFont };

    // Sum opening value
    entryWs.getCell(footRow, 5).value = {
      formula: `SUM(E4:E${footRow - 1})`, result: 0
    } as any;

    // Sum per-day qty
    for (let d = 0; d < dayCount; d++) {
      const base = FIXED_LEFT + 1 + d * COLS_PER_DAY;
      entryWs.getCell(footRow, base).value = {
        formula: `SUM(${(entryWs.getColumn(base) as any).letter}4:${(entryWs.getColumn(base) as any).letter}${footRow - 1})`,
        result: 0,
      } as any;
    }

    // Sum closing value, period totals
    for (let j = 0; j < 3; j++) {
      const col = closeStartCol + j;
      const letter = entryWs.getColumn(col).letter;
      entryWs.getCell(footRow, col).value = { formula: `SUM(${letter}4:${letter}${footRow - 1})`, result: 0 } as any;
    }
    for (let j = 0; j < 4; j++) {
      const col = totStartCol + j;
      const letter = entryWs.getColumn(col).letter;
      entryWs.getCell(footRow, col).value = { formula: `SUM(${letter}4:${letter}${footRow - 1})`, result: 0 } as any;
    }

    for (let c = 1; c <= TOTAL_COLS; c++) {
      const cell = entryWs.getCell(footRow, c);
      cell.fill = headerFill;
      if (!cell.font?.white) cell.font = { ...whiteFont };
      cell.numFmt = "#,##0.00";
      cell.border = { bottom: { style: "medium" } };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Sheet 2: Daily Sales (raw)
  // ════════════════════════════════════════════════════════════════════════════
  const dailyWs = wb.addWorksheet("Daily Sales");
  dailyWs.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  const dailyCols = [
    { header: "Date",         key: "date",      width: 12 },
    { header: "Item Code",    key: "code",       width: 14 },
    { header: "Item Name",    key: "name",       width: 28 },
    { header: "UOM",          key: "uom",        width: 8  },
    { header: "Qty Sold",     key: "qty",        width: 10 },
    { header: "Price / Unit", key: "price",      width: 12 },
    { header: "Total Rev",    key: "totalRev",   width: 13 },
    { header: "Unit Cost",    key: "unitCost",   width: 12 },
    { header: "Total Cost",   key: "totalCost",  width: 13 },
    { header: "Profit / U",   key: "profitPU",   width: 12 },
    { header: "Total Profit", key: "profit",     width: 13 },
  ];
  dailyWs.columns = dailyCols;
  const dailyHdrRow = dailyWs.getRow(1);
  dailyHdrRow.height = 15;
  dailyHdrRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = whiteFont;
    cell.alignment = { horizontal: "center" };
  });

  let dailyRowNum = 2;
  for (const date of dates) {
    for (const item of items) {
      const ds = item.salesByDate.get(date);
      if (!ds || ds.qty === 0) continue;
      const avgPrice  = ds.totalSales / ds.qty;
      const avgCost   = ds.totalCost  / ds.qty;
      const profitPU  = avgPrice - avgCost;
      const profit    = ds.totalSales - ds.totalCost;

      const row = dailyWs.getRow(dailyRowNum++);
      row.values = [
        date, item.itemCode, item.itemName, item.itemUom,
        r2(ds.qty), r2(avgPrice), r2(ds.totalSales),
        r2(avgCost), r2(ds.totalCost), r2(profitPU), r2(profit),
      ];
      if (dailyRowNum % 2 === 0) {
        row.eachCell((cell) => { cell.fill = altRowFill; });
      }
      row.getCell(5).numFmt  = "#,##0.00";
      row.getCell(6).numFmt  = "#,##0.0000";
      row.getCell(7).numFmt  = "#,##0.00";
      row.getCell(8).numFmt  = "#,##0.0000";
      row.getCell(9).numFmt  = "#,##0.00";
      row.getCell(10).numFmt = "#,##0.0000";
      row.getCell(11).numFmt = "#,##0.00";
      row.height = 13;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Sheet 3: Summary (by item)
  // ════════════════════════════════════════════════════════════════════════════
  const sumWs = wb.addWorksheet("Summary");
  sumWs.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

  const sumCols = [
    { header: "Code",          key: "code",       width: 14 },
    { header: "Item Name",     key: "name",       width: 30 },
    { header: "UOM",           key: "uom",        width: 8  },
    { header: "Open Qty",      key: "openQty",    width: 11 },
    { header: "Open Value",    key: "openVal",    width: 13 },
    { header: "Total Sold",    key: "totalQty",   width: 11 },
    { header: "Total Revenue", key: "totalRev",   width: 14 },
    { header: "Avg Price",     key: "avgPrice",   width: 11 },
    { header: "Total Cost",    key: "totalCost",  width: 13 },
    { header: "Gross Profit",  key: "profit",     width: 13 },
    { header: "Close Qty",     key: "closeQty",   width: 11 },
    { header: "Close Value",   key: "closeVal",   width: 13 },
    { header: "Net Change",    key: "netChange",  width: 11 },
  ];
  sumWs.columns = sumCols;

  const sumHdrRow = sumWs.getRow(1);
  sumHdrRow.height = 15;
  sumHdrRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = whiteFont;
    cell.alignment = { horizontal: "center" };
  });

  let sumTotalQty = 0, sumTotalRev = 0, sumTotalCost = 0, sumTotalProfit = 0;
  let sumOpenVal = 0, sumCloseVal = 0;
  let sumRowNum = 2;

  for (const item of items) {
    let totalQty = 0, totalSales = 0, totalCost = 0;
    for (const [, ds] of item.salesByDate) {
      totalQty   += ds.qty;
      totalSales += ds.totalSales;
      totalCost  += ds.totalCost;
    }
    const profit   = totalSales - totalCost;
    const avgPrice = totalQty > 0 ? totalSales / totalQty : 0;
    const netChange = item.closeQty - item.openQty;

    sumTotalQty    += totalQty;
    sumTotalRev    += totalSales;
    sumTotalCost   += totalCost;
    sumTotalProfit += profit;
    sumOpenVal     += item.openValue;
    sumCloseVal    += item.closeValue;

    const row = sumWs.getRow(sumRowNum);
    row.values = [
      item.itemCode, item.itemName, item.itemUom,
      r2(item.openQty)   || null, r2(item.openValue)  || null,
      r2(totalQty)       || null, r2(totalSales)      || null,
      r2(avgPrice)       || null,
      r2(totalCost)      || null, r2(profit)          || null,
      r2(item.closeQty)  || null, r2(item.closeValue) || null,
      r2(netChange)      || null,
    ];
    if (sumRowNum % 2 === 0) row.eachCell((cell) => { cell.fill = altRowFill; });
    for (let c = 4; c <= 13; c++) {
      row.getCell(c).numFmt = "#,##0.00";
      row.getCell(c).alignment = { horizontal: "right" };
    }
    row.height = 13;
    sumRowNum++;
  }

  // Summary totals row
  if (items.length > 0) {
    const sfRow = sumWs.getRow(sumRowNum);
    sfRow.values = [
      "TOTAL", "", "",
      null, r2(sumOpenVal),
      r2(sumTotalQty), r2(sumTotalRev),
      null,
      r2(sumTotalCost), r2(sumTotalProfit),
      null, r2(sumCloseVal),
      null,
    ];
    sfRow.eachCell((cell) => {
      cell.font = boldFont;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD700" } };
      cell.numFmt = "#,##0.00";
    });
    sfRow.height = 15;
  }

  // ── Serialize ───────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
