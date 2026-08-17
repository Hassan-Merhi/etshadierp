/**
 * Regression tests for partial-container offload costing.
 *
 * Business rule: the container's full material value and landed charges form a
 * fixed numerator. The effective landed rate is that fixed total divided by the
 * actual received weight. A shortage raises cost/kg; an overage lowers it.
 *
 * Subsequent receipts update cumulative receivedKg and skip duplicate financial
 * posting.
 *
 * Coverage:
 *   1. computeCorrectContainerCost — fixed total divided by actual received kg
 *   2. computeCorrectContainerCost — unchanged when actualKg equals declaredKg
 *   3. First partial receipt: correct effective rate, status PARTIALLY_RECEIVED
 *   4. Second receipt: accepted (not 400), receivedKg updated, no duplicate daybook
 *   5. Final receipt: status transitions to OFFLOADED
 *   6. OFFLOADED container: second receipt returns 400
 *   7. Remaining-kg guard: excess subsequent kg rejected
 *   8. available-containers endpoint: includes PARTIALLY_RECEIVED, excludes OFFLOADED
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { eq, and } from "drizzle-orm";
import * as schema from "../shared/schema";
import { computeCorrectContainerCost } from "../server/services/factory/raw-stock-recalc";

const TEST_PREFIX = "partialoffload";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let supplierId: number;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeContainer(opts: {
  containerNumber: string;
  totalKg?: string;
  declaredKg?: string;
  actualReceivedKg?: string;
  ratePerKg?: string;
  freight?: string;
  otherCharges?: string;
  commissionAmount?: string;
  status?: string;
  currencyCode?: string;
  fxRateToUsd?: string;
}) {
  const totalKg = opts.totalKg ?? opts.declaredKg ?? "20000";
  const [c] = await db
    .insert(schema.factoryContainers)
    .values({
      companyId: ctx.companyId,
      containerNumber: opts.containerNumber,
      supplierId,
      totalKg,
      declaredKg: opts.declaredKg ?? totalKg,
      actualReceivedKg: opts.actualReceivedKg ?? null,
      ratePerKg: opts.ratePerKg ?? "0.460000",
      freight: opts.freight ?? "900",
      otherCharges: opts.otherCharges ?? "0",
      commissionAmount: opts.commissionAmount ?? "0",
      status: opts.status ?? "RECEIVED",
      currencyCode: opts.currencyCode ?? "USD",
      fxRateToUsd: opts.fxRateToUsd ?? "1",
      fxRateToUsdOffload: opts.fxRateToUsd ?? "1",
      fxRateConfirmed: true,
      finalPayableAmount: "0",
      finalPayableAmountUsd: "0",
      dutyStatus: "NONE",
      dutyAmount: "0",
    })
    .returning();
  return c;
}

async function cleanupFactoryTables(companyId: number) {
  await pool.query(`DELETE FROM factory_container_receipts WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_daybook_entries WHERE company_id = $1`, [companyId]);
  await pool.query(
    `DELETE FROM factory_mix_batch_sources WHERE mix_batch_id IN (SELECT id FROM factory_mix_batches WHERE company_id = $1)`,
    [companyId]
  );
  await pool.query(`DELETE FROM factory_mix_batches WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_raw_stock WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_offload_additional_charges WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_container_commissions WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_containers WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_suppliers WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = $1)`, [
    companyId,
  ]);
  await pool.query(`DELETE FROM vouchers WHERE company_id = $1`, [companyId]);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  await db.update(schema.companies).set({ companyType: "factory" }).where(eq(schema.companies.id, ctx.companyId));

  agent = request.agent(ctx.app);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (loginRes.status !== 200) throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });

  const [supplier] = await db
    .insert(schema.factorySuppliers)
    .values({ companyId: ctx.companyId, name: `${TEST_PREFIX}_Supplier` })
    .returning();
  supplierId = supplier.id;
}, 30000);

afterAll(async () => {
  await cleanupFactoryTables(ctx.companyId);
  await cleanupTestData(ctx);
  await closeTestServer(ctx);
}, 30000);

beforeEach(async () => {
  // Clean between tests
  await pool.query(`DELETE FROM factory_container_receipts WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_daybook_entries WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(
    `DELETE FROM factory_mix_batch_sources WHERE mix_batch_id IN (SELECT id FROM factory_mix_batches WHERE company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM factory_mix_batches WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_raw_stock WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_offload_additional_charges WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_container_commissions WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_containers WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = $1)`, [
    ctx.companyId,
  ]);
  await pool.query(`DELETE FROM vouchers WHERE company_id = $1`, [ctx.companyId]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. computeCorrectContainerCost — fixed total / actual received kg
// ─────────────────────────────────────────────────────────────────────────────
describe("computeCorrectContainerCost — fixed total value rule", () => {
  it("uses actual received kg as the divisor while keeping the full container value fixed", async () => {
    // 20,000 kg agreed, 10,000 kg received, rate $0.46, freight $900.
    // Fixed total value = (20,000 × 0.46) + 900 = $10,100.
    // Effective rate = $10,100 / 10,000 actual kg = $1.01/kg.
    const container = await makeContainer({
      containerNumber: `${TEST_PREFIX}-COMP1`,
      totalKg: "20000",
      actualReceivedKg: "10000",
      ratePerKg: "0.460000",
      freight: "900",
      status: "PARTIALLY_RECEIVED",
    });

    const result = computeCorrectContainerCost(container as any, [], null);
    const fixedTotal = 20000 * 0.46 + 900;
    const expectedRate = fixedTotal / 10000;
    expect(result.costPerKg).toBeCloseTo(expectedRate, 5);
    expect(result.costPerKg * 10000).toBeCloseTo(fixedTotal, 2);
    expect(result.fxUnresolved).toBe(false);
  });

  it("is unchanged for OFFLOADED containers (actualKg == declaredKg)", async () => {
    const container = await makeContainer({
      containerNumber: `${TEST_PREFIX}-COMP2`,
      totalKg: "20000",
      actualReceivedKg: "20000",
      ratePerKg: "0.460000",
      freight: "900",
      status: "OFFLOADED",
    });

    const result = computeCorrectContainerCost(container as any, [], null);
    const expectedRate = (20000 * 0.46 + 900) / 20000;
    expect(result.costPerKg).toBeCloseTo(expectedRate, 5);
  });

  it("changes the rate with received weight while preserving the same fixed total value", async () => {
    const base = { totalKg: "20000", ratePerKg: "0.460000", freight: "900" };
    const container5k = await makeContainer({
      containerNumber: `${TEST_PREFIX}-COMP3a`,
      ...base,
      actualReceivedKg: "5000",
      status: "PARTIALLY_RECEIVED",
    });
    const container10k = await makeContainer({
      containerNumber: `${TEST_PREFIX}-COMP3b`,
      ...base,
      actualReceivedKg: "10000",
      status: "PARTIALLY_RECEIVED",
    });
    const container20k = await makeContainer({
      containerNumber: `${TEST_PREFIX}-COMP3c`,
      ...base,
      actualReceivedKg: "20000",
      status: "OFFLOADED",
    });

    const r5k = computeCorrectContainerCost(container5k as any, [], null);
    const r10k = computeCorrectContainerCost(container10k as any, [], null);
    const r20k = computeCorrectContainerCost(container20k as any, [], null);
    const fixedTotal = 20000 * 0.46 + 900;

    expect(r5k.costPerKg).toBeCloseTo(fixedTotal / 5000, 5);
    expect(r10k.costPerKg).toBeCloseTo(fixedTotal / 10000, 5);
    expect(r20k.costPerKg).toBeCloseTo(fixedTotal / 20000, 5);
    expect(r5k.costPerKg * 5000).toBeCloseTo(fixedTotal, 2);
    expect(r10k.costPerKg * 10000).toBeCloseTo(fixedTotal, 2);
    expect(r20k.costPerKg * 20000).toBeCloseTo(fixedTotal, 2);
  });

  it("correctly handles the known production example: PORTUGAL SAAD", async () => {
    // Fixed total = (20,000 × $0.4626) + $545 = $9,797.
    // Actual received = 14,600 kg, so effective cost = $9,797 / 14,600.
    const container = await makeContainer({
      containerNumber: `${TEST_PREFIX}-SAAD`,
      totalKg: "20000",
      actualReceivedKg: "14600",
      ratePerKg: "0.462600",
      freight: "545",
      status: "PARTIALLY_RECEIVED",
    });

    const result = computeCorrectContainerCost(container as any, [], null);
    const fixedTotal = 20000 * 0.4626 + 545;
    const expectedRate = fixedTotal / 14600;
    expect(result.costPerKg).toBeCloseTo(expectedRate, 5);
    expect(result.costPerKg * 14600).toBeCloseTo(fixedTotal, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. available-containers endpoint includes PARTIALLY_RECEIVED
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/factory/raw-stock/available-containers", () => {
  it("includes PARTIALLY_RECEIVED and excludes OFFLOADED", async () => {
    const partial = await makeContainer({ containerNumber: `${TEST_PREFIX}-AVAIL-P`, status: "PARTIALLY_RECEIVED" });
    const offloaded = await makeContainer({ containerNumber: `${TEST_PREFIX}-AVAIL-O`, status: "OFFLOADED" });
    const received = await makeContainer({ containerNumber: `${TEST_PREFIX}-AVAIL-R`, status: "RECEIVED" });

    const res = await agent.get("/api/factory/raw-stock/available-containers");
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((c: any) => c.id);
    expect(ids).toContain(partial.id);
    expect(ids).toContain(received.id);
    expect(ids).not.toContain(offloaded.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3–7. Multi-receipt API flow
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/factory/raw-stock/offload — multi-receipt flow", () => {
  it("first partial receipt: fixed total divided by actual weight, status PARTIALLY_RECEIVED", async () => {
    const container = await makeContainer({ containerNumber: `${TEST_PREFIX}-MR1`, totalKg: "20000" });

    const res = await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "10000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "900",
      offloadDate: "2026-07-17",
    });

    expect(res.status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.factoryContainers)
      .where(eq(schema.factoryContainers.id, container.id));
    expect(updated.status).toBe("PARTIALLY_RECEIVED");
    expect(parseFloat(updated.actualReceivedKg!)).toBeCloseTo(10000, 1);

    const rawStocks = await db
      .select()
      .from(schema.factoryRawStock)
      .where(
        and(eq(schema.factoryRawStock.companyId, ctx.companyId), eq(schema.factoryRawStock.containerId, container.id))
      );
    expect(rawStocks).toHaveLength(1);
    const fixedTotal = 20000 * 0.46 + 900;
    const expectedRate = fixedTotal / 10000;
    expect(parseFloat(rawStocks[0].costPerKg!)).toBeCloseTo(expectedRate, 4);
    expect(parseFloat(rawStocks[0].costPerKg!) * parseFloat(rawStocks[0].receivedKg!)).toBeCloseTo(fixedTotal, 1);
    expect(parseFloat(rawStocks[0].receivedKg!)).toBeCloseTo(10000, 1);
  });

  it("second receipt: accepted, receivedKg updated, daybook NOT doubled", async () => {
    const container = await makeContainer({ containerNumber: `${TEST_PREFIX}-MR2`, totalKg: "20000" });

    const res1 = await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "10000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "900",
      offloadDate: "2026-07-17",
    });
    expect(res1.status).toBe(200);

    const { rows: dbRows1 } = await pool.query(
      `SELECT COUNT(*) AS n FROM factory_daybook_entries WHERE company_id = $1 AND reference_id = $2`,
      [ctx.companyId, container.id]
    );
    const daybookCount1 = parseInt(dbRows1[0].n);

    const res2 = await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "8000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "900",
      offloadDate: "2026-07-18",
    });
    expect(res2.status).toBe(200);

    const { rows: dbRows2 } = await pool.query(
      `SELECT COUNT(*) AS n FROM factory_daybook_entries WHERE company_id = $1 AND reference_id = $2`,
      [ctx.companyId, container.id]
    );
    const daybookCount2 = parseInt(dbRows2[0].n);
    expect(daybookCount2).toBe(daybookCount1);

    const rawStocks = await db
      .select()
      .from(schema.factoryRawStock)
      .where(
        and(eq(schema.factoryRawStock.companyId, ctx.companyId), eq(schema.factoryRawStock.containerId, container.id))
      );
    expect(rawStocks).toHaveLength(1);
    expect(parseFloat(rawStocks[0].receivedKg!)).toBeCloseTo(18000, 1);

    const [updated] = await db
      .select()
      .from(schema.factoryContainers)
      .where(eq(schema.factoryContainers.id, container.id));
    expect(updated.status).toBe("PARTIALLY_RECEIVED");
  });

  it("final receipt: container transitions to OFFLOADED", async () => {
    const container = await makeContainer({ containerNumber: `${TEST_PREFIX}-MR3`, totalKg: "20000" });

    await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "10000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "900",
      offloadDate: "2026-07-17",
    });

    const res = await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "10000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "0",
      offloadDate: "2026-07-18",
    });
    expect(res.status).toBe(200);

    const [updated] = await db
      .select()
      .from(schema.factoryContainers)
      .where(eq(schema.factoryContainers.id, container.id));
    expect(updated.status).toBe("OFFLOADED");
    expect(parseFloat(updated.actualReceivedKg!)).toBeCloseTo(20000, 1);
  });

  it("OFFLOADED container: second receipt returns 400", async () => {
    const container = await makeContainer({ containerNumber: `${TEST_PREFIX}-MR4`, totalKg: "20000" });

    await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "20000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "900",
      offloadDate: "2026-07-17",
    });

    const res = await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "5000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "0",
      offloadDate: "2026-07-18",
    });
    expect(res.status).toBe(400);
  });

  it("excess-kg guard: receipt exceeding remaining is rejected", async () => {
    const container = await makeContainer({ containerNumber: `${TEST_PREFIX}-MR5`, totalKg: "20000" });

    await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "10000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "900",
      offloadDate: "2026-07-17",
    });

    const res = await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "11000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "0",
      offloadDate: "2026-07-18",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/remaining/i);
  });

  it("a partial receipt has a higher rate than a full receipt but the same fixed total value", async () => {
    const declaredKg = "20000";
    const ratePerKg = "0.46";
    const freight = "900";
    const fixedTotal = 20000 * 0.46 + 900;

    const containerFull = await makeContainer({ containerNumber: `${TEST_PREFIX}-RATE-FULL`, totalKg: declaredKg });
    const containerPartial = await makeContainer({ containerNumber: `${TEST_PREFIX}-RATE-PART`, totalKg: declaredKg });

    await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(containerFull.id),
      receivedKg: "20000",
      costPerKg: ratePerKg,
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight,
      offloadDate: "2026-07-17",
    });

    await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(containerPartial.id),
      receivedKg: "10000",
      costPerKg: ratePerKg,
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight,
      offloadDate: "2026-07-17",
    });

    const [fullRawStock] = await db
      .select()
      .from(schema.factoryRawStock)
      .where(
        and(
          eq(schema.factoryRawStock.companyId, ctx.companyId),
          eq(schema.factoryRawStock.containerId, containerFull.id)
        )
      );
    const [partialRawStock] = await db
      .select()
      .from(schema.factoryRawStock)
      .where(
        and(
          eq(schema.factoryRawStock.companyId, ctx.companyId),
          eq(schema.factoryRawStock.containerId, containerPartial.id)
        )
      );

    const fullRate = parseFloat(fullRawStock.costPerKg!);
    const partialRate = parseFloat(partialRawStock.costPerKg!);
    expect(partialRate).toBeGreaterThan(fullRate);
    expect(fullRate).toBeCloseTo(fixedTotal / 20000, 4);
    expect(partialRate).toBeCloseTo(fixedTotal / 10000, 4);
    expect(fullRate * parseFloat(fullRawStock.receivedKg!)).toBeCloseTo(fixedTotal, 1);
    expect(partialRate * parseFloat(partialRawStock.receivedKg!)).toBeCloseTo(fixedTotal, 1);
  });

  it("factory_container_receipts row is inserted on first and subsequent receipts", async () => {
    const container = await makeContainer({ containerNumber: `${TEST_PREFIX}-RECEIPTS`, totalKg: "20000" });

    await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "12000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "900",
      offloadDate: "2026-07-17",
    });

    const { rows: rows1 } = await pool.query(
      `SELECT * FROM factory_container_receipts WHERE company_id = $1 AND container_id = $2 ORDER BY id`,
      [ctx.companyId, container.id]
    );
    expect(rows1).toHaveLength(1);
    expect(parseFloat(rows1[0].received_kg)).toBeCloseTo(12000, 1);
    expect(parseFloat(rows1[0].cumulative_received_kg)).toBeCloseTo(12000, 1);
    expect(parseFloat(rows1[0].fixed_cost_per_kg)).toBeGreaterThan(0);

    await agent.post("/api/factory/raw-stock/offload").send({
      containerId: String(container.id),
      receivedKg: "8000",
      costPerKg: "0.46",
      currencyCode: "USD",
      fxRateToUsd: "1",
      freight: "0",
      offloadDate: "2026-07-18",
    });

    const { rows: rows2 } = await pool.query(
      `SELECT * FROM factory_container_receipts WHERE company_id = $1 AND container_id = $2 ORDER BY id`,
      [ctx.companyId, container.id]
    );
    expect(rows2).toHaveLength(2);
    expect(parseFloat(rows2[1].received_kg)).toBeCloseTo(8000, 1);
    expect(parseFloat(rows2[1].cumulative_received_kg)).toBeCloseTo(20000, 1);
    // Subsequent receipts currently reuse the first receipt's locked rate and do
    // not repeat financial posting.
    expect(parseFloat(rows2[0].fixed_cost_per_kg)).toBeCloseTo(parseFloat(rows2[1].fixed_cost_per_kg), 5);
  });
});
