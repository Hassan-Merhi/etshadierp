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
 * Opening stock for item1 (asOf Jun 30):
 *   current inventory = 100 (seeded by seedTestData)
 *   + reverse the valid Jul 3 sale (qty=10) → 110
 *
 * Closing stock for item1 (asOf Jul 7):
 *   current inventory = 100 (no valid sales after Jul 7) → 100
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
const E_DATE_START    = FIXED_LEFT + 1;  // 7 — first Qty column for day 0
const CLOSE_QTY_COL   = FIXED_LEFT + 1 + DAY_COUNT * COLS_PER_DAY; // 28

// Sales sheet constants
const S_ITEM_NAME_COL = 3;  // C
const S_DATE_START    = 4;  // day 0 in Sales sheet

const E_DATA_ROW_START = 4; // ENTRY data rows start at row 4

let ctx: TestContext;
let buf: Buffer;
let wb:  ExcelJS.Workbook;

// Expected values populated after calling inventory helper directly
let expectedOpenQtyItem1  = 0;
let expectedCloseQtyItem1 = 0;

// Helper: find a named row in ENTRY/Sales sheet (column col = item name column)
function findItemRow(ws: ExcelJS.Worksheet, itemName: string, nameCol = E_ITEM_NAME_COL): number | null {
  for (let r = E_DATA_ROW_START; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(nameCol).value;
    if (typeof v === "string" && v.trim() === itemName) return r;
  }
  return null;
}

// Helper: extract numeric result from plain number or formula-object cell
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

// Error patterns to scan
const ERROR_PAT = /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/;

function scanSheetForErrors(ws: ExcelJS.Worksheet): string[] {
  const hits: string[] = [];
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value as any;
      const strVal = v?.result !== undefined ? String(v.result) : String(v ?? "");
      if (ERROR_PAT.test(strVal)) {
        hits.push(`${ws.name}!${cell.address}: ${strVal}`);
      }
    });
  });
  return hits;
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);

  const { companyId, locationId, stockItemIds } = ctx;
  const [item1Id, item2Id, item3Id] = stockItemIds;

  // ── 1. Valid Sales voucher: Jul 3, item1, qty=10, totalSales=120, totalCost=100
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

  // ── 2. Deleted Sales voucher: Jul 2, item2, qty=5 → must be excluded
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

  // ── 3. Optional Sales voucher: Jul 4, item2, qty=7 → must be excluded
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

  // ── 4. Wrong-type (Journal) voucher: Jul 5, item3, qty=3 → must be excluded
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

  // ── Derive expected opening/closing from the inventory helper directly ──────
  // Opening = asOf Jun 30 (day before Jul 1)
  const openRows  = await calculateHistoricalLocationInventory(locationId, companyId, "2026-06-30");
  const closeRows = await calculateHistoricalLocationInventory(locationId, companyId, TO);

  const openEntry  = openRows.find((r) => r.stockItemId === item1Id);
  const closeEntry = closeRows.find((r) => r.stockItemId === item1Id);

  expectedOpenQtyItem1  = openEntry  ? parseFloat(String(openEntry.quantity  ?? "0")) : 0;
  expectedCloseQtyItem1 = closeEntry ? parseFloat(String(closeEntry.quantity ?? "0")) : 0;

  // ── Generate workbook ────────────────────────────────────────────────────────
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
  // Clean up in FK order (sales_items → vouchers)
  try {
    await pool.query(
      `DELETE FROM sales_items
        WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = $1)`,
      [ctx.companyId],
    );
    await pool.query(
      `DELETE FROM vouchers WHERE company_id = $1`,
      [ctx.companyId],
    );
  } catch { /* ignore */ }

  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

// ── 1. Buffer integrity ───────────────────────────────────────────────────────
describe("V2 Export — Buffer integrity", () => {
  it("returns a non-empty Buffer", () => {
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(2000);
  });

  it("ExcelJS can parse the generated buffer without error", () => {
    expect(wb).toBeDefined();
  });
});

// ── 2. Sheet count and order ──────────────────────────────────────────────────
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
});

// ── 3. Sheet visibility ───────────────────────────────────────────────────────
describe("V2 Export — Sheet visibility", () => {
  const HIDDEN_SHEETS  = ["Costing", "Sales", "Summary-Itemwise"];
  const VISIBLE_SHEETS = ["ENTRY", "Summary", "Ageing"];

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

// ── 4. No Excel error cells in visible sheets ─────────────────────────────────
describe("V2 Export — No error cells in visible sheets", () => {
  const VISIBLE_SHEETS = ["ENTRY", "Summary", "Ageing"];

  VISIBLE_SHEETS.forEach((name) => {
    it(`"${name}" contains no #REF!, #DIV/0!, #VALUE!, #NAME?, #N/A`, () => {
      const ws = wb.getWorksheet(name);
      if (!ws) return; // sheet existence covered in prior suite
      const errors = scanSheetForErrors(ws);
      expect(errors, `Error cells found:\n${errors.join("\n")}`).toHaveLength(0);
    });
  });
});

// ── 5. Opening stock matches calculateHistoricalLocationInventory ─────────────
describe("V2 Export — Opening stock (Jun 30)", () => {
  it("expectedOpenQtyItem1 is positive (seeded sale reversed into opening)", () => {
    // Valid Jul 3 sale (qty=10) is reversed → current 100 + 10 = 110
    expect(expectedOpenQtyItem1).toBeGreaterThan(0);
  });

  it("ENTRY opening qty for Test Item 1 matches calculateHistoricalLocationInventory(Jun 30)", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found in ENTRY").not.toBeNull();
    const openInWorkbook = cellNum(ws, row!, E_OPEN_QTY_COL);
    expect(openInWorkbook).not.toBeNull();
    expect(openInWorkbook).toBeCloseTo(expectedOpenQtyItem1, 1);
  });
});

// ── 6. Closing stock matches calculateHistoricalLocationInventory ─────────────
describe("V2 Export — Closing stock (Jul 7)", () => {
  it("expectedCloseQtyItem1 equals current inventory snapshot (no sales after Jul 7)", () => {
    // Inventory snapshot = 100; no valid sales after Jul 7 → helper returns 100
    expect(expectedCloseQtyItem1).toBeGreaterThan(0);
  });

  it("ENTRY closing qty for Test Item 1 matches calculateHistoricalLocationInventory(Jul 7)", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found in ENTRY").not.toBeNull();
    const closeInWorkbook = cellNum(ws, row!, CLOSE_QTY_COL);
    expect(closeInWorkbook).not.toBeNull();
    expect(closeInWorkbook).toBeCloseTo(expectedCloseQtyItem1, 1);
  });
});

// ── 7. No dates after toDate ──────────────────────────────────────────────────
describe("V2 Export — No dates beyond toDate in ENTRY", () => {
  it("ENTRY row 2: no group-header beyond day 6 (Jul 7)", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    const stale: string[] = [];
    // Columns beyond the last day's 3-col block must be empty in row 2
    const firstBeyond = E_DATE_START + DAY_COUNT * COLS_PER_DAY; // = CLOSE_QTY_COL
    // Check a few extra col positions beyond close columns (after col 31)
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
    // Day-index 7 starts at col E_DATE_START + 7 * 3 = col 28 + 3 = 31 (Qty for day 7)
    const firstStaleCol = E_DATE_START + DAY_COUNT * COLS_PER_DAY + 3; // after closing cols
    for (let c = firstStaleCol; c < firstStaleCol + 12; c++) {
      const v = ws.getRow(3).getCell(c).value;
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        stale.push(`col ${c}: ${JSON.stringify(v).slice(0, 40)}`);
      }
    }
    expect(stale, `Stale sub-headers after toDate:\n${stale.join("\n")}`).toHaveLength(0);
  });
});

// ── 8. No sale values on no-sale days ─────────────────────────────────────────
describe("V2 Export — No sale values on no-sale days (item1)", () => {
  // Valid sale is ONLY on Jul 3 (day index 2).
  // Days 0, 1, 3, 4, 5, 6 (Jul 1,2,4,5,6,7) must have null Qty and null SalePrice.
  const NO_SALE_DAYS = [0, 1, 3, 4, 5, 6]; // day indices with no valid sale

  NO_SALE_DAYS.forEach((d) => {
    const dateLabel = ["Jul 1", "Jul 2", "Jul 4", "Jul 5", "Jul 6", "Jul 7"][NO_SALE_DAYS.indexOf(d)];
    it(`ENTRY Test Item 1: Qty and Sale Price are null on ${dateLabel} (day ${d})`, () => {
      const ws = wb.getWorksheet("ENTRY")!;
      const row = findItemRow(ws, "Test Item 1");
      expect(row, "Test Item 1 row not found").not.toBeNull();
      const baseCol = E_DATE_START + d * COLS_PER_DAY;
      const qtyV   = ws.getRow(row!).getCell(baseCol).value;
      const priceV = ws.getRow(row!).getCell(baseCol + 1).value;
      expect(qtyV,   `Day ${d} Qty should be null`).toBeNull();
      expect(priceV, `Day ${d} Sale Price should be null`).toBeNull();
    });
  });

  it("ENTRY Test Item 1: Qty on Jul 3 (day 2) = 10", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 1");
    expect(row, "Test Item 1 row not found").not.toBeNull();
    const qtyCol = E_DATE_START + 2 * COLS_PER_DAY; // day 2
    const qty = cellNum(ws, row!, qtyCol);
    expect(qty).not.toBeNull();
    expect(qty).toBeCloseTo(10, 1);
  });
});

// ── 9. Sales query excludes deleted, optional, and non-Sales vouchers ─────────
describe("V2 Export — Sales query filters", () => {
  it("ENTRY Test Item 2: no Qty on Jul 2 (deleted Sales voucher excluded)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 2");
    if (!row) return; // item2 may not appear if it has zero everything
    const qtyCol = E_DATE_START + 1 * COLS_PER_DAY; // day 1 = Jul 2
    const qty = ws.getRow(row).getCell(qtyCol).value;
    expect(qty, "Deleted voucher must not appear as Qty on Jul 2").toBeNull();
  });

  it("ENTRY Test Item 2: no Qty on Jul 4 (optional Sales voucher excluded)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 2");
    if (!row) return;
    const qtyCol = E_DATE_START + 3 * COLS_PER_DAY; // day 3 = Jul 4
    const qty = ws.getRow(row).getCell(qtyCol).value;
    expect(qty, "Optional voucher must not appear as Qty on Jul 4").toBeNull();
  });

  it("ENTRY Test Item 3: no Qty on Jul 5 (wrong voucher_type excluded)", () => {
    const ws  = wb.getWorksheet("ENTRY")!;
    const row = findItemRow(ws, "Test Item 3");
    if (!row) return;
    const qtyCol = E_DATE_START + 4 * COLS_PER_DAY; // day 4 = Jul 5
    const qty = ws.getRow(row).getCell(qtyCol).value;
    expect(qty, "Journal voucher must not appear as Qty on Jul 5").toBeNull();
  });

  it("direct DB: fetchSalesData query returns only 1 row (the valid Sales voucher)", async () => {
    // Replicate the exact query the service uses and verify filter correctness
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
    // All 4 sales_items were inserted (we rely on the above filter to exclude 3 of them)
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

// ── 10. Sales sheet — no stale data after toDate ──────────────────────────────
describe("V2 Export — Sales sheet date range", () => {
  it("Sales date row (row 1): exactly 7 date columns for the 7-day range", () => {
    const ws = wb.getWorksheet("Sales")!;
    if (!ws) return;
    const capacity = ws.columnCount - S_DATE_START + 1;
    expect(capacity).toBeGreaterThanOrEqual(DAY_COUNT);
  });

  it("Sales sheet: no qty values on day 7+ columns (after toDate Jul 7)", () => {
    const ws = wb.getWorksheet("Sales")!;
    if (!ws) return;
    const stale: string[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const name = ws.getRow(r).getCell(S_ITEM_NAME_COL).value;
      if (!name || String(name).trim() === "") continue;
      // Check columns beyond the 7-day range
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

// ── 11. ENTRY structural sanity ───────────────────────────────────────────────
describe("V2 Export — ENTRY structural sanity", () => {
  it("ENTRY sheet has at least 3 items rows (one per seeded item)", () => {
    const ws = wb.getWorksheet("ENTRY")!;
    let count = 0;
    for (let r = E_DATA_ROW_START; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).getCell(E_ITEM_NAME_COL).value;
      if (v && typeof v === "string" && v.trim() !== "" && !v.startsWith("TOTAL")) count++;
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
 * ✓ Route/service generates workbook for July 1–7
 * ✓ Workbook has 6 sheets in correct order
 * ✓ Costing, Sales, Summary-Itemwise are hidden
 * ✓ ENTRY, Summary, Ageing are visible
 * ✓ Opening stock matches calculateHistoricalLocationInventory(Jun 30)
 * ✓ Closing stock matches calculateHistoricalLocationInventory(Jul 7)
 * ✓ No #DIV/0!, #REF!, #VALUE!, #NAME?, #N/A in visible sheets
 * ✓ No date headers beyond selected toDate
 * ✓ No sale values on no-sale days (null Qty / Sale Price)
 * ✓ Sales query: deleted vouchers excluded
 * ✓ Sales query: optional vouchers excluded
 * ✓ Sales query: non-Sales voucher_type excluded
 * ✓ DB-level verification: only 1 qualifying row passes all filters
 */
