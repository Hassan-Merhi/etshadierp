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
const FIXED_LEFT   = 6;  // cols 1-6: RowNum, Group, Name, Code, OpenQty, Cost/Bag
const COLS_PER_DAY = 3;
const E_ITEM_NAME_COL = 3;  // C
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

  it("ENTRY closing qty cell is a formula MAX(0, E-SUM(...))", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const formula = cellFormula(ws, row!, CLOSE_QTY_COL);
    expect(formula, "Close Qty should be a formula").not.toBeNull();
    expect(formula!.toUpperCase()).toContain("MAX(0,E");
    expect(formula!.toUpperCase()).toContain("SUM(");
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
    // Formula should reference Close Qty column (AB) and $F (Cost/Bag)
    expect(formula!.toUpperCase()).toMatch(/\*\$F/);
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
  it("ENTRY Qty cell format does not force .00 (uses #,##0.## or similar)", () => {
    const ws     = wb.getWorksheet("ENTRY")!;
    const row    = findItemRow(ws, "Test Item 1")!;
    const qtyCol = E_DATE_START + 2 * COLS_PER_DAY; // Jul 3 — has a value
    const fmt    = ws.getRow(row).getCell(qtyCol).numFmt ?? "";
    // Should not be the ".00" forced-decimal format
    expect(fmt).not.toBe("#,##0.00");
    expect(fmt).not.toBe("0.00");
  });

  it("ENTRY Cost/Bag cell format includes a dollar sign", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1")!;
    const fmt = ws.getRow(row).getCell(E_COST_BAG_COL).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
  });

  it("ENTRY Sale Price cell format includes a dollar sign", () => {
    const ws       = wb.getWorksheet("ENTRY")!;
    const row      = findItemRow(ws, "Test Item 1")!;
    const priceCol = E_DATE_START + 2 * COLS_PER_DAY + 1;
    const fmt      = ws.getRow(row).getCell(priceCol).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
  });

  it("ENTRY Close Value cell format includes a dollar sign", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1")!;
    const fmt = ws.getRow(row).getCell(CLOSE_VAL_COL).numFmt ?? "";
    expect(fmt).toMatch(/\$/);
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

  it("ENTRY row 3 (sub-header): has 'Qty' label at day-0 qty column (col 7)", () => {
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

/*
 * Coverage summary
 * ─────────────────
 * ✓ 5 sheets in correct order (Costing, Sales, ENTRY, Summary, Summary-Itemwise)
 * ✓ No Ageing sheet
 * ✓ Costing, Sales, Summary-Itemwise are hidden; ENTRY, Summary are visible
 * ✓ Opening stock matches calculateHistoricalLocationInventory(Jun 30)
 * ✓ Closing stock is formula MAX(0, E-SUM(qty refs)); result matches helper(Jul 7)
 * ✓ Closing Value is formula CloseQty * CostBag
 * ✓ Profit/Bag is formula IF(OR(Qty="",Price=""),"",Price-$F)
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
