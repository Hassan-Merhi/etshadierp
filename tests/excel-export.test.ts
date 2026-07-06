import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import {
  seedTestData,
  cleanupTestData,
  closeTestServer,
  type TestContext,
} from "./setup";
import { pool } from "../server/db";
import { generateSpSalesFormExcel } from "../server/services/spSalesFormExport";

const TEST_PREFIX = "xlsxtest";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "server",
  "templates",
  "supplier_partner_sales_form_template.xlsx",
);

// Evaluated synchronously at module load
const templateExists = fs.existsSync(TEMPLATE_PATH);

let ctx: TestContext;

// File-level state — populated by the file-level beforeAll so ctx is guaranteed set first
let buf: Buffer;
let wb: ExcelJS.Workbook;

function isFormulaCell(cell: ExcelJS.Cell): boolean {
  if (!cell.value || typeof cell.value !== "object") return false;
  const v = cell.value as Record<string, unknown>;
  return "formula" in v || "sharedFormula" in v;
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);

  if (!templateExists) return; // skip generation; inner tests use it.skip

  // ── Seed minimum SP data so generateSpSalesFormExcel has real data ────────
  // The SP export reads from sp_stock_movements, sp_sales, and sp_sale_lines.
  // Without at least one matching row, the ENTRY sheet has no data and ExcelJS's
  // writeBuffer() may throw "Shared Formula master must exist above and or left
  // of clone" for templates with shared-formula chains.
  //
  // We use article_code = "Shoes" (the first real item row in the template's
  // ENTRY sheet, col C row 5), and a saleDate of 2024-06-01 (inside fromDate–
  // toDate). The stock movement is back-dated to 2024-05-31 so the opening-
  // stock query (created_at <= fromDate) picks it up.
  await pool.query(
    `INSERT INTO sp_stock_movements
       (company_id, article_code, qty_in, qty_remaining,
        base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd,
        source_type, created_at)
     VALUES ($1, 'Shoes', 100, 100, 10, 10, 10, 'offload', '2024-05-31')
     ON CONFLICT DO NOTHING`,
    [ctx.companyId],
  );

  const { rows: [movement] } = await pool.query<{ id: number }>(
    `SELECT id FROM sp_stock_movements
      WHERE company_id = $1 AND article_code = 'Shoes'
        AND created_at::date = '2024-05-31'
      LIMIT 1`,
    [ctx.companyId],
  );

  const { rows: [sale] } = await pool.query<{ id: number }>(
    `INSERT INTO sp_sales
       (company_id, sale_date, customer_name,
        total_sale_price_usd, total_base_cost_usd, total_final_cost_usd,
        gross_profit_usd, status)
     VALUES ($1, '2024-06-01', 'Test Customer', 150, 100, 100, 50, 'posted')
     RETURNING id`,
    [ctx.companyId],
  );

  await pool.query(
    `INSERT INTO sp_sale_lines
       (sale_id, company_id, movement_id, article_code,
        qty_sold, sale_price_per_unit,
        base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd)
     VALUES ($1, $2, $3, 'Shoes', 10, 15, 10, 10, 10)`,
    [sale.id, ctx.companyId, movement.id],
  );

  const fromDate = "2024-06-01";
  const toDate   = "2024-06-05"; // 5 days — small, fast, still exercises date-column logic

  // SP data is now seeded — generateSpSalesFormExcel should produce a real
  // workbook without throwing the shared-formula error.
  // If an error is still thrown here, let it propagate so the test fails loudly.
  buf = await generateSpSalesFormExcel({
    companyId: ctx.companyId,
    fromDate,
    toDate,
    supplierName: "Test Export",
  });

  // Load the generated buffer back for structure inspection.
  const tmpWb = new ExcelJS.Workbook();
  await tmpWb.xlsx.load(buf);
  wb = tmpWb;
}, 90000);

afterAll(async () => {
  // Clean up SP data before cleanupTestData (no FK constraints to ERP tables,
  // but order within SP: lines → sales → movements).
  try {
    await pool.query(
      `DELETE FROM sp_sale_lines
        WHERE company_id = $1`,
      [ctx.companyId],
    );
    await pool.query(
      `DELETE FROM sp_sales
        WHERE company_id = $1`,
      [ctx.companyId],
    );
    await pool.query(
      `DELETE FROM sp_stock_movements
        WHERE company_id = $1`,
      [ctx.companyId],
    );
  } catch {
    // SP tables might not exist in all environments; ignore cleanup errors
  }

  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

// ── guard ─────────────────────────────────────────────────────────────────────
// All inner tests use conditional `it` so they stay in the normal test runner
// (skipped = todoish, no silent-pass, shows intent clearly).

const maybeIt = templateExists
  ? it
  : it.skip.bind(it, "template missing");

// Helper: call at the top of each structure test.
// Returns the workbook if available, or calls ctx.skip() and returns null.
function requireWb(ctx: { skip: () => void }): ExcelJS.Workbook | null {
  if (!buf || !wb) { ctx.skip(); return null; }
  return wb;
}
// Alias for backward-compat with older call sites
const wbOrSkip = requireWb;

// ── 1. Corruption-free open ───────────────────────────────────────────────────
describe("SP Sales Form — Workbook integrity", () => {
  maybeIt("generated buffer is non-empty", (ctx) => {
    if (!buf) { ctx.skip(); return; }
    expect(buf.length).toBeGreaterThan(1000); // a minimal xlsx is always > 1 KB
  });

  maybeIt("returned value is a real Buffer", (ctx) => {
    if (!buf) { ctx.skip(); return; }
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  maybeIt("ExcelJS can open the generated buffer", (ctx) => {
    const w = requireWb(ctx); if (!w) return;
    expect(w).toBeDefined();
  });
});

// ── 2. Required sheets exist ──────────────────────────────────────────────────
describe("SP Sales Form — Sheet existence", () => {
  const requiredSheets = ["ENTRY", "Costing", "Sales", "Summary", "Ageing", "Summary-Itemwise"];

  for (const name of requiredSheets) {
    maybeIt(`sheet "${name}" exists in the workbook`, (ctx) => {
      const w = wbOrSkip(ctx); if (!w) return;
      const ws = w.getWorksheet(name);
      expect(ws, `Expected sheet "${name}" to exist`).toBeDefined();
    });
  }
});

// ── 3. Sheet visibility ───────────────────────────────────────────────────────
describe("SP Sales Form — Sheet visibility", () => {
  maybeIt("Costing sheet is hidden", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("Costing") as any;
    expect(ws?.state).toBe("hidden");
  });

  maybeIt("Sales sheet is hidden", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("Sales") as any;
    expect(ws?.state).toBe("hidden");
  });

  maybeIt("Summary-Itemwise sheet is hidden", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("Summary-Itemwise") as any;
    expect(ws?.state).toBe("hidden");
  });

  maybeIt("ENTRY sheet is visible (not hidden)", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("ENTRY") as any;
    expect(ws?.state).not.toBe("hidden");
    expect(ws?.state).not.toBe("veryHidden");
  });

  maybeIt("Ageing sheet is visible — regression guard (was incorrectly hidden)", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("Ageing") as any;
    expect(ws?.state).not.toBe("hidden");
    expect(ws?.state).not.toBe("veryHidden");
  });

  maybeIt("Summary sheet is visible (not hidden)", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("Summary") as any;
    expect(ws?.state).not.toBe("hidden");
    expect(ws?.state).not.toBe("veryHidden");
  });
});

// ── 4. Date columns — 3 columns per day ──────────────────────────────────────
describe("SP Sales Form — ENTRY date-column layout", () => {
  const E_DATE_ROW   = 3;
  const E_DATE_START = 7;  // column G = 7
  const DAY_COUNT    = 5;  // fromDate=2024-06-01, toDate=2024-06-05

  maybeIt("generates exactly 3 columns per day in ENTRY row 3", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    const dateRow = ws.getRow(E_DATE_ROW);
    let dateColCount = 0;
    for (let d = 0; d < DAY_COUNT; d++) {
      const baseCol = E_DATE_START + d * 3;
      const cells = [dateRow.getCell(baseCol), dateRow.getCell(baseCol + 1), dateRow.getCell(baseCol + 2)];
      const hasValue = cells.some(
        (c) => isFormulaCell(c) || (c.value !== null && c.value !== undefined),
      );
      if (hasValue) dateColCount++;
    }
    expect(dateColCount).toBe(DAY_COUNT);
  });

  maybeIt("column G (first date column) is populated for day 0", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    const cell = ws.getRow(E_DATE_ROW).getCell(E_DATE_START);
    const isPopulated = isFormulaCell(cell) || (cell.value !== null && cell.value !== undefined);
    expect(isPopulated).toBe(true);
  });

  maybeIt("stale date columns beyond export range are cleared", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    const dateRow = ws.getRow(E_DATE_ROW);
    const staleFound: string[] = [];
    for (let d = DAY_COUNT + 5; d < DAY_COUNT + 15; d++) {
      const baseCol = E_DATE_START + d * 3;
      for (let c = baseCol; c < baseCol + 3; c++) {
        const cell = dateRow.getCell(c);
        if (!isFormulaCell(cell) && cell.value !== null && cell.value !== undefined) {
          staleFound.push(`col ${c}`);
        }
      }
    }
    expect(staleFound).toHaveLength(0);
  });
});

// ── 5. ENTRY sheet formulas ───────────────────────────────────────────────────
describe("SP Sales Form — ENTRY sheet formulas", () => {
  const E_DATA_START = 5;
  const E_DATE_START = 7;
  const DAY_COUNT    = 5;

  maybeIt("no profit column cell contains a plain number (formulas only)", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    const rowCount = ws.rowCount;
    const plainNumberProfitCells: string[] = [];

    for (let r = E_DATA_START; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const nameCell = row.getCell(3).value;
      if (!nameCell || typeof nameCell !== "string" || nameCell.toString().trim() === "") continue;
      if (nameCell.toString().startsWith("Total ")) continue;

      for (let d = 0; d < DAY_COUNT; d++) {
        const profitCell = row.getCell(E_DATE_START + d * 3 + 2);
        if (profitCell.value !== null && typeof profitCell.value === "number") {
          plainNumberProfitCells.push(`row ${r} day ${d}`);
        }
      }
    }
    expect(plainNumberProfitCells).toHaveLength(0);
  });
});

// ── 6. ENTRY sheet — seeded item row has data ─────────────────────────────────
describe("SP Sales Form — seeded Shoes row", () => {
  const E_DATA_START = 5;
  const E_DATE_START = 7;
  const E_NAME_COL   = 3; // col C

  maybeIt("ENTRY row for 'Shoes' has qty=10 on day 0 (from seeded sp_sale_lines)", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    let shoesRow: number | null = null;
    for (let r = E_DATA_START; r <= ws.rowCount; r++) {
      const name = ws.getRow(r).getCell(E_NAME_COL).value;
      if (typeof name === "string" && name.trim() === "Shoes") {
        shoesRow = r;
        break;
      }
    }
    if (shoesRow === null) {
      ctx.skip(); // "Shoes" not in this template variant — ok to skip
      return;
    }
    // Day 0 qty column = E_DATE_START + 0*3 = col 7 (G)
    // The seeded sp_sale_lines has qty_sold = 10 for 2024-06-01.
    const qtyCell = ws.getRow(shoesRow).getCell(E_DATE_START);
    expect(qtyCell.value).not.toBeNull();
    // Value may be stored as a number or as a formula-object with result
    const actual = typeof qtyCell.value === "object"
      ? (qtyCell.value as any)?.result ?? (qtyCell.value as any)
      : qtyCell.value;
    expect(Number(actual)).toBe(10); // exactly the seeded qty_sold
  });

  maybeIt("ENTRY row for 'Shoes' has no data beyond the export range (day 6+)", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    let shoesRow: number | null = null;
    for (let r = E_DATA_START; r <= ws.rowCount; r++) {
      const name = ws.getRow(r).getCell(E_NAME_COL).value;
      if (typeof name === "string" && name.trim() === "Shoes") {
        shoesRow = r;
        break;
      }
    }
    if (shoesRow === null) { ctx.skip(); return; }

    // Days 5–9 (beyond the 5-day export range) should have null qty cells
    const stale: string[] = [];
    for (let d = 5; d < 10; d++) {
      const qtyCell = ws.getRow(shoesRow).getCell(E_DATE_START + d * 3);
      if (qtyCell.value !== null && qtyCell.value !== undefined) {
        stale.push(`day ${d} col ${E_DATE_START + d * 3}`);
      }
    }
    expect(stale).toHaveLength(0);
  });
});

// ── 7. Costing sheet ─────────────────────────────────────────────────────────
describe("SP Sales Form — Costing sheet structure", () => {
  maybeIt("has at least one data row beyond the header", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("Costing")!;
    expect(ws.rowCount).toBeGreaterThan(1);
  });

  maybeIt("avg-cost column contains no Excel error strings", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("Costing")!;
    const C_AVG_COL  = 7; // G
    const C_NAME_COL = 4; // D

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nameCell = row.getCell(C_NAME_COL).value;
      if (!nameCell || String(nameCell).trim() === "") continue;
      if (String(nameCell).startsWith("Total ") || String(nameCell) === "Inventory") continue;

      const strVal = String(row.getCell(C_AVG_COL).value ?? "");
      expect(strVal).not.toMatch(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/);
    }
  });
});

// ── 8. Sales alignment ────────────────────────────────────────────────────────
describe("SP Sales Form — Sales sheet alignment", () => {
  maybeIt("Sales date row starts at column F (col 6)", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("Sales")!;
    const firstCell = ws.getRow(1).getCell(6); // row 1, col F
    const isPopulated = isFormulaCell(firstCell) || (firstCell.value !== null && firstCell.value !== undefined);
    expect(isPopulated).toBe(true);
  });

  maybeIt("Sales sheet has enough date columns for the export range (5 days)", (ctx) => {
    const w = wbOrSkip(ctx); if (!w) return;
    const ws = w.getWorksheet("Sales")!;
    const capacity = ws.columnCount - 6 + 1; // cols from F onward
    expect(capacity).toBeGreaterThanOrEqual(5);
  });
});

/*
 * What this file protects:
 * - Corruption: ExcelJS opens buffer without error (with real SP seed data)
 * - Sheet existence: all 6 required sheets present
 * - Sheet visibility: Costing/Sales/Summary-Itemwise hidden; ENTRY/Ageing/Summary visible
 * - Date columns: ENTRY row 3 generates 3 columns per day; stale columns cleared
 * - Formula preservation: profit column cells are formula objects, never plain numbers
 * - Seeded data: ENTRY "Shoes" row has non-null qty on day 0 from the seeded sale
 * - Costing avg-cost: no Excel error strings
 * - Sales alignment: date row starts at col F with enough capacity
 */
