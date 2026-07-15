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
import { signRepairToken } from "../server/services/factory/repairToken";
import { applyFxResolutionRepair } from "../server/services/factory/fxResolutionRepair";

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

  it("rejects the diagnostic GET for non-admin roles too", async () => {
    const res = await nonAdminAgent.get("/api/factory/suppliers/fx-diagnostic");
    expect(res.status).toBe(403);
  });

  it("detects a non-USD charge attached to a USD-currency container", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C8`,
        supplierId,
        currencyCode: "USD",
        fxRateToUsd: "1",
        fxRateConfirmed: true,
        status: "PENDING",
      })
      .returning();

    const [charge] = await db
      .insert(schema.factoryOffloadAdditionalCharges)
      .values({
        companyId: ctx.companyId,
        containerId: container.id,
        description: "Non-USD charge on a USD container",
        amount: "500",
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
      })
      .returning();

    const res = await agent.get("/api/factory/suppliers/fx-diagnostic");
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.source === "offload_additional_charge" && r.id === charge.id);
    expect(row).toBeTruthy();
    expect(row.currencyCode).toBe("EUR");
    // The charge's container status must be resolved correctly even though the
    // container itself is USD (and therefore not in the non-USD container scan).
    expect(row.status).toBe("PENDING");
  });

  it("classifies a non-USD charge on a CLOSED USD container as manual-review-only, and its GET/POST repair path is refused", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C9`,
        supplierId,
        currencyCode: "USD",
        fxRateToUsd: "1",
        fxRateConfirmed: true,
        status: "CLOSED",
      })
      .returning();

    const [charge] = await db
      .insert(schema.factoryOffloadAdditionalCharges)
      .values({
        companyId: ctx.companyId,
        containerId: container.id,
        description: "Non-USD charge on a historical closed USD container",
        amount: "250",
        currencyCode: "CDF",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
      })
      .returning();

    const res = await agent.get("/api/factory/suppliers/fx-diagnostic");
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.source === "offload_additional_charge" && r.id === charge.id);
    expect(row).toBeTruthy();
    expect(row.status).toBe("CLOSED");
    expect(res.body.manualReviewRequired.some((r: any) => r.id === charge.id && r.source === "offload_additional_charge")).toBe(
      true
    );

    const preview = await agent
      .post("/api/factory/suppliers/fx-diagnostic/repair")
      .send({ source: "offload_additional_charge", id: charge.id, fxRateToUsd: 1.5 });
    expect(preview.status).toBe(200);
    expect(preview.body.plan.manualReviewRequired).toBe(true);

    const apply = await agent.post("/api/factory/suppliers/fx-diagnostic/repair").send({
      source: "offload_additional_charge",
      id: charge.id,
      fxRateToUsd: 1.5,
      confirm: true,
      confirmationToken: preview.body.confirmationToken,
    });
    expect(apply.status).toBe(409);
    expect(apply.body.code).toBe("MANUAL_REVIEW_REQUIRED");

    const [reloaded] = await db
      .select()
      .from(schema.factoryOffloadAdditionalCharges)
      .where(eq(schema.factoryOffloadAdditionalCharges.id, charge.id));
    expect((reloaded as any).fxRateConfirmed).toBe(false);
  });

  it("returns 409 ALREADY_CONFIRMED instead of overwriting a confirmed rate that differs from the request", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C10`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1.1",
        fxRateConfirmed: true, // already confirmed at 1.1
        status: "PENDING",
      })
      .returning();

    const preview = await agent
      .post("/api/factory/suppliers/fx-diagnostic/repair")
      .send({ source: "container", id: container.id, fxRateToUsd: 1.25 });
    expect(preview.status).toBe(409);
    expect(preview.body.code).toBe("ALREADY_CONFIRMED");

    const [reloaded] = await db.select().from(schema.factoryContainers).where(eq(schema.factoryContainers.id, container.id));
    expect(parseFloat((reloaded as any).fxRateToUsd)).toBeCloseTo(1.1, 6); // untouched
  });

  it("rejects an expired confirmation token", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C11`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
        status: "PENDING",
      })
      .returning();

    const staleToken = signRepairToken({
      companyId: ctx.companyId,
      source: "container",
      id: container.id,
      newFxRateToUsd: 1.08,
      oldFxRateToUsd: "1",
      oldFxRateConfirmed: false,
      versionTag: null,
      userId: "someone",
      expiresAt: Date.now() - 1000, // already expired
    });

    const res = await agent.post("/api/factory/suppliers/fx-diagnostic/repair").send({
      source: "container",
      id: container.id,
      fxRateToUsd: 1.08,
      confirm: true,
      confirmationToken: staleToken,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TOKEN_EXPIRED");

    const [reloaded] = await db.select().from(schema.factoryContainers).where(eq(schema.factoryContainers.id, container.id));
    expect((reloaded as any).fxRateConfirmed).toBe(false);
  });

  it("rolls back the FX update if the atomic audit-log insert fails", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C12`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
        status: "PENDING",
      })
      .returning();

    await expect(
      applyFxResolutionRepair("container", container.id, ctx.companyId, 1.08, {
        onAudit: async () => {
          throw new Error("simulated audit-log failure");
        },
      })
    ).rejects.toThrow("simulated audit-log failure");

    const [reloaded] = await db.select().from(schema.factoryContainers).where(eq(schema.factoryContainers.id, container.id));
    // The FX write must have rolled back along with the failed audit insert —
    // never left half-applied.
    expect((reloaded as any).fxRateConfirmed).toBe(false);
    expect(parseFloat((reloaded as any).fxRateToUsd)).toBeCloseTo(1, 6);
  });

  it("row-locks concurrent repair attempts on the same row so only one apply succeeds", async () => {
    const [container] = await db
      .insert(schema.factoryContainers)
      .values({
        companyId: ctx.companyId,
        containerNumber: `${TEST_PREFIX}-C13`,
        supplierId,
        currencyCode: "EUR",
        fxRateToUsd: "1",
        fxRateConfirmed: false,
        status: "PENDING",
      })
      .returning();

    const [r1, r2] = await Promise.all([
      applyFxResolutionRepair("container", container.id, ctx.companyId, 1.2),
      applyFxResolutionRepair("container", container.id, ctx.companyId, 1.2),
    ]);
    // Serialized by the advisory + row lock: the first to acquire the lock applies,
    // the second sees the already-confirmed-same-rate state and safely no-ops.
    const appliedCount = [r1, r2].filter((r) => r.applied).length;
    expect(appliedCount).toBe(1);

    const [reloaded] = await db.select().from(schema.factoryContainers).where(eq(schema.factoryContainers.id, container.id));
    expect((reloaded as any).fxRateConfirmed).toBe(true);
    expect(parseFloat((reloaded as any).fxRateToUsd)).toBeCloseTo(1.2, 6);
  });

  it("full reconciliation report is present with kg accounting, locked-rate diagnostics, and zero writes", async () => {
    const before = await db
      .select()
      .from(schema.factoryContainers)
      .where(eq(schema.factoryContainers.companyId, ctx.companyId));

    const res = await agent.get("/api/factory/suppliers/fx-diagnostic");
    expect(res.status).toBe(200);
    const recon = res.body.reconciliation;
    expect(recon).toBeTruthy();
    expect(recon.companyId).toBe(ctx.companyId);
    expect(recon.kgSummary).toBeTruthy();
    expect(typeof recon.kgSummary.receivedKg).toBe("number");
    expect(typeof recon.kgSummary.usedKg).toBe("number");
    expect(typeof recon.kgSummary.reservedKg).toBe("number");
    expect(typeof recon.kgSummary.freeKg).toBe("number");
    expect(Array.isArray(recon.kgSummary.negativeStockRows)).toBe(true);
    expect(Array.isArray(recon.lockedRateDiagnostics)).toBe(true);
    expect(Array.isArray(recon.supplierCurrencyExposure)).toBe(true);
    expect(Array.isArray(recon.crossCompanyContamination)).toBe(true);
    expect(Array.isArray(recon.doubleReservedDeductions)).toBe(true);

    // Zero-write guarantee: the GET must never modify container rows.
    const after = await db
      .select()
      .from(schema.factoryContainers)
      .where(eq(schema.factoryContainers.companyId, ctx.companyId));
    expect(after.length).toBe(before.length);
    const beforeById = new Map(before.map((c: any) => [c.id, JSON.stringify(c)]));
    for (const c of after as any[]) {
      expect(beforeById.get(c.id)).toBe(JSON.stringify(c));
    }
  });
});
