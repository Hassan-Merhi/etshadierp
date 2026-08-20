/**
 * tests/excel-export-v2.test.ts
 *
 * Validates the V2 from-scratch ExcelJS export (generateSpSalesFormExcelV2).
 *
 * Test range: 2026-07-01 → 2026-07-07 (7 days)
 *
 * Seed plan
 * ─────────
 *   item1  Valid Sales voucher    Jul 3  qty=10  totalSales=120  totalCost=100
 *   item2  Deleted Sales voucher  Jul 2  qty=5   (deleted_at set → must be excluded)
 *   item2  Optional Sales voucher Jul 4  qty=7   (optional=true  → must be excluded)
 *   item3  Journal voucher        Jul 5  qty=3   (wrong type     → must be excluded)
 *
 * ENTRY row layout (3 items, 1 group):
 *   Row 4: Test Item 1  ─┐
 *   Row 5: Test Item 2   ├ items (xlsxv2test_TestGroup)
 *   Row 6: Test Item 3  ─┘
 *   Row 7: subtotal row (xlsxv2test_TestGroup)
 *   Row 8: TOTAL row (green)
 *   Row 10: CASH & BANK SUMMARY header
 *   Row 11: CASH/BANK sub-headers
 *   Row 12: Opening Cash
 *   Row 13: Cash deposit in Bank
 *   Row 14: Receipt from Credit Sales
 *   Row 16: PAYMENTS header
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import {
  seedTestData,
  cleanupTestData,
  closeTestServer,
  type TestContext,
} from "./setup";
import { pool } from "../server/db";
import { generateSpSalesFormExcelV2 } from "../server/services/spSalesFormExportV2";
import { calculateHistoricalLocationInventory } from "../server/routes/helpers/inventoryHistoryHelpers";

const TEST_PREFIX = "xlsxv2p2";
const FROM  = "2026-07-01";
const TO    = "2026-07-07";
const DAY_COUNT = 7; // Jul 1–7

// ENTRY sheet constants (mirrors spSalesFormExportV2.ts)
// A=RowNum, B=Group, C=ItemName, D=Code, E=OpenQty, F=Cost/Bag
const FIXED_LEFT   = 6;  // cols 1-6: RowNum, Group, Name, Code, OpenQty, Cost/Bag
const COLS_PER_DAY = 3;
const E_GROUP_COL     = 2;  // B
const E_ITEM_NAME_COL = 3;  // C
const E_ITEM_CODE_COL = 4;  // D
const E_OPEN_QTY_COL  = 5;  // E
const E_COST_BAG_COL  = 6;  // F
const E_DATE_START    = FIXED_LEFT + 1;  // 7 — first Qty column for day 0
const CLOSE_QTY_COL   = FIXED_LEFT + 1 + DAY_COUNT * COLS_PER_DAY; // 28
const CLOSE_VAL_COL   = CLOSE_QTY_COL + 1; // 29

// With 3 items + 1 group, the row layout is:
// Row 4: item1, Row 5: item2, Row 6: item3
// Row 7: subtotal, Row 8: TOTAL
const E_DATA_ROW_START = 4;
const ITEM_COUNT       = 3;
const E_SUBTOTAL_ROW   = E_DATA_ROW_START + ITEM_COUNT;      // 7
const E_TOTAL_ROW      = E_SUBTOTAL_ROW + 1;                  // 8
// Cash section (totalRow + 2 gap)
const E_CASH_HDR_ROW   = E_TOTAL_ROW + 2;                     // 10
const E_CASH_SUBHDR    = E_CASH_HDR_ROW + 1;                  // 11
const E_OPEN_CASH_ROW  = E_CASH_SUBHDR + 1;                   // 12
const E_DEPOSIT_ROW    = E_OPEN_CASH_ROW + 1;                 // 13
const E_RECEIPT_ROW    = E_DEPOSIT_ROW + 1;                    // 14
const E_PAYMENTS_ROW   = E_RECEIPT_ROW + 2;                   // 16
const NUM_PAYMENT_ROWS = 10;
const E_PAY_FIRST_ROW  = E_PAYMENTS_ROW + 1;                  // 17
const E_PAY_LAST_ROW   = E_PAYMENTS_ROW + NUM_PAYMENT_ROWS;   // 26
const E_TOTAL_PAY_ROW  = E_PAY_LAST_ROW + 1;                  // 27
const E_BALANCE_ROW    = E_TOTAL_PAY_ROW + 1;                 // 28

// Sales sheet constants
const S_ITEM_NAME_COL = 3;
const S_DATE_START    = 4;

let ctx: TestContext;
let buf: Buffer;
let wb:  ExcelJS.Workbook;

let expectedOpenQtyItem1  = 0;
let expectedCloseQtyItem1 = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Find a data row in ENTRY sheet by item name (column C). Skips subtotal / header rows. */
function findItemRow(ws: ExcelJS.Worksheet, itemName: string, nameCol = E_ITEM_NAME_COL): number | null {
  for (let r = E_DATA_ROW_START; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(nameCol).value;
    if (typeof v === "string" && v.trim() === itemName) return r;
  }
  return null;
}

/** Scan all rows for a cell in col 1 that contains the given string (case-insensitive). */
function findRowByCol1(ws: ExcelJS.Worksheet, contains: string): number | null {
  const lc = contains.toLowerCase();
  for (let r = 1; r <= ws.rowCount + 30; r++) {
    const v = ws.getRow(r).getCell(1).value;
    if (typeof v === "string" && v.toLowerCase().includes(lc)) return r;
  }
  return null;
}

/** Extract numeric result from plain number or formula-object cell. */
function cellNum(ws: ExcelJS.Worksheet, row: number, col: number): number | null {
  const v = ws.getRow(row).getCell(col).value as any;
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) {
    const r = v.result;
    if (r === null || r === undefined) return null;
    return typeof r === "number" ? r : Number(r);
  }
  return null;
}

/** Extract the formula string from a cell (or null if not a formula). */
function cellFormula(ws: ExcelJS.Worksheet, row: number, col: number): string | null {
  const v = ws.getRow(row).getCell(col).value as any;
  if (v && typeof v === "object" && "formula" in v) return String(v.formula ?? "");
  return null;
}

// Error patterns to scan
const ERROR_PAT = /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/;

function scanSheetForErrors(ws: ExcelJS.Worksheet): string[] {
  const hits: string[] = [];
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value as any;
      const strVal = v?.result !== undefined ? String(v.result) : String(v ?? "");
      if (ERROR_PAT.test(strVal)) hits.push(`${ws.name}!${cell.address}: ${strVal}`);
    });
  });
  return hits;
}

// ── Setup ──────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);

  const { companyId, locationId, stockItemIds } = ctx;
  const [item1Id, item2Id, item3Id] = stockItemIds;

  // 1. Valid Sales voucher: Jul 3, item1, qty=10, totalSales=120, totalCost=100
  const { rows: [v1] } = await pool.query<{ id: number }>(
    `INSERT INTO vouchers
       (company_id, location_id, voucher_type, voucher_date, description,
        optional, voucher_number, total_amount)
     VALUES ($1, $2, 'Sales', '2026-07-03', 'V2 test valid sale',
             false, 'V2-001', 120.00)
     RETURNING id`,
    [companyId, locationId],
  );
  await pool.query(
    `INSERT INTO sales_items
       (voucher_id, stock_item_id, quantity, selling_price, cost_price, total_sales, total_cost, profit)
     VALUES ($1, $2, 10, 12.00, 10.00, 120.00, 100.00, 20.00)`,
    [v1.id, item1Id],
  );

  // 2. Deleted Sales voucher: Jul 2, item2, qty=5 → must be excluded
  const { rows: [v2] } = await pool.query<{ id: number }>(
    `INSERT INTO vouchers
       (company_id, location_id, voucher_type, voucher_date, description,
        optional, voucher_number, total_amount, deleted_at)
     VALUES ($1, $2, 'Sales', '2026-07-02', 'V2 test deleted sale',
             false, 'V2-002', 60.00, NOW())
     RETURNING id`,
    [companyId, locationId],
  );
  await pool.query(
    `INSERT INTO sales_items
       (voucher_id, stock_item_id, quantity, selling_price, cost_price, total_sales, total_cost, profit)
     VALUES ($1, $2, 5, 12.00, 10.00, 60.00, 50.00, 10.00)`,
    [v2.id, item2Id],
  );

  // 3. Optional Sales voucher: Jul 4, item2, qty=7 → must be excluded
  const { rows: [v3] } = await pool.query<{ id: number }>(
    `INSERT INTO vouchers
       (company_id, location_id, voucher_type, voucher_date, description,
        optional, voucher_number, total_amount)
     VALUES ($1, $2, 'Sales', '2026-07-04', 'V2 test optional sale',
             true, 'V2-003', 84.00)
     RETURNING id`,
    [companyId, locationId],
  );
  await pool.query(
    `INSERT INTO sales_items
       (voucher_id, stock_item_id, quantity, selling_price, cost_price, total_sales, total_cost, profit)
     VALUES ($1, $2, 7, 12.00, 10.00, 84.00, 70.00, 14.00)`,
    [v3.id, item2Id],
  );

  // 4. Wrong-type (Journal) voucher: Jul 5, item3, qty=3 → must be excluded
  const { rows: [v4] } = await pool.query<{ id: number }>(
    `INSERT INTO vouchers
       (company_id, location_id, voucher_type, voucher_date, description,
        optional, voucher_number, total_amount)
     VALUES ($1, $2, 'Journal', '2026-07-05', 'V2 test journal',
             false, 'V2-004', 36.00)
     RETURNING id`,
    [companyId, locationId],
  );
  await pool.query(
    `INSERT INTO sales_items
       (voucher_id, stock_item_id, quantity, selling_price, cost_price, total_sales, total_cost, profit)
     VALUES ($1, $2, 3, 12.00, 10.00, 36.00, 30.00, 6.00)`,
    [v4.id, item3Id],
  );

  // Derive expected opening/closing from inventory helper
  const openRows  = await calculateHistoricalLocationInventory(locationId, companyId, "2026-06-30");
  const closeRows = await calculateHistoricalLocationInventory(locationId, companyId, TO);
  const openEntry  = openRows.find((r) => r.stockItemId === item1Id);
  const closeEntry = closeRows.find((r) => r.stockItemId === item1Id);
  expectedOpenQtyItem1  = openEntry  ? parseFloat(String(openEntry.quantity  ?? "0")) : 0;
  expectedCloseQtyItem1 = closeEntry ? parseFloat(String(closeEntry.quantity ?? "0")) : 0;

  // Generate workbook
  buf = await generateSpSalesFormExcelV2({
    companyId,
    locationId,
    fromDate: FROM,
    toDate:   TO,
    locationName: "Test Warehouse",
    supplierName: "V2 Export Test",
  });

  const tmpWb = new ExcelJS.Workbook();
  await tmpWb.xlsx.load(buf);
  wb = tmpWb;
}, 120000);

afterAll(async () => {
  try {
    await pool.query(
      `DELETE FROM sales_items WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = $1)`,
      [ctx.companyId],
    );
    await pool.query(`DELETE FROM vouchers WHERE company_id = $1`, [ctx.companyId]);
  } catch { /* ignore */ }
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

// ── 1. Buffer integrity ────────────────────────────────────────────────────────
// ── 8. Group subtotal row ──────────────────────────────────────────────────────
describe("V2 Export — Group subtotal rows", () => {
  it("ENTRY has a subtotal row for the test group at the expected position", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(E_SUBTOTAL_ROW).getCell(1).value;
    expect(typeof v).toBe("string");
    expect((v as string).toLowerCase()).toContain("testgroup");
  });

  it("Subtotal row Qty for Jul 3 (day 2) sums item qty correctly", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    // Only item1 has a sale on Jul 3 (qty=10)
    const qtyCol = E_DATE_START + 2 * COLS_PER_DAY;
    const subtotalQty = cellNum(ws, E_SUBTOTAL_ROW, qtyCol);
    expect(subtotalQty).not.toBeNull();
    expect(subtotalQty).toBeCloseTo(10, 1);
  });

  it("Subtotal row Sales for Jul 3 equals total sales for the group", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const salesCol = E_DATE_START + 2 * COLS_PER_DAY + 1;
    const subtotalSales = cellNum(ws, E_SUBTOTAL_ROW, salesCol);
    expect(subtotalSales).not.toBeNull();
    expect(subtotalSales).toBeCloseTo(120, 1); // 10 qty * 12 sale price
  });

  it("Subtotal row Profit for Jul 3 equals total profit for the group", () => {
    const ws        = wb.getWorksheet("ENTRY")!;
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2;
    const subtotalProfit = cellNum(ws, E_SUBTOTAL_ROW, profitCol);
    expect(subtotalProfit).not.toBeNull();
    expect(subtotalProfit).toBeCloseTo(20, 1); // 120 - 100
  });

  it("Subtotal Qty column is a formula SUM", () => {
    const ws     = wb.getWorksheet("ENTRY")!;
    const qtyCol = E_DATE_START + 2 * COLS_PER_DAY;
    const formula = cellFormula(ws, E_SUBTOTAL_ROW, qtyCol);
    expect(formula, "Subtotal Qty should be a SUM formula").not.toBeNull();
    expect(formula!.toUpperCase()).toContain("SUM(");
  });

  it("Subtotal Sales column is a live SUMPRODUCT formula (not a cached value)", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const salesCol = E_DATE_START + 2 * COLS_PER_DAY + 1;
    const formula  = cellFormula(ws, E_SUBTOTAL_ROW, salesCol);
    expect(formula, "Subtotal Sales should be a SUMPRODUCT formula").not.toBeNull();
    expect(formula!.toUpperCase()).toContain("SUMPRODUCT(");
  });

  it("Subtotal Sales formula does NOT use IF(ISNUMBER) — uses plain SUMPRODUCT", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const salesCol = E_DATE_START + 2 * COLS_PER_DAY + 1;
    const formula  = cellFormula(ws, E_SUBTOTAL_ROW, salesCol);
    expect(formula!.toUpperCase()).not.toContain("ISNUMBER");
  });

  it("Subtotal Profit column is a live SUMPRODUCT formula (not a cached value)", () => {
    const ws        = wb.getWorksheet("ENTRY")!;
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2;
    const formula   = cellFormula(ws, E_SUBTOTAL_ROW, profitCol);
    expect(formula, "Subtotal Profit should be a SUMPRODUCT formula").not.toBeNull();
    expect(formula!.toUpperCase()).toContain("SUMPRODUCT(");
  });

  it("Subtotal Profit formula does NOT use IF(ISNUMBER) — uses plain SUMPRODUCT", () => {
    const ws        = wb.getWorksheet("ENTRY")!;
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2;
    const formula   = cellFormula(ws, E_SUBTOTAL_ROW, profitCol);
    expect(formula!.toUpperCase()).not.toContain("ISNUMBER");
  });

  it("Subtotal Sale Price column (Total Sales) is money formatted", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const salesCol = E_DATE_START + 2 * COLS_PER_DAY + 1;
    const fmt      = ws.getRow(E_SUBTOTAL_ROW).getCell(salesCol).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
  });

  it("Subtotal Profit/Bag column (Total Profit) is money formatted", () => {
    const ws        = wb.getWorksheet("ENTRY")!;
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2;
    const fmt       = ws.getRow(E_SUBTOTAL_ROW).getCell(profitCol).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
  });
});

// ── 9. Grand TOTAL row ────────────────────────────────────────────────────────
describe("V2 Export — Grand TOTAL row", () => {
  it("TOTAL row exists at the expected position and contains 'TOTAL'", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(E_TOTAL_ROW).getCell(1).value;
    expect(typeof v).toBe("string");
    expect((v as string).trim()).toBe("TOTAL");
  });

  it("TOTAL row Qty for Jul 3 matches sum of all items", () => {
    const ws     = wb.getWorksheet("ENTRY")!;
    const qtyCol = E_DATE_START + 2 * COLS_PER_DAY;
    const totalQty = cellNum(ws, E_TOTAL_ROW, qtyCol);
    expect(totalQty).not.toBeNull();
    expect(totalQty).toBeCloseTo(10, 1);
  });

  it("TOTAL row Sales for Jul 3 matches total sales", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const salesCol = E_DATE_START + 2 * COLS_PER_DAY + 1;
    const totalSales = cellNum(ws, E_TOTAL_ROW, salesCol);
    expect(totalSales).not.toBeNull();
    expect(totalSales).toBeCloseTo(120, 1);
  });

  it("TOTAL row Profit for Jul 3 matches total profit", () => {
    const ws        = wb.getWorksheet("ENTRY")!;
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2;
    const totalProfit = cellNum(ws, E_TOTAL_ROW, profitCol);
    expect(totalProfit).not.toBeNull();
    expect(totalProfit).toBeCloseTo(20, 1);
  });

  it("TOTAL row Sales column is a SUM formula over subtotal rows", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const salesCol = E_DATE_START + 2 * COLS_PER_DAY + 1;
    const formula  = cellFormula(ws, E_TOTAL_ROW, salesCol);
    expect(formula, "TOTAL Sales should be a SUM formula").not.toBeNull();
    expect(formula!.toUpperCase()).toContain("SUM(");
  });

  it("TOTAL row Profit column is a SUM formula over subtotal rows", () => {
    const ws        = wb.getWorksheet("ENTRY")!;
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2;
    const formula   = cellFormula(ws, E_TOTAL_ROW, profitCol);
    expect(formula, "TOTAL Profit should be a SUM formula").not.toBeNull();
    expect(formula!.toUpperCase()).toContain("SUM(");
  });
});

// ── 10. No dates after toDate ─────────────────────────────────────────────────
describe("V2 Export — No dates beyond toDate in ENTRY", () => {
  it("ENTRY row 2: no group-header beyond day 6 (Jul 7)", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const stale: string[] = [];
    const firstBeyond = E_DATE_START + DAY_COUNT * COLS_PER_DAY;
    for (let c = firstBeyond + 3; c < firstBeyond + 15; c++) {
      const v = ws.getRow(2).getCell(c).value;
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        stale.push(`col ${c}: ${JSON.stringify(v).slice(0, 40)}`);
      }
    }
    expect(stale, `Stale group-headers after toDate:\n${stale.join("\n")}`).toHaveLength(0);
  });

  it("ENTRY row 3: no sub-header beyond day 6 (Jul 7)", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const stale: string[] = [];
    const firstStaleCol = E_DATE_START + DAY_COUNT * COLS_PER_DAY + 3;
    for (let c = firstStaleCol; c < firstStaleCol + 12; c++) {
      const v = ws.getRow(3).getCell(c).value;
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        stale.push(`col ${c}: ${JSON.stringify(v).slice(0, 40)}`);
      }
    }
    expect(stale, `Stale sub-headers after toDate:\n${stale.join("\n")}`).toHaveLength(0);
  });
});

// ── 11. No sale values on no-sale days ────────────────────────────────────────
describe("V2 Export — No sale values on no-sale days (item1)", () => {
  const NO_SALE_DAYS  = [0, 1, 3, 4, 5, 6];
  const NO_SALE_LABELS = ["Jul 1","Jul 2","Jul 4","Jul 5","Jul 6","Jul 7"];

  NO_SALE_DAYS.forEach((d, i) => {
    it(`ENTRY Test Item 1: Qty and Sale Price are null on ${NO_SALE_LABELS[i]} (day ${d})`, () => {
      const ws  = wb.getWorksheet("ENTRY")!;
      const row = findItemRow(ws, "Test Item 1");
      expect(row, "Test Item 1 row not found").not.toBeNull();
      const baseCol = E_DATE_START + d * COLS_PER_DAY;
      expect(ws.getRow(row!).getCell(baseCol).value, `Day ${d} Qty`).toBeNull();
      expect(ws.getRow(row!).getCell(baseCol + 1).value, `Day ${d} Sale Price`).toBeNull();
    });
  });

  it("ENTRY Test Item 1: Qty on Jul 3 (day 2) = 10", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const qtyCol = E_DATE_START + 2 * COLS_PER_DAY;
    expect(cellNum(ws, row!, qtyCol)).toBeCloseTo(10, 1);
  });
});

// ── 12. Sales query filters ────────────────────────────────────────────────────
describe("V2 Export — Sales query filters", () => {
  it("ENTRY Test Item 2: no Qty on Jul 2 (deleted Sales voucher excluded)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 2");
    if (!row) return;
    const qtyCol = E_DATE_START + 1 * COLS_PER_DAY;
    expect(ws.getRow(row).getCell(qtyCol).value, "Deleted voucher must not appear").toBeNull();
  });

  it("ENTRY Test Item 2: no Qty on Jul 4 (optional Sales voucher excluded)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 2");
    if (!row) return;
    const qtyCol = E_DATE_START + 3 * COLS_PER_DAY;
    expect(ws.getRow(row).getCell(qtyCol).value, "Optional voucher must not appear").toBeNull();
  });

  it("ENTRY Test Item 3: no Qty on Jul 5 (wrong voucher_type excluded)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 3");
    if (!row) return;
    const qtyCol = E_DATE_START + 4 * COLS_PER_DAY;
    expect(ws.getRow(row).getCell(qtyCol).value, "Journal voucher must not appear").toBeNull();
  });

  it("direct DB: fetchSalesData query returns only 1 row (valid Sales voucher)", async () => {
    const { rows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
         FROM sales_items si
         JOIN vouchers v ON v.id = si.voucher_id
        WHERE v.company_id   = $1
          AND v.deleted_at   IS NULL
          AND v.voucher_type = 'Sales'
          AND v.optional     = false
          AND v.voucher_date BETWEEN '2026-07-01'::date AND '2026-07-07'::date
          AND v.location_id  = $2`,
      [ctx.companyId, ctx.locationId],
    );
    expect(parseInt(rows[0].cnt, 10)).toBe(1);
  });

  it("direct DB: raw sales_items count (all vouchers) = 4 (confirms seed)", async () => {
    const { rows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
         FROM sales_items si
         JOIN vouchers v ON v.id = si.voucher_id
        WHERE v.company_id = $1`,
      [ctx.companyId],
    );
    expect(parseInt(rows[0].cnt, 10)).toBe(4);
  });
});

// ── 13. Sales sheet date range ────────────────────────────────────────────────
describe("V2 Export — Sales sheet date range", () => {
  it("Sales date row (row 1): at least 7 date columns for the 7-day range", () => {
    const ws = wb.getWorksheet("Sales")!;
    if (!ws) return;
    const capacity = ws.columnCount - S_DATE_START + 1;
    expect(capacity).toBeGreaterThanOrEqual(DAY_COUNT);
  });

  it("Sales sheet: no qty values after day 7 columns", () => {
    const ws = wb.getWorksheet("Sales")!;
    if (!ws) return;
    const stale: string[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const name = ws.getRow(r).getCell(S_ITEM_NAME_COL).value;
      if (!name || String(name).trim() === "") continue;
      for (let d = DAY_COUNT; d < DAY_COUNT + 5; d++) {
        const v = ws.getRow(r).getCell(S_DATE_START + d).value;
        if (v !== null && v !== undefined) {
          stale.push(`r${r} "${name}" day ${d}: ${JSON.stringify(v).slice(0, 30)}`);
        }
      }
    }
    expect(stale, `Stale Sales data after toDate:\n${stale.join("\n")}`).toHaveLength(0);
  });
});

// ── 14. Cash section ──────────────────────────────────────────────────────────
describe("V2 Export — Cash & Bank section", () => {
  it("ENTRY has 'CASH & BANK SUMMARY' header below TOTAL row", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(E_CASH_HDR_ROW).getCell(1).value;
    expect(typeof v).toBe("string");
    expect((v as string).toLowerCase()).toContain("cash");
    expect((v as string).toLowerCase()).toContain("bank");
  });

  it("ENTRY has CASH sub-header for day 0 at cashSubHdrRow", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(E_CASH_SUBHDR).getCell(E_DATE_START).value;
    expect(String(v ?? "").toLowerCase()).toContain("cash");
  });

  it("ENTRY has BANK sub-header for day 0 at cashSubHdrRow", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(E_CASH_SUBHDR).getCell(E_DATE_START + 1).value;
    expect(String(v ?? "").toLowerCase()).toContain("bank");
  });

  it("ENTRY has 'Opening Cash' row", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(E_OPEN_CASH_ROW).getCell(1).value;
    expect(String(v ?? "").toLowerCase()).toContain("opening cash");
  });

  it("ENTRY has 'Cash deposit in Bank' row", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(E_DEPOSIT_ROW).getCell(1).value;
    expect(String(v ?? "").toLowerCase()).toContain("cash deposit");
  });

  it("ENTRY has 'Receipt from Credit Sales' row", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(E_RECEIPT_ROW).getCell(1).value;
    expect(String(v ?? "").toLowerCase()).toContain("receipt");
  });
});

// ── 15. Payments section ──────────────────────────────────────────────────────
describe("V2 Export — Payments section", () => {
  it("ENTRY has 'PAYMENTS' header row", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(E_PAYMENTS_ROW).getCell(1).value;
    expect(String(v ?? "").toLowerCase()).toContain("payment");
  });

  it("ENTRY has 10 editable payment rows labeled Payment 1..Payment 10", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    for (let p = 1; p <= NUM_PAYMENT_ROWS; p++) {
      const row = E_PAYMENTS_ROW + p;
      const label = String(ws.getRow(row).getCell(1).value ?? "");
      expect(label).toBe(`Payment ${p}`);
    }
  });

  it("Payment row CASH and BANK cells are unlocked for manual entry", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const cashProt = ws.getRow(E_PAY_FIRST_ROW).getCell(E_DATE_START).protection;
    const bankProt = ws.getRow(E_PAY_FIRST_ROW).getCell(E_DATE_START + 1).protection;
    expect(cashProt?.locked).toBe(false);
    expect(bankProt?.locked).toBe(false);
  });

  it("ENTRY has a 'Total Payments' row using SUM formulas, locked", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const label = String(ws.getRow(E_TOTAL_PAY_ROW).getCell(1).value ?? "");
    expect(label.toLowerCase()).toContain("total payments");

    const cashCell = ws.getRow(E_TOTAL_PAY_ROW).getCell(E_DATE_START);
    const formula  = (cashCell.value as any)?.formula ?? "";
    expect(formula).toContain("SUM(");
    expect(cashCell.protection?.locked).not.toBe(false);

    const bankCell = ws.getRow(E_TOTAL_PAY_ROW).getCell(E_DATE_START + 1);
    expect(bankCell.protection?.locked).not.toBe(false);
  });

  it("ENTRY has a 'Balance Cash' row with locked formula cells", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const label = String(ws.getRow(E_BALANCE_ROW).getCell(1).value ?? "");
    expect(label.toLowerCase()).toContain("balance");

    const cashCell = ws.getRow(E_BALANCE_ROW).getCell(E_DATE_START);
    expect(cashCell.protection?.locked).not.toBe(false);
    const bankCell = ws.getRow(E_BALANCE_ROW).getCell(E_DATE_START + 1);
    expect(bankCell.protection?.locked).not.toBe(false);
  });
});

// ── 15b. Cash/Bank formulas ────────────────────────────────────────────────────
describe("V2 Export — Cash/Bank roll-forward formulas", () => {
  it("Day 1 Opening Cash/Bank cells reference the previous day's Balance Cash/Bank row", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const nextCashCell = ws.getRow(E_OPEN_CASH_ROW).getCell(E_DATE_START + COLS_PER_DAY);
    const nextBankCell = ws.getRow(E_OPEN_CASH_ROW).getCell(E_DATE_START + COLS_PER_DAY + 1);
    const cashFormula  = (nextCashCell.value as any)?.formula ?? "";
    const bankFormula  = (nextBankCell.value as any)?.formula ?? "";
    expect(cashFormula).toContain(String(E_BALANCE_ROW));
    expect(bankFormula).toContain(String(E_BALANCE_ROW));
    expect(nextCashCell.protection?.locked).not.toBe(false);
    expect(nextBankCell.protection?.locked).not.toBe(false);
  });

  it("Day 2 Opening Cash/Bank cells reference Day 1's Balance Cash/Bank row (chain continues beyond the first roll-forward)", () => {
    // Export range is Jul 1–7 (7 days, index 0..6), so index 2 ("Day 3") exists
    // and must reference index 1's ("Day 2") Balance row — proving the
    // roll-forward is a repeating chain, not a one-off Day1→Day2 special case.
    const ws = wb.getWorksheet("ENTRY")!;
    const day3CashCell = ws.getRow(E_OPEN_CASH_ROW).getCell(E_DATE_START + COLS_PER_DAY * 2);
    const day3BankCell = ws.getRow(E_OPEN_CASH_ROW).getCell(E_DATE_START + COLS_PER_DAY * 2 + 1);
    const cashFormula  = (day3CashCell.value as any)?.formula ?? "";
    const bankFormula  = (day3BankCell.value as any)?.formula ?? "";
    expect(cashFormula).toContain(String(E_BALANCE_ROW));
    expect(bankFormula).toContain(String(E_BALANCE_ROW));
    // And it must reference Day 2's column (one day-block to the left of Day 3's own column)
    const day2CashCol = E_DATE_START + COLS_PER_DAY; // Day 2's CASH column index
    const day2ColLetter = ws.getColumn(day2CashCol).letter;
    expect(cashFormula).toContain(day2ColLetter);
    expect(day3CashCell.protection?.locked).not.toBe(false);
    expect(day3BankCell.protection?.locked).not.toBe(false);
  });

  it("BANK deposit cell mirrors the CASH deposit cell via formula, locked", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const bankDepositCell = ws.getRow(E_DEPOSIT_ROW).getCell(E_DATE_START + 1);
    const formula = (bankDepositCell.value as any)?.formula ?? "";
    expect(formula).toContain(`${E_DEPOSIT_ROW}`);
    expect(bankDepositCell.protection?.locked).not.toBe(false);
  });

  it("CASH deposit input cell is unlocked for manual entry", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const cashDepositCell = ws.getRow(E_DEPOSIT_ROW).getCell(E_DATE_START);
    expect(cashDepositCell.protection?.locked).toBe(false);
  });

  it("Receipt from Credit Sales CASH cell is unlocked for manual entry", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const receiptCell = ws.getRow(E_RECEIPT_ROW).getCell(E_DATE_START);
    expect(receiptCell.protection?.locked).toBe(false);
  });

  it("Balance Cash formula includes Opening Cash + Total Sales - Deposit + Receipt - Total Payments references", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const cashCell = ws.getRow(E_BALANCE_ROW).getCell(E_DATE_START);
    const formula  = (cashCell.value as any)?.formula ?? "";
    expect(formula).toContain(String(E_OPEN_CASH_ROW));
    expect(formula).toContain(String(E_TOTAL_ROW));
    expect(formula).toContain(String(E_DEPOSIT_ROW));
    expect(formula).toContain(String(E_RECEIPT_ROW));
    expect(formula).toContain(String(E_TOTAL_PAY_ROW));
  });

  it("Balance Bank formula includes Opening Bank + Deposit - Total Bank Payments references", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const bankCell = ws.getRow(E_BALANCE_ROW).getCell(E_DATE_START + 1);
    const formula  = (bankCell.value as any)?.formula ?? "";
    expect(formula).toContain(String(E_OPEN_CASH_ROW));
    expect(formula).toContain(String(E_DEPOSIT_ROW));
    expect(formula).toContain(String(E_TOTAL_PAY_ROW));
  });

  it("With no cashAccountId, Day 1 Opening Cash cell is blank and unlocked for manual entry", () => {
    // The default `buf` workbook (built in beforeAll) is generated WITHOUT
    // cashAccountId — Day 1 Opening Cash must be an editable manual cell,
    // never a stale/frozen value.
    const ws = wb.getWorksheet("ENTRY")!;
    const cashCell = ws.getRow(E_OPEN_CASH_ROW).getCell(E_DATE_START);
    expect(cashCell.value).toBeNull();
    expect(cashCell.protection?.locked).toBe(false);
  });
});
