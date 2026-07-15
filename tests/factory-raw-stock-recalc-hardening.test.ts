/**
 * Integration tests for the raw-stock recalculation admin repair tool's
 * hardening: admin-only access, CLOSED/COMPLETED container guard, dry-run +
 * signed confirmation-token flow, idempotency, and stale-token rejection.
 *   GET  /api/factory/raw-stock/recalc/preview
 *   POST /api/factory/raw-stock/recalc/apply
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";

const TEST_PREFIX = "recalchard";

let ctx: TestContext;
let agent: request.SuperAgentTest; // Admin role
let nonAdminAgent: request.SuperAgentTest;
let supplierId: number;

async function createAndLoginAs(username: string, role: string): Promise<request.SuperAgentTest> {
  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.hash("testpassword123", 10);
  const [user] = await db.insert(schema.users).values({ username, password: hashedPassword }).returning();
  await db.insert(schema.userCompanyRoles).values({ userId: user.id, companyId: ctx.companyId, role });

  const roleAgent = request.agent(ctx.app);
  const loginRes = await roleAgent.post("/api/auth/login").send({ username, password: "testpassword123" });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed for ${username}: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  const switchRes = await roleAgent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
  if (switchRes.status !== 200) {
    throw new Error(`Set-company failed for ${username}: ${switchRes.status} ${JSON.stringify(switchRes.body)}`);
  }
  return roleAgent;
}

async function makeContainerWithRawStock(opts: {
  containerNumber: string;
  status?: string;
  ratePerKg?: string;
  rawStockCostPerKg?: string;
  rawStockCostPerKgUsd?: string;
  receivedKg?: string;
}) {
  const [container] = await db
    .insert(schema.factoryContainers)
    .values({
      companyId: ctx.companyId,
      containerNumber: opts.containerNumber,
      supplierId,
      currencyCode: "USD",
      fxRateToUsd: "1",
      fxRateConfirmed: true,
      status: opts.status || "OFFLOADED",
      actualReceivedKg: opts.receivedKg || "1000",
      ratePerKg: opts.ratePerKg || "2.5", // stale/wrong rate to force a diff
      freight: "0",
      otherCharges: "0",
      commissionAmount: "0",
      dutyStatus: "NONE",
      dutyAmount: "0",
    })
    .returning();

  const [rawStock] = await db
    .insert(schema.factoryRawStock)
    .values({
      companyId: ctx.companyId,
      containerId: container.id,
      receivedKg: opts.receivedKg || "1000",
      usedKg: "0",
      costPerKg: opts.rawStockCostPerKg || "2.0", // deliberately stale vs container.ratePerKg
      costPerKgUsd: opts.rawStockCostPerKgUsd || "2.0",
    })
    .returning();

  return { container, rawStock };
}

async function cleanupFactoryTables(companyId: number) {
  await pool.query(`DELETE FROM factory_raw_stock WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_containers WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_suppliers WHERE company_id = $1`, [companyId]);
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  await db.update(schema.companies).set({ companyType: "factory" }).where(eq(schema.companies.id, ctx.companyId));
  agent = request.agent(ctx.app);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });

  nonAdminAgent = await createAndLoginAs(`${TEST_PREFIX}_viewer`, "Viewer");

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

describe("Raw-stock recalc admin repair hardening", () => {
  it("rejects preview and apply for non-admin roles", async () => {
    const previewRes = await nonAdminAgent.get("/api/factory/raw-stock/recalc/preview");
    expect(previewRes.status).toBe(403);

    const applyRes = await nonAdminAgent.post("/api/factory/raw-stock/recalc/apply").send({ containerIds: [1] });
    expect(applyRes.status).toBe(403);
  });

  it("dry-run apply returns a confirmationToken and writes nothing", async () => {
    const { container, rawStock } = await makeContainerWithRawStock({ containerNumber: `${TEST_PREFIX}-R1` });

    const res = await agent.post("/api/factory/raw-stock/recalc/apply").send({ containerIds: [container.id] });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.confirmationToken).toBeTruthy();

    const [reloadedRs] = await db.select().from(schema.factoryRawStock).where(eq(schema.factoryRawStock.id, rawStock.id));
    expect(parseFloat((reloadedRs as any).costPerKg)).toBeCloseTo(2.0, 6); // unchanged — dry run only
  });

  it("applies with a matching token, cascades the corrected cost, and is idempotent on replay", async () => {
    const { container, rawStock } = await makeContainerWithRawStock({ containerNumber: `${TEST_PREFIX}-R2` });

    const preview = await agent.post("/api/factory/raw-stock/recalc/apply").send({ containerIds: [container.id] });
    expect(preview.status).toBe(200);
    const token = preview.body.confirmationToken;

    const apply = await agent
      .post("/api/factory/raw-stock/recalc/apply")
      .send({ containerIds: [container.id], confirm: true, confirmationToken: token });
    expect(apply.status).toBe(200);
    expect(apply.body.dryRun).toBe(false);
    expect(apply.body.results[0].applied).toBe(true);

    const [reloadedRs] = await db.select().from(schema.factoryRawStock).where(eq(schema.factoryRawStock.id, rawStock.id));
    // 1000kg * 2.5 USD/kg = 2500 total / 1000kg = 2.5/kg corrected
    expect(parseFloat((reloadedRs as any).costPerKg)).toBeCloseTo(2.5, 4);

    // Replaying the exact same token/apply is a safe no-op — the stored cost already
    // matches the corrected value.
    const replay = await agent
      .post("/api/factory/raw-stock/recalc/apply")
      .send({ containerIds: [container.id], confirm: true, confirmationToken: token });
    expect(replay.status).toBe(200);
    expect(replay.body.results[0].applied).toBe(false);
  });

  it("refuses a CLOSED container with a reported reason instead of silently skipping", async () => {
    const { container, rawStock } = await makeContainerWithRawStock({
      containerNumber: `${TEST_PREFIX}-R3`,
      status: "CLOSED",
    });

    const preview = await agent.post("/api/factory/raw-stock/recalc/apply").send({ containerIds: [container.id] });
    expect(preview.status).toBe(200);
    const token = preview.body.confirmationToken;

    const apply = await agent
      .post("/api/factory/raw-stock/recalc/apply")
      .send({ containerIds: [container.id], confirm: true, confirmationToken: token });
    expect(apply.status).toBe(200);
    expect(apply.body.results[0].applied).toBe(false);
    expect(apply.body.results[0].skippedReason).toMatch(/CLOSED/);

    const [reloadedRs] = await db.select().from(schema.factoryRawStock).where(eq(schema.factoryRawStock.id, rawStock.id));
    expect(parseFloat((reloadedRs as any).costPerKg)).toBeCloseTo(2.0, 6); // untouched
  });

  it("rejects a stale token when the container changed since the dry-run preview", async () => {
    const { container } = await makeContainerWithRawStock({ containerNumber: `${TEST_PREFIX}-R4` });

    const preview = await agent.post("/api/factory/raw-stock/recalc/apply").send({ containerIds: [container.id] });
    expect(preview.status).toBe(200);
    const token = preview.body.confirmationToken;

    // Simulate a concurrent change to this container's landed cost since the preview.
    await db
      .update(schema.factoryContainers)
      .set({ ratePerKgUsd: "9.9999" })
      .where(eq(schema.factoryContainers.id, container.id));
    // The staleness check compares against factory_raw_stock.costPerKgUsd (what the
    // preview snapshot captured); simulate that changing too, as a real conflicting
    // recalc/edit would.
    await db
      .update(schema.factoryRawStock)
      .set({ costPerKgUsd: "9.9999" })
      .where(eq(schema.factoryRawStock.containerId, container.id));

    const apply = await agent
      .post("/api/factory/raw-stock/recalc/apply")
      .send({ containerIds: [container.id], confirm: true, confirmationToken: token });
    expect(apply.status).toBe(400);
    expect(apply.body.code).toBe("STALE_TOKEN");
  });
});
