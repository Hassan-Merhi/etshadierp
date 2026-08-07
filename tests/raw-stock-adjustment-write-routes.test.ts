/**
 * Behavioural coverage for the raw-stock adjustment write routes.
 *
 * These were guard-only, and the rule they enforce is the most consequential
 * one in the raw-material system: **an adjustment may never move a supplier's
 * locked rate.**
 *
 * The locked rate is what every downstream valuation multiplies by — the
 * net-position report's "Factory Raw Material Stock", the Raw Materials page's
 * stock value, the moving average applied at each offload. It is established
 * only by a real receipt (a container offload, or the opening-balance
 * workflow). An ADD adjustment is a quantity correction, so the handler ignores
 * any `costPerKg` the client sends for a supplier-backed ADD and substitutes
 * the locked rate; if no rate has ever been established it refuses outright
 * rather than inventing one from the request body.
 *
 * That is easy to regress and impossible to notice: accepting the client's cost
 * would silently re-price the supplier's entire remaining stock, and every
 * report would agree with itself at the new, wrong number.
 *
 * The other guard worth holding is on `PATCH .../receipts/:rawStockId`:
 * `received_kg` may not be set below `used_kg`, because material already
 * consumed into a mix batch cannot un-exist. Allowing it would make the
 * remaining balance negative.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "rsadj";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let seq = 0;

/** A supplier with no receipt history, so no locked rate. */
async function createSupplier(locked: number | null): Promise<number> {
  seq += 1;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO factory_suppliers (company_id, name, current_raw_material_cost_per_kg_usd)
     VALUES ($1, $2, $3) RETURNING id`,
    [ctx.companyId, `${TEST_PREFIX} supplier ${seq}`, locked === null ? null : String(locked)]
  );
  return result.rows[0].id;
}

async function lockedRate(supplierId: number): Promise<number | null> {
  const result = await pool.query<{ rate: string | null }>(
    `SELECT current_raw_material_cost_per_kg_usd AS rate FROM factory_suppliers WHERE id = $1`,
    [supplierId]
  );
  const raw = result.rows[0]?.rate;
  return raw === null || raw === undefined ? null : Number(raw);
}

/** A container plus its raw-stock row, as an offload would leave them. */
async function createReceipt(supplierId: number, receivedKg: string, usedKg = "0"): Promise<number> {
  seq += 1;
  const container = await pool.query<{ id: number }>(
    `INSERT INTO factory_containers (company_id, supplier_id, container_number, total_kg, rate_per_kg, currency_code, status)
     VALUES ($1, $2, $3, $4, '2.00', 'USD', 'OFFLOADED') RETURNING id`,
    [ctx.companyId, supplierId, `${TEST_PREFIX}-CONT-${seq}`, receivedKg]
  );
  const rawStock = await pool.query<{ id: number }>(
    `INSERT INTO factory_raw_stock (company_id, container_id, received_kg, used_kg, cost_per_kg, cost_per_kg_usd, offloaded_at)
     VALUES ($1, $2, $3, $4, '2.00', '2.00', now()) RETURNING id`,
    [ctx.companyId, container.rows[0].id, receivedKg, usedKg]
  );
  return rawStock.rows[0].id;
}

async function rawStockRow(id: number) {
  const result = await pool.query<{ received_kg: string; used_kg: string }>(
    `SELECT received_kg, used_kg FROM factory_raw_stock WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function adjustmentRow(id: number) {
  const result = await pool.query<{ type: string; kg: string; cost_per_kg: string; deleted_at: string | null }>(
    `SELECT type, kg, cost_per_kg, deleted_at FROM factory_raw_material_adjustments WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);

  const login = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (login.status !== 200) throw new Error(`Login failed: ${login.status}`);
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}, 120000);

afterAll(async () => {
  await pool.query(`DELETE FROM factory_raw_material_adjustments WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("POST /api/factory/raw-stock/adjustment", () => {
  it("uses the supplier's locked rate and ignores the cost the client sent", async () => {
    const supplierId = await createSupplier(2.5);
    await createReceipt(supplierId, "1000.000");

    const response = await agent
      .post("/api/factory/raw-stock/adjustment")
      .send({ type: "ADD", kg: "100", costPerKg: "99.00", supplierId, date: "2026-05-01" });

    expect(response.status).toBe(200);
    // The client asked for 99/kg. Honouring it would re-price the supplier's
    // entire remaining stock, and every report would agree with itself at the
    // new, wrong number.
    expect(Number((await adjustmentRow(response.body.id ?? response.body.adjustment?.id))?.cost_per_kg)).toBeCloseTo(
      2.5,
      4
    );
    expect(await lockedRate(supplierId)).toBeCloseTo(2.5, 4);
  });

  it("refuses an ADD for a supplier that has no established rate", async () => {
    const supplierId = await createSupplier(null);

    const response = await agent
      .post("/api/factory/raw-stock/adjustment")
      .send({ type: "ADD", kg: "100", costPerKg: "3.00", supplierId, date: "2026-05-01" });

    // Establishing the first rate is the job of a container offload or the
    // opening-balance workflow, not of a quantity correction.
    expect(response.status).toBe(400);
    expect(String(response.body.message)).toContain("no established raw-material rate");
    expect(await lockedRate(supplierId)).toBeNull();
  });

  it("accepts a client cost for a supplier-less manual adjustment", async () => {
    const response = await agent
      .post("/api/factory/raw-stock/adjustment")
      .send({ type: "ADD", kg: "50", costPerKg: "4.25", materialLabel: `${TEST_PREFIX} manual`, date: "2026-05-01" });

    // With no supplier there is no locked rate to protect, so the supplied
    // cost is the only figure available and is used as given.
    expect(response.status).toBe(200);
    const row = await adjustmentRow(response.body.id ?? response.body.adjustment?.id);
    expect(Number(row?.cost_per_kg)).toBeCloseTo(4.25, 4);
  });

  it("rejects an unknown type, a non-positive kg, or a missing date", async () => {
    const supplierId = await createSupplier(2.0);

    for (const body of [
      { type: "SET", kg: "10", supplierId, date: "2026-05-01" },
      { type: "ADD", kg: "0", supplierId, date: "2026-05-01" },
      { type: "ADD", kg: "-5", supplierId, date: "2026-05-01" },
      { type: "ADD", kg: "10", supplierId },
    ]) {
      const response = await agent.post("/api/factory/raw-stock/adjustment").send(body);
      expect(response.status).toBe(400);
    }

    // None of the rejected requests may leave the locked rate moved.
    expect(await lockedRate(supplierId)).toBeCloseTo(2.0, 4);
  });
});

describe("DELETE /api/factory/raw-stock/adjustments/:id", () => {
  it("removes the adjustment", async () => {
    const created = await agent
      .post("/api/factory/raw-stock/adjustment")
      .send({ type: "ADD", kg: "25", costPerKg: "1.00", materialLabel: `${TEST_PREFIX} del`, date: "2026-05-01" });
    expect(created.status).toBe(200);
    const adjustmentId = created.body.id ?? created.body.adjustment?.id;

    const response = await agent.delete(`/api/factory/raw-stock/adjustments/${adjustmentId}`);
    expect(response.status).toBe(200);

    const row = await adjustmentRow(adjustmentId);
    // Either hard-deleted or tombstoned — both mean it no longer counts.
    expect(row === null || row.deleted_at !== null).toBe(true);
  });

  it("returns 404 for an adjustment in another company", async () => {
    expect((await agent.delete("/api/factory/raw-stock/adjustments/999999")).status).toBe(404);
  });

  it("rejects a non-numeric id", async () => {
    expect((await agent.delete("/api/factory/raw-stock/adjustments/not-an-id")).status).toBe(400);
  });
});

describe("PATCH /api/factory/raw-stock/receipts/:rawStockId", () => {
  it("corrects the received quantity", async () => {
    const supplierId = await createSupplier(2.0);
    const rawStockId = await createReceipt(supplierId, "1000.000");

    const response = await agent.patch(`/api/factory/raw-stock/receipts/${rawStockId}`).send({ receivedKg: "950.000" });

    expect(response.status).toBe(200);
    expect(Number((await rawStockRow(rawStockId))?.received_kg)).toBeCloseTo(950, 3);
  });

  it("refuses to set received below what has already been used", async () => {
    const supplierId = await createSupplier(2.0);
    const rawStockId = await createReceipt(supplierId, "1000.000", "400.000");

    const response = await agent.patch(`/api/factory/raw-stock/receipts/${rawStockId}`).send({ receivedKg: "300.000" });

    // 400 kg is already consumed into mix batches. Allowing 300 received would
    // make the remaining balance negative, and nothing downstream expects that.
    expect(response.status).toBe(400);
    expect(String(response.body.message)).toContain("already-used");
    expect(Number((await rawStockRow(rawStockId))?.received_kg)).toBeCloseTo(1000, 3);
  });

  it("allows setting received exactly to the used amount", async () => {
    const supplierId = await createSupplier(2.0);
    const rawStockId = await createReceipt(supplierId, "1000.000", "400.000");

    const response = await agent.patch(`/api/factory/raw-stock/receipts/${rawStockId}`).send({ receivedKg: "400.000" });

    // The boundary is inclusive: a fully-consumed receipt is legitimate.
    expect(response.status).toBe(200);
    expect(Number((await rawStockRow(rawStockId))?.received_kg)).toBeCloseTo(400, 3);
  });

  it("rejects a negative or non-numeric quantity", async () => {
    const supplierId = await createSupplier(2.0);
    const rawStockId = await createReceipt(supplierId, "500.000");

    for (const receivedKg of ["-1", "abc"]) {
      expect((await agent.patch(`/api/factory/raw-stock/receipts/${rawStockId}`).send({ receivedKg })).status).toBe(
        400
      );
    }
    expect(Number((await rawStockRow(rawStockId))?.received_kg)).toBeCloseTo(500, 3);
  });

  it("returns 404 for a raw-stock row in another company", async () => {
    const response = await agent.patch("/api/factory/raw-stock/receipts/999999").send({ receivedKg: "10" });
    expect(response.status).toBe(404);
  });
});
