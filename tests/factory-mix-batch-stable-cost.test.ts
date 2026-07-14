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
let expectedRateA: number;

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
  await pool.query(`DELETE FROM factory_raw_material_adjustments WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_raw_stock WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_containers WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_suppliers WHERE company_id = $1`, [companyId]);
}

async function offloadedContainer(containerNumber: string, supplierId: number, receivedKg: string, costPerKgUsd: string) {
  const { applyOffloadMovingAverage } = await import("../server/services/factory/rawStockLockedRate");

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

  // Mirrors exactly what the real offload endpoint does: apply the moving-average
  // formula to the supplier's locked rate BEFORE inserting the new raw-stock row, so
  // the persisted rate is event-driven (only moves on a real receipt), not recomputed
  // live from receipt history on every read.
  await db.transaction(async (tx) => {
    await applyOffloadMovingAverage(tx, {
      companyId: ctx.companyId,
      supplierId,
      newReceivedKg: parseFloat(receivedKg),
      newContainerLandedCostPerKgUsd: parseFloat(costPerKgUsd),
    });

    await tx.insert(schema.factoryRawStock).values({
      companyId: ctx.companyId,
      containerId: container.id,
      receivedKg,
      costPerKg: costPerKgUsd,
      costPerKgUsd,
    });
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

    // Offload another 10,000 kg @ $0.40/kg → the locked rate moves via the spec's exact
    // moving-average formula, using REMAINING kg (not all-time received kg) immediately
    // before this offload — some of supplier A's 20,000 kg has since been consumed by
    // the mix batches above, so remainingKg < 20,000 going into this offload.
    const beforeThirdOffload = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    const oldRemainingKg = parseFloat(beforeThirdOffload.remainingKg);
    const oldLockedRate = parseFloat(beforeThirdOffload.costPerKgUsd);
    const expectedNewRate = (oldRemainingKg * oldLockedRate + 10000 * 0.4) / (oldRemainingKg + 10000);

    await offloadedContainer(`${TEST_PREFIX}-C3`, supplierAId, "10000", "0.40");

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierA`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(expectedNewRate, 4);
    expectedRateA = parseFloat(row.costPerKgUsd);

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
    expect(parseFloat(rowA.costPerKgUsd)).toBeCloseTo(expectedRateA, 4);

    const rowB2 = await getSupplierRow(`${TEST_PREFIX}_SupplierB`);
    expect(parseFloat(rowB2.costPerKgUsd)).toBeCloseTo(1.0, 4);
  });
});

describe("Locked rate — ADD/REMOVE adjustments, client-cost tampering, and corrections", () => {
  let supplierCId: number;

  beforeAll(async () => {
    const [supplierC] = await db
      .insert(schema.factorySuppliers)
      .values({ companyId: ctx.companyId, name: `${TEST_PREFIX}_SupplierC` })
      .returning();
    supplierCId = supplierC.id;
  });

  it("establishes the locked rate on a real receipt, and ADD/REMOVE adjustments never shift it while still feeding the next offload's remaining-kg base", async () => {
    // Real receipt: 19,000 kg @ $0.50/kg
    await offloadedContainer(`${TEST_PREFIX}-CC1`, supplierCId, "19000", "0.50");
    let row = await getSupplierRow(`${TEST_PREFIX}_SupplierC`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.5, 4);

    // A quantity-only ADD adjustment attempting to tamper with cost (9.99) must be
    // ignored — server always forces the existing locked rate.
    const addRes = await agent.post("/api/factory/raw-stock/adjustment").send({
      type: "ADD",
      kg: "1000",
      costPerKg: "9.99",
      supplierId: supplierCId,
      date: "2026-01-01",
    });
    expect(addRes.status).toBe(200);

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierC`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.5, 4); // unchanged by the ADD
    // The Raw Materials API's own remainingKg must reflect the ADD (19000 + 1000 = 20000) —
    // this is the exact authoritative quantity the next offload's moving average must use.
    expect(parseFloat(row.remainingKg)).toBeCloseTo(20000, 1);

    // Now perform a real second offload: 20,000 kg @ $0.80/kg. The moving average MUST
    // use 20,000 kg (existing 19,000 + the 1,000 ADD) as oldRemainingKg, not 19,000:
    //   (20000*0.50 + 20000*0.80) / 40000 = 0.65
    await offloadedContainer(`${TEST_PREFIX}-CC2`, supplierCId, "20000", "0.80");
    row = await getSupplierRow(`${TEST_PREFIX}_SupplierC`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.65, 4);

    // A REMOVE adjustment is quantity-only too — it must not shift the rate either,
    // and must reduce the authoritative remaining kg the same way ADD increased it.
    const removeRes = await agent.post("/api/factory/raw-stock/adjustment").send({
      type: "REMOVE",
      kg: "500",
      supplierId: supplierCId,
      date: "2026-01-02",
    });
    expect(removeRes.status).toBe(200);
    row = await getSupplierRow(`${TEST_PREFIX}_SupplierC`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.65, 4);
    expect(parseFloat(row.remainingKg)).toBeCloseTo(39500, 1); // 40000 - 500
  });

  it("ignores client-supplied costPerKg tampering when creating a mix batch from a real supplier", async () => {
    const row = await getSupplierRow(`${TEST_PREFIX}_SupplierC`);
    const lockedRate = parseFloat(row.costPerKgUsd);

    const createRes = await agent.post("/api/factory/mix-batches").send({
      supplierSources: [{ supplierId: supplierCId, weightKg: "100", costPerKg: "9.99" }],
      name: "Batch Tamper Test",
    });
    expect(createRes.status).toBe(200);
    expect(parseFloat(createRes.body.costPerKg)).toBeCloseTo(lockedRate, 4);
    expect(parseFloat(createRes.body.costPerKg)).not.toBeCloseTo(9.99, 2);
  });

  it("update-cost sets the locked rate directly to the new uniform cost (an explicit, deliberate correction)", async () => {
    const updateRes = await agent.post("/api/factory/raw-stock/update-cost").send({
      supplierId: supplierCId,
      newCostPerKg: "0.70",
    });
    expect(updateRes.status).toBe(200);

    const row = await getSupplierRow(`${TEST_PREFIX}_SupplierC`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(0.7, 4);
  });
});

describe("Landed-cost correction (cascadeContainerCostChange) — remaining-stock-only impact", () => {
  it("does not reintroduce already-consumed kilograms into the locked rate", async () => {
    const { cascadeContainerCostChange } = await import("../server/services/factory/rawStockCostCascade");

    const [supplierD] = await db
      .insert(schema.factorySuppliers)
      .values({ companyId: ctx.companyId, name: `${TEST_PREFIX}_SupplierD` })
      .returning();

    // One container: 10,000 kg @ $1.00/kg. 6,000 kg already consumed, 4,000 kg remaining.
    const container = await offloadedContainer(`${TEST_PREFIX}-D1`, supplierD.id, "10000", "1.00");
    await db
      .update(schema.factoryRawStock)
      .set({ usedKg: "6000" })
      .where(eq(schema.factoryRawStock.containerId, container.id));

    let row = await getSupplierRow(`${TEST_PREFIX}_SupplierD`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(1.0, 4);

    // Correction: the container's landed cost is actually $1.20/kg (a $0.20/kg increase).
    // A WRONG implementation recomputes from ALL 10,000 kg received (reintroducing the
    // 6,000 kg already consumed at the old rate). The CORRECT result only applies the
    // $0.20/kg delta to the 4,000 kg still remaining:
    //   newLockedRate = 1.00 + (4000 * 0.20) / 4000 = 1.20
    // (with only one container/supplier in play here, remaining kg for the whole
    // supplier equals this container's own remaining kg, so the correction fully lands.)
    await db.transaction(async (tx) => {
      await cascadeContainerCostChange(tx, {
        companyId: ctx.companyId,
        containerId: container.id,
        newCostPerKg: 1.2,
        newCostPerKgUsd: 1.2,
      });
    });

    row = await getSupplierRow(`${TEST_PREFIX}_SupplierD`);
    expect(parseFloat(row.costPerKgUsd)).toBeCloseTo(1.2, 4);
  });
});
