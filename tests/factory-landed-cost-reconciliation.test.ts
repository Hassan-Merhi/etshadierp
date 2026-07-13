/**
 * Regression tests for the factory raw-material landed-cost reconciliation bug:
 *
 *   1. cascadeContainerCostChange must correctly propagate a corrected
 *      container cost/kg down to mix batch sources, recompute each affected
 *      batch's weighted-average cost across ALL its sources (not just the one
 *      container being corrected), and cascade the new blended cost to bales.
 *   2. GET /api/factory/raw-stock/history/:supplierId must report each
 *      supplier's OWN weighted cost/kg (from factory_mix_batch_sources), not
 *      the batch's blended cost/kg — which silently misattributes cost when a
 *      batch draws from more than one supplier/source.
 *   3. POST /api/factory/raw-stock/offload must refuse to silently default a
 *      non-USD container's FX rate to 1 when the live FX lookup fails and the
 *      container has no explicitly-set fxRateToUsd to fall back on.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";
import { cascadeContainerCostChange } from "../server/services/factory/rawStockCostCascade";

const TEST_PREFIX = "lcrtest";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let supplierAId: number;
let supplierBId: number;

async function loginAsTestUser() {
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  const switchRes = await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
  if (switchRes.status !== 200) {
    console.warn("Switch company response:", switchRes.status, switchRes.body);
  }
}

async function cleanupFactoryTables(companyId: number) {
  await pool.query(`DELETE FROM factory_daybook_entries WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_fx_rates WHERE company_id = $1`, [companyId]);
  await pool.query(
    `DELETE FROM factory_bales WHERE mix_batch_id IN (SELECT id FROM factory_mix_batches WHERE company_id = $1)`,
    [companyId]
  );
  await pool.query(
    `DELETE FROM factory_mix_batch_sources WHERE mix_batch_id IN (SELECT id FROM factory_mix_batches WHERE company_id = $1)`,
    [companyId]
  );
  await pool.query(`DELETE FROM factory_mix_batches WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_raw_stock WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_containers WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_suppliers WHERE company_id = $1`, [companyId]);
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  // The /api/factory/* company-resolution middleware only recognizes companies
  // with companyType "factory"/"factory_v2" (falling back to an unrelated
  // factory company otherwise), so the seeded test company must be marked as
  // a factory company before any /api/factory request is made.
  await db.update(schema.companies).set({ companyType: "factory" }).where(eq(schema.companies.id, ctx.companyId));
  agent = request.agent(ctx.app);
  await loginAsTestUser();

  const [supplierA] = await db
    .insert(schema.factorySuppliers)
    .values({ companyId: ctx.companyId, name: `${TEST_PREFIX}_SupplierA` })
    .returning();
  const [supplierB] = await db
    .insert(schema.factorySuppliers)
    .values({ companyId: ctx.companyId, name: `${TEST_PREFIX}_SupplierB` })
    .returning();
  supplierAId = supplierA.id;
  supplierBId = supplierB.id;
}, 60000);

afterAll(async () => {
  await cleanupFactoryTables(ctx.companyId);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("cascadeContainerCostChange", () => {
  it("propagates a corrected container cost through sources, batch weighted-average, and bales", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C1`,
        supplierId: supplierAId,
        actualReceivedKg: "1000",
        currencyCode: "USD",
        fxRateToUsd: "1",
        status: "OFFLOADED",
      })
      .returning();

    const [otherContainer] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C2`,
        supplierId: supplierBId,
        actualReceivedKg: "500",
        currencyCode: "USD",
        fxRateToUsd: "1",
        status: "OFFLOADED",
      })
      .returning();

    await db.insert(schema.factoryRawStock).values({
      companyId: ctx.companyId,
      containerId: container.id,
      receivedKg: "1000",
      costPerKg: "0.50",
      costPerKgUsd: "0.50",
    });
    await db.insert(schema.factoryRawStock).values({
      companyId: ctx.companyId,
      containerId: otherContainer.id,
      receivedKg: "500",
      costPerKg: "0.80",
      costPerKgUsd: "0.80",
    });

    // One mix batch blended from BOTH containers: 600kg @ 0.50 + 200kg @ 0.80 = 460 total / 800kg = 0.575/kg
    const [batch] = await db
      .insert(schema.factoryMixBatches)
      .values({
        companyId: ctx.companyId,
        batchCode: `${TEST_PREFIX}-B1`,
        totalWeightKg: "800",
        costPerKg: "0.575",
        totalCost: "460.00",
        status: "ACTIVE",
      })
      .returning();

    await db.insert(schema.factoryMixBatchSources).values({
      mixBatchId: batch.id,
      containerId: container.id,
      supplierId: supplierAId,
      weightKg: "600",
      costPerKg: "0.50",
      totalCost: "300.00",
    });
    await db.insert(schema.factoryMixBatchSources).values({
      mixBatchId: batch.id,
      containerId: otherContainer.id,
      supplierId: supplierBId,
      weightKg: "200",
      costPerKg: "0.80",
      totalCost: "160.00",
    });

    const [bale] = await db
      .insert(schema.factoryBales)
      .values({
        companyId: ctx.companyId,
        mixBatchId: batch.id,
        baleCode: `${TEST_PREFIX}-BALE1`,
        referenceNumber: `${TEST_PREFIX}-REF1`,
        weightKg: "100",
        costPerKg: "0.575",
        totalCost: "57.50",
        status: "PRESSED",
      })
      .returning();

    // Correct container 1's cost from 0.50 -> 0.60 per kg (e.g. a landed-cost repair).
    const result = await db.transaction(async (tx) => {
      return cascadeContainerCostChange(tx, {
        companyId: ctx.companyId,
        containerId: container.id,
        newCostPerKg: 0.6,
        newCostPerKgUsd: 0.6,
      });
    });

    // Raw stock updated
    const [updatedRawStock] = await db
      .select()
      .from(schema.factoryRawStock)
      .where(eq(schema.factoryRawStock.containerId, container.id));
    expect(parseFloat(updatedRawStock.costPerKg)).toBeCloseTo(0.6, 4);
    expect(parseFloat(updatedRawStock.costPerKgUsd!)).toBeCloseTo(0.6, 4);

    // Container 1's mix batch source updated to the new rate
    const [srcA] = await db
      .select()
      .from(schema.factoryMixBatchSources)
      .where(eq(schema.factoryMixBatchSources.containerId, container.id));
    expect(parseFloat(srcA.costPerKg)).toBeCloseTo(0.6, 4);
    expect(parseFloat(srcA.totalCost)).toBeCloseTo(360, 2); // 600kg * 0.60

    // Container 2's mix batch source (untouched container) is unchanged
    const [srcB] = await db
      .select()
      .from(schema.factoryMixBatchSources)
      .where(eq(schema.factoryMixBatchSources.containerId, otherContainer.id));
    expect(parseFloat(srcB.costPerKg)).toBeCloseTo(0.8, 4);

    // Batch weighted average recomputed from BOTH sources: (360 + 160) / 800 = 0.65
    const [updatedBatch] = await db.select().from(schema.factoryMixBatches).where(eq(schema.factoryMixBatches.id, batch.id));
    expect(parseFloat(updatedBatch.costPerKg)).toBeCloseTo(0.65, 4);
    expect(parseFloat(updatedBatch.totalCost)).toBeCloseTo(520, 2);

    // Bale cascaded to the new blended batch cost
    const [updatedBale] = await db.select().from(schema.factoryBales).where(eq(schema.factoryBales.id, bale.id));
    expect(parseFloat(updatedBale.costPerKg)).toBeCloseTo(0.65, 4);
    expect(parseFloat(updatedBale.totalCost)).toBeCloseTo(65, 2); // 100kg * 0.65

    expect(result.affectedBatches.length).toBe(1);
    expect(result.affectedBales.length).toBe(1);
  });
});

describe("GET /api/factory/raw-stock/history/:supplierId", () => {
  it("reports the supplier's own weighted cost/kg, not the batch's blended cost/kg", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C3`,
        supplierId: supplierAId,
        actualReceivedKg: "300",
        currencyCode: "USD",
        fxRateToUsd: "1",
        status: "OFFLOADED",
      })
      .returning();

    const [batch] = await db
      .insert(schema.factoryMixBatches)
      .values({
        companyId: ctx.companyId,
        batchCode: `${TEST_PREFIX}-B2`,
        totalWeightKg: "500",
        // Blended batch cost is deliberately far from supplier A's own rate,
        // to prove the endpoint isn't just echoing this field.
        costPerKg: "1.20",
        totalCost: "600.00",
        status: "ACTIVE",
      })
      .returning();

    // Supplier A contributed 300kg @ 0.40/kg = 120; Supplier B contributed 200kg @ 2.40/kg = 480.
    // Blended batch cost = 600/500 = 1.20 (matches above) but supplier A's own rate is 0.40, not 1.20.
    await db.insert(schema.factoryMixBatchSources).values({
      mixBatchId: batch.id,
      containerId: container.id,
      supplierId: supplierAId,
      weightKg: "300",
      costPerKg: "0.40",
      totalCost: "120.00",
    });
    await db.insert(schema.factoryMixBatchSources).values({
      mixBatchId: batch.id,
      supplierId: supplierBId,
      weightKg: "200",
      costPerKg: "2.40",
      totalCost: "480.00",
    });

    const res = await agent.get(`/api/factory/raw-stock/history/${supplierAId}`);
    expect(res.status).toBe(200);
    const batchEntry = (res.body.entries || res.body.timeline || res.body).find?.((e: any) => e.batchId === batch.id) ??
      (Array.isArray(res.body) ? res.body.find((e: any) => e.batchId === batch.id) : undefined);
    expect(batchEntry).toBeTruthy();
    // Must reflect supplier A's own 0.40/kg rate, NOT the batch's blended 1.20/kg.
    expect(batchEntry.costPerKg).toBeCloseTo(0.4, 4);
  });
});

describe("POST /api/factory/raw-stock/offload — FX safeguard", () => {
  it("rejects a non-USD offload instead of silently defaulting FX to 1 when no rate is available", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C4`,
        supplierId: supplierAId,
        actualReceivedKg: "1000",
        // Not a real ISO currency code, so the live FX lookup is guaranteed to fail —
        // exercising the failure path deterministically instead of depending on
        // network availability in the test environment.
        currencyCode: "ZZZ",
        // fxRateToUsd left at the schema default of "1" — i.e. never explicitly set.
        status: "PENDING",
      })
      .returning();

    const res = await agent.post("/api/factory/raw-stock/offload").send({
      containerId: container.id,
      // No fxRateToUsd supplied and no valid FX rate can be resolved for "ZZZ",
      // so this must fail closed rather than silently costing the container at
      // a 1:1 rate.
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body).toLowerCase()).toContain("fx");
  });
});
