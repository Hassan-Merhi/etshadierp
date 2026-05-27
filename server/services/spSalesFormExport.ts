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

/**
 * Returns true if the cell holds an Excel formula (or a shared-formula reference).
 * ExcelJS represents master formula cells as { formula, result? }
 * and shared-formula slave cells as { sharedFormula: '<masterAddr>' }.
 * Both must be treated as formula cells so we never accidentally overwrite them
 * in contexts where we want to preserve the formula chain.
 */
function isFormula(cell: ExcelJS.Cell): boolean {
  if (cell.value === null || cell.value === undefined) return false;
  if (typeof cell.value !== 'object') return false;
  const v = cell.value as Record<string, unknown>;
  return 'formula' in v || 'sharedFormula' in v;
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
//   baseCol   = Qty          (plain)
//   baseCol+1 = Sale Price   (plain)
//   baseCol+2 = Profit/Bag   (formula in template – we always overwrite with computed value)

// Costing sheet
const C_NAME_COL = 4;   // D – item name (same as ENTRY col C)
const C_QTY_COL  = 5;   // E – On Hand qty  (opening stock)
const C_AVG_COL  = 7;   // G – Avg Cost (formula =H/E – we write 0 when qty=0 to prevent #DIV/0!)
const C_VAL_COL  = 8;   // H – Asset value  (opening value)

// Sales sheet
const S_DATE_ROW   = 1;
const S_DATA_START = 2;
const S_NAME_COL   = 3;   // C – item name
const S_DATE_START = 6;   // F – first date column
// The Sales date row is a mix: F1 is plain, G1–L1 are formulas (=F1+1 chain),
// then further cols (13, 14 … 36) revert to plain values in the template.
// We must write ALL plain cells in row 1, not just F1.

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
    // • per-qty deduction: sp_sale_lines.movement_id → sp_stock_movements.location_id
    //     → locations.supplier_partner_payable_deduction_per_qty
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
    // For every lot created on or before fromDate:
    //   opening_qty = MAX(qty_in − qty_sold_on_or_before_fromDate, 0)
    // Correct for any date range (not just current month).
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
  // FIX: When qty = 0, also write 0 to the Avg Cost cell (G = C_AVG_COL).
  // The template formula there is =H/E. If both H and E are null/0, Excel
  // computes 0/0 = #DIV/0!, which then propagates to ENTRY col F (Cost/Bag)
  // and from there into the Closing Stock Value formula — causing the #DIV/0!
  // errors visible in the exported sheet. Overwriting with the plain value 0
  // replaces the formula entirely so Excel shows 0 instead of the error.
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

    const qtyCell    = row.getCell(C_QTY_COL);
    const avgCostCell = row.getCell(C_AVG_COL);
    const valCell    = row.getCell(C_VAL_COL);

    if (!isFormula(qtyCell)) {
      qtyCell.value = stock.qty > 0 ? r3(stock.qty) : null;
    }
    if (!isFormula(valCell)) {
      const assetVal = stock.qty * stock.avgCost;
      valCell.value  = assetVal > 0 ? r2(assetVal) : null;
    }

    // Always set avg cost cell to prevent #DIV/0!:
    //   • qty > 0 → write computed avg cost (plain value, safe even if formula present)
    //   • qty = 0 → write 0 (overrides =H/E formula that would produce #DIV/0!)
    avgCostCell.value = stock.qty > 0 ? r2(stock.avgCost) : 0;

    row.commit();
  }

  // ── 2. Sales sheet: write ALL plain date cells in row 1, then item qty ─────
  // FIX: The Sales date row is not a single plain + formula chain.
  // The template has: F1 plain, G1–L1 formulas, then cols 13–18 and 36 also
  // plain (stale Jan-2024 dates left from the template). Writing only F1 leaves
  // those stale dates intact. Fix: iterate every cell in row 1 and write the
  // correct date to any non-formula cell, clear anything beyond the export range.
  if (salesWs) {
    const sDateRow  = salesWs.getRow(S_DATE_ROW);
    // Write dates to all non-formula cells within the export range
    for (let d = 0; d < dayCount; d++) {
      const cell = sDateRow.getCell(S_DATE_START + d);
      if (!isFormula(cell)) cell.value = addDays(startDate, d);
    }
    // Clear any stale plain date cells beyond the export range
    for (let d = dayCount; d < dayCount + 40; d++) {
      const cell = sDateRow.getCell(S_DATE_START + d);
      if (!isFormula(cell)) cell.value = null;
    }
    sDateRow.commit();

    // Item rows: write qty per day
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
      for (let d = dayCount; d < dayCount + 40; d++) {
        const cell = row.getCell(S_DATE_START + d);
        if (!isFormula(cell)) cell.value = 0;
      }
      row.commit();
    }
  }

  // ── 3. ENTRY sheet ────────────────────────────────────────────────────────

  // Pre-sweep: nullify every sharedFormula slave cell in the profit column
  // (baseCol+2 for each day) across ALL rows E_DATA_START–E_DATA_END.
  //
  // Why this is necessary:
  //   The template stores profit/bag as a shared formula — row 5 is the master
  //   (value: { formula: '=IF(G5=0,0,H5-$F5)' }) and rows 6–128 are slaves
  //   (value: { sharedFormula: 'I5' }).  When the main loop below overwrites
  //   the master cell with a plain number, ExcelJS removes the formula from
  //   that cell.  But rows that are skipped (e.g. "Total …" rows) still carry
  //   { sharedFormula: 'I5' }.  During wb.xlsx.writeBuffer() ExcelJS validates
  //   every slave reference; finding a slave that points to a non-formula master
  //   throws "Shared Formula master must exist above and or left of clone for
  //   cell I<N>".  Nullifying slaves here breaks the reference safely before
  //   we overwrite the master.
  for (let r = E_DATA_START; r <= E_DATA_END; r++) {
    const row = entryWs.getRow(r);
    let rowChanged = false;
    for (let d = 0; d < dayCount + 20; d++) {
      const profitCell = row.getCell(E_DATE_START + d * 3 + 2);
      const v = profitCell.value as any;
      if (v && typeof v === 'object' && 'sharedFormula' in v) {
        profitCell.value = null;
        rowChanged = true;
      }
    }
    if (rowChanged) row.commit();
  }

  // 3a. Date row (row 3)
  // G3/H3/I3 are the only plain cells; J3 onward are formula/shared-formula.
  // isFormula() now correctly detects both, so only G3/H3/I3 get written.
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
  // Qty (baseCol) and Sale Price (baseCol+1): plain cells — write normally.
  // Profit/Bag (baseCol+2): always write our computed deduction-adjusted value,
  //   bypassing the isFormula guard. The template has IF(G=0,0,H-$F) as a
  //   master formula in row 5 (isFormula=true) and shared-formula refs in rows
  //   6-128 (isFormula=true with the updated check). We need to override all of
  //   them with the real net-profit-per-bag that includes the warehouse deduction.
  //   Writing a plain value replaces the formula in the output file; fullCalcOnLoad
  //   does not undo plain cell overwrites.
  for (const [displayName, rowNum] of itemRows) {
    const systemCode  = nameToSystemCode.get(displayName) ?? displayName;
    const daySalesMap = getSalesMap(displayName, systemCode);
    const row         = entryWs.getRow(rowNum);

    for (let d = 0; d < dayCount; d++) {
      const baseCol    = E_DATE_START + d * 3;
      const qtyCell    = row.getCell(baseCol);
      const priceCell  = row.getCell(baseCol + 1);
      const profitCell = row.getCell(baseCol + 2);

      const ds = daySalesMap?.get(dates[d]);

      if (ds && ds.qty > 0) {
        const avgPrice    = ds.totalSales / ds.qty;
        const netProfitPB = (ds.totalSales - ds.totalCost - ds.totalDeduction) / ds.qty;

        if (!isFormula(qtyCell))   qtyCell.value   = r3(ds.qty);
        if (!isFormula(priceCell)) priceCell.value = r2(avgPrice);
        profitCell.value = r2(netProfitPB); // always write — bypasses formula guard
      } else {
        if (!isFormula(qtyCell))   qtyCell.value   = null;
        if (!isFormula(priceCell)) priceCell.value = null;
        profitCell.value = null;            // always clear — bypasses formula guard
      }
    }

    // Clear stale data beyond the export range
    for (let d = dayCount; d < dayCount + 15; d++) {
      const baseCol = E_DATE_START + d * 3;
      const qtyCell    = row.getCell(baseCol);
      const priceCell  = row.getCell(baseCol + 1);
      const profitCell = row.getCell(baseCol + 2);
      if (!isFormula(qtyCell))   qtyCell.value   = null;
      if (!isFormula(priceCell)) priceCell.value = null;
      profitCell.value = null;
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
