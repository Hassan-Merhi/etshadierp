/**
 * The read-only convergence reconciliation endpoint.
 *
 * The reconciler and its loaders had no route in front of them, so nothing
 * outside the test suite could ever run a reconciliation. These tests drive the
 * real endpoint: they post a transfer through the API, reconcile, and assert the
 * report is clean — and that the endpoint is company-scoped from the session and
 * closed to roles that should not see another tenant's books.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { pool } from "../server/db";

const TEST_PREFIX = "convroute";

let ctx: TestContext;
let agent: request.SuperAgentTest;

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}, 60000);

afterAll(async () => {
  await pool.query(`DELETE FROM canonical_stock_movement_audit WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM canonical_stock_movement_requests WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM canonical_stock_movements WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("GET /api/admin/convergence-reconciliation", () => {
  it("reports a clean reconciliation for a transfer that recorded its evidence", async () => {
    const transfer = await agent.post("/api/stock-transfers").send({
      sourceLocationId: ctx.locationId,
      destinationLocationId: ctx.location2Id,
      items: [
        {
          stockItemId: ctx.stockItemIds[0],
          quantity: 2,
          rate: "4.00",
          sourceLocationId: ctx.locationId,
        },
      ],
      notes: "reconciliation route transfer",
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(transfer.status).toBeGreaterThanOrEqual(200);
    expect(transfer.status).toBeLessThan(300);

    const res = await agent.get("/api/admin/convergence-reconciliation");

    expect(res.status).toBe(200);
    expect(res.body.companyId).toBe(ctx.companyId);
    expect(res.body.stockSnapshots).toBeGreaterThan(0);
    // The document and the journal agree, so there is nothing to report. A
    // discrepancy here would mean the transfer applied stock without matching
    // evidence, which is exactly what this endpoint exists to surface.
    expect(res.body.discrepancies).toEqual([]);
    expect(res.body.clean).toBe(true);
  }, 30000);

  it("reconciles the company on the session rather than one named by the caller", async () => {
    // There is no companyId parameter to point this at another tenant; a
    // caller-supplied one is ignored, and the tenant boundary refuses a primary
    // companyId that disagrees with the session anyway.
    const res = await agent.get("/api/admin/convergence-reconciliation?companyId=999999");
    expect([403, 200]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.companyId).toBe(ctx.companyId);
    }
  }, 30000);

  it("is closed to an unauthenticated caller", async () => {
    const anonymous = request.agent(ctx.app);
    const res = await anonymous.get("/api/admin/convergence-reconciliation");
    expect(res.status).toBe(401);
  }, 30000);

  it("never mutates: reconciling twice leaves the journal untouched", async () => {
    const countRows = async () => {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS count FROM canonical_stock_movements WHERE company_id = $1`,
        [ctx.companyId]
      );
      return rows[0].count;
    };

    const before = await countRows();
    await agent.get("/api/admin/convergence-reconciliation");
    await agent.get("/api/admin/convergence-reconciliation");
    expect(await countRows()).toBe(before);
  }, 30000);
});
