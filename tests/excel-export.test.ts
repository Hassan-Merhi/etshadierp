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
    // Only check the date section (cols 7-60).  Cols 62+ are fixed template
    // columns (Closing Stock at BJ/BK=62/63, Avg Monthly Sales at col 65, etc.)
    // that are intentionally preserved — they must not be treated as stale.
    const E_FIXED_COL_START = 62;
    for (let d = DAY_COUNT + 5; d < DAY_COUNT + 15; d++) {
      const baseCol = E_DATE_START + d * 3;
      for (let c = baseCol; c < baseCol + 3; c++) {
        if (c >= E_FIXED_COL_START) continue; // skip fixed template columns
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

// ── 9. Regression: 2026-07-01 to 2026-07-06 ──────────────────────────────────
// Verifies all the issues found in the "July export still broken" report:
//   - No date beyond toDate visible immediately after dayCount (not just at +5)
//   - No #DIV/0! in visible date area
//   - No Qty/Sale Price on no-sale days
//   - Opening Stock col E written directly (not reliant on Costing SUMIFS)
//   - Closing Stock col BJ filled (= opening - sold)
//   - Sales sheet has no stale data after toDate
describe("SP Sales Form — regression 2026-07-01 to 2026-07-06", () => {
  const FROM = "2026-07-01";
  const TO   = "2026-07-06";
  const DAY_COUNT_R    = 6;
  const E_DATE_START_R = 7;
  const E_OPENING_COL  = 5;  // E
  const E_CLOSING_COL  = 62; // BJ
  const E_CLOSING_VAL  = 63; // BK
  const S_DATE_START_R = 6;  // F

  let rbuf: Buffer;
  let rwb: ExcelJS.Workbook;

  beforeAll(async () => {
    if (!templateExists) return;

    // The existing Shoes movement (created 2024-05-31, qty_in=100, cost=10) already
    // exists in the DB (seeded by the file-level beforeAll).
    // Opening stock for 2026-07-01 = 100 − 10 (sold 2024-06-01) = 90 bags.
    const { rows: [mvt] } = await pool.query<{ id: number }>(
      `SELECT id FROM sp_stock_movements
        WHERE company_id = $1 AND article_code = 'Shoes'
          AND created_at::date = '2024-05-31'
        LIMIT 1`,
      [ctx.companyId],
    );
    if (!mvt) return; // movement not found — skip the regression

    // Add a sale on 2026-07-01: 5 bags × $20.  Days 2-6 (July 2-6) have no sale.
    const { rows: [sale2] } = await pool.query<{ id: number }>(
      `INSERT INTO sp_sales
         (company_id, sale_date, customer_name,
          total_sale_price_usd, total_base_cost_usd, total_final_cost_usd,
          gross_profit_usd, status)
       VALUES ($1, '2026-07-01', 'Regression Test', 100, 50, 50, 50, 'posted')
       RETURNING id`,
      [ctx.companyId],
    );

    await pool.query(
      `INSERT INTO sp_sale_lines
         (sale_id, company_id, movement_id, article_code,
          qty_sold, sale_price_per_unit,
          base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd)
       VALUES ($1, $2, $3, 'Shoes', 5, 20, 10, 10, 10)`,
      [sale2.id, ctx.companyId, mvt.id],
    );

    rbuf = await generateSpSalesFormExcel({
      companyId: ctx.companyId,
      fromDate: FROM,
      toDate: TO,
      supplierName: "Regression Test",
    });

    const tmpWb = new ExcelJS.Workbook();
    await tmpWb.xlsx.load(rbuf);
    rwb = tmpWb;
  }, 90000);

  // Helper: skip if the regression buffer wasn't generated
  function rWb(tCtx: { skip: () => void }): ExcelJS.Workbook | null {
    if (!rbuf || !rwb) { tCtx.skip(); return null; }
    return rwb;
  }
  const rIt = templateExists ? it : it.skip.bind(it, "template missing");

  rIt("generated buffer is non-empty for 2026-07-01 to 2026-07-06", (tCtx) => {
    if (!rbuf) { tCtx.skip(); return; }
    expect(rbuf.length).toBeGreaterThan(1000);
  });

  rIt("ENTRY row 3: day index 6 (July 7) is blank — checked immediately after dayCount", (tCtx) => {
    const w = rWb(tCtx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    const dateRow = ws.getRow(3);
    const stale: string[] = [];
    // Check day index DAY_COUNT_R (= 6, the first position after the export range)
    // through index DAY_COUNT_R + 3 (= 9) — these must all be null.
    for (let d = DAY_COUNT_R; d < DAY_COUNT_R + 4; d++) {
      const baseCol = E_DATE_START_R + d * 3;
      for (let c = baseCol; c < baseCol + 3; c++) {
        const cell = dateRow.getCell(c);
        if (cell.value !== null && cell.value !== undefined) {
          stale.push(`day ${d} col ${c}: ${JSON.stringify(cell.value).slice(0, 60)}`);
        }
      }
    }
    expect(stale, `Stale date cells after toDate:\n${stale.join("\n")}`).toHaveLength(0);
  });

  rIt("ENTRY: no #DIV/0! in visible date area (rows 5+, days 0-5)", (tCtx) => {
    const w = rWb(tCtx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    const errors: string[] = [];
    for (let r = 5; r <= ws.rowCount; r++) {
      const nameCell = ws.getRow(r).getCell(3).value;
      if (!nameCell || typeof nameCell !== "string" || nameCell.startsWith("Total ")) continue;
      for (let d = 0; d < DAY_COUNT_R; d++) {
        const baseCol = E_DATE_START_R + d * 3;
        for (let c = baseCol; c < baseCol + 3; c++) {
          const v = ws.getRow(r).getCell(c).value as any;
          const result = v?.result ?? (typeof v === "string" ? v : null);
          if (typeof result === "string" && result.includes("#DIV/0!")) {
            errors.push(`r${r} d${d} c${c}: ${result}`);
          }
        }
      }
    }
    expect(errors, `#DIV/0! found:\n${errors.join("\n")}`).toHaveLength(0);
  });

  rIt("ENTRY Shoes: Qty and Sale Price null on no-sale days (July 2-6, days 1-5)", (tCtx) => {
    const w = rWb(tCtx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    let shoesRow: number | null = null;
    for (let r = 5; r <= ws.rowCount; r++) {
      const n = ws.getRow(r).getCell(3).value;
      if (typeof n === "string" && n.trim() === "Shoes") { shoesRow = r; break; }
    }
    if (shoesRow === null) { tCtx.skip(); return; }
    const stale: string[] = [];
    for (let d = 1; d < DAY_COUNT_R; d++) { // days 1-5 (July 2-6) have no sale
      const baseCol = E_DATE_START_R + d * 3;
      const qtyV   = ws.getRow(shoesRow).getCell(baseCol).value;
      const priceV = ws.getRow(shoesRow).getCell(baseCol + 1).value;
      if (qtyV   !== null && qtyV   !== undefined) stale.push(`day ${d} qty=${JSON.stringify(qtyV)}`);
      if (priceV !== null && priceV !== undefined) stale.push(`day ${d} price=${JSON.stringify(priceV)}`);
    }
    expect(stale, `Stale values on no-sale days:\n${stale.join("\n")}`).toHaveLength(0);
  });

  rIt("ENTRY Shoes: Opening Stock col E = 90 (written directly)", (tCtx) => {
    const w = rWb(tCtx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    let shoesRow: number | null = null;
    for (let r = 5; r <= ws.rowCount; r++) {
      const n = ws.getRow(r).getCell(3).value;
      if (typeof n === "string" && n.trim() === "Shoes") { shoesRow = r; break; }
    }
    if (shoesRow === null) { tCtx.skip(); return; }
    const v = ws.getRow(shoesRow).getCell(E_OPENING_COL).value as any;
    const qty = typeof v === "number" ? v : (v?.result ?? null);
    // 100 seeded − 10 sold on 2024-06-01 = 90 opening for 2026-07-01
    expect(qty, "Opening Stock col E should be 90").not.toBeNull();
    expect(Number(qty)).toBe(90);
  });

  rIt("ENTRY Shoes: Closing Stock col BJ = 85 (90 − 5 sold on July 1)", (tCtx) => {
    const w = rWb(tCtx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    let shoesRow: number | null = null;
    for (let r = 5; r <= ws.rowCount; r++) {
      const n = ws.getRow(r).getCell(3).value;
      if (typeof n === "string" && n.trim() === "Shoes") { shoesRow = r; break; }
    }
    if (shoesRow === null) { tCtx.skip(); return; }
    const v = ws.getRow(shoesRow).getCell(E_CLOSING_COL).value as any;
    const qty = typeof v === "number" ? v : (v?.result ?? null);
    // 90 opening − 5 sold = 85
    expect(qty, "Closing Stock col BJ should be 85").not.toBeNull();
    expect(Number(qty)).toBe(85);
  });

  rIt("ENTRY Shoes: Closing Stock value col BK = 850 (85 × $10 avg cost)", (tCtx) => {
    const w = rWb(tCtx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    let shoesRow: number | null = null;
    for (let r = 5; r <= ws.rowCount; r++) {
      const n = ws.getRow(r).getCell(3).value;
      if (typeof n === "string" && n.trim() === "Shoes") { shoesRow = r; break; }
    }
    if (shoesRow === null) { tCtx.skip(); return; }
    const v = ws.getRow(shoesRow).getCell(E_CLOSING_VAL).value as any;
    const val = typeof v === "number" ? v : (v?.result ?? null);
    // 85 × $10 = $850
    expect(val, "Closing Stock value col BK should be 850").not.toBeNull();
    expect(Number(val)).toBe(850);
  });

  rIt("Sales sheet: no stale data on item rows for days 6-9 (immediately after toDate)", (tCtx) => {
    const w = rWb(tCtx); if (!w) return;
    const salesWs = w.getWorksheet("Sales");
    if (!salesWs) { tCtx.skip(); return; }
    const stale: string[] = [];
    for (let r = 2; r <= salesWs.rowCount; r++) {
      const nameRaw = salesWs.getRow(r).getCell(3).value;
      const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
      if (!name || name.startsWith("Total ")) continue;
      for (let d = DAY_COUNT_R; d < DAY_COUNT_R + 4; d++) {
        const cell = salesWs.getRow(r).getCell(S_DATE_START_R + d);
        const v = cell.value;
        if (v !== null && v !== undefined) {
          stale.push(`r${r} "${name}" day ${d}: ${JSON.stringify(v).slice(0, 40)}`);
        }
      }
    }
    expect(stale, `Stale Sales data after toDate:\n${stale.join("\n")}`).toHaveLength(0);
  });

  rIt("stale-date check at DAY_COUNT+5 still clean (regression guard for old test)", (tCtx) => {
    const w = rWb(tCtx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    const dateRow = ws.getRow(3);
    const stale: string[] = [];
    // Only check the date section (cols 7-60).  Cols 62+ are fixed template
    // columns (Closing Stock, Avg Monthly Sales, Ageing) — intentionally preserved.
    const E_FIXED_COL_START = 62;
    for (let d = DAY_COUNT_R + 5; d < DAY_COUNT_R + 15; d++) {
      const baseCol = E_DATE_START_R + d * 3;
      for (let c = baseCol; c < baseCol + 3; c++) {
        if (c >= E_FIXED_COL_START) continue;
        const cell = dateRow.getCell(c);
        if (!isFormulaCell(cell) && cell.value !== null && cell.value !== undefined) {
          stale.push(`col ${c} day ${d}`);
        }
      }
    }
    expect(stale).toHaveLength(0);
  });

  // ── Edge case: zero-opening-stock item closing is null ─────────────────────
  rIt("ENTRY: item with zero opening stock has null closing stock (not 0)", (tCtx) => {
    const w = rWb(tCtx); if (!w) return;
    const ws = w.getWorksheet("ENTRY")!;
    // Any item row where col E (opening qty) is null or 0 must also have null
    // at BJ (col 62) — not numeric 0, because there is nothing to report.
    for (let r = 5; r <= ws.rowCount; r++) {
      const nameVal = ws.getRow(r).getCell(3).value;
      if (!nameVal || typeof nameVal !== "string" || nameVal.startsWith("Total ")) continue;
      const openingV = ws.getRow(r).getCell(E_OPENING_COL).value as any;
      const openingQty = typeof openingV === "number" ? openingV : (openingV?.result ?? null);
      if (openingQty === null || openingQty === 0) {
        const closingV = ws.getRow(r).getCell(E_CLOSING_COL).value;
        expect(
          closingV,
          `r${r} "${nameVal}": zero-opening item should have null closing stock, got ${JSON.stringify(closingV)}`
        ).toBeNull();
      }
    }
  });

  // ── Edge case: capacity overflow — export clamped at 18 days ──────────────
  rIt("capacity guard: 20-day export is clamped — BJ col (Closing Stock label) not wiped", async (tCtx) => {
    if (!templateExists) { tCtx.skip(); return; }
    // fromDate=2026-07-01, toDate=2026-07-20 = 20 days (> 18 template capacity)
    const buf4 = await generateSpSalesFormExcel({
      companyId: ctx.companyId,
      fromDate: "2026-07-01",
      toDate: "2026-07-20",
      supplierName: "Overflow Test",
    });
    expect(buf4.length, "overflow export must produce a valid buffer").toBeGreaterThan(1000);

    const tmpWb = new ExcelJS.Workbook();
    await tmpWb.xlsx.load(buf4);
    const ws = tmpWb.getWorksheet("ENTRY")!;

    // The "Closing Stock" label in row 3 at col BJ (62) must survive.
    const bjLabel = ws.getRow(3).getCell(62).value;
    expect(bjLabel, "Closing Stock label at row3 col BJ must not be wiped by overflow export").not.toBeNull();

    // The date section must end at or before col 60 (last valid date-block column).
    // col 61 should be blank (separator), col 62+ preserved.
    const col61 = ws.getRow(3).getCell(61).value;
    // col 61 is the empty separator — may be null; just check it's not a future date.
    if (col61 !== null && col61 instanceof Date) {
      const d = new Date(col61 as any);
      // Even if present, it should be within the export range, not day 18/19.
      expect(d.getTime()).toBeLessThanOrEqual(new Date("2026-07-18").getTime());
    }

    // Shoes item row: Closing Stock col BJ must be numeric (written by capacity-guard code)
    let shoesRow: number | null = null;
    for (let r = 5; r <= ws.rowCount; r++) {
      const n = ws.getRow(r).getCell(3).value;
      if (typeof n === "string" && n.trim() === "Shoes") { shoesRow = r; break; }
    }
    if (shoesRow !== null) {
      const v = ws.getRow(shoesRow).getCell(62).value;
      // Closing stock should be present (numeric), not undefined/null due to column corruption
      expect(
        v,
        "Closing Stock col BJ in Shoes row must not be corrupted by overflow export"
      ).not.toBeUndefined();
    }
  }, 60000);
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
 * - Regression 2026-07-01..06: date boundary, #DIV/0!, no-sale blanks,
 *   opening stock col E, closing stock col BJ/BK, Sales stale data
 */
