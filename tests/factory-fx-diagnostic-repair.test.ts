/**
 * Integration tests for the raw-material FX diagnostic + safe repair flow:
 *   GET  /api/factory/suppliers/fx-diagnostic
 *   POST /api/factory/suppliers/fx-diagnostic/repair
 *
 * Covers: unresolved rows are surfaced (never silently treated as rate=1),
 * a confirmed rate of exactly 1 is NOT flagged as unresolved, repair is
 * admin-only, dry-run by default with a confirmation token, the token is
 * bound to the exact (source, id, rate) triple, repair is idempotent, and
 * CLOSED/COMPLETED/OFFLOADED containers are refused with MANUAL_REVIEW_REQUIRED
 * rather than silently repaired.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { eq } from "drizzle-orm";
import * as schema from "../shared/schema";

const TEST_PREFIX = "fxdiag";

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

async function cleanupFactoryTables(companyId: number) {
  await pool.query(`DELETE FROM factory_offload_additional_charges WHERE company_id = $1`, [companyId]);
  await pool.query(`DELETE FROM factory_container_commissions WHERE company_id = $1`, [companyId]);
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

describe("Factory FX diagnostic + safe repair", () => {
  it("flags a non-USD container with fxRateConfirmed=false as unresolved, not as rate=1", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C1`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1", // deliberately looks like the old "unset" heuristic value
        fxRateConfirmed: false,
        status: "PENDING",
      })
      .returning();

    const res = await agent.get("/api/factory/suppliers/fx-diagnostic");
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.source === "container" && r.id === container.id);
    expect(row).toBeTruthy();
    expect(row.fxRateConfirmed).toBe(false);
  });

  it("does NOT flag a confirmed rate of exactly 1.0 as unresolved", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C2`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: true, // genuinely confirmed 1:1 peg
        status: "PENDING",
      })
      .returning();

    const res = await agent.get("/api/factory/suppliers/fx-diagnostic");
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.source === "container" && r.id === container.id);
    expect(row).toBeUndefined();
  });

  it("rejects repair for non-admin roles", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C3`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
        status: "PENDING",
      })
      .returning();

    const res = await nonAdminAgent
      .post("/api/factory/suppliers/fx-diagnostic/repair")
      .send({ source: "container", id: container.id, fxRateToUsd: 1.08 });
    expect(res.status).toBe(403);
  });

  it("dry-run returns a plan + confirmationToken and makes no changes", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C4`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
        status: "PENDING",
      })
      .returning();

    const res = await agent
      .post("/api/factory/suppliers/fx-diagnostic/repair")
      .send({ source: "container", id: container.id, fxRateToUsd: 1.08 });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.confirmationToken).toBeTruthy();
    expect(res.body.plan.manualReviewRequired).toBe(false);

    const [reloaded] = await db.select().from(schema.factoryContainers).where(eq(schema.factoryContainers.id, container.id));
    expect((reloaded as any).fxRateConfirmed).toBe(false); // unchanged — dry run only
  });

  it("rejects apply with a mismatched confirmationToken", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C5`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
        status: "PENDING",
      })
      .returning();

    const res = await agent.post("/api/factory/suppliers/fx-diagnostic/repair").send({
      source: "container",
      id: container.id,
      fxRateToUsd: 1.08,
      confirm: true,
      confirmationToken: "not-the-real-token",
    });
    expect(res.status).toBe(400);

    const [reloaded] = await db.select().from(schema.factoryContainers).where(eq(schema.factoryContainers.id, container.id));
    expect((reloaded as any).fxRateConfirmed).toBe(false);
  });

  it("applies the repair end-to-end with the matching token, and is idempotent on replay", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C6`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
        status: "PENDING",
      })
      .returning();

    const preview = await agent
      .post("/api/factory/suppliers/fx-diagnostic/repair")
      .send({ source: "container", id: container.id, fxRateToUsd: 1.08 });
    expect(preview.status).toBe(200);
    const token = preview.body.confirmationToken;

    const apply = await agent.post("/api/factory/suppliers/fx-diagnostic/repair").send({
      source: "container",
      id: container.id,
      fxRateToUsd: 1.08,
      confirm: true,
      confirmationToken: token,
    });
    expect(apply.status).toBe(200);
    expect(apply.body.dryRun).toBe(false);
    expect(apply.body.result.applied).toBe(true);

    const [reloaded] = await db.select().from(schema.factoryContainers).where(eq(schema.factoryContainers.id, container.id));
    expect((reloaded as any).fxRateConfirmed).toBe(true);
    expect(parseFloat((reloaded as any).fxRateToUsd)).toBeCloseTo(1.08, 6);

    // Replaying the exact same apply is a safe no-op, not a duplicate write.
    const replay = await agent.post("/api/factory/suppliers/fx-diagnostic/repair").send({
      source: "container",
      id: container.id,
      fxRateToUsd: 1.08,
      confirm: true,
      confirmationToken: token,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.result.applied).toBe(false);
  });

  it("refuses to repair a CLOSED container and reports MANUAL_REVIEW_REQUIRED", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C7`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
        status: "CLOSED",
      })
      .returning();

    const preview = await agent
      .post("/api/factory/suppliers/fx-diagnostic/repair")
      .send({ source: "container", id: container.id, fxRateToUsd: 1.08 });
    expect(preview.status).toBe(200);
    expect(preview.body.plan.manualReviewRequired).toBe(true);
    const token = preview.body.confirmationToken;

    const apply = await agent.post("/api/factory/suppliers/fx-diagnostic/repair").send({
      source: "container",
      id: container.id,
      fxRateToUsd: 1.08,
      confirm: true,
      confirmationToken: token,
    });
    expect(apply.status).toBe(409);
    expect(apply.body.code).toBe("MANUAL_REVIEW_REQUIRED");

    const [reloaded] = await db.select().from(schema.factoryContainers).where(eq(schema.factoryContainers.id, container.id));
    expect((reloaded as any).fxRateConfirmed).toBe(false); // historical costing left untouched
  });
});
