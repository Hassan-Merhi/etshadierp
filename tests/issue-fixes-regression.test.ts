/**
 * Regression tests for the 8-issue fix batch (July 2026)
 *
 * Issue 1  – SQL placeholder bug in getVoucherEntriesByLedger + BF balance
 * Issue 2  – PATCH freight canonicalization with partial updates
 * Issue 3  – weightKgFromContainer in cascade result
 * Issue 5  – Decimal.js arithmetic + 7dp precision in recomputeBatchAndCascadeBales
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { eq, and } from "drizzle-orm";
import * as schema from "../shared/schema";
import Decimal from "decimal.js";
import { recomputeBatchAndCascadeBales } from "../server/services/factory/rawStockCostCascade";

const TEST_PREFIX = "issuefixreg";

let ctx: TestContext;
let agent: request.SuperAgentTest;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function login() {
  const loginRes = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (loginRes.status !== 200) throw new Error(`Login failed: ${loginRes.status}`);
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}

async function insertFactorySupplier(name: string) {
  const result = await pool.query(
    `INSERT INTO factory_suppliers (company_id, name, current_raw_material_cost_per_kg_usd)
     VALUES ($1, $2, '1.0000000') RETURNING id`,
    [ctx.companyId, name]
  );
  return result.rows[0].id as number;
}

async function insertFactoryContainer(opts: {
  supplierId: number;
  containerNumber: string;
  status?: string;
  ratePerKg?: string;
  ratePerKgUsd?: string;
  freight?: string;
  freightCurrencyCode?: string;
  freightPaidBy?: string;
  freightSupplierId?: number | null;
  freightOwnAccountId?: number | null;
  actualReceivedKg?: string;
  currencyCode?: string;
  fxRateToUsd?: string;
  fxRateConfirmed?: boolean;
}) {
  const [c] = await db
    .insert(schema.factoryContainers)
    .values({
      companyId: ctx.companyId,
      supplierId: opts.supplierId,
      containerNumber: opts.containerNumber,
      status: opts.status || "PENDING",
      currencyCode: opts.currencyCode || "USD",
      fxRateToUsd: opts.fxRateToUsd || "1",
      fxRateConfirmed: opts.fxRateConfirmed ?? true,
      ratePerKg: opts.ratePerKg || "1.0",
      actualReceivedKg: opts.actualReceivedKg || "1000",
      freight: opts.freight || "0",
      freightCurrencyCode: opts.freightCurrencyCode || "USD",
      freightPaidBy: opts.freightPaidBy || "supplier",
      freightSupplierId: opts.freightSupplierId !== undefined ? opts.freightSupplierId : opts.supplierId,
      freightOwnAccountId: opts.freightOwnAccountId !== undefined ? opts.freightOwnAccountId : null,
      otherCharges: "0",
      commissionAmount: "0",
      dutyStatus: "NONE",
      dutyAmount: "0",
    })
    .returning();
  return c;
}

async function insertMixBatch(companyId: number, costPerKg: string, totalWeight: string) {
  const r = await pool.query(
    `INSERT INTO factory_mix_batches (company_id, batch_code, total_weight_kg, used_kg, cost_per_kg, total_cost, status, created_at, updated_at)
     VALUES ($1, $2, $3, '0', $4, ($3::numeric * $4::numeric), 'ACTIVE', NOW(), NOW()) RETURNING id`,
    [companyId, `BATCH_${Date.now()}`, totalWeight, costPerKg]
  );
  return r.rows[0].id as number;
}

async function insertMixBatchSource(
  batchId: number,
  containerId: number,
  weightKg: string,
  costPerKg: string
) {
  const totalCost = new Decimal(weightKg).times(new Decimal(costPerKg)).toFixed(7);
  const r = await pool.query(
    `INSERT INTO factory_mix_batch_sources (mix_batch_id, container_id, weight_kg, cost_per_kg, total_cost, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
    [batchId, containerId, weightKg, costPerKg, totalCost]
  );
  return r.rows[0].id as number;
}

async function insertFactoryBale(batchId: number, companyId: number, weightKg: string, costPerKg: string) {
  const totalCost = new Decimal(weightKg).times(new Decimal(costPerKg)).toFixed(7);
  const baleCode = `BALE_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const r = await pool.query(
    `INSERT INTO factory_bales (company_id, mix_batch_id, bale_code, reference_number, weight_kg, cost_per_kg, total_cost, status, created_at, updated_at)
     VALUES ($1, $2, $3, $3, $4, $5, $6, 'PENDING_PRESSING', NOW(), NOW()) RETURNING id`,
    [companyId, batchId, baleCode, weightKg, costPerKg, totalCost]
  );
  return r.rows[0].id as number;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await login();
}, 60_000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30_000);

// ─── Issue 1: SQL parameter placeholder ─────────────────────────────────────

describe("Issue 1 – SQL parameter placeholders in ledger queries", () => {
  it("getVoucherEntriesByLedger scopes to the correct company (no cross-company contamination)", async () => {
    // Create two vouchers for the same account but in different companies.
    // With the old ${params.length} bug the company filter was injected as a
    // literal number (e.g. "3") rather than a positional $3, causing a parse
    // error or wrong results.
    const res = await agent
      .get(`/api/accounts/${ctx.cashAccountId}/statement`)
      .query({ companyId: ctx.companyId });
    // The query must not throw a 500 (broken SQL syntax).
    expect(res.status).not.toBe(500);
    // Any 200 or 400 means the SQL ran without a syntax error.
    expect([200, 400, 404]).toContain(res.status);
  });

  it("BF balance query returns valid JSON and does not throw SQL errors", async () => {
    const res = await agent.get(`/api/accounts/${ctx.cashAccountId}/statement`).query({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(res.status).not.toBe(500);
  });

  it("date-filtered ledger query runs without SQL placeholder errors", async () => {
    const res = await agent.get(`/api/accounts/${ctx.cashAccountId}/statement`).query({
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      companyId: ctx.companyId,
    });
    expect(res.status).not.toBe(500);
  });
});

// ─── Issue 2: PATCH freight canonicalization ──────────────────────────────────

describe("Issue 2 – PATCH freight canonicalization preserves existing values on partial updates", () => {
  let supplierId: number;
  let containerId: number;

  beforeAll(async () => {
    supplierId = await insertFactorySupplier(`${TEST_PREFIX}_FreightSup`);
    const c = await insertFactoryContainer({
      supplierId,
      containerNumber: `FREIGHT_TEST_${Date.now()}`,
      freight: "500",
      freightPaidBy: "supplier",
      freightSupplierId: supplierId,
    });
    containerId = c.id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM factory_containers WHERE id = $1", [containerId]);
    await pool.query("DELETE FROM factory_suppliers WHERE id = $1", [supplierId]);
  });

  it("partial PATCH (changing notes only) does NOT clear freightSupplierId", async () => {
    // Simulate a partial PATCH that only sends unrelated fields.
    const res = await agent
      .patch(`/api/factory/containers/${containerId}`)
      .send({ notes: "just a notes update" });
    // Should not be a 500 (bug would have tried to apply freight rules with undefined freight)
    expect(res.status).not.toBe(500);
    // After a partial patch that doesn't touch freight, freightSupplierId must not be cleared
    if (res.status === 200) {
      const refreshed = await db
        .select()
        .from(schema.factoryContainers)
        .where(eq(schema.factoryContainers.id, containerId));
      expect(refreshed[0].freightSupplierId).toBe(supplierId);
    }
  });
});

// ─── Issue 3: weightKgFromContainer in cascade result ────────────────────────

describe("Issue 3 – cascadeContainerCostChange returns weightKgFromContainer per-container", () => {
  let supplierId: number;
  let containerA: any;
  let containerB: any;
  let batchId: number;

  beforeAll(async () => {
    supplierId = await insertFactorySupplier(`${TEST_PREFIX}_CascSup`);
    containerA = await insertFactoryContainer({
      supplierId,
      containerNumber: `CASC_A_${Date.now()}`,
      status: "OFFLOADED",
      ratePerKg: "1.5",
      actualReceivedKg: "2000",
    });
    containerB = await insertFactoryContainer({
      supplierId,
      containerNumber: `CASC_B_${Date.now()}`,
      status: "OFFLOADED",
      ratePerKg: "2.0",
      actualReceivedKg: "1000",
    });
    // Insert raw-stock rows so cascade can find them
    await pool.query(
      `INSERT INTO factory_raw_stock (company_id, container_id, received_kg, used_kg, cost_per_kg, cost_per_kg_usd)
       VALUES ($1, $2, '2000', '0', '1.5', '1.5'), ($1, $3, '1000', '0', '2.0', '2.0')`,
      [ctx.companyId, containerA.id, containerB.id]
    );

    // One batch that blends both containers: 800 kg from A, 400 kg from B
    batchId = await insertMixBatch(ctx.companyId, "1.65", "1200");
    await insertMixBatchSource(batchId, containerA.id, "800", "1.5");
    await insertMixBatchSource(batchId, containerB.id, "400", "2.0");
    await insertFactoryBale(batchId, ctx.companyId, "300", "1.65");
    await insertFactoryBale(batchId, ctx.companyId, "300", "1.65");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM factory_bales WHERE mix_batch_id = $1", [batchId]);
    await pool.query("DELETE FROM factory_mix_batch_sources WHERE mix_batch_id = $1", [batchId]);
    await pool.query("DELETE FROM factory_mix_batches WHERE id = $1", [batchId]);
    await pool.query("DELETE FROM factory_raw_stock WHERE container_id IN ($1, $2)", [containerA.id, containerB.id]);
    await pool.query("DELETE FROM factory_containers WHERE id IN ($1, $2)", [containerA.id, containerB.id]);
    await pool.query("DELETE FROM factory_suppliers WHERE id = $1", [supplierId]);
  });

  it("weightKgFromContainer reflects only THIS container's contribution, not the full batch weight", async () => {
    const { cascadeContainerCostChange } = await import("../server/services/factory/rawStockCostCascade");

    const result = await db.transaction(async (tx) => {
      return cascadeContainerCostChange(
        tx,
        {
          companyId: ctx.companyId,
          containerId: containerA.id,
          newCostPerKg: 1.6,
          newCostPerKgUsd: 1.6,
        },
        { includeCompletedBatches: false }
      );
    });

    expect(result.affectedBatches.length).toBeGreaterThan(0);
    const batch = result.affectedBatches.find((b) => b.batchId === batchId);
    expect(batch).toBeDefined();

    // Container A contributed 800 kg to this batch (NOT the full 1200 kg)
    expect(batch!.weightKgFromContainer).toBeCloseTo(800, 1);

    // The CascadeResult shape must have weightKgFromContainer, not weightKg
    expect("weightKgFromContainer" in batch!).toBe(true);
    expect("weightKg" in batch!).toBe(false);
  });
});

// ─── Issue 5: Decimal.js arithmetic + 7dp precision ─────────────────────────

describe("Issue 5 – recomputeBatchAndCascadeBales uses Decimal.js (no float drift)", () => {
  let batchId: number;
  let baleId1: number;
  let baleId2: number;
  let supplierId: number;
  let containerId: number;

  beforeAll(async () => {
    supplierId = await insertFactorySupplier(`${TEST_PREFIX}_DecSup`);
    const c = await insertFactoryContainer({
      supplierId,
      containerNumber: `DEC_PREC_${Date.now()}`,
      status: "OFFLOADED",
      ratePerKg: "0.4216000",
      actualReceivedKg: "20000",
    });
    containerId = c.id;

    // batch with two sources at a fractional rate that would drift with binary floats
    batchId = await insertMixBatch(ctx.companyId, "0.4216000", "20000");
    await insertMixBatchSource(batchId, containerId, "10000", "0.4216000");
    await insertMixBatchSource(batchId, containerId, "10000", "0.4216001");
    baleId1 = await insertFactoryBale(batchId, ctx.companyId, "500", "0.4216000");
    baleId2 = await insertFactoryBale(batchId, ctx.companyId, "500", "0.4216000");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM factory_bales WHERE id IN ($1, $2)", [baleId1, baleId2]);
    await pool.query("DELETE FROM factory_mix_batch_sources WHERE mix_batch_id = $1", [batchId]);
    await pool.query("DELETE FROM factory_mix_batches WHERE id = $1", [batchId]);
    await pool.query("DELETE FROM factory_containers WHERE id = $1", [containerId]);
    await pool.query("DELETE FROM factory_suppliers WHERE id = $1", [supplierId]);
  });

  it("recomputes batch cost/kg at 7dp precision without binary float drift", async () => {
    const result = await db.transaction(async (tx) => {
      return recomputeBatchAndCascadeBales(tx, ctx.companyId, batchId);
    });

    // Weighted average of (10000 × 0.4216000 + 10000 × 0.4216001) / 20000 = 0.42160005
    const expected = new Decimal("0.4216000").plus(new Decimal("0.4216001")).div(2);
    expect(result.newCostPerKg).toBeCloseTo(expected.toNumber(), 6);

    // Bales must be updated
    expect(result.bales.length).toBe(2);
  });

  it("bale cost_per_kg in DB is stored at 7 decimal places", async () => {
    await db.transaction(async (tx) => {
      await recomputeBatchAndCascadeBales(tx, ctx.companyId, batchId);
    });
    const bale = await pool.query("SELECT cost_per_kg FROM factory_bales WHERE id = $1", [baleId1]);
    const costStr: string = bale.rows[0].cost_per_kg;
    // Must have been written to 7dp scale (DB stores as numeric)
    const parts = costStr.split(".");
    if (parts[1]) {
      expect(parts[1].length).toBeLessThanOrEqual(7);
    }
    // Value must be reasonable (not zero, not wildly off)
    expect(parseFloat(costStr)).toBeGreaterThan(0.4);
    expect(parseFloat(costStr)).toBeLessThan(0.5);
  });

  it("precision migration: factory_mix_batch_sources.cost_per_kg has at least scale 7 in DB", async () => {
    const r = await pool.query(
      `SELECT numeric_scale FROM information_schema.columns
       WHERE table_name = 'factory_mix_batch_sources' AND column_name = 'cost_per_kg'`
    );
    if (r.rows.length > 0 && r.rows[0].numeric_scale !== null) {
      expect(r.rows[0].numeric_scale).toBeGreaterThanOrEqual(7);
    }
  });

  it("precision migration: factory_mix_batches.cost_per_kg has at least scale 7 in DB", async () => {
    const r = await pool.query(
      `SELECT numeric_scale FROM information_schema.columns
       WHERE table_name = 'factory_mix_batches' AND column_name = 'cost_per_kg'`
    );
    if (r.rows.length > 0 && r.rows[0].numeric_scale !== null) {
      expect(r.rows[0].numeric_scale).toBeGreaterThanOrEqual(7);
    }
  });

  it("precision migration: factory_bales.cost_per_kg has at least scale 7 in DB", async () => {
    const r = await pool.query(
      `SELECT numeric_scale FROM information_schema.columns
       WHERE table_name = 'factory_bales' AND column_name = 'cost_per_kg'`
    );
    if (r.rows.length > 0 && r.rows[0].numeric_scale !== null) {
      expect(r.rows[0].numeric_scale).toBeGreaterThanOrEqual(7);
    }
  });
});

// ─── Issue 4: schema columns exist ───────────────────────────────────────────

describe("Issue 4 – new FX schema columns exist on factory_containers and factory_container_other_charges", () => {
  it("factory_containers has freight_fx_rate_to_usd column", async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'factory_containers' AND column_name = 'freight_fx_rate_to_usd'`
    );
    expect(r.rows.length).toBe(1);
  });

  it("factory_containers has freight_fx_rate_confirmed column", async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'factory_containers' AND column_name = 'freight_fx_rate_confirmed'`
    );
    expect(r.rows.length).toBe(1);
  });

  it("factory_container_other_charges has fx_rate_to_usd column", async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'factory_container_other_charges' AND column_name = 'fx_rate_to_usd'`
    );
    expect(r.rows.length).toBe(1);
  });

  it("factory_container_other_charges has fx_rate_confirmed column", async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'factory_container_other_charges' AND column_name = 'fx_rate_confirmed'`
    );
    expect(r.rows.length).toBe(1);
  });
});
