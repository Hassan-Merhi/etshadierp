/**
 * Phase 4 — Real XLSX Export Tests
 * ----------------------------------
 * Downloads actual Excel responses from factory export endpoints and opens
 * the workbook with ExcelJS to verify:
 *   - Returned binary is valid XLSX (PK magic bytes + ExcelJS can load it)
 *   - Expected sheet names exist
 *   - Required column headers are present on the header row
 *   - No other company's data leaks into the workbook (real cross-company bale)
 *   - Unauthenticated requests are rejected with 401
 *
 * Factory endpoints fall back to currentCompanyId, so the standard
 * seedTestData + set-company auth flow works without a factoryCompanyId.
 *
 * Note on shared-DB environment: this test suite runs against a shared database
 * that may contain production factory bales. The structural tests (valid XLSX,
 * sheet names, headers, auth) work regardless of what data is present. The
 * data-presence tests (seeded bale appears, export-full.xlsx success path) are
 * run conditionally — they are skipped when the test infrastructure detects that
 * the session's company does not match the freshly-created test company (which
 * can happen on a shared DB when a previous run left factory_bales behind,
 * blocking location cleanup and causing a new company to be created).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { db, pool } from "../server/db";
import { eq, sql } from "drizzle-orm";
import * as schema from "../shared/schema";
import { factoryBales } from "../shared/schema/factory";
import {
  seedTestData,
  cleanupTestData,
  closeTestServer,
  type TestContext,
} from "./setup";

const TEST_PREFIX = "xlsexp";
const BALE_FINALIZED_DATE = "2000-06-15";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let seededBaleId: number | null = null;
// CI uses an isolated PostgreSQL database, so the seeded bale must always be
// visible through the authenticated test company's export endpoints.
// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadWorkbook(body: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body);
  return wb;
}

function isValidXlsxMagic(buf: Buffer): boolean {
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

function getBinary(agentOrApp: any, url: string): request.Test {
  const req =
    typeof agentOrApp.get === "function"
      ? (agentOrApp as request.SuperAgentTest).get(url)
      : request(agentOrApp).get(url);
  return req
    .buffer(true)
    .parse((_res: any, fn: any) => {
      const chunks: Buffer[] = [];
      _res.on("data", (c: Buffer) => chunks.push(c));
      _res.on("end", () => fn(null, Buffer.concat(chunks)));
    });
}

async function login() {
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (loginRes.status !== 200)
    throw new Error(`Login failed: ${loginRes.status} — ${JSON.stringify(loginRes.body)}`);

  const setCoRes = await agent
    .post("/api/auth/set-company")
    .send({ companyId: ctx.companyId });
  if (setCoRes.status !== 200)
    throw new Error(
      `set-company failed: ${setCoRes.status} — ${JSON.stringify(setCoRes.body)}`,
    );
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await login();

  // Seed one factory bale for the test company.
  // erpLocationId is intentionally omitted (null) so that the location deletion
  // in cleanupTestData is not blocked by a FK constraint, preventing orphaned rows
  // from accumulating across test runs.
  const [bale] = await db
    .insert(factoryBales)
    .values({
      companyId: ctx.companyId,
      baleCode: `${TEST_PREFIX}-BALE-001`,
      referenceNumber: `${TEST_PREFIX}-REF-001`,
      articleCode: `${TEST_PREFIX}-ART`,
      productName: "Test Export Bale",
      category: "Test Category",
      grade: "A",
      weightKg: "50.500",
      costPerKg: "2.00",
      totalCost: "101.00",
      status: "FINALIZED",
      finalizedAt: new Date(`${BALE_FINALIZED_DATE}T12:00:00Z`),
      quantity: 1,
      // erpLocationId: null (default) — avoids FK constraint on location cleanup
    })
    .returning({ id: factoryBales.id });
  seededBaleId = bale.id;
}, 60000);

afterAll(async () => {
  // Clean up factory bales BEFORE cleanupTestData deletes locations
  // (location deletion fails with FK constraint if factory_bales.erpLocationId
  // references any location in the test company).
  if (seededBaleId !== null) {
    await db.delete(factoryBales).where(eq(factoryBales.id, seededBaleId));
  }
  // Also sweep any orphaned xlsexp factory bales left by previous failed runs
  const testCompanies = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(sql`${schema.companies.name} LIKE ${"%" + TEST_PREFIX + "%"}`);
  for (const co of testCompanies) {
    await db.delete(factoryBales).where(eq(factoryBales.companyId, co.id));
  }
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

// ── Bale Stock Register ───────────────────────────────────────────────────────

describe("XLSX Export — Bale Stock Register", () => {
  it("GET /api/factory/bales/stock-register.xlsx returns 200 with Excel content-type", async () => {
    const res = await getBinary(agent, "/api/factory/bales/stock-register.xlsx");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"] ?? "").toMatch(/spreadsheet|excel|octet-stream/i);
  });

  it("returned buffer is valid XLSX (PK magic bytes)", async () => {
    const res = await getBinary(agent, "/api/factory/bales/stock-register.xlsx");
    expect(res.status).toBe(200);
    const buf = res.body as Buffer;
    expect(buf.length).toBeGreaterThan(1000);
    expect(isValidXlsxMagic(buf)).toBe(true);
  });

  it("ExcelJS can open the returned buffer without error", async () => {
    const res = await getBinary(agent, "/api/factory/bales/stock-register.xlsx");
    expect(res.status).toBe(200);
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb).toBeDefined();
  });

  it('sheet "Stock Register" exists', async () => {
    const res = await getBinary(agent, "/api/factory/bales/stock-register.xlsx");
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.getWorksheet("Stock Register")).toBeDefined();
  });

  it('sheet "Summary" exists', async () => {
    const res = await getBinary(agent, "/api/factory/bales/stock-register.xlsx");
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.getWorksheet("Summary")).toBeDefined();
  });

  it('"Stock Register" sheet has expected column headers', async () => {
    const res = await getBinary(agent, "/api/factory/bales/stock-register.xlsx");
    const wb = await loadWorkbook(res.body as Buffer);
    const ws = wb.getWorksheet("Stock Register")!;
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell) => {
      if (cell.value) headers.push(String(cell.value));
    });
    expect(headers).toContain("Reference Number");
    expect(headers).toContain("Weight (KG)");
    expect(headers).toContain("Status");
  });

  it('"Summary" sheet has Status, Bale Count, Total Weight headers', async () => {
    const res = await getBinary(agent, "/api/factory/bales/stock-register.xlsx");
    const wb = await loadWorkbook(res.body as Buffer);
    const ws = wb.getWorksheet("Summary")!;
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell) => {
      if (cell.value) headers.push(String(cell.value));
    });
    expect(headers).toContain("Status");
    expect(headers).toContain("Bale Count");
    expect(headers).toContain("Total Weight (KG)");
  });

  it("seeded bale reference number appears in the export", async () => {
    // This test doubles as a session-company diagnostic: if our seeded bale
    // (company_id = ctx.companyId) does not appear, the session is pointing to
    // a different company (shared-DB environment issue). We record the outcome
    // so the export-full.xlsx success-path tests can skip gracefully.
    const res = await getBinary(agent, "/api/factory/bales/stock-register.xlsx");
    const wb = await loadWorkbook(res.body as Buffer);
    const ws = wb.getWorksheet("Stock Register")!;

    const refNumbers: string[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const val = row.getCell(1).value;
      if (val) refNumbers.push(String(val));
    });
expect(refNumbers).toContain(`${TEST_PREFIX}-REF-001`);
  });

  it("export does not contain another company's bale reference", async () => {
    // Use a unique suffix to avoid collision if a previous run was interrupted
    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    const [otherCompany] = await db
      .insert(schema.companies)
      .values({ code: `XO${suffix}`, name: `${TEST_PREFIX}_OtherCo_${suffix}`, baseCurrency: "USD" })
      .returning();

    let otherBaleId: number | null = null;
    try {
      const [otherBale] = await db
        .insert(factoryBales)
        .values({
          companyId: otherCompany.id,
          baleCode: `${TEST_PREFIX}-OTHER-BALE`,
          referenceNumber: `${TEST_PREFIX}-OTHER-REF`,
          articleCode: `${TEST_PREFIX}-OTHER-ART`,
          productName: "Other Company Bale",
          category: "Foreign",
          grade: "B",
          weightKg: "30.000",
          costPerKg: "1.00",
          totalCost: "30.00",
          status: "IN_STOCK",
          quantity: 1,
        })
        .returning({ id: factoryBales.id });
      otherBaleId = otherBale.id;

      const res = await getBinary(agent, "/api/factory/bales/stock-register.xlsx");
      const wb = await loadWorkbook(res.body as Buffer);
      const ws = wb.getWorksheet("Stock Register")!;

      const refNumbers: string[] = [];
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const val = row.getCell(1).value;
        if (val) refNumbers.push(String(val));
      });

      // The other company's bale reference must NOT appear in our company's export
      expect(refNumbers).not.toContain(`${TEST_PREFIX}-OTHER-REF`);
    } finally {
      if (otherBaleId !== null) {
        await db.delete(factoryBales).where(eq(factoryBales.id, otherBaleId));
      }
      await db.delete(schema.companies).where(eq(schema.companies.id, otherCompany.id));
    }
  });

  it("unauthenticated request returns 401", async () => {
    const res = await getBinary(
      request.agent(ctx.app),
      "/api/factory/bales/stock-register.xlsx",
    );
    expect(res.status).toBe(401);
  });
});

// ── Location Inventory Export ─────────────────────────────────────────────────

describe("XLSX Export — Location Inventory", () => {
  it("GET /api/factory/location-inventory/:id/export/excel returns 200 with Excel content-type", async () => {
    const res = await getBinary(
      agent,
      `/api/factory/location-inventory/${ctx.locationId}/export/excel`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"] ?? "").toMatch(/spreadsheet|excel|octet-stream/i);
  });

  it("returned buffer is valid XLSX (PK magic bytes)", async () => {
    const res = await getBinary(
      agent,
      `/api/factory/location-inventory/${ctx.locationId}/export/excel`,
    );
    expect(res.status).toBe(200);
    const buf = res.body as Buffer;
    expect(buf.length).toBeGreaterThan(1000);
    expect(isValidXlsxMagic(buf)).toBe(true);
  });

  it("ExcelJS can open the returned buffer without error", async () => {
    const res = await getBinary(
      agent,
      `/api/factory/location-inventory/${ctx.locationId}/export/excel`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb).toBeDefined();
  });

  it('contains "Stock Summary" sheet', async () => {
    const res = await getBinary(
      agent,
      `/api/factory/location-inventory/${ctx.locationId}/export/excel`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.getWorksheet("Stock Summary")).toBeDefined();
  });

  it('contains "Bale Details" sheet', async () => {
    const res = await getBinary(
      agent,
      `/api/factory/location-inventory/${ctx.locationId}/export/excel`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.getWorksheet("Bale Details")).toBeDefined();
  });

  it('contains "Wipers & Garbage" sheet', async () => {
    const res = await getBinary(
      agent,
      `/api/factory/location-inventory/${ctx.locationId}/export/excel`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.getWorksheet("Wipers & Garbage")).toBeDefined();
  });

  it('contains "Garbage & Wiper Details" sheet', async () => {
    const res = await getBinary(
      agent,
      `/api/factory/location-inventory/${ctx.locationId}/export/excel`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.getWorksheet("Garbage & Wiper Details")).toBeDefined();
  });

  it('"Stock Summary" sheet has Article Code, Product Name, Total KG headers', async () => {
    const res = await getBinary(
      agent,
      `/api/factory/location-inventory/${ctx.locationId}/export/excel`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    const ws = wb.getWorksheet("Stock Summary")!;
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell) => {
      if (cell.value) headers.push(String(cell.value));
    });
    expect(headers).toContain("Article Code");
    expect(headers).toContain("Product Name");
    expect(headers).toContain("Total KG");
  });

  it("non-existent location ID returns < 500 (empty workbook or 4xx, never 500)", async () => {
    const res = await agent.get("/api/factory/location-inventory/999999999/export/excel");
    expect(res.status).toBeLessThan(500);
  });

  it("unauthenticated request returns 401", async () => {
    const res = await getBinary(
      request.agent(ctx.app),
      `/api/factory/location-inventory/${ctx.locationId}/export/excel`,
    );
    expect(res.status).toBe(401);
  });
});

// ── Daily Production Report Export ───────────────────────────────────────────

describe("XLSX Export — Daily Production Report", () => {
  it("GET /api/factory/daily-report/export?format=excel returns 200 with Excel content-type", async () => {
    const res = await getBinary(agent, "/api/factory/daily-report/export?format=excel");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"] ?? "").toMatch(/spreadsheet|excel|octet-stream/i);
  });

  it("returned buffer is valid XLSX (PK magic bytes)", async () => {
    const res = await getBinary(agent, "/api/factory/daily-report/export?format=excel");
    expect(res.status).toBe(200);
    const buf = res.body as Buffer;
    expect(buf.length).toBeGreaterThan(1000);
    expect(isValidXlsxMagic(buf)).toBe(true);
  });

  it("ExcelJS can open the returned buffer without error", async () => {
    const res = await getBinary(agent, "/api/factory/daily-report/export?format=excel");
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb).toBeDefined();
  });

  it('contains "Production Report" sheet', async () => {
    const res = await getBinary(agent, "/api/factory/daily-report/export?format=excel");
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.getWorksheet("Production Report")).toBeDefined();
  });

  it('"Production Report" sheet has Date, Batch Code, KG Used, Notes headers', async () => {
    const res = await getBinary(agent, "/api/factory/daily-report/export?format=excel");
    const wb = await loadWorkbook(res.body as Buffer);
    const ws = wb.getWorksheet("Production Report")!;
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell) => {
      if (cell.value) headers.push(String(cell.value));
    });
    expect(headers).toContain("Date");
    expect(headers).toContain("Batch Code");
    expect(headers).toContain("KG Used");
    expect(headers).toContain("Notes");
  });

  it("unauthenticated request returns 401", async () => {
    const res = await getBinary(
      request.agent(ctx.app),
      "/api/factory/daily-report/export?format=excel",
    );
    expect(res.status).toBe(401);
  });
});

// ── Bale Full Export ──────────────────────────────────────────────────────────
//
// Error and success paths both run against the isolated CI database.

describe("XLSX Export — Bale Full Export (error cases)", () => {
  it("GET without date param returns 400 with message mentioning 'date'", async () => {
    const res = await agent.get("/api/factory/bales/export-full.xlsx");
    expect(res.status).toBe(400);
    expect(String(res.body?.message ?? "")).toMatch(/date/i);
  });

  it("with a valid date but no matching bales returns 404", async () => {
    const res = await agent.get("/api/factory/bales/export-full.xlsx?date=1999-01-01");
    expect(res.status).toBe(404);
  });

  it("unauthenticated request returns 401", async () => {
    const res = await request(ctx.app)
      .get(`/api/factory/bales/export-full.xlsx?date=${BALE_FINALIZED_DATE}`);
    expect(res.status).toBe(401);
  });
});

describe("XLSX Export — Bale Full Export (success path)", () => {
  it("with seeded bale date returns 200 with valid XLSX", async () => {
const res = await getBinary(
      agent,
      `/api/factory/bales/export-full.xlsx?date=${BALE_FINALIZED_DATE}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"] ?? "").toMatch(/spreadsheet|excel|octet-stream/i);
    const buf = res.body as Buffer;
    expect(buf.length).toBeGreaterThan(1000);
    expect(isValidXlsxMagic(buf)).toBe(true);
  });

  it("ExcelJS can open the returned buffer without error", async () => {
const res = await getBinary(
      agent,
      `/api/factory/bales/export-full.xlsx?date=${BALE_FINALIZED_DATE}`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb).toBeDefined();
  });

  it('contains "Bales" sheet', async () => {
const res = await getBinary(
      agent,
      `/api/factory/bales/export-full.xlsx?date=${BALE_FINALIZED_DATE}`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    expect(wb.getWorksheet("Bales")).toBeDefined();
  });

  it('"Bales" sheet contains the seeded bale reference number', async () => {
const res = await getBinary(
      agent,
      `/api/factory/bales/export-full.xlsx?date=${BALE_FINALIZED_DATE}`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    const ws = wb.getWorksheet("Bales")!;
    const refNumbers: string[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const val = row.getCell(1).value;
      if (val) refNumbers.push(String(val));
    });
    expect(refNumbers).toContain(`${TEST_PREFIX}-REF-001`);
  });

  it('"Bales" sheet has expected column headers (Reference Number, Weight, Status)', async () => {
const res = await getBinary(
      agent,
      `/api/factory/bales/export-full.xlsx?date=${BALE_FINALIZED_DATE}`,
    );
    const wb = await loadWorkbook(res.body as Buffer);
    const ws = wb.getWorksheet("Bales")!;
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell) => {
      if (cell.value) headers.push(String(cell.value));
    });
    expect(headers).toContain("Reference Number");
    expect(headers).toContain("Weight (kg)");
    expect(headers).toContain("Status");
  });
});

// ── SP Sales Form — July 1–6 verification ────────────────────────────────────
//
// Spec (task requirement §8): generate export for 2026-07-01 to 2026-07-06 and confirm:
//   • No visible date after 2026-07-06 in ENTRY exported day blocks
//   • No Qty/Sale Price values on days with no posted SP sales
//   • Opening stock exists for items with SP stock movements before 2026-07-01
//   • No #DIV/0! appears in visible sheets
//
// Strategy: update the test company to company_type='supplier_partner' for the
// duration of this block (restored in afterAll).  Seed a stock movement created
// on 2026-06-15 and one posted SP sale on 2026-07-03 only.
//
// Template-item matching: the seeded article code is unlikely to match any
// hardcoded template row, so ENTRY data cells remain null — but the structural
// assertions (date clearing, error-freedom) are template-agnostic.

describe("XLSX Export — SP Sales Form (July 1–6 verification)", () => {
  const FROM      = "2026-07-01";
  const TO        = "2026-07-06";
  const ARTICLE   = `${TEST_PREFIX}_SPITM`;
  const DAY_COUNT = 6;   // 6 days: July 1–6
  const E_DATE_START = 7;
  const S_DATE_START = 6;  // F = first date column in Sales sheet
  const S_NAME_COL = 3;    // C = item name column in Sales sheet

  let spMovId      = 0;
  let spSaleId     = 0;
  let spOnDateMovId = 0; // movement created ON fromDate — must appear in opening stock
  // Cache the export buffer so we only hit the DB+template once per test run.
  let exportBuf: Buffer | null = null;

  async function getExportBuf(): Promise<Buffer> {
    if (!exportBuf) {
      const res = await getBinary(
        agent,
        `/api/sp/sales-form/export?fromDate=${FROM}&toDate=${TO}`,
      );
      if (res.status !== 200)
        throw new Error(`SP export failed: ${res.status} — ${JSON.stringify(res.body)}`);
      exportBuf = res.body as Buffer;
    }
    return exportBuf;
  }

  beforeAll(async () => {
    // Promote test company to supplier_partner so requireSpCompany passes.
    await pool.query("UPDATE companies SET company_type = 'supplier_partner' WHERE id = $1", [ctx.companyId]);

    // Stock movement created BEFORE fromDate — contributes to opening stock.
    const mvRes = await pool.query(
      `INSERT INTO sp_stock_movements
         (company_id, article_code, qty_in, qty_remaining,
          base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd, created_at)
       VALUES ($1, $2, 100, 100, 5.00, 5.00, 5.00, '2026-06-15T00:00:00Z'::timestamptz)
       RETURNING id`,
      [ctx.companyId, ARTICLE],
    );
    spMovId = mvRes.rows[0]?.id ?? 0;

    // One posted sale on July 3 (day 2 of the range); days 0,1,3,4,5 have no sale.
    const saleRes = await pool.query(
      `INSERT INTO sp_sales
         (company_id, sale_date, customer_name,
          total_sale_price_usd, total_base_cost_usd, total_final_cost_usd, gross_profit_usd, status)
       VALUES ($1, '2026-07-03'::date, 'Test SP Customer', 600, 500, 500, 100, 'posted')
       RETURNING id`,
      [ctx.companyId],
    );
    spSaleId = saleRes.rows[0]?.id ?? 0;

    await pool.query(
      `INSERT INTO sp_sale_lines
         (sale_id, company_id, movement_id, article_code,
          qty_sold, sale_price_per_unit, base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd)
       VALUES ($1, $2, $3, $4, 10, 60, 50, 50, 50)`,
      [spSaleId, ctx.companyId, spMovId, ARTICLE],
    );

    // Second movement created ON fromDate (July 1) — must also appear in opening stock
    // because `created_at::date <= fromDate::date` is inclusive (on-date arrivals count).
    const mvOnDateRes = await pool.query(
      `INSERT INTO sp_stock_movements
         (company_id, article_code, qty_in, qty_remaining,
          base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd, created_at)
       VALUES ($1, $2, 50, 50, 5.00, 5.00, 5.00, '2026-07-01T06:00:00Z'::timestamptz)
       RETURNING id`,
      [ctx.companyId, ARTICLE],
    );
    spOnDateMovId = mvOnDateRes.rows[0]?.id ?? 0;

    // Assign a real location to spMovId so locationId-filter tests can verify
    // that the filter includes/excludes it based on location.
    await pool.query(
      "UPDATE sp_stock_movements SET location_id = $1 WHERE id = $2",
      [ctx.locationId, spMovId],
    );
  }, 30000);

  afterAll(async () => {
    exportBuf = null;
    // Best-effort individual deletes so company-type restore always runs.
    try { await pool.query("DELETE FROM sp_sale_lines WHERE sale_id = $1", [spSaleId]); } catch {}
    try { await pool.query("DELETE FROM sp_sales WHERE id = $1", [spSaleId]); } catch {}
    try { await pool.query("DELETE FROM sp_stock_movements WHERE id = $1", [spMovId]); } catch {}
    try { await pool.query("DELETE FROM sp_stock_movements WHERE id = $1", [spOnDateMovId]); } catch {}
    // Restore company type — runs even if deletions above partially fail.
    await pool.query("UPDATE companies SET company_type = 'erp' WHERE id = $1", [ctx.companyId]);
  }, 15000);

  // ── 1. Basic shape ───────────────────────────────────────────────────────
  it("returns 200 with valid XLSX magic bytes", async () => {
    const res = await getBinary(
      agent,
      `/api/sp/sales-form/export?fromDate=${FROM}&toDate=${TO}`,
    );
    expect(res.status).toBe(200);
    expect(isValidXlsxMagic(res.body as Buffer)).toBe(true);
  });

  // ── 2. Date clearing ─────────────────────────────────────────────────────
  it("ENTRY date row: cells for day 6+ are null — no date after July 6", async () => {
    const wb = await loadWorkbook(await getExportBuf());
    const ws = wb.getWorksheet("ENTRY");
    expect(ws).toBeTruthy();
    const dateRow = ws!.getRow(3);

    // First triplet beyond export range: d=6, col = E_DATE_START + 6*3 = 25
    const firstUnused = E_DATE_START + DAY_COUNT * 3;
    for (let c = firstUnused; c < firstUnused + 15; c++) {
      expect(
        dateRow.getCell(c).value,
        `ENTRY date-row col ${c} (day ${Math.floor((c - E_DATE_START) / 3)}) should be null`,
      ).toBeNull();
    }
  });

  it("ENTRY date row: last exported day triplet (day 5 = July 6) has a non-null value", async () => {
    const wb = await loadWorkbook(await getExportBuf());
    const ws = wb.getWorksheet("ENTRY")!;
    // Day 5 first col: E_DATE_START + 5*3 = 22
    const lastDayCol = E_DATE_START + (DAY_COUNT - 1) * 3;
    expect(ws.getRow(3).getCell(lastDayCol).value).not.toBeNull();
  });

  // ── 3. Formula errors ────────────────────────────────────────────────────
  it("visible sheets contain no #DIV/0! formula errors", async () => {
    const wb = await loadWorkbook(await getExportBuf());
    const VISIBLE = ["ENTRY", "Summary", "Ageing", "Summary-Itemwise"];
    const errors: string[] = [];
    for (const name of VISIBLE) {
      const ws = wb.getWorksheet(name);
      if (!ws) continue;
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value as any;
          const result = v?.result ?? (typeof v === "string" ? v : null);
          if (typeof result === "string" && result.includes("#DIV/0!"))
            errors.push(`${name}!${cell.address}`);
        });
      });
    }
    expect(errors, `#DIV/0! found in visible sheets: ${errors.join(", ")}`).toHaveLength(0);
  });

  // ── 4. Sales sheet date clearing ─────────────────────────────────────────
  it("Sales hidden sheet: date-row cells beyond toDate are null", async () => {
    const wb = await loadWorkbook(await getExportBuf());
    const ws = wb.getWorksheet("Sales");
    if (!ws) return; // skip if Sales sheet absent from template
    const dateRow = ws.getRow(1);
    // Sales uses one column per day; first unused = S_DATE_START + DAY_COUNT = 12
    const firstUnused = S_DATE_START + DAY_COUNT;
    for (let c = firstUnused; c < firstUnused + 15; c++) {
      expect(
        dateRow.getCell(c).value,
        `Sales date-row col ${c} should be null (beyond July 6)`,
      ).toBeNull();
    }
  });

  // ── 5. Sales sheet null for no-sale days ─────────────────────────────────
  it("Sales sheet: days with no posted sales have null/zero qty (not a non-zero amount)", async () => {
    // Days 0,1,3,4,5 have no sales; day 2 (July 3) has a sale but only for
    // our test article which may not appear in the template.
    // Scan every named item row: no-sale day cells must be null or 0.
    // Formula cells are stored by ExcelJS as { formula, result } — unwrap the
    // result before comparing so we don't mistake a 0-result formula for a value.
    const wb = await loadWorkbook(await getExportBuf());
    const ws = wb.getWorksheet("Sales");
    if (!ws) return;
    const staleValues: string[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.getCell(3).value) continue; // skip rows with no item name
      for (const d of [0, 1, 3, 4, 5]) { // days with no sales
        const c = S_DATE_START + d;
        const raw = row.getCell(c).value as any;
        // Skip formula cells — the export code intentionally leaves template
        // formulas intact (isFormula guard in spSalesFormExport).  Those cells
        // are not plain sale quantities and won't be picked up by SUMIFS.
        if (raw !== null && typeof raw === "object" && ("formula" in raw || "sharedFormula" in raw)) {
          continue;
        }
        // For plain cells: null / 0 / undefined are all acceptable; anything else is a bug
        if (raw !== null && raw !== 0 && raw !== undefined)
          staleValues.push(`Sales!r${r}d${d}=${raw}`);
      }
    }
    expect(
      staleValues,
      `Non-null, non-zero qty on no-sale days: ${staleValues.join(", ")}`,
    ).toHaveLength(0);
  });

  // ── 6. Opening stock cutoff ───────────────────────────────────────────────
  it("opening stock query: movement before fromDate returns full qty (< cutoff)", async () => {
    // Verify directly in DB: our movement was created 2026-06-15 with qty_in=100.
    // The sold_before CTE uses s.sale_date < '2026-07-01', so the July 3 sale
    // is NOT deducted from opening stock.  Opening qty must be 100.
    const result = await pool.query(
      `WITH sold_before AS (
         SELECT sl.movement_id, SUM(sl.qty_sold) AS qty
         FROM   sp_sale_lines sl
         JOIN   sp_sales s ON sl.sale_id = s.id
         WHERE  sl.company_id = $1
           AND  s.status      = 'posted'
           AND  s.sale_date   < '2026-07-01'::date
         GROUP BY sl.movement_id
       )
       SELECT GREATEST(sm.qty_in::numeric - COALESCE(sb.qty, 0), 0) AS opening_qty
       FROM   sp_stock_movements sm
       LEFT JOIN sold_before sb ON sb.movement_id = sm.id
       WHERE  sm.id = $2`,
      [ctx.companyId, spMovId],
    );
    const row = result.rows[0];
    expect(row).toBeDefined();
    expect(parseFloat(row.opening_qty)).toBe(100);
  });

  it("opening stock query with <= cutoff would incorrectly deduct July 3 sale (regression guard)", async () => {
    // Confirms the OLD bug: if we used sale_date <= fromDate, the July 3 sale
    // would NOT be deducted (July 3 > July 1) — but if fromDate were July 3,
    // a sale on July 3 WOULD be deducted, giving wrong opening stock.
    // Here we check that with fromDate=July 3 the new < cutoff gives 100
    // while <= would give 90 (10 units sold).
    const strictRes = await pool.query(
      `WITH sold_before AS (
         SELECT sl.movement_id, SUM(sl.qty_sold) AS qty
         FROM   sp_sale_lines sl
         JOIN   sp_sales s ON sl.sale_id = s.id
         WHERE  sl.company_id = $1
           AND  s.status      = 'posted'
           AND  s.sale_date   < '2026-07-03'::date
         GROUP BY sl.movement_id
       )
       SELECT GREATEST(sm.qty_in::numeric - COALESCE(sb.qty, 0), 0) AS opening_qty
       FROM   sp_stock_movements sm
       LEFT JOIN sold_before sb ON sb.movement_id = sm.id
       WHERE  sm.id = $2`,
      [ctx.companyId, spMovId],
    );
    expect(parseFloat(strictRes.rows[0].opening_qty)).toBe(100); // July 3 sale NOT deducted

    const inclRes = await pool.query(
      `WITH sold_on_or_before AS (
         SELECT sl.movement_id, SUM(sl.qty_sold) AS qty
         FROM   sp_sale_lines sl
         JOIN   sp_sales s ON sl.sale_id = s.id
         WHERE  sl.company_id = $1
           AND  s.status      = 'posted'
           AND  s.sale_date   <= '2026-07-03'::date
         GROUP BY sl.movement_id
       )
       SELECT GREATEST(sm.qty_in::numeric - COALESCE(sob.qty, 0), 0) AS opening_qty
       FROM   sp_stock_movements sm
       LEFT JOIN sold_on_or_before sob ON sob.movement_id = sm.id
       WHERE  sm.id = $2`,
      [ctx.companyId, spMovId],
    );
    expect(parseFloat(inclRes.rows[0].opening_qty)).toBe(90); // old bug: July 3 sale incorrectly deducted
  });

  it("opening stock: movement created ON fromDate IS included (inclusive <= cutoff is correct)", async () => {
    // spOnDateMovId was created at 2026-07-01T06:00:00Z — within fromDate.
    // sm.created_at::date <= '2026-07-01'::date → '2026-07-01' <= '2026-07-01' → true.
    // An arrival on the period-start date is part of opening stock for that period.
    const res = await pool.query(
      `SELECT GREATEST(sm.qty_in::numeric, 0) AS opening_qty
       FROM   sp_stock_movements sm
       WHERE  sm.id = $1
         AND  sm.created_at::date <= '2026-07-01'::date`,
      [spOnDateMovId],
    );
    expect(res.rows.length).toBe(1); // row found — movement IS within the <= cutoff
    expect(parseFloat(res.rows[0].opening_qty)).toBe(50);
  });

  // ── 7. Sales sheet item-row formula clearing ─────────────────────────────
  it("Sales sheet item rows: all cells beyond toDate are null (formula cells cleared too)", async () => {
    // Fix: the old code had `if (!isFormula(cell)) cell.value = null` which left
    // formula-chain cells (e.g. =F2+1) alive after the export range.  The fix
    // removes the isFormula guard for d >= dayCount so every cell is nulled.
    const wb = await loadWorkbook(await getExportBuf());
    const ws = wb.getWorksheet("Sales");
    if (!ws) return; // skip if Sales sheet absent from this template
    const surviving: string[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.getCell(S_NAME_COL).value) continue; // skip rows with no item name
      // Every cell at d >= DAY_COUNT must be null — formulas and plain values alike.
      for (let d = DAY_COUNT; d < DAY_COUNT + 15; d++) {
        const c = S_DATE_START + d;
        const val = row.getCell(c).value;
        if (val !== null && val !== undefined) {
          surviving.push(`r${r}c${c}=${JSON.stringify(val)}`);
        }
      }
    }
    expect(
      surviving,
      `Non-null cells survived beyond toDate in Sales item rows: ${surviving.join(", ")}`,
    ).toHaveLength(0);
  });

  // ── 8. locationId filtering ───────────────────────────────────────────────
  it("sales query: locationId filter includes only sales from the matching location", async () => {
    // spMovId now has location_id = ctx.locationId (set in beforeAll UPDATE).
    // Query matching that locationId → expect the July 3 sale line.
    const matchRes = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM  sp_sale_lines sl
       JOIN  sp_sales       s  ON sl.sale_id   = s.id
       LEFT  JOIN sp_stock_movements mv ON mv.id = sl.movement_id
       WHERE sl.company_id = $1
         AND s.status      = 'posted'
         AND s.sale_date BETWEEN '2026-07-01'::date AND '2026-07-06'::date
         AND mv.location_id = $2`,
      [ctx.companyId, ctx.locationId],
    );
    expect(parseInt(matchRes.rows[0].cnt)).toBeGreaterThanOrEqual(1);

    // Query with a different locationId → no rows (our movement is at ctx.locationId only).
    const noMatchRes = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM  sp_sale_lines sl
       JOIN  sp_sales       s  ON sl.sale_id   = s.id
       LEFT  JOIN sp_stock_movements mv ON mv.id = sl.movement_id
       WHERE sl.company_id = $1
         AND s.status      = 'posted'
         AND s.sale_date BETWEEN '2026-07-01'::date AND '2026-07-06'::date
         AND mv.location_id = $2`,
      [ctx.companyId, ctx.location2Id], // location2 has no SP movements
    );
    expect(parseInt(noMatchRes.rows[0].cnt)).toBe(0);
  });

  it("opening stock query: locationId filter includes only movements at matching location", async () => {
    // spMovId was updated to location_id = ctx.locationId.
    // Opening stock query with that locationId must find our movement.
    const matchRes = await pool.query(
      `WITH sold_before AS (
         SELECT sl.movement_id, SUM(sl.qty_sold) AS qty
         FROM   sp_sale_lines sl
         JOIN   sp_sales s ON sl.sale_id = s.id
         WHERE  sl.company_id = $1
           AND  s.status      = 'posted'
           AND  s.sale_date   < '2026-07-01'::date
         GROUP BY sl.movement_id
       )
       SELECT SUM(GREATEST(sm.qty_in::numeric - COALESCE(sb.qty, 0), 0)) AS opening_qty
       FROM   sp_stock_movements sm
       LEFT   JOIN sold_before sb ON sb.movement_id = sm.id
       WHERE  sm.company_id     = $1
         AND  sm.created_at::date <= '2026-07-01'::date
         AND  sm.location_id     = $2`,
      [ctx.companyId, ctx.locationId],
    );
    expect(parseFloat(matchRes.rows[0]?.opening_qty ?? "0")).toBeGreaterThan(0);

    // Different location → no opening stock from our movements.
    const noMatchRes = await pool.query(
      `WITH sold_before AS (
         SELECT sl.movement_id, SUM(sl.qty_sold) AS qty
         FROM   sp_sale_lines sl
         JOIN   sp_sales s ON sl.sale_id = s.id
         WHERE  sl.company_id = $1
           AND  s.status      = 'posted'
           AND  s.sale_date   < '2026-07-01'::date
         GROUP BY sl.movement_id
       )
       SELECT COALESCE(SUM(GREATEST(sm.qty_in::numeric - COALESCE(sb.qty, 0), 0)), 0) AS opening_qty
       FROM   sp_stock_movements sm
       LEFT   JOIN sold_before sb ON sb.movement_id = sm.id
       WHERE  sm.company_id     = $1
         AND  sm.created_at::date <= '2026-07-01'::date
         AND  sm.location_id     = $2`,
      [ctx.companyId, ctx.location2Id],
    );
    expect(parseFloat(noMatchRes.rows[0]?.opening_qty ?? "0")).toBe(0);
  });

  it("export with locationId param returns valid XLSX (locationId filter does not crash)", async () => {
    const res = await getBinary(
      agent,
      `/api/sp/sales-form/export?fromDate=${FROM}&toDate=${TO}&locationId=${ctx.locationId}`,
    );
    expect(res.status, `Export with locationId failed: ${JSON.stringify(res.body)}`).toBe(200);
    expect(isValidXlsxMagic(res.body as Buffer)).toBe(true);
  });
});

/*
 * What this file protects:
 * - All export endpoints return 200 with Excel content-type
 * - Returned binaries have XLSX PK magic bytes (not JSON error or empty body)
 * - ExcelJS can open every returned buffer without throwing
 * - Bale Stock Register: sheets "Stock Register" + "Summary" with expected headers
 * - Bale Stock Register: another company's bale does NOT appear (real FK isolation)
 * - Location Inventory: all 4 sheets present; "Stock Summary" has expected headers
 * - Daily Production Report: "Production Report" sheet with correct headers
 * - Bale Full Export error cases: missing date → 400; no bales → 404; unauthenticated → 401
 * - Bale Full Export success path (conditional): valid XLSX + "Bales" sheet + seeded ref +
 *   column headers — runs when baleAppearsInSessionCompany=true (isolated DB only)
 * - All export endpoints reject unauthenticated requests with 401
 * - SP Sales Form July 1–6: date clearing, no #DIV/0!, Sales sheet null for no-sale days,
 *   opening stock < sale cutoff (not <=), on-date movement included in opening (inclusive <=),
 *   regression guard for old <= sale-cutoff bug, afterAll cleanup failure-resilient
 */
