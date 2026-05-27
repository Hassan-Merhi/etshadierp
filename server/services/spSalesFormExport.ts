import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { db } from '../db';
import { sql } from 'drizzle-orm';

export interface SpSalesFormParams {
  companyId: number;
  locationId?: number;
  fromDate: string;
  toDate: string;
  locationName?: string;
  supplierName?: string;
}

function parseNum(v: any): number {
  const n = parseFloat(String(v ?? '0'));
  return isNaN(n) ? 0 : n;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export async function generateSpSalesFormExcel(params: SpSalesFormParams): Promise<Buffer> {
  const { companyId, locationId, fromDate, toDate, locationName = '', supplierName = '' } = params;

  const templatePath = path.join(process.cwd(), 'server', 'templates', 'supplier_partner_sales_form_template.xlsx');
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      'Supplier partner sales form template not found. ' +
      'Place the template at server/templates/supplier_partner_sales_form_template.xlsx'
    );
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  const entryWs = wb.getWorksheet('ENTRY');
  const costingWs = wb.getWorksheet('Costing');

  if (!entryWs) throw new Error('ENTRY sheet not found in template');
  if (!costingWs) throw new Error('Costing sheet not found in template');

  // ── Date range ──────────────────────────────────────────────────────────────
  const startDate = new Date(fromDate + 'T00:00:00.000Z');
  const endDate = new Date(toDate + 'T00:00:00.000Z');
  const dayCount = Math.max(1,
    Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1
  );

  // ── ENTRY column constants ────────────────────────────────────────────────
  // Col A=1, B=2, C=3 (display name), D=4 (article code), E=5 (Opening Stock formula),
  // F=6 (Cost/Bag formula), G=7 (Qty day0 DATA), H=8 (Sale Price day0 DATA),
  // I=9 (Profit/Bag formula), J=10 (Qty day1), K=11 (Sale Price day1), ...
  const ENTRY_DISPLAY_NAME_COL = 3; // C
  const ENTRY_ARTICLE_CODE_COL = 4; // D
  const ENTRY_DATE_START_COL = 7;   // G
  const ENTRY_DATA_START_ROW = 5;
  const ENTRY_LAST_ROW = entryWs.rowCount;

  // Set date cells in row 3 (G3:I3 merged, J3:L3 merged, etc.)
  // G3 = day0, J3 = day1, M3 = day2 ... each date master col = 7 + dayIdx*3
  for (let dayIdx = 0; dayIdx < dayCount; dayIdx++) {
    const dateVal = addDays(startDate, dayIdx);
    const masterCol = ENTRY_DATE_START_COL + dayIdx * 3;
    entryWs.getRow(3).getCell(masterCol).value = dateVal;
  }

  // ── Query SP-module sales ─────────────────────────────────────────────────
  const spSalesResult = await db.execute(sql`
    SELECT
      sl.article_code,
      s.sale_date::text AS sale_date,
      SUM(sl.qty_sold)::numeric           AS total_qty,
      SUM(sl.qty_sold * sl.sale_price_per_unit)::numeric AS total_revenue
    FROM sp_sale_lines sl
    JOIN sp_sales s ON sl.sale_id = s.id
    WHERE s.company_id = ${companyId}
      AND s.sale_date BETWEEN ${fromDate}::date AND ${toDate}::date
    GROUP BY sl.article_code, s.sale_date
    ORDER BY s.sale_date
  `);

  // ── Query ERP POS sales (vouchers / salesItems) ───────────────────────────
  const erpSalesResult = await db.execute(sql`
    SELECT
      si2.code                               AS article_code,
      v.voucher_date::text                   AS sale_date,
      SUM(si.quantity)::numeric              AS total_qty,
      SUM(si.quantity * si.selling_price)::numeric AS total_revenue
    FROM sales_items si
    JOIN vouchers v   ON si.voucher_id = v.id
    JOIN stock_items si2 ON si.stock_item_id = si2.id
    WHERE v.company_id = ${companyId}
      AND v.voucher_type IN ('Sales', 'SP Sales')
      AND v.voucher_date BETWEEN ${fromDate}::date AND ${toDate}::date
      AND v.deleted_at IS NULL
      ${locationId ? sql`AND (v.location_id = ${locationId} OR v.location_id IS NULL)` : sql``}
    GROUP BY si2.code, v.voucher_date
    ORDER BY v.voucher_date
  `);

  // ── Build sales map: articleCode → dateStr → {qty, totalRevenue} ─────────
  type DaySales = { qty: number; totalRevenue: number };
  const salesMap = new Map<string, Map<string, DaySales>>();

  const addSale = (articleCode: string, date: string, qty: number, totalRevenue: number) => {
    if (!articleCode || !date) return;
    if (!salesMap.has(articleCode)) salesMap.set(articleCode, new Map());
    const dm = salesMap.get(articleCode)!;
    const prev = dm.get(date) ?? { qty: 0, totalRevenue: 0 };
    dm.set(date, { qty: prev.qty + qty, totalRevenue: prev.totalRevenue + totalRevenue });
  };

  const spRows = (spSalesResult as any).rows ?? (spSalesResult as any[]);
  for (const r of spRows) {
    addSale(r.article_code, r.sale_date, parseNum(r.total_qty), parseNum(r.total_revenue));
  }

  const erpRows = (erpSalesResult as any).rows ?? (erpSalesResult as any[]);
  for (const r of erpRows) {
    addSale(r.article_code, r.sale_date, parseNum(r.total_qty), parseNum(r.total_revenue));
  }

  // ── Query inventory for Costing population ───────────────────────────────
  const invResult = await db.execute(sql`
    SELECT
      si.code          AS article_code,
      si.uom,
      COALESCE(i.quantity, 0)::numeric      AS on_hand,
      COALESCE(i.total_value, 0)::numeric   AS total_value,
      COALESCE(i.average_rate, 0)::numeric  AS avg_rate
    FROM stock_items si
    LEFT JOIN inventory i
      ON i.stock_item_id = si.id
      AND i.company_id = ${companyId}
      ${locationId ? sql`AND i.location_id = ${locationId}` : sql``}
    WHERE si.company_id = ${companyId}
      AND si.deleted_at IS NULL
  `);

  const invMap = new Map<string, { onHand: number; totalValue: number; avgRate: number; uom: string }>();
  const invRows = (invResult as any).rows ?? (invResult as any[]);
  for (const r of invRows) {
    invMap.set(r.article_code, {
      onHand: parseNum(r.on_hand),
      totalValue: parseNum(r.total_value),
      avgRate: parseNum(r.avg_rate),
      uom: r.uom || 'Pcs',
    });
  }

  // Also query from sp_stock_movements for remaining qty and cost per article code
  const movResult = await db.execute(sql`
    SELECT
      article_code,
      SUM(qty_remaining)::numeric         AS qty_remaining,
      SUM(qty_remaining * final_unit_cost_usd)::numeric AS total_remaining_value
    FROM sp_stock_movements
    WHERE company_id = ${companyId}
      ${locationId ? sql`AND location_id = ${locationId}` : sql``}
    GROUP BY article_code
  `);
  const movRows = (movResult as any).rows ?? (movResult as any[]);
  for (const r of movRows) {
    if (!invMap.has(r.article_code) && parseNum(r.qty_remaining) > 0) {
      const qty = parseNum(r.qty_remaining);
      const val = parseNum(r.total_remaining_value);
      invMap.set(r.article_code, {
        onHand: qty,
        totalValue: val,
        avgRate: qty > 0 ? val / qty : 0,
        uom: 'Bales',
      });
    }
  }

  // ── Scan ENTRY: build displayName → articleCode map ──────────────────────
  const nameToCode = new Map<string, string>();
  for (let r = ENTRY_DATA_START_ROW; r <= ENTRY_LAST_ROW; r++) {
    const row = entryWs.getRow(r);
    const displayNameVal = row.getCell(ENTRY_DISPLAY_NAME_COL).value;
    const articleCodeVal = row.getCell(ENTRY_ARTICLE_CODE_COL).value;
    if (
      typeof displayNameVal === 'string' && displayNameVal.trim() &&
      typeof articleCodeVal === 'string' && articleCodeVal.trim()
    ) {
      nameToCode.set(displayNameVal.trim(), articleCodeVal.trim());
    }
  }

  // ── Fill ENTRY: Qty and Sale Price per item per date ─────────────────────
  for (let r = ENTRY_DATA_START_ROW; r <= ENTRY_LAST_ROW; r++) {
    const row = entryWs.getRow(r);
    const articleCodeCell = row.getCell(ENTRY_ARTICLE_CODE_COL);
    const articleCodeVal = articleCodeCell.value;

    if (typeof articleCodeVal !== 'string' || !articleCodeVal.trim()) continue;
    const articleCode = articleCodeVal.trim();

    const itemDateMap = salesMap.get(articleCode);

    for (let dayIdx = 0; dayIdx < dayCount; dayIdx++) {
      const dateStr = dateOnly(addDays(startDate, dayIdx));
      const qtyCol = ENTRY_DATE_START_COL + dayIdx * 3;
      const priceCol = ENTRY_DATE_START_COL + dayIdx * 3 + 1;

      const sales = itemDateMap?.get(dateStr);
      if (sales && sales.qty > 0) {
        const avgPrice = sales.qty > 0 ? sales.totalRevenue / sales.qty : 0;
        row.getCell(qtyCol).value = Math.round(sales.qty * 1000) / 1000;
        row.getCell(priceCol).value = Math.round(avgPrice * 100) / 100;
      } else {
        const qtyCell = row.getCell(qtyCol);
        const priceCell = row.getCell(priceCol);
        // Only clear if it's a plain value (don't clear formulas)
        if (!qtyCell.value || typeof qtyCell.value !== 'object') qtyCell.value = null;
        if (!priceCell.value || typeof priceCell.value !== 'object') priceCell.value = null;
      }
    }
  }

  // ── Fill Costing: E (on hand) and H (asset value) per item ───────────────
  // G (avg cost) = H/E formula → auto-derives
  const COSTING_DISPLAY_NAME_COL = 4; // D
  const COSTING_ON_HAND_COL = 5;      // E
  const COSTING_UOM_COL = 6;          // F
  const COSTING_ASSET_VALUE_COL = 8;  // H

  const costingLastRow = costingWs.rowCount;
  for (let r = 2; r <= costingLastRow; r++) {
    const row = costingWs.getRow(r);
    const nameCell = row.getCell(COSTING_DISPLAY_NAME_COL);
    const nameVal = nameCell.value;

    if (typeof nameVal !== 'string' || !nameVal.trim()) continue;
    const displayName = nameVal.trim();

    const articleCode = nameToCode.get(displayName);
    if (!articleCode) continue;

    const inv = invMap.get(articleCode);
    if (!inv) continue;

    // Only write to non-formula cells
    const onHandCell = row.getCell(COSTING_ON_HAND_COL);
    if (!onHandCell.value || typeof onHandCell.value !== 'object' || !(onHandCell.value as any).formula) {
      onHandCell.value = inv.onHand > 0 ? Math.round(inv.onHand * 1000) / 1000 : null;
    }

    const assetCell = row.getCell(COSTING_ASSET_VALUE_COL);
    if (!assetCell.value || typeof assetCell.value !== 'object' || !(assetCell.value as any).formula) {
      assetCell.value = inv.totalValue > 0 ? Math.round(inv.totalValue * 100) / 100 : null;
    }

    const uomCell = row.getCell(COSTING_UOM_COL);
    if (!uomCell.value) {
      uomCell.value = inv.uom;
    }
  }

  const rawBuf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
}
