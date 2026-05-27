import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { db } from '../db';
import { sql } from 'drizzle-orm';

// ── Public interface ──────────────────────────────────────────────────────────

export interface SpSalesFormParams {
  companyId: number;
  fromDate: string;      // YYYY-MM-DD
  toDate: string;        // YYYY-MM-DD
  supplierName?: string;
  locationName?: string; // kept for API compat / filename use
  locationId?: number;   // kept for API compat but ignored
}

// ── Internal types ────────────────────────────────────────────────────────────

interface DaySales {
  qty: number;
  totalSales: number;
  totalCost: number;
  totalDeduction: number; // per-qty warehouse deduction from locations table
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function pn(v: unknown): number {
  const n = parseFloat(String(v ?? '0'));
  return isNaN(n) ? 0 : n;
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** YYYY-MM-DD → UTC midnight Date */
function toUtcDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isFormula(cell: ExcelJS.Cell): boolean {
  return (
    cell.value !== null &&
    cell.value !== undefined &&
    typeof cell.value === 'object' &&
    'formula' in (cell.value as Record<string, unknown>)
  );
}

// ── Template column / row constants ──────────────────────────────────────────

// ENTRY sheet
const E_DATE_ROW   = 3;
const E_DATA_START = 5;
const E_DATA_END   = 128;
const E_NAME_COL   = 3;   // C – display name (matches article_code / canonical stock code)
const E_CODE_COL   = 4;   // D – optional system code override
const E_DATE_START = 7;   // G – first date block
// Pattern per day d: baseCol = E_DATE_START + d*3
//   baseCol   = Qty
//   baseCol+1 = Sale Price
//   baseCol+2 = Profit/Bag  ← we write deduction-adjusted net profit here

// Costing sheet
const C_NAME_COL = 4;   // D – item name (same as ENTRY col C)
const C_QTY_COL  = 5;   // E – On Hand qty  (opening stock)
const C_VAL_COL  = 8;   // H – Asset value  (opening value)

// Sales sheet
const S_DATE_ROW   = 1;
const S_DATA_START = 2;
const S_NAME_COL   = 3;   // C – item name
const S_DATE_START = 6;   // F – first date column (F+1 onward are formulas)

// ── Main export function ──────────────────────────────────────────────────────

export async function generateSpSalesFormExcel(params: SpSalesFormParams): Promise<Buffer> {
  const { companyId, fromDate, toDate } = params;

  const templatePath = path.join(
    process.cwd(), 'server', 'templates', 'supplier_partner_sales_form_template.xlsx'
  );
  if (!fs.existsSync(templatePath)) {
    throw new Error('Template not found: server/templates/supplier_partner_sales_form_template.xlsx');
  }

  // ── Build date list ────────────────────────────────────────────────────────
  const startDate = toUtcDate(fromDate);
  const endDate   = toUtcDate(toDate);
  const dayCount  = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
  const dates: string[] = Array.from({ length: dayCount }, (_, i) => dateStr(addDays(startDate, i)));

  // ── DB queries ─────────────────────────────────────────────────────────────
  const [salesRes, openingRes] = await Promise.all([

    // ── Query 1: daily SP sales within the export range ─────────────────────
    // • article_code normalized via stock_item_code_aliases → stock_items.code
    // • per-qty deduction fetched via sp_sale_lines.movement_id
    //     → sp_stock_movements.location_id → locations.supplier_partner_payable_deduction_per_qty
    //   This is the warehouse-fee deduction that reduces what we owe the supplier.
    db.execute(sql`
      SELECT
        COALESCE(si.code, sl.article_code)                                            AS item_code,
        s.sale_date::text                                                             AS sale_date,
        SUM(sl.qty_sold)::numeric                                                     AS qty,
        SUM(sl.qty_sold * sl.sale_price_per_unit)::numeric                            AS total_sales,
        SUM(sl.qty_sold * sl.final_unit_cost_usd)::numeric                            AS total_cost,
        SUM(sl.qty_sold * COALESCE(l.supplier_partner_payable_deduction_per_qty, 0))
          ::numeric                                                                   AS total_deduction
      FROM  sp_sale_lines          sl
      JOIN  sp_sales               s    ON sl.sale_id     = s.id
      LEFT  JOIN sp_stock_movements mv  ON mv.id          = sl.movement_id
      LEFT  JOIN locations          l   ON l.id           = mv.location_id
      LEFT  JOIN stock_item_code_aliases sica
                                        ON sica.alias_code  = sl.article_code
                                       AND sica.company_id  = sl.company_id
      LEFT  JOIN stock_items        si  ON si.id          = sica.stock_item_id
      WHERE sl.company_id = ${companyId}
        AND s.status      = 'posted'
        AND s.sale_date BETWEEN ${fromDate}::date AND ${toDate}::date
      GROUP BY COALESCE(si.code, sl.article_code), s.sale_date
      ORDER BY s.sale_date
    `),

    // ── Query 2: point-in-time opening stock at END of fromDate ─────────────
    //
    // Approach: for every SP stock lot created on or before fromDate, compute
    //   opening_qty = MAX(qty_in − qty_sold_on_or_before_fromDate, 0)
    // then aggregate by canonical item code.
    //
    // This is correct for any date range — it doesn't assume no new arrivals
    // after fromDate (unlike the old currentQty + soldAfter approach).
    db.execute(sql`
      WITH sold_on_or_before AS (
        SELECT
          sl.movement_id,
          SUM(sl.qty_sold) AS qty
        FROM  sp_sale_lines sl
        JOIN  sp_sales       s ON sl.sale_id = s.id
        WHERE sl.company_id = ${companyId}
          AND s.status      = 'posted'
          AND s.sale_date  <= ${fromDate}::date
        GROUP BY sl.movement_id
      ),
      lot_opening AS (
        SELECT
          sm.article_code,
          sm.company_id,
          sm.final_unit_cost_usd,
          GREATEST(
            sm.qty_in::numeric - COALESCE(sob.qty, 0)::numeric,
            0
          ) AS opening_qty
        FROM  sp_stock_movements sm
        LEFT  JOIN sold_on_or_before sob ON sob.movement_id = sm.id
        WHERE sm.company_id     = ${companyId}
          AND sm.created_at::date <= ${fromDate}::date
      )
      SELECT
        COALESCE(si.code, lo.article_code)  AS item_code,
        SUM(lo.opening_qty)::numeric        AS qty,
        CASE WHEN SUM(lo.opening_qty) > 0
             THEN SUM(lo.opening_qty * lo.final_unit_cost_usd::numeric)
                  / SUM(lo.opening_qty)
             ELSE 0
        END::numeric                        AS avg_cost
      FROM  lot_opening                    lo
      LEFT  JOIN stock_item_code_aliases   sica
                                           ON sica.alias_code = lo.article_code
                                          AND sica.company_id = lo.company_id
      LEFT  JOIN stock_items               si ON si.id = sica.stock_item_id
      GROUP BY COALESCE(si.code, lo.article_code)
    `),
  ]);

  const salesRows   = (salesRes   as any).rows ?? (salesRes   as any[]);
  const openingRows = (openingRes as any).rows ?? (openingRes as any[]);

  // ── Build in-memory data structures ──────────────────────────────────────

  // salesMap: resolvedItemCode → dateStr → DaySales
  const salesMap = new Map<string, Map<string, DaySales>>();
  for (const r of salesRows) {
    const code = String(r.item_code ?? '').trim();
    if (!code) continue;
    if (!salesMap.has(code)) salesMap.set(code, new Map());
    const dm  = salesMap.get(code)!;
    const key = String(r.sale_date).slice(0, 10);
    const prev = dm.get(key) ?? { qty: 0, totalSales: 0, totalCost: 0, totalDeduction: 0 };
    dm.set(key, {
      qty:            prev.qty            + pn(r.qty),
      totalSales:     prev.totalSales     + pn(r.total_sales),
      totalCost:      prev.totalCost      + pn(r.total_cost),
      totalDeduction: prev.totalDeduction + pn(r.total_deduction),
    });
  }

  // openingMap: resolvedItemCode → { qty, avgCost } at end of fromDate
  const openingMap = new Map<string, { qty: number; avgCost: number }>();
  for (const r of openingRows) {
    openingMap.set(String(r.item_code).trim(), {
      qty:     pn(r.qty),
      avgCost: pn(r.avg_cost),
    });
  }

  /** Opening stock — try displayName first, then systemCode fallback. */
  const getOpening = (displayName: string, systemCode: string) =>
    openingMap.get(displayName) ??
    openingMap.get(systemCode) ??
    { qty: 0, avgCost: 0 };

  /** DaySales map — try displayName first, then systemCode fallback. */
  const getSalesMap = (displayName: string, systemCode: string) =>
    salesMap.get(displayName) ?? salesMap.get(systemCode);

  // ── Load workbook ─────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  wb.calcProperties.fullCalcOnLoad = true;

  const entryWs    = wb.getWorksheet('ENTRY');
  const costingWs  = wb.getWorksheet('Costing');
  const salesWs    = wb.getWorksheet('Sales');
  const ageingWs   = wb.getWorksheet('Ageing');
  const summaryIWs = wb.getWorksheet('Summary-Itemwise');

  if (!entryWs || !costingWs) throw new Error('ENTRY or Costing sheet missing from template');

  // ── Scan ENTRY rows 5-128: build name → systemCode + row-number maps ───────
  const nameToSystemCode = new Map<string, string>();
  const itemRows          = new Map<string, number>();

  for (let r = E_DATA_START; r <= E_DATA_END; r++) {
    const row      = entryWs.getRow(r);
    const nameCell = row.getCell(E_NAME_COL).value;
    const codeCell = row.getCell(E_CODE_COL).value;

    const rawName = typeof nameCell === 'string'
      ? nameCell.trim()
      : typeof (nameCell as any)?.result === 'string'
        ? (nameCell as any).result.trim()
        : '';
    if (!rawName || rawName.startsWith('Total ')) continue;

    const systemCode =
      typeof codeCell === 'string' && codeCell.trim()
        ? codeCell.trim()
        : rawName;

    nameToSystemCode.set(rawName, systemCode);
    itemRows.set(rawName, r);
  }

  // ── 1. Costing sheet: write opening stock ─────────────────────────────────
  const costingLastRow = costingWs.rowCount;
  for (let r = 2; r <= costingLastRow; r++) {
    const row     = costingWs.getRow(r);
    const nameRaw = row.getCell(C_NAME_COL).value;
    const displayName = typeof nameRaw === 'string'
      ? nameRaw.trim()
      : typeof (nameRaw as any)?.result === 'string'
        ? (nameRaw as any).result.trim()
        : '';
    if (!displayName || displayName.startsWith('Total ') || displayName === 'Inventory') continue;

    const systemCode = nameToSystemCode.get(displayName) ?? displayName;
    const stock      = getOpening(displayName, systemCode);

    const qtyCell = row.getCell(C_QTY_COL);
    const valCell = row.getCell(C_VAL_COL);

    if (!isFormula(qtyCell)) {
      qtyCell.value = stock.qty > 0 ? r3(stock.qty) : null;
    }
    if (!isFormula(valCell)) {
      const assetVal = stock.qty * stock.avgCost;
      valCell.value  = assetVal > 0 ? r2(assetVal) : null;
    }
    row.commit();
  }

  // ── 2. Sales sheet: write start date (F1 only) and qty per day ────────────
  // F1 is a plain value; G1, H1… are formula =F1+1, =G1+1 — only write F1.
  if (salesWs) {
    const sDateRow  = salesWs.getRow(S_DATE_ROW);
    const startCell = sDateRow.getCell(S_DATE_START);
    if (!isFormula(startCell)) startCell.value = addDays(startDate, 0);
    sDateRow.commit();

    const salesWsLast = salesWs.rowCount;
    for (let r = S_DATA_START; r <= salesWsLast; r++) {
      const row     = salesWs.getRow(r);
      const nameRaw = row.getCell(S_NAME_COL).value;
      const displayName = typeof nameRaw === 'string'
        ? nameRaw.trim()
        : typeof (nameRaw as any)?.result === 'string'
          ? (nameRaw as any).result.trim()
          : '';
      if (!displayName || displayName.startsWith('Total ')) continue;

      const systemCode  = nameToSystemCode.get(displayName) ?? displayName;
      const daySalesMap = getSalesMap(displayName, systemCode);

      for (let d = 0; d < dayCount; d++) {
        const cell = row.getCell(S_DATE_START + d);
        if (isFormula(cell)) continue;
        const ds = daySalesMap?.get(dates[d]);
        cell.value = ds && ds.qty > 0 ? r3(ds.qty) : 0;
      }
      for (let d = dayCount; d < dayCount + 10; d++) {
        const cell = row.getCell(S_DATE_START + d);
        if (!isFormula(cell)) cell.value = 0;
      }
      row.commit();
    }
  }

  // ── 3. ENTRY sheet ────────────────────────────────────────────────────────

  // 3a. Date row (row 3)
  // Template: G3/H3/I3 = plain date values; J3+ = formula chain =G3+1, =J3+1…
  // Guard every write with isFormula so formula cells are never overwritten.
  const eDateRow = entryWs.getRow(E_DATE_ROW);
  for (let d = 0; d < dayCount; d++) {
    const dateVal = addDays(startDate, d);
    const baseCol = E_DATE_START + d * 3;
    for (let c = baseCol; c < baseCol + 3; c++) {
      const cell = eDateRow.getCell(c);
      if (!isFormula(cell)) cell.value = dateVal;
    }
  }
  for (let d = dayCount; d < dayCount + 15; d++) {
    const baseCol = E_DATE_START + d * 3;
    for (let c = baseCol; c < baseCol + 3; c++) {
      const cell = eDateRow.getCell(c);
      if (!isFormula(cell)) cell.value = null;
    }
  }
  eDateRow.commit();

  // 3b. Item data rows
  // Write Qty (baseCol) and Sale Price (baseCol+1) as always.
  // Write Profit/Bag (baseCol+2) as computed deduction-adjusted net profit per bag.
  //   = (totalSales − totalCost − totalDeduction) / qty
  // This overrides the template formula IF(G=0,0,H-$F) to correctly reflect
  // the per-qty warehouse deduction, making the Summary Closing Balance match
  // the SP ledger payable balance.
  for (const [displayName, rowNum] of itemRows) {
    const systemCode  = nameToSystemCode.get(displayName) ?? displayName;
    const daySalesMap = getSalesMap(displayName, systemCode);
    const row         = entryWs.getRow(rowNum);

    for (let d = 0; d < dayCount; d++) {
      const baseCol   = E_DATE_START + d * 3;
      const qtyCell   = row.getCell(baseCol);
      const priceCell = row.getCell(baseCol + 1);
      const profitCell = row.getCell(baseCol + 2);

      const ds = daySalesMap?.get(dates[d]);

      if (ds && ds.qty > 0) {
        const avgPrice    = ds.totalSales / ds.qty;
        const netProfitPB = (ds.totalSales - ds.totalCost - ds.totalDeduction) / ds.qty;

        if (!isFormula(qtyCell))    qtyCell.value    = r3(ds.qty);
        if (!isFormula(priceCell))  priceCell.value  = r2(avgPrice);
        if (!isFormula(profitCell)) profitCell.value = r2(netProfitPB);
      } else {
        if (!isFormula(qtyCell))    qtyCell.value    = null;
        if (!isFormula(priceCell))  priceCell.value  = null;
        if (!isFormula(profitCell)) profitCell.value = null;
      }
    }

    // Clear stale data beyond the export range (all 3 cols including profit)
    for (let d = dayCount; d < dayCount + 15; d++) {
      const baseCol = E_DATE_START + d * 3;
      for (let c = baseCol; c < baseCol + 3; c++) {
        const cell = row.getCell(c);
        if (!isFormula(cell)) cell.value = null;
      }
    }

    row.commit();
  }

  // ── 4. Summary-Itemwise: B1 = toDate (VLOOKUP reference) ─────────────────
  if (summaryIWs) {
    const b1 = summaryIWs.getRow(1).getCell(2);
    if (!isFormula(b1)) b1.value = toUtcDate(toDate);
    summaryIWs.getRow(1).commit();
  }

  // ── 5. Hide Ageing (preserve formula refs) ────────────────────────────────
  if (ageingWs) {
    (ageingWs as any).state = 'hidden';
  }

  // ── 6. Output ─────────────────────────────────────────────────────────────
  const rawBuf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
}
