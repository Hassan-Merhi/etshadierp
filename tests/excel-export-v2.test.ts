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

const TEST_PREFIX = "xlsxv2test";
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
describe("V2 Export — Buffer integrity", () => {
  it("returns a non-empty Buffer", () => {
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(2000);
  });
  it("ExcelJS can parse the generated buffer without error", () => {
    expect(wb).toBeDefined();
  });
});

// ── 2. Sheet count and order (6 sheets, incl. Ageing — Phase 15) ──────────────
describe("V2 Export — Sheet order", () => {
  const EXPECTED_ORDER = ["Costing", "Sales", "ENTRY", "Summary", "Ageing", "Summary-Itemwise"];

  it("workbook has exactly 6 sheets", () => {
    expect(wb.worksheets.length).toBe(6);
  });

  EXPECTED_ORDER.forEach((name, idx) => {
    it(`sheet ${idx + 1} is "${name}"`, () => {
      expect(wb.worksheets[idx]?.name).toBe(name);
    });
  });

  it("Ageing sheet is visible", () => {
    const ws = wb.getWorksheet("Ageing");
    expect(ws).toBeDefined();
    expect((ws as any)?.state ?? "visible").toBe("visible");
  });
});

// ── 3. Sheet visibility ────────────────────────────────────────────────────────
describe("V2 Export — Sheet visibility", () => {
  const HIDDEN_SHEETS  = ["Costing", "Sales", "Summary-Itemwise"];
  const VISIBLE_SHEETS = ["ENTRY", "Summary"];

  HIDDEN_SHEETS.forEach((name) => {
    it(`"${name}" is hidden`, () => {
      const ws = wb.getWorksheet(name) as any;
      expect(ws?.state).toBe("hidden");
    });
  });

  VISIBLE_SHEETS.forEach((name) => {
    it(`"${name}" is visible (not hidden)`, () => {
      const ws = wb.getWorksheet(name) as any;
      expect(ws?.state).not.toBe("hidden");
      expect(ws?.state).not.toBe("veryHidden");
    });
  });
});

// ── 4. No Excel error cells in visible sheets ──────────────────────────────────
describe("V2 Export — No error cells in visible sheets", () => {
  ["ENTRY", "Summary", "Ageing"].forEach((name) => {
    it(`"${name}" contains no #REF!, #DIV/0!, #VALUE!, #NAME?, #N/A`, () => {
      const ws = wb.getWorksheet(name);
      if (!ws) return;
      const errors = scanSheetForErrors(ws);
      expect(errors, `Error cells found:\n${errors.join("\n")}`).toHaveLength(0);
    });
  });
});

// ── 5. Opening stock matches calculateHistoricalLocationInventory ──────────────
describe("V2 Export — Opening stock (Jun 30)", () => {
  it("expectedOpenQtyItem1 is positive (seeded sale reversed into opening)", () => {
    expect(expectedOpenQtyItem1).toBeGreaterThan(0);
  });

  it("ENTRY opening qty for Test Item 1 matches calculateHistoricalLocationInventory(Jun 30)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found in ENTRY").not.toBeNull();
    const openInWorkbook = cellNum(ws, row!, E_OPEN_QTY_COL);
    expect(openInWorkbook).not.toBeNull();
    expect(openInWorkbook).toBeCloseTo(expectedOpenQtyItem1, 1);
  });
});

// ── 6. Closing stock — formula, matches helper ─────────────────────────────────
describe("V2 Export — Closing stock (Jul 7)", () => {
  it("expectedCloseQtyItem1 is positive", () => {
    expect(expectedCloseQtyItem1).toBeGreaterThan(0);
  });

  it("ENTRY closing qty cell is a formula referencing Opening Qty (E) WITHOUT MAX (can go negative)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const formula = cellFormula(ws, row!, CLOSE_QTY_COL);
    expect(formula, "Close Qty should be a formula").not.toBeNull();
    expect(formula!.toUpperCase()).not.toContain("MAX");
    expect(formula!.toUpperCase()).toContain("SUM(");
    // Formula must reference the Opening Qty cell (E column, IF-guarded against blank)
    expect(formula!.toUpperCase()).toMatch(/^IF\(E\d+="",0,E\d+\)-SUM\(/);
  });

  it("ENTRY closing qty formula result matches calculateHistoricalLocationInventory(Jul 7)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const closeInWorkbook = cellNum(ws, row!, CLOSE_QTY_COL);
    expect(closeInWorkbook).not.toBeNull();
    expect(closeInWorkbook).toBeCloseTo(expectedCloseQtyItem1, 1);
  });

  it("ENTRY closing value cell is a formula CloseQty * CostBag", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const formula = cellFormula(ws, row!, CLOSE_VAL_COL);
    expect(formula, "Close Value should be a formula").not.toBeNull();
    // Formula should reference Close Qty column and Cost/Bag (col F, after Group column).
    // Note: ExcelJS normalizes absolute ($) references away on buffer round-trip parse.
    expect(formula!.toUpperCase()).toMatch(/\*\$?F/);
  });
});

// ── 7. Profit/Bag formula ──────────────────────────────────────────────────────
describe("V2 Export — Profit/Bag formula cells", () => {
  it("Profit/Bag cell on Jul 3 (day 2) for Test Item 1 is a formula", () => {
    const ws      = wb.getWorksheet("ENTRY")!;
    const row     = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2; // day 2, Profit/Bag
    const formula   = cellFormula(ws, row!, profitCol);
    expect(formula, "Profit/Bag should be a formula").not.toBeNull();
    expect(formula!.toUpperCase()).toContain("IF(OR(");
  });

  it("Profit/Bag formula result on Jul 3 equals SalePrice - CostBag", () => {
    const ws      = wb.getWorksheet("ENTRY")!;
    const row     = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const priceCol  = E_DATE_START + 2 * COLS_PER_DAY + 1; // Sale Price
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2; // Profit/Bag
    const costBag   = cellNum(ws, row!, E_COST_BAG_COL);
    const salePrice = cellNum(ws, row!, priceCol);
    const profitBag = cellNum(ws, row!, profitCol);
    // All three must be non-null (item1 has a valid sale on Jul 3)
    expect(costBag).not.toBeNull();
    expect(salePrice).not.toBeNull();
    expect(profitBag).not.toBeNull();
    expect(profitBag!).toBeCloseTo(salePrice! - costBag!, 3);
  });

  it("Profit/Bag cell on a no-sale day is a formula (not a hard error value)", () => {
    const ws      = wb.getWorksheet("ENTRY")!;
    const row     = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const profitCol = E_DATE_START + 0 * COLS_PER_DAY + 2; // day 0 (Jul 1) — no sale
    const v = ws.getRow(row!).getCell(profitCol).value as any;
    // Must be a formula (not a raw error string)
    expect(v && typeof v === "object" && "formula" in v).toBe(true);
    // Result must not be an Excel error value — ExcelJS may serialize "" as 0 on readback
    const result = String(v?.result ?? "");
    expect(result).not.toMatch(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/);
  });
});
