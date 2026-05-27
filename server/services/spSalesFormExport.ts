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
const E_NAME_COL   = 3;   // C – display name (= article_code key)
const E_CODE_COL   = 4;   // D – optional system code override
const E_DATE_START = 7;   // G – first date block (Qty col for day 0)
// Pattern: day d → baseCol = E_DATE_START + d*3
//   baseCol   = Qty
//   baseCol+1 = Sale Price
//   baseCol+2 = Profit/Bag  ← formula IF(G=0,0,H-$F); do NOT write

// Costing sheet
const C_NAME_COL = 4;   // D – item name (same as ENTRY col C)
const C_QTY_COL  = 5;   // E – On Hand qty  (we write opening stock here)
const C_VAL_COL  = 8;   // H – Asset value  (we write opening value here)

// Sales sheet
const S_DATE_ROW   = 1;
const S_DATA_START = 2;
const S_NAME_COL   = 3;   // C – item name (same as ENTRY col C)
const S_DATE_START = 6;   // F – first date column (one col per day; F+1 is formula)

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

  // ── DB queries (all in parallel) ──────────────────────────────────────────
  // All three queries use SP-specific tables:
  //   sp_sale_lines + sp_sales  → actual SP sales data
  //   sp_stock_movements        → actual SP stock (FIFO lots)
  const [salesRes, invRes, afterRes] = await Promise.all([

    // 1. Daily SP sales within the export range
    db.execute(sql`
      SELECT
        sl.article_code,
        s.sale_date::text                                    AS sale_date,
        SUM(sl.qty_sold)::numeric                            AS qty,
        SUM(sl.qty_sold * sl.sale_price_per_unit)::numeric   AS total_sales,
        SUM(sl.qty_sold * sl.final_unit_cost_usd)::numeric   AS total_cost
      FROM  sp_sale_lines sl
      JOIN  sp_sales      s  ON sl.sale_id   = s.id
      WHERE sl.company_id = ${companyId}
        AND s.status      = 'posted'
        AND s.sale_date BETWEEN ${fromDate}::date AND ${toDate}::date
      GROUP BY sl.article_code, s.sale_date
      ORDER BY s.sale_date
    `),

    // 2. Current SP stock (all lots with qty_remaining > 0, weighted-avg cost)
    db.execute(sql`
      SELECT
        article_code,
        SUM(qty_remaining)::numeric                                              AS qty,
        CASE WHEN SUM(qty_remaining) > 0
             THEN SUM(qty_remaining::numeric * final_unit_cost_usd::numeric)
                  / SUM(qty_remaining)
             ELSE 0
        END::numeric                                                             AS avg_cost
      FROM  sp_stock_movements
      WHERE company_id   = ${companyId}
        AND qty_remaining > 0
      GROUP BY article_code
    `),

    // 3. SP sales AFTER fromDate → reconstruct opening stock at end of fromDate
    //    openingQty = currentQty + qtySoldAfterFromDate
    //    (accurate when no new stock arrived after fromDate; true for same-month exports)
    db.execute(sql`
      SELECT
        sl.article_code,
        SUM(sl.qty_sold)::numeric AS qty_after
      FROM  sp_sale_lines sl
      JOIN  sp_sales      s  ON sl.sale_id   = s.id
      WHERE sl.company_id = ${companyId}
        AND s.status      = 'posted'
        AND s.sale_date   > ${fromDate}::date
      GROUP BY sl.article_code
    `),
  ]);

  const salesRows = (salesRes as any).rows ?? (salesRes as any[]);
  const invRows   = (invRes   as any).rows ?? (invRes   as any[]);
  const afterRows = (afterRes as any).rows ?? (afterRes as any[]);

  // ── Build in-memory data structures ──────────────────────────────────────

  // salesMap: articleCode → dateStr → DaySales
  const salesMap = new Map<string, Map<string, DaySales>>();
  for (const r of salesRows) {
    const code = String(r.article_code ?? '').trim();
    if (!code) continue;
    if (!salesMap.has(code)) salesMap.set(code, new Map());
    const dm   = salesMap.get(code)!;
    const key  = String(r.sale_date).slice(0, 10);
    const prev = dm.get(key) ?? { qty: 0, totalSales: 0, totalCost: 0 };
    dm.set(key, {
      qty:        prev.qty        + pn(r.qty),
      totalSales: prev.totalSales + pn(r.total_sales),
      totalCost:  prev.totalCost  + pn(r.total_cost),
    });
  }

  // curInv: articleCode → { qty, avgCost }
  const curInv = new Map<string, { qty: number; avgCost: number }>();
  for (const r of invRows) {
    curInv.set(String(r.article_code).trim(), {
      qty:     pn(r.qty),
      avgCost: pn(r.avg_cost),
    });
  }

  // afterMap: articleCode → qty sold after fromDate
  const afterMap = new Map<string, number>();
  for (const r of afterRows) afterMap.set(String(r.article_code).trim(), pn(r.qty_after));

  /** Opening stock at end of fromDate.
   *  avgCost from current lots (FIFO cost is stable if no new arrivals after fromDate). */
  const openingOf = (articleCode: string) => {
    const inv       = curInv.get(articleCode) ?? { qty: 0, avgCost: 0 };
    const soldAfter = afterMap.get(articleCode) ?? 0;
    return { qty: inv.qty + soldAfter, avgCost: inv.avgCost };
  };

  /** Find DaySales for an ENTRY/Costing/Sales display name.
   *  Tries displayName first (= article_code in most cases), then systemCode fallback. */
  const getSalesMap = (displayName: string, systemCode: string) =>
    salesMap.get(displayName) ?? salesMap.get(systemCode);

  const getOpening = (displayName: string, systemCode: string) => {
    const byDisplay = curInv.has(displayName) || afterMap.has(displayName)
      ? openingOf(displayName) : null;
    if (byDisplay && (byDisplay.qty > 0 || afterMap.has(displayName))) return byDisplay;
    return openingOf(systemCode);
  };

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

  // ── Scan ENTRY rows 5-128: build name → systemCode + row number maps ───────
  // displayName  = ENTRY col C (= article_code in SP sale_lines)
  // systemCode   = ENTRY col D when present, else same as displayName
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
    const row      = costingWs.getRow(r);
    const nameRaw  = row.getCell(C_NAME_COL).value;
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
      valCell.value = assetVal > 0 ? r2(assetVal) : null;
    }
    row.commit();
  }

  // ── 2. Sales sheet: write F1 (start date) and qty per item per day ─────────
  // Row 1: F1 is a plain value; G1, H1… are formula =F1+1, =G1+1, etc.
  //        → only write F1 (col 6 = S_DATE_START), leave formula cells alone.
  if (salesWs) {
    const sDateRow = salesWs.getRow(S_DATE_ROW);
    const startCell = sDateRow.getCell(S_DATE_START);
    if (!isFormula(startCell)) startCell.value = addDays(startDate, 0);
    sDateRow.commit();

    // Item rows: write qty; formula cells (COUNTIF etc.) are left untouched
    const salesWsLast = salesWs.rowCount;
    for (let r = S_DATA_START; r <= salesWsLast; r++) {
      const row      = salesWs.getRow(r);
      const nameRaw  = row.getCell(S_NAME_COL).value;
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
      // Clear stale columns beyond export range
      for (let d = dayCount; d < dayCount + 10; d++) {
        const cell = row.getCell(S_DATE_START + d);
        if (!isFormula(cell)) cell.value = 0;
      }
      row.commit();
    }
  }

  // ── 3. ENTRY sheet ────────────────────────────────────────────────────────

  // 3a. Date row (row 3)
  //   Template structure: G3/H3/I3 = plain values (start date)
  //                       J3/K3/L3 = formula "G3+1"
  //                       M3/N3/O3 = formula "J3+1"  … etc.
  //   → Only write to non-formula cells (isFormula guard on WRITE too).
  //     Writing only G3 (+ H3/I3 which are also plain) is enough;
  //     the formula chain propagates all subsequent dates automatically.
  const eDateRow = entryWs.getRow(E_DATE_ROW);
  for (let d = 0; d < dayCount; d++) {
    const dateVal = addDays(startDate, d);
    const baseCol = E_DATE_START + d * 3;
    for (let c = baseCol; c < baseCol + 3; c++) {
      const cell = eDateRow.getCell(c);
      if (!isFormula(cell)) cell.value = dateVal;   // only plain cells
    }
  }
  // Clear stale date blocks beyond range
  for (let d = dayCount; d < dayCount + 15; d++) {
    const baseCol = E_DATE_START + d * 3;
    for (let c = baseCol; c < baseCol + 3; c++) {
      const cell = eDateRow.getCell(c);
      if (!isFormula(cell)) cell.value = null;
    }
  }
  eDateRow.commit();

  // 3b. Item data rows: write Qty and Sale Price; leave Profit/Bag alone
  //   The profit column (baseCol+2) has formula IF(G=0,0,H-$F) where $F is
  //   avg cost from Costing. Writing a plain value here breaks the Summary
  //   Total Profit SUMPRODUCT. Leave it as a formula.
  for (const [displayName, rowNum] of itemRows) {
    const systemCode  = nameToSystemCode.get(displayName) ?? displayName;
    const daySalesMap = getSalesMap(displayName, systemCode);
    const row         = entryWs.getRow(rowNum);

    for (let d = 0; d < dayCount; d++) {
      const baseCol  = E_DATE_START + d * 3;
      const qtyCell   = row.getCell(baseCol);
      const priceCell = row.getCell(baseCol + 1);
      // baseCol+2 = Profit/Bag formula → intentionally NOT written

      const ds = daySalesMap?.get(dates[d]);

      if (ds && ds.qty > 0) {
        const avgPrice = ds.totalSales / ds.qty;
        if (!isFormula(qtyCell))   qtyCell.value   = r3(ds.qty);
        if (!isFormula(priceCell)) priceCell.value = r2(avgPrice);
      } else {
        if (!isFormula(qtyCell))   qtyCell.value   = null;
        if (!isFormula(priceCell)) priceCell.value = null;
      }
    }

    // Clear stale data beyond the export range
    for (let d = dayCount; d < dayCount + 15; d++) {
      const baseCol = E_DATE_START + d * 3;
      for (let c = baseCol; c < baseCol + 2; c++) {   // only Qty+Price, not Profit
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
