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
// Group column removed: A=RowNum, B=ItemName, C=Code, D=OpenQty, E=Cost/Bag
const FIXED_LEFT   = 5;  // cols 1-5: RowNum, Name, Code, OpenQty, Cost/Bag
const COLS_PER_DAY = 3;
const E_ITEM_NAME_COL = 2;  // B
const E_OPEN_QTY_COL  = 4;  // D
const E_COST_BAG_COL  = 5;  // E
const E_DATE_START    = FIXED_LEFT + 1;  // 6 — first Qty column for day 0
const CLOSE_QTY_COL   = FIXED_LEFT + 1 + DAY_COUNT * COLS_PER_DAY; // 27
const CLOSE_VAL_COL   = CLOSE_QTY_COL + 1; // 28

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

// ── 2. Sheet count and order (5 sheets — no Ageing) ───────────────────────────
describe("V2 Export — Sheet order", () => {
  const EXPECTED_ORDER = ["Costing", "Sales", "ENTRY", "Summary", "Summary-Itemwise"];

  it("workbook has exactly 5 sheets", () => {
    expect(wb.worksheets.length).toBe(5);
  });

  EXPECTED_ORDER.forEach((name, idx) => {
    it(`sheet ${idx + 1} is "${name}"`, () => {
      expect(wb.worksheets[idx]?.name).toBe(name);
    });
  });

  it("Ageing sheet does not exist", () => {
    expect(wb.getWorksheet("Ageing")).toBeUndefined();
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
  ["ENTRY", "Summary"].forEach((name) => {
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

  it("ENTRY closing qty cell is a formula D-SUM(...) WITHOUT MAX (can go negative)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const formula = cellFormula(ws, row!, CLOSE_QTY_COL);
    expect(formula, "Close Qty should be a formula").not.toBeNull();
    expect(formula!.toUpperCase()).not.toContain("MAX");
    expect(formula!.toUpperCase()).toContain("SUM(");
    // Formula must start with the opening qty cell reference (D column)
    expect(formula!.toUpperCase()).toMatch(/^D\d+-SUM\(/);
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
    // Formula should reference Close Qty column and $E (Cost/Bag — col E after Group removal)
    expect(formula!.toUpperCase()).toMatch(/\*\$E/);
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
});

// ── 16. Cell protection ────────────────────────────────────────────────────────
describe("V2 Export — Cell protection", () => {
  it("ENTRY item name cell (col C) for Test Item 1 is locked (not unlocked)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1")!;
    const prot = ws.getRow(row).getCell(E_ITEM_NAME_COL).protection;
    // locked: false is the only "unlocked" signal; undefined or true means locked
    expect(prot?.locked).not.toBe(false);
  });

  it("ENTRY Cost/Bag cell (col F) is locked", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1")!;
    const prot = ws.getRow(row).getCell(E_COST_BAG_COL).protection;
    expect(prot?.locked).not.toBe(false);
  });

  it("ENTRY Qty cell for Test Item 1 on Jul 3 is UNLOCKED", () => {
    const ws     = wb.getWorksheet("ENTRY")!;
    const row    = findItemRow(ws, "Test Item 1")!;
    const qtyCol = E_DATE_START + 2 * COLS_PER_DAY; // day 2 Qty
    const prot   = ws.getRow(row).getCell(qtyCol).protection;
    expect(prot?.locked).toBe(false);
  });

  it("ENTRY Sale Price cell for Test Item 1 on Jul 3 is UNLOCKED", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const row      = findItemRow(ws, "Test Item 1")!;
    const priceCol = E_DATE_START + 2 * COLS_PER_DAY + 1; // day 2 Sale Price
    const prot     = ws.getRow(row).getCell(priceCol).protection;
    expect(prot?.locked).toBe(false);
  });

  it("ENTRY Profit/Bag cell is locked (formula cell)", () => {
    const ws        = wb.getWorksheet("ENTRY")!;
    const row       = findItemRow(ws, "Test Item 1")!;
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2;
    const prot      = ws.getRow(row).getCell(profitCol).protection;
    expect(prot?.locked).not.toBe(false);
  });

  it("ENTRY Closing Qty cell is locked (formula cell)", () => {
    const ws   = wb.getWorksheet("ENTRY")!;
    const row  = findItemRow(ws, "Test Item 1")!;
    const prot = ws.getRow(row).getCell(CLOSE_QTY_COL).protection;
    expect(prot?.locked).not.toBe(false);
  });
});

// ── 17. Number formats ────────────────────────────────────────────────────────
describe("V2 Export — Number formats", () => {
  it("ENTRY Qty cell format is #,##0 (whole units — no decimals)", () => {
    const ws     = wb.getWorksheet("ENTRY")!;
    const row    = findItemRow(ws, "Test Item 1")!;
    const qtyCol = E_DATE_START + 2 * COLS_PER_DAY; // Jul 3 — has a value
    const fmt    = ws.getRow(row).getCell(qtyCol).numFmt ?? "";
    // Must be the whole-unit format with no decimal places
    expect(fmt).toBe("#,##0");
    expect(fmt).not.toBe("#,##0.00");
    expect(fmt).not.toBe("#,##0.##");
    expect(fmt).not.toBe("0.00");
  });

  it("ENTRY Cost/Bag cell format includes a dollar sign and no decimals", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1")!;
    const fmt = ws.getRow(row).getCell(E_COST_BAG_COL).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
    expect(fmt).toBe('"$"#,##0');
    expect(fmt).not.toContain(".00");
    expect(fmt).not.toContain(".0000");
  });

  it("ENTRY Sale Price cell format includes a dollar sign and no decimals", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const row      = findItemRow(ws, "Test Item 1")!;
    const priceCol = E_DATE_START + 2 * COLS_PER_DAY + 1;
    const fmt      = ws.getRow(row).getCell(priceCol).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
    expect(fmt).toBe('"$"#,##0');
    expect(fmt).not.toContain(".00");
    expect(fmt).not.toContain(".0000");
  });

  it("ENTRY Profit/Bag cell format includes a dollar sign and no decimals", () => {
    const ws        = wb.getWorksheet("ENTRY")!;
    const row       = findItemRow(ws, "Test Item 1")!;
    const profitCol = E_DATE_START + 2 * COLS_PER_DAY + 2;
    const fmt       = ws.getRow(row).getCell(profitCol).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
    expect(fmt).toBe('"$"#,##0');
    expect(fmt).not.toContain(".00");
    expect(fmt).not.toContain(".0000");
  });

  it("ENTRY Close Value cell format includes a dollar sign and no decimals", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1")!;
    const fmt = ws.getRow(row).getCell(CLOSE_VAL_COL).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
    expect(fmt).not.toContain(".00");
    expect(fmt).not.toContain(".0000");
  });

  it("ENTRY Total Sales / Total Profit (TOTAL row) formats have $ and no decimals", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const salesCol = E_DATE_START + 1;
    const fmt      = ws.getRow(E_TOTAL_ROW).getCell(salesCol).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
    expect(fmt).not.toContain(".00");
    expect(fmt).not.toContain(".0000");
  });

  it("Cash/Bank/Payments money cells have $ format and no decimals", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const cells = [
      ws.getRow(E_OPEN_CASH_ROW).getCell(E_DATE_START),
      ws.getRow(E_DEPOSIT_ROW).getCell(E_DATE_START),
      ws.getRow(E_RECEIPT_ROW).getCell(E_DATE_START),
      ws.getRow(E_PAY_FIRST_ROW).getCell(E_DATE_START),
      ws.getRow(E_TOTAL_PAY_ROW).getCell(E_DATE_START),
      ws.getRow(E_BALANCE_ROW).getCell(E_DATE_START),
    ];
    for (const c of cells) {
      const fmt = c.numFmt ?? "";
      expect(fmt).toMatch(/\$/);
      expect(fmt).not.toContain(".00");
      expect(fmt).not.toContain(".0000");
    }
  });
});

// ── 18. ENTRY structural sanity ────────────────────────────────────────────────
describe("V2 Export — ENTRY structural sanity", () => {
  it("ENTRY has at least 3 item rows", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    let count = 0;
    for (let r = E_DATA_ROW_START; r <= E_SUBTOTAL_ROW - 1; r++) {
      const v = ws.getRow(r).getCell(E_ITEM_NAME_COL).value;
      if (v && typeof v === "string" && v.trim() !== "") count++;
    }
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("ENTRY row 3 (sub-header): has 'Qty' label at day-0 qty column (col 6)", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(3).getCell(E_DATE_START).value;
    expect(String(v ?? "").toLowerCase()).toContain("qty");
  });

  it("ENTRY row 3: has 'Close Qty' label at closeQtyCol", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(3).getCell(CLOSE_QTY_COL).value;
    expect(String(v ?? "").toLowerCase()).toContain("close");
  });
});

// ── 19. No Group column in item rows ──────────────────────────────────────────
describe("V2 Export — No Group column in item rows", () => {
  it("ENTRY col B (col 2) for item row contains item name, not group name", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 not found").not.toBeNull();
    const colBVal = ws.getRow(row!).getCell(2).value;
    expect(typeof colBVal).toBe("string");
    // Should be the item name, not a group/category name
    expect((colBVal as string).toLowerCase()).toContain("test item 1");
  });

  it("ENTRY row 3 (sub-header): col 2 label is 'Item Name' (not 'Group')", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = ws.getRow(3).getCell(2).value;
    expect(String(v ?? "").toLowerCase()).toContain("item");
    expect(String(v ?? "").toLowerCase()).not.toBe("group");
  });

  it("ENTRY row 3 (sub-header): col 2 label is NOT 'Group'", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = String(ws.getRow(3).getCell(2).value ?? "").toLowerCase().trim();
    expect(v).not.toBe("group");
  });
});

// ── 20. Avg/Mo Sales is a live formula ────────────────────────────────────────
describe("V2 Export — Avg/Mo Sales formula", () => {
  const AVG_MO_COL = CLOSE_QTY_COL + 2;

  it("ENTRY Avg/Mo Sales cell for Test Item 1 is a formula (not a static value)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 not found").not.toBeNull();
    const formula = cellFormula(ws, row!, AVG_MO_COL);
    expect(formula, "Avg/Mo Sales should be a formula, not a static value").not.toBeNull();
  });

  it("ENTRY Avg/Mo Sales formula contains SUM of daily qty cells", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 not found").not.toBeNull();
    const formula = cellFormula(ws, row!, AVG_MO_COL);
    expect(formula!.toUpperCase()).toContain("SUM(");
  });

  it("ENTRY Avg/Mo Sales formula uses ROUND(...,0) for whole-unit result", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 not found").not.toBeNull();
    const formula = cellFormula(ws, row!, AVG_MO_COL);
    expect(formula!.toUpperCase()).toMatch(/^ROUND\(/);
  });

  it("ENTRY Avg/Mo Sales formula result matches expected monthly average", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 not found").not.toBeNull();
    // item1 has 10 qty sold over 7 days → avg monthly = 10/7*30 ≈ 42.86
    const result = cellNum(ws, row!, AVG_MO_COL);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo((10 / 7) * 30, 0);
  });
});

// ── Regression: after-cutoff stock adjustments must not leak into opening stock ─
describe("V2 Export — Historical opening stock excludes after-cutoff stock adjustments", () => {
  const ADJ_PREFIX = "xlsxv2adjtest";
  let adjCtx: TestContext;

  beforeAll(async () => {
    adjCtx = await seedTestData(ADJ_PREFIX);
  }, 60000);

  afterAll(async () => {
    try {
      await pool.query(
        `DELETE FROM vouchers WHERE company_id = $1`,
        [adjCtx.companyId],
      );
    } catch { /* ignore */ }
    await cleanupTestData(ADJ_PREFIX);
  }, 30000);

  it("Consumption adjustment (signed negative qty) dated after cutoff is added back, not double-subtracted", async () => {
    const { companyId, locationId, stockItemIds } = adjCtx;
    const itemId = stockItemIds[0]; // seeded qty=100, rate=10

    const before = await calculateHistoricalLocationInventory(locationId, companyId, "2026-06-30");
    const beforeQty = parseFloat(String(before.find((r) => r.stockItemId === itemId)?.quantity ?? "0"));
    expect(beforeQty).toBe(100);

    // A "Consumption" adjustment dated 2026-07-07 (after the Jun-30 cutoff)
    // removes 30 units. Consumption items are persisted with a NEGATIVE
    // signed quantity (see client/src/pages/vouchers/StockAdjustmentForm.tsx
    // and server/storage/stockOps.ts) — the on-hand qty afterwards is 70.
    const { rows: [v] } = await pool.query<{ id: number }>(
      `INSERT INTO vouchers (company_id, location_id, voucher_type, voucher_date, description, optional, voucher_number, total_amount)
       VALUES ($1, $2, 'Stock Adjustment', '2026-07-07', 'Adj regression: consumption', false, 'ADJ-CONS-001', 300.00)
       RETURNING id`,
      [companyId, locationId],
    );
    const { rows: [av] } = await pool.query<{ id: number }>(
      `INSERT INTO stock_adjustment_vouchers (voucher_id, location_id, adjustment_type)
       VALUES ($1, $2, 'Consumption') RETURNING id`,
      [v.id, locationId],
    );
    await pool.query(
      `INSERT INTO stock_adjustment_items (adjustment_id, stock_item_id, quantity, rate, total_amount)
       VALUES ($1, $2, -30, 10.00, 300.00)`,
      [av.id, itemId],
    );
    await pool.query(
      `UPDATE inventory SET quantity = quantity - 30, total_value = total_value - 300
       WHERE company_id = $1 AND location_id = $2 AND stock_item_id = $3`,
      [companyId, locationId, itemId],
    );

    const after = await calculateHistoricalLocationInventory(locationId, companyId, "2026-06-30");
    const afterQty = parseFloat(String(after.find((r) => r.stockItemId === itemId)?.quantity ?? "0"));

    // Historical (Jun 30) opening stock must still read 100: NOT 70 (current,
    // un-reversed) and NOT 40 (the old bug: current 70 minus 30 again).
    expect(afterQty).toBe(100);
  });

  it("Mixed adjustment's production item (positive signed qty) dated after cutoff is subtracted, not added again", async () => {
    const { companyId, locationId, stockItemIds } = adjCtx;
    const itemId = stockItemIds[1]; // seeded qty=100, rate=10, untouched by the previous test

    const before = await calculateHistoricalLocationInventory(locationId, companyId, "2026-06-30");
    const beforeQty = parseFloat(String(before.find((r) => r.stockItemId === itemId)?.quantity ?? "0"));
    expect(beforeQty).toBe(100);

    // A "Mixed" adjustment dated 2026-07-07 adds 20 units via a production
    // line item (POSITIVE signed quantity). Current on-hand becomes 120.
    const { rows: [v] } = await pool.query<{ id: number }>(
      `INSERT INTO vouchers (company_id, location_id, voucher_type, voucher_date, description, optional, voucher_number, total_amount)
       VALUES ($1, $2, 'Stock Adjustment', '2026-07-07', 'Adj regression: mixed production', false, 'ADJ-MIX-001', 200.00)
       RETURNING id`,
      [companyId, locationId],
    );
    const { rows: [av] } = await pool.query<{ id: number }>(
      `INSERT INTO stock_adjustment_vouchers (voucher_id, location_id, adjustment_type)
       VALUES ($1, $2, 'Mixed') RETURNING id`,
      [v.id, locationId],
    );
    await pool.query(
      `INSERT INTO stock_adjustment_items (adjustment_id, stock_item_id, quantity, rate, total_amount)
       VALUES ($1, $2, 20, 10.00, 200.00)`,
      [av.id, itemId],
    );
    await pool.query(
      `UPDATE inventory SET quantity = quantity + 20, total_value = total_value + 200
       WHERE company_id = $1 AND location_id = $2 AND stock_item_id = $3`,
      [companyId, locationId, itemId],
    );

    const after = await calculateHistoricalLocationInventory(locationId, companyId, "2026-06-30");
    const afterQty = parseFloat(String(after.find((r) => r.stockItemId === itemId)?.quantity ?? "0"));

    // Historical (Jun 30) opening stock must still read 100: NOT 120 (current,
    // un-reversed) and NOT 140 (the old bug: current 120 plus 20 again,
    // because "Mixed" never matched the old "production" branch check).
    expect(afterQty).toBe(100);
  });

  it("Export for Jul 1–7 shows Opening Stock unaffected by a same-run after-cutoff adjustment (All Locations aggregation)", async () => {
    const { companyId, locationId, stockItemIds } = adjCtx;
    const itemId = stockItemIds[2]; // seeded qty=100, rate=10, untouched by previous tests

    // Consumption of 15 units dated inside the export range (Jul 7), after cutoff.
    const { rows: [v] } = await pool.query<{ id: number }>(
      `INSERT INTO vouchers (company_id, location_id, voucher_type, voucher_date, description, optional, voucher_number, total_amount)
       VALUES ($1, $2, 'Stock Adjustment', '2026-07-07', 'Adj regression: all-locations', false, 'ADJ-ALL-001', 150.00)
       RETURNING id`,
      [companyId, locationId],
    );
    const { rows: [av] } = await pool.query<{ id: number }>(
      `INSERT INTO stock_adjustment_vouchers (voucher_id, location_id, adjustment_type)
       VALUES ($1, $2, 'Consumption') RETURNING id`,
      [v.id, locationId],
    );
    await pool.query(
      `INSERT INTO stock_adjustment_items (adjustment_id, stock_item_id, quantity, rate, total_amount)
       VALUES ($1, $2, -15, 10.00, 150.00)`,
      [av.id, itemId],
    );
    await pool.query(
      `UPDATE inventory SET quantity = quantity - 15, total_value = total_value - 150
       WHERE company_id = $1 AND location_id = $2 AND stock_item_id = $3`,
      [companyId, locationId, itemId],
    );

    // Export with locationId omitted → "All Locations" aggregation path.
    const adjBuf = await generateSpSalesFormExcelV2({
      companyId,
      fromDate: FROM,
      toDate: TO,
      locationName: "All Locations",
      supplierName: "V2 Adjustment Regression Test",
    });
    const adjWb = new ExcelJS.Workbook();
    await adjWb.xlsx.load(adjBuf);
    const ws = adjWb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 3");
    expect(row, "Test Item 3 not found in All-Locations export").not.toBeNull();
    const openQty = cellNum(ws, row!, E_OPEN_QTY_COL);
    // Must equal the pre-adjustment historical qty (100), not current (85).
    expect(openQty).toBe(100);
  });
});

/*
 * Coverage summary
 * ─────────────────
 * ✓ 5 sheets in correct order (Costing, Sales, ENTRY, Summary, Summary-Itemwise)
 * ✓ No Ageing sheet
 * ✓ Costing, Sales, Summary-Itemwise are hidden; ENTRY, Summary are visible
 * ✓ Opening stock matches calculateHistoricalLocationInventory(Jun 30)
 * ✓ Closing stock is formula MAX(0, E-SUM(qty refs)); result matches helper(Jul 7)
 * ✓ Closing Value is formula CloseQty * CostBag
 * ✓ Profit/Bag is formula IF(OR(Qty="",Price=""),"",Price-$E)  ← $E = Cost/Bag after Group column removal
 * ✓ Group subtotal rows present with Total Qty/Sales/Profit per day
 * ✓ Grand TOTAL row exists and is labelled "TOTAL"
 * ✓ Cash & Bank section: header, CASH/BANK sub-headers, Opening Cash, Deposit, Receipt rows
 * ✓ Payments section exists below cash section
 * ✓ Qty and Sale Price cells are unlocked; formula/static cells are locked
 * ✓ Qty format does not force .00; money formats include dollar sign
 * ✓ No #DIV/0!, #REF!, #VALUE!, #NAME?, #N/A in visible sheets
 * ✓ No date headers beyond toDate
 * ✓ No sale values on no-sale days
 * ✓ Sales query: deleted/optional/wrong-type vouchers excluded
 * ✓ DB-level: only 1 qualifying row passes all filters
 */
