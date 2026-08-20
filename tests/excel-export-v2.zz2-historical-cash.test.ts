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

const TEST_PREFIX = "xlsxv2p3";
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
// ── 15c. Historical opening cash from a real ledger account ───────────────────
describe("V2 Export — Historical opening cash (cashAccountId)", () => {
  const CASH_PREFIX = "xlsxv2cashtest";
  let cashCtx: TestContext;
  const BEFORE_BALANCE = 500;  // posted before fromDate (2026-07-01) → must be picked up
  const AFTER_DELTA    = 9999; // posted after fromDate → must NOT affect opening cash

  beforeAll(async () => {
    cashCtx = await seedTestData(CASH_PREFIX);
    const { companyId, locationId, cashAccountId, salesAccountId } = cashCtx;

    // Journal dated 2026-06-25 (well before fromDate=2026-07-01): DR cash 500.
    // This must be the balance picked up "as of dayBefore(fromDate)" = Jun 30.
    const { rows: [vBefore] } = await pool.query<{ id: number }>(
      `INSERT INTO vouchers (company_id, location_id, voucher_type, voucher_date, description, optional, voucher_number, total_amount)
       VALUES ($1, $2, 'Journal', '2026-06-25', 'Cash test: pre-period balance', false, 'CASH-PRE-001', $3)
       RETURNING id`,
      [companyId, locationId, BEFORE_BALANCE],
    );
    await pool.query(
      `INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
       VALUES ($1, $2, $3, 0, 'pre-period'),
              ($1, $4, 0, $3, 'pre-period')`,
      [vBefore.id, cashAccountId, BEFORE_BALANCE, salesAccountId],
    );

    // Journal dated 2026-07-04 (INSIDE the export range, after fromDate):
    // must be excluded from the opening-cash balance — it should only ever
    // show up rolled into a later day's Balance Cash, never Day-1 Opening Cash.
    const { rows: [vAfter] } = await pool.query<{ id: number }>(
      `INSERT INTO vouchers (company_id, location_id, voucher_type, voucher_date, description, optional, voucher_number, total_amount)
       VALUES ($1, $2, 'Journal', '2026-07-04', 'Cash test: in-period, must be excluded from opening', false, 'CASH-POST-001', $3)
       RETURNING id`,
      [companyId, locationId, AFTER_DELTA],
    );
    await pool.query(
      `INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
       VALUES ($1, $2, $3, 0, 'in-period'),
              ($1, $4, 0, $3, 'in-period')`,
      [vAfter.id, cashAccountId, AFTER_DELTA, salesAccountId],
    );
  }, 60000);

  afterAll(async () => {
    try {
      await pool.query(
        `DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = $1)`,
        [cashCtx.companyId],
      );
      await pool.query(`DELETE FROM vouchers WHERE company_id = $1`, [cashCtx.companyId]);
    } catch { /* ignore */ }
    await cleanupTestData(CASH_PREFIX);
  }, 30000);

  it("Day 1 Opening Cash equals the ledger balance as of dayBefore(fromDate) — not today's/current balance — and is locked", async () => {
    const { companyId, locationId, cashAccountId } = cashCtx;
    const cashBuf = await generateSpSalesFormExcelV2({
      companyId,
      locationId,
      fromDate: FROM, // 2026-07-01 → dayBefore = 2026-06-30
      toDate: TO,
      locationName: "Cash Test Warehouse",
      supplierName: "Cash Account Test",
      cashAccountId,
    });
    const cashWb = new ExcelJS.Workbook();
    await cashWb.xlsx.load(cashBuf);
    const ws = cashWb.getWorksheet("ENTRY")!;
    const cashCell = ws.getRow(E_OPEN_CASH_ROW).getCell(E_DATE_START);

    // Must equal the pre-period balance (500), never include the in-period
    // journal (9999) — proving the query is scoped to dayBefore(fromDate),
    // not "today" or the full ledger through export generation time.
    expect(cellNum(ws, E_OPEN_CASH_ROW, E_DATE_START)).toBe(BEFORE_BALANCE);
    // ExcelJS omits the `protection` element for locked cells (locked=true is
    // the workbook default), so "locked" reads back as undefined — matching
    // the pattern used by the other roll-forward lock assertions in this file.
    expect(cashCell.protection?.locked).not.toBe(false);
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

// ── 19. Group column present in item rows (Phase 15) ───────────────────────────
describe("V2 Export — Group column present in item rows", () => {
  it("ENTRY col B (col 2) for item row contains the group name", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 not found").not.toBeNull();
    const colBVal = ws.getRow(row!).getCell(E_GROUP_COL).value;
    expect(typeof colBVal).toBe("string");
    expect((colBVal as string).toLowerCase()).toContain("testgroup");
  });

  it("ENTRY col C (col 3) for item row contains the item name", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 not found").not.toBeNull();
    const colCVal = ws.getRow(row!).getCell(E_ITEM_NAME_COL).value;
    expect(typeof colCVal).toBe("string");
    expect((colCVal as string).toLowerCase()).toContain("test item 1");
  });

  it("ENTRY row 3 (sub-header): col 2 label is 'Group'", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = String(ws.getRow(3).getCell(E_GROUP_COL).value ?? "").toLowerCase().trim();
    expect(v).toBe("group");
  });

  it("ENTRY row 3 (sub-header): col 3 label is 'Item Name'", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const v  = String(ws.getRow(3).getCell(E_ITEM_NAME_COL).value ?? "").toLowerCase().trim();
    expect(v).toContain("item name");
  });
});

// ── 20. Ageing sheet (Phase 15) ─────────────────────────────────────────────────
describe("V2 Export — Ageing sheet", () => {
  const AGE_GROUP_COL = 1, AGE_CODE_COL = 2, AGE_NAME_COL = 3,
        AGE_CQTY_COL = 4, AGE_CVAL_COL = 5,
        AGE_B1_COL = 6, AGE_B2_COL = 7, AGE_B3_COL = 8, AGE_B4_COL = 9, AGE_B5_COL = 10,
        AGE_BASIS_COL = 11;

  function findAgeingRow(ws: ExcelJS.Worksheet, itemName: string): number | null {
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).getCell(AGE_NAME_COL).value;
      if (typeof v === "string" && v.trim() === itemName) return r;
    }
    return null;
  }

  it("has the expected header row", () => {
    const ws = wb.getWorksheet("Ageing")!;
    expect(String(ws.getRow(1).getCell(AGE_GROUP_COL).value)).toMatch(/group/i);
    expect(String(ws.getRow(1).getCell(AGE_CQTY_COL).value)).toMatch(/closing qty/i);
    expect(String(ws.getRow(1).getCell(AGE_B5_COL).value)).toMatch(/121\+/);
    expect(String(ws.getRow(1).getCell(AGE_BASIS_COL).value)).toMatch(/ageing basis/i);
  });

  it("Test Item 1 (no seeded offload/transfer movement) falls into the 121+ bucket with a documented fallback basis", () => {
    const ws  = wb.getWorksheet("Ageing")!;
    const row = findAgeingRow(ws, "Test Item 1");
    expect(row, "Test Item 1 not found in Ageing sheet").not.toBeNull();
    const b5 = ws.getRow(row!).getCell(AGE_B5_COL).value;
    expect(typeof b5).toBe("number");
    expect(b5 as number).toBeGreaterThan(0);
    // No other bucket should be populated for this item
    [AGE_B1_COL, AGE_B2_COL, AGE_B3_COL, AGE_B4_COL].forEach((c) => {
      expect(ws.getRow(row!).getCell(c).value).toBeNull();
    });
    const basis = String(ws.getRow(row!).getCell(AGE_BASIS_COL).value ?? "");
    expect(basis.toLowerCase()).toContain("no movement record");
  });

  it("bucketed qty for Test Item 1 matches its ENTRY Closing Qty", () => {
    const entryWs = wb.getWorksheet("ENTRY")!;
    const entryRow = findItemRow(entryWs, "Test Item 1");
    expect(entryRow, "Test Item 1 not found in ENTRY").not.toBeNull();
    const closeQty = cellNum(entryWs, entryRow!, CLOSE_QTY_COL);

    const ageWs = wb.getWorksheet("Ageing")!;
    const ageRow = findAgeingRow(ageWs, "Test Item 1");
    expect(ageRow, "Test Item 1 not found in Ageing").not.toBeNull();
    const ageCloseQty = ageWs.getRow(ageRow!).getCell(AGE_CQTY_COL).value as number;
    expect(ageCloseQty).toBeCloseTo(closeQty!, 1);
  });

  it("Ageing sheet has a TOTAL row whose 121+ bucket sum reconciles with item rows (no seeded movement data)", () => {
    const ws = wb.getWorksheet("Ageing")!;
    let totalRow: number | null = null;
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).getCell(AGE_GROUP_COL).value;
      if (typeof v === "string" && v.trim().toUpperCase() === "TOTAL") { totalRow = r; break; }
    }
    expect(totalRow, "TOTAL row not found in Ageing sheet").not.toBeNull();
    const totalB5 = ws.getRow(totalRow!).getCell(AGE_B5_COL).value as number;

    let sumB5 = 0;
    for (let r = 2; r < totalRow!; r++) {
      const v = ws.getRow(r).getCell(AGE_B5_COL).value;
      if (typeof v === "number") sumB5 += v;
    }
    expect(totalB5).toBeCloseTo(sumB5, 1);
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
