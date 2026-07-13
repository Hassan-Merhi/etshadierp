/**
 * Regression tests for the factory raw-material stable-cost-rate bug.
 *
 * Business rule: a supplier's mix-batch source cost/kg is a stable
 * receipt-weighted rate (SUM(receivedKg * costPerKgUsd) / SUM(receivedKg)).
 * It must change ONLY when a container is offloaded/received or an existing
 * container's landed cost is corrected — never when stock is consumed,
 * mix batches are created/edited/topped-up/deleted, or bales are produced.
 *
 * Previously, factoryMixBatchRoutes.ts computed the supplier rate by weighting
 * each row by its REMAINING kg (receivedKg - usedKg) instead of receivedKg,
 * so — because consumption is FIFO — the rate drifted after every deduction.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";

const TEST_PREFIX = "mbstable";

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

async function offloadedContainer(containerNumber: string, supplierId: number, receivedKg: string, costPerKgUsd: string) {
  const [container] = await db
    .insert(schema.factoryContainers)
    .values({
      companyId: ctx.companyId,
      containerNumber,
      supplierId,
      actualReceivedKg: receivedKg,
      currencyCode: "USD",
      fxRateToUsd: "1",
      status: "OFFLOADED",
    })
    .returning();

  await db.insert(schema.factoryRawStock).values({
    companyId: ctx.companyId,
    containerId: container.id,
    receivedKg,
    costPerKg: costPerKgUsd,
    costPerKgUsd,
  });

  return container;
}

async function getSupplierRow(supplierName: string) {
  const res = await agent.get("/api/factory/raw-stock");
  expect(res.status).toBe(200);
  const row = (res.body as any[]).find((r) => r.supplierName === supplierName);
  expect(row).toBeTruthy();
  return row;
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
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

describe("Stable receipt-weighted supplier cost rate", () => {
  it("stays fixed at $0.28/kg through mix-batch create/edit/top-up/delete/consume, and only moves on a new offload", async () => {
    // Offload 10,000 kg @ $0.20/kg and 10,000 kg @ $0.36/kg → stable rate = $0.28/kg
    const c1 = await offloadedContainer(`${TEST_PREFIX}-C1`, supplierAId, "10000", "0.20");
    const c2 = await offloadedContainer(`${TEST_PREFIX}-C2`, supplierAId, "10000", "0.36");

    let row = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.28, 4);

    // Create a 1,000 kg mix batch — FIFO draws from c1 first (0.20/kg alone), but the
    // recorded/blended rate must be the stable 0.28/kg, not c1's own rate.
    const createRes = await agent.post("/api/factory/mix-batches").send({
      supplierSources: [{ supplierId: supplierAId, weightKg: "1000" }],
      name: "Batch 1",
    });
    expect(createRes.status).toBe(200);
    const batch1Id = createRes.body.id;
    expect(parseFloat(createRes.body.costPerKg)).toBeCloseTo(0.28, 4);

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.28, 4);
    expect(parseFloat(row.freeKg || row.remainingKg)).toBeCloseTo(19000, 1);

    // A second mix batch also uses the stable $0.28/kg rate.
    const createRes2 = await agent.post("/api/factory/mix-batches").send({
      supplierSources: [{ supplierId: supplierAId, weightKg: "2000" }],
      name: "Batch 2",
    });
    expect(createRes2.status).toBe(200);
    const batch2Id = createRes2.body.id;
    expect(parseFloat(createRes2.body.costPerKg)).toBeCloseTo(0.28, 4);

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.28, 4);

    // Top-up batch 1 with more supplier A stock — still $0.28/kg.
    const topUpRes = await agent.post(`/api/factory/mix-batches/${batch1Id}/top-up`).send({
      supplierSources: [{ supplierId: supplierAId, weightKg: "500" }],
    });
    expect(topUpRes.status).toBe(200);
    expect(parseFloat(topUpRes.body.costPerKg)).toBeCloseTo(0.28, 4);

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.28, 4);

    // Edit batch 2's sources — still $0.28/kg.
    const editRes = await agent.patch(`/api/factory/mix-batches/${batch2Id}`).send({
      supplierSources: [{ supplierId: supplierAId, weightKg: "1500" }],
    });
    expect(editRes.status).toBe(200);
    expect(parseFloat(editRes.body.costPerKg)).toBeCloseTo(0.28, 4);

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.28, 4);

    // Delete/reverse batch 1 (restores its consumed kg) — rate still $0.28/kg.
    const deleteRes = await agent.delete(`/api/factory/mix-batches/${batch1Id}`);
    expect(deleteRes.status).toBe(200);

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.28, 4);

    // Consume more directly via a third batch — still $0.28/kg.
    const createRes3 = await agent.post("/api/factory/mix-batches").send({
      supplierSources: [{ supplierId: supplierAId, weightKg: "3000" }],
      name: "Batch 3",
    });
    expect(createRes3.status).toBe(200);
    expect(parseFloat(createRes3.body.costPerKg)).toBeCloseTo(0.28, 4);

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.28, 4);

    // Offload another 10,000 kg @ $0.40/kg → NOW the stable rate moves to $0.32/kg:
    // (10000*0.20 + 10000*0.36 + 10000*0.40) / 30000 = 0.32
    await offloadedContainer(`${TEST_PREFIX}-C3`, supplierAId, "10000", "0.40");

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.32, 4);

    // factoryRawStock.costPerKg/costPerKgUsd on the original containers must be untouched
    // by any of the mix-batch operations above.
    const [rs1] = await db.select().from(schema.factoryRawStock).where(eq(schema.factoryRawStock.containerId, c1.id));
    const [rs2] = await db.select().from(schema.factoryRawStock).where(eq(schema.factoryRawStock.containerId, c2.id));
    expect(parseFloat(rs1.costPerKgUsd!)).toBeCloseTo(0.2, 6);
    expect(parseFloat(rs2.costPerKgUsd!)).toBeCloseTo(0.36, 6);
  });

  it("keeps supplier and company isolation — supplier B's rate is unaffected by supplier A's activity", async () => {
    await offloadedContainer(`${TEST_PREFIX}-B1`, supplierBId, "5000", "1.00");

    const rowB = await getSupplierRow(`${TEST_PREFIX}_SupplierB`);
    expect(parseFloat(rowB.costPerKgUsd)).toBeCloseTo(1.0, 4);

    // Consuming supplier B stock must not perturb supplier A's already-established rate.
    await agent.post("/api/factory/mix-batches").send({
      supplierSources: [{ supplierId: supplierBId, weightKg: "1000" }],
      name: "Batch B1",
    });

    const rowA = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(rowA.costPerKgUsd)).toBeCloseTo(0.32, 4);

    const rowB2 = await getSupplierRow(`${TEST_PREFIX}_SupplierB`);
    expect(parseFloat(rowB2.costPerKgUsd)).toBeCloseTo(1.0, 4);
  });
});
