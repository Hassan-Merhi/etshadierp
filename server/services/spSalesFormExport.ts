import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { db } from '../db';
import { sql } from 'drizzle-orm';

// ── Public interface ──────────────────────────────────────────────────────────

export interface SpSalesFormParams {
  companyId: number;
  fromDate: string;      // YYYY-MM-DD  (opening stock = stock at END of this day)
  toDate: string;        // YYYY-MM-DD
  supplierName?: string;
  locationName?: string; // kept for API compat / filename use; data always all-locations
  locationId?: number;   // kept for API compat but ignored – always all-locations
}

// ── Internal types ────────────────────────────────────────────────────────────

interface DaySales {
  qty: number;
  totalSales: number;
  totalCost: number;
  totalDeduction: number;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function pn(v: unknown): number {
  const n = parseFloat(String(v ?? '0'));
  return isNaN(n) ? 0 : n;
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** 1-based column number → Excel letter (A, B, …, AA, AB, …) */
function colLetter(col: number): string {
  let result = '';
  let c = col;
  while (c > 0) { c--; result = String.fromCharCode(65 + (c % 26)) + result; c = Math.floor(c / 26); }
  return result;
}

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
const E_DATE_ROW = 3;
const E_HEADER_ROW = 4;
const E_DATA_START = 5;
const E_DATA_END = 128;    // last item row before Total rows
const E_GROUP_COL = 2;     // B  – group name (GC-Hand Bags / GC-Shoes …)
const E_NAME_COL = 3;      // C  – display name / primary code key
const E_CODE_COL = 4;      // D  – explicit system code (sometimes blank)
const E_OPEN_COL = 5;      // E  – Opening Stock  (formula from Costing)
const E_COST_COL = 6;      // F  – Cost / Bag     (formula from Costing)
const E_DATE_START = 7;    // G  – first date block  (Qty day-0)
// For day d: qtyCol = E_DATE_START + d*3, priceCol +1, profitCol +2

// Costing sheet
const C_GROUP_COL = 3;     // C
const C_NAME_COL = 4;      // D  – same values as ENTRY col C
const C_QTY_COL = 5;       // E  – On Hand  (we write opening stock here)
const C_UOM_COL = 6;       // F
const C_AVG_COL = 7;       // G  – Avg Cost  (formula H/E  – leave as-is)
const C_VAL_COL = 8;       // H  – Asset Value  (we write opening value here)

// Sales sheet
const S_DATE_ROW = 1;
const S_DATA_START = 2;
const S_GROUP_COL = 2;     // B
const S_NAME_COL = 3;      // C  – same key as ENTRY col C
const S_DATE_START = 6;    // F  – first date column (one col per day)

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
  const [salesRes, invRes, afterRes] = await Promise.all([

    // 1. Daily sales within range – all locations, include credit sales
    //    Adds deduction from locations that have supplier_partner_payable_deduction_per_qty
    db.execute(sql`
      SELECT
        si2.code                                                                           AS item_code,
        v.voucher_date::text                                                               AS sale_date,
        SUM(si.quantity)::numeric                                                          AS qty,
        SUM(si.total_sales)::numeric                                                       AS total_sales,
        SUM(si.total_cost)::numeric                                                        AS total_cost,
        SUM(si.quantity *
            COALESCE(l.supplier_partner_payable_deduction_per_qty, 0))::numeric           AS total_deduction
      FROM  sales_items si
      JOIN  vouchers     v    ON si.voucher_id    = v.id
      JOIN  stock_items  si2  ON si.stock_item_id = si2.id
      LEFT  JOIN locations l  ON v.location_id    = l.id
      WHERE v.company_id    = ${companyId}
        AND v.voucher_type IN ('Sales', 'SP Sales')
        AND v.deleted_at   IS NULL
        AND v.voucher_date BETWEEN ${fromDate}::date AND ${toDate}::date
      GROUP BY si2.code, v.voucher_date
      ORDER BY v.voucher_date
    `),

    // 2. Current inventory – all locations combined
    db.execute(sql`
      SELECT
        si.code,
        SUM(i.quantity)::numeric    AS qty,
        SUM(i.total_value)::numeric AS total_val
      FROM  inventory   i
      JOIN  stock_items si ON i.stock_item_id = si.id
      WHERE i.company_id = ${companyId}
      GROUP BY si.code
    `),

    // 3. Sales AFTER fromDate (all dates, no upper bound) – used to reconstruct
    //    opening stock at end of fromDate:
    //      openingQty = currentQty + salesQtyAfterFromDate
    //    (Assumes no new stock was received after fromDate; accurate for same-month exports.)
    db.execute(sql`
      SELECT
        si2.code,
        SUM(si.quantity)::numeric AS qty_after
      FROM  sales_items si
      JOIN  vouchers     v    ON si.voucher_id    = v.id
      JOIN  stock_items  si2  ON si.stock_item_id = si2.id
      WHERE v.company_id    = ${companyId}
        AND v.voucher_type IN ('Sales', 'SP Sales')
        AND v.deleted_at   IS NULL
        AND v.voucher_date  > ${fromDate}::date
      GROUP BY si2.code
    `),
  ]);

  const salesRows = (salesRes as any).rows ?? (salesRes as any[]);
  const invRows   = (invRes   as any).rows ?? (invRes   as any[]);
  const afterRows = (afterRes as any).rows ?? (afterRes as any[]);

  // ── Build in-memory data structures ──────────────────────────────────────

  // salesMap: itemCode → dateStr → DaySales
  const salesMap = new Map<string, Map<string, DaySales>>();
  for (const r of salesRows) {
    const code = String(r.item_code ?? '').trim();
    if (!code) continue;
    if (!salesMap.has(code)) salesMap.set(code, new Map());
    const dm  = salesMap.get(code)!;
    const key = String(r.sale_date);
    const prev = dm.get(key) ?? { qty: 0, totalSales: 0, totalCost: 0, totalDeduction: 0 };
    dm.set(key, {
      qty:            prev.qty + pn(r.qty),
      totalSales:     prev.totalSales + pn(r.total_sales),
      totalCost:      prev.totalCost + pn(r.total_cost),
      totalDeduction: prev.totalDeduction + pn(r.total_deduction),
    });
  }

  // curInv: itemCode → { qty, avgCost }
  const curInv = new Map<string, { qty: number; avgCost: number }>();
  for (const r of invRows) {
    const qty = pn(r.qty);
    const val = pn(r.total_val);
    curInv.set(String(r.code), { qty, avgCost: qty > 0 ? val / qty : 0 });
  }

  // afterMap: itemCode → qty sold after fromDate
  const afterMap = new Map<string, number>();
  for (const r of afterRows) afterMap.set(String(r.code), pn(r.qty_after));

  /** Opening stock at end of fromDate = current qty + (sales qty after fromDate) */
  const openingOf = (code: string) => {
    const inv     = curInv.get(code) ?? { qty: 0, avgCost: 0 };
    const soldAfter = afterMap.get(code) ?? 0;
    return { qty: inv.qty + soldAfter, avgCost: inv.avgCost };
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

  // ── Scan ENTRY: build nameToSystemCode map ────────────────────────────────
  // Traverse rows 5-128; build:
  //   nameToSystemCode: entryColC → stock item code
  //     (uses col D when present, else col C itself)
  //   itemRows: entryColC → ENTRY row number (only real item rows)
  const nameToSystemCode = new Map<string, string>();
  const itemRows          = new Map<string, number>();   // colC name → ENTRY row

  for (let r = E_DATA_START; r <= E_DATA_END; r++) {
    const row      = entryWs.getRow(r);
    const nameCell = row.getCell(E_NAME_COL).value;
    const codeCell = row.getCell(E_CODE_COL).value;

    if (typeof nameCell !== 'string' || !nameCell.trim()) continue;
    const displayName = nameCell.trim();
    if (displayName.startsWith('Total ')) continue;  // skip sub-total rows

    const systemCode =
      typeof codeCell === 'string' && codeCell.trim()
        ? codeCell.trim()
        : displayName;

    nameToSystemCode.set(displayName, systemCode);
    itemRows.set(displayName, r);
  }

  // ── 1. Costing sheet: write opening stock ─────────────────────────────────
  const costingLastRow = costingWs.rowCount;
  for (let r = 2; r <= costingLastRow; r++) {
    const row      = costingWs.getRow(r);
    const nameCell = row.getCell(C_NAME_COL).value;
    if (typeof nameCell !== 'string' || !nameCell.trim()) continue;
    const displayName = nameCell.trim();
    if (displayName.startsWith('Total ') || displayName === 'Inventory') continue;

    // Look up system code via ENTRY map; fall back to the Costing name itself
    const systemCode = nameToSystemCode.get(displayName) ?? displayName;
    const stock      = openingOf(systemCode);

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

  // ── 2. Sales sheet: write dates (row 1) and qty (item rows) ───────────────
  if (salesWs) {
    // Date row
    const sDateRow = salesWs.getRow(S_DATE_ROW);
    for (let d = 0; d < dayCount; d++) {
      sDateRow.getCell(S_DATE_START + d).value = addDays(startDate, d);
    }
    // Clear stale dates beyond range (first 10 extra slots)
    for (let d = dayCount; d < dayCount + 10; d++) {
      const cell = sDateRow.getCell(S_DATE_START + d);
      if (!isFormula(cell)) cell.value = null;
    }
    sDateRow.commit();

    // Item rows
    const salesWsLast = salesWs.rowCount;
    for (let r = S_DATA_START; r <= salesWsLast; r++) {
      const row      = salesWs.getRow(r);
      const nameCell = row.getCell(S_NAME_COL).value;
      if (typeof nameCell !== 'string' || !nameCell.trim()) continue;
      const displayName = nameCell.trim();
      if (displayName.startsWith('Total ')) continue;

      const systemCode  = nameToSystemCode.get(displayName) ?? displayName;
      const daySalesMap = salesMap.get(systemCode);

      for (let d = 0; d < dayCount; d++) {
        const cell = row.getCell(S_DATE_START + d);
        if (isFormula(cell)) continue;
        const ds = daySalesMap?.get(dates[d]);
        cell.value = ds && ds.qty > 0 ? r3(ds.qty) : 0;
      }
      // Clear beyond range
      for (let d = dayCount; d < dayCount + 10; d++) {
        const cell = row.getCell(S_DATE_START + d);
        if (!isFormula(cell)) cell.value = 0;
      }
      row.commit();
    }
  }

  // ── 3. ENTRY sheet ────────────────────────────────────────────────────────

  // 3a. Date row (row 3): write date to all 3 cols in each date block
  //     (overrides cached formula results so Excel shows correct dates immediately)
  const eDateRow = entryWs.getRow(E_DATE_ROW);
  for (let d = 0; d < dayCount; d++) {
    const dateVal = addDays(startDate, d);
    const baseCol = E_DATE_START + d * 3;
    eDateRow.getCell(baseCol).value     = dateVal;  // Qty col
    eDateRow.getCell(baseCol + 1).value = dateVal;  // Sale Price col
    eDateRow.getCell(baseCol + 2).value = dateVal;  // Profit/Bag col
  }
  // Clear date blocks beyond the export range (prevents old dates from showing)
  for (let d = dayCount; d < dayCount + 15; d++) {
    const baseCol = E_DATE_START + d * 3;
    for (let c = baseCol; c < baseCol + 3; c++) {
      const cell = eDateRow.getCell(c);
      if (!isFormula(cell)) cell.value = null;
    }
  }
  eDateRow.commit();

  // 3b. Item data rows
  for (const [displayName, rowNum] of itemRows) {
    const systemCode  = nameToSystemCode.get(displayName) ?? displayName;
    const daySalesMap = salesMap.get(systemCode);
    const row         = entryWs.getRow(rowNum);

    for (let d = 0; d < dayCount; d++) {
      const baseCol   = E_DATE_START + d * 3;
      const qtyCol    = baseCol;
      const priceCol  = baseCol + 1;
      const profitCol = baseCol + 2;

      const qtyCell    = row.getCell(qtyCol);
      const priceCell  = row.getCell(priceCol);
      const profitCell = row.getCell(profitCol);

      const ds = daySalesMap?.get(dates[d]);

      if (ds && ds.qty > 0) {
        const avgPrice     = ds.totalSales / ds.qty;
        // Net profit per bag already accounts for -$5 location deduction
        const netProfitPB  = (ds.totalSales - ds.totalCost - ds.totalDeduction) / ds.qty;

        // Write plain values (overrides template IF-formula so deduction is reflected)
        qtyCell.value    = r3(ds.qty);
        priceCell.value  = r2(avgPrice);
        profitCell.value = r2(netProfitPB);
      } else {
        // No sales for this item on this date → clear data cells
        if (!isFormula(qtyCell))    qtyCell.value    = null;
        if (!isFormula(priceCell))  priceCell.value  = null;
        if (!isFormula(profitCell)) profitCell.value = null;
      }
    }

    // Clear data beyond the export range
    for (let d = dayCount; d < dayCount + 15; d++) {
      const baseCol = E_DATE_START + d * 3;
      for (let c = baseCol; c < baseCol + 3; c++) {
        const cell = row.getCell(c);
        if (!isFormula(cell)) cell.value = null;
      }
    }

    row.commit();
  }

  // ── 4. Summary-Itemwise: set date reference cell (B1) to toDate ───────────
  //    The sheet uses VLOOKUP referencing this date to find the right ENTRY column.
  if (summaryIWs) {
    summaryIWs.getRow(1).getCell(2).value = toUtcDate(toDate);
  }

  // ── 5. Hide Ageing sheet (keep it so cross-sheet formula refs stay valid) ──
  if (ageingWs) {
    (ageingWs as any).state = 'hidden';
  }

  // ── 6. Output ─────────────────────────────────────────────────────────────
  const rawBuf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
}
