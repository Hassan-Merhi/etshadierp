/**
 * Behavioural coverage for the factory bale CRUD write routes.
 *
 * These eight were guard-only — nothing but `tests/write-route-guard-sweep.test.ts`
 * named them — while between them they set bale status, weight and cost on
 * `factory_bales`, which is the stock ledger the factory's inventory value is
 * summed from.
 *
 * Two properties carry most of the risk and neither had a test:
 *
 *   - **Cost follows weight.** `PATCH .../weight` recomputes `total_cost` from
 *     the corrected weight and the bale's own `cost_per_kg`, and cascades the
 *     new weight to every table that recorded it during loading. A weight
 *     correction that updated the bale but not its cost would leave stock
 *     valued at the old figure with no trace.
 *   - **Status vocabulary is closed.** The status columns drive whether a bale
 *     counts as in-stock, so an unrecognised value silently removes it from
 *     inventory. Both the single and bulk endpoints must reject one.
 *
 * The bulk endpoints are also checked for company scoping: they take an id
 * array straight from the request, so the only thing standing between a caller
 * and another tenant's bales is the `company_id` predicate in the WHERE clause.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "balecrud";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let foreignCompanyId: number;
let foreignBaleId: number;

let baleSeq = 0;

/** A bale in the fixture company, priced so weight changes are observable. */
async function createBale(overrides: { weightKg?: string; costPerKg?: string; status?: string } = {}) {
  baleSeq += 1;
  const code = `${TEST_PREFIX}-B${baleSeq}`;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO factory_bales
       (company_id, bale_code, reference_number, weight_kg, cost_per_kg, total_cost, status, product_name)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      ctx.companyId,
      code,
      overrides.weightKg ?? "100.000",
      overrides.costPerKg ?? "2.00",
      String((Number(overrides.weightKg ?? 100) * Number(overrides.costPerKg ?? 2)).toFixed(2)),
      overrides.status ?? "IN_STOCK",
      `${TEST_PREFIX} product`,
    ]
  );
  return result.rows[0].id;
}

async function baleRow(id: number) {
  const result = await pool.query<{
    id: number;
    status: string;
    weight_kg: string;
    cost_per_kg: string;
    total_cost: string;
    deleted_at: string | null;
    stock_entry_date: string | null;
    product_name: string | null;
  }>(
    `SELECT id, status, weight_kg, cost_per_kg, total_cost, deleted_at, stock_entry_date, product_name
     FROM factory_bales WHERE id = $1`,
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

  const company = await pool.query<{ id: number }>(
    `INSERT INTO companies (code, name, company_type, base_currency)
     VALUES ($1, $2, 'factory', 'USD') RETURNING id`,
    [`${TEST_PREFIX.slice(0, 5)}FGN`, `${TEST_PREFIX}_ForeignCompany`]
  );
  foreignCompanyId = company.rows[0].id;

  const foreign = await pool.query<{ id: number }>(
    `INSERT INTO factory_bales
       (company_id, bale_code, reference_number, weight_kg, cost_per_kg, total_cost, status)
     VALUES ($1, $2, $2, '50.000', '3.00', '150.00', 'IN_STOCK') RETURNING id`,
    [foreignCompanyId, `${TEST_PREFIX}-FGN-1`]
  );
  foreignBaleId = foreign.rows[0].id;
}, 120000);

afterAll(async () => {
  await pool.query(`DELETE FROM factory_bales WHERE company_id = $1`, [foreignCompanyId]);
  await pool.query(`DELETE FROM companies WHERE id = $1`, [foreignCompanyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("PATCH /api/factory/bales/:id/weight", () => {
  it("recomputes total cost from the corrected weight", async () => {
    const id = await createBale({ weightKg: "100.000", costPerKg: "2.50" });

    const response = await agent.patch(`/api/factory/bales/${id}/weight`).send({ weightKg: 80 });
    expect(response.status).toBe(200);

    const row = await baleRow(id);
    expect(Number(row?.weight_kg)).toBeCloseTo(80, 3);
    // total_cost is what the stock valuation sums. Leaving it at 250 while the
    // bale weighs 80 kg would overstate stock by 50 with nothing to show for it.
    expect(Number(row?.total_cost)).toBeCloseTo(200, 2);
    expect(Number(row?.cost_per_kg)).toBeCloseTo(2.5, 4);
  });

  it("rejects a zero, negative or non-numeric weight without changing the bale", async () => {
    const id = await createBale({ weightKg: "100.000", costPerKg: "2.00" });
    const before = await baleRow(id);

    for (const weightKg of [0, -5, "abc"]) {
      const response = await agent.patch(`/api/factory/bales/${id}/weight`).send({ weightKg });
      expect(response.status).toBe(400);
    }

    expect(await baleRow(id)).toEqual(before);
  });

  it("does not correct the weight of another company's bale", async () => {
    const before = await baleRow(foreignBaleId);
    const response = await agent.patch(`/api/factory/bales/${foreignBaleId}/weight`).send({ weightKg: 999 });

    expect(response.status).not.toBe(200);
    expect(await baleRow(foreignBaleId)).toEqual(before);
  });
});

describe("PATCH /api/factory/bales/:id/status", () => {
  it("moves a bale to an allowed status", async () => {
    const id = await createBale({ status: "IN_STOCK" });

    const response = await agent.patch(`/api/factory/bales/${id}/status`).send({ status: "RESERVED" });

    expect(response.status).toBe(200);
    expect((await baleRow(id))?.status).toBe("RESERVED");
  });

  it("refuses a status outside the allowed set", async () => {
    const id = await createBale({ status: "IN_STOCK" });

    const response = await agent.patch(`/api/factory/bales/${id}/status`).send({ status: "NOT_A_STATUS" });

    // An unrecognised status is not inert: every stock query filters on this
    // column, so an unknown value silently drops the bale out of inventory.
    expect(response.status).toBe(400);
    expect((await baleRow(id))?.status).toBe("IN_STOCK");
  });

  it("returns 404 for a bale in another company", async () => {
    const response = await agent.patch(`/api/factory/bales/${foreignBaleId}/status`).send({ status: "RESERVED" });

    expect(response.status).toBe(404);
    expect((await baleRow(foreignBaleId))?.status).toBe("IN_STOCK");
  });
});

describe("DELETE /api/factory/bales/:id", () => {
  it("soft-deletes by setting status and deletedAt together", async () => {
    const id = await createBale({ status: "IN_STOCK" });

    const response = await agent.delete(`/api/factory/bales/${id}`);
    expect(response.status).toBe(200);

    const row = await baleRow(id);
    // Both have to move. Stock queries exclude on one or the other depending on
    // the caller, so setting only one leaves the bale visible to half of them.
    expect(row?.status).toBe("DELETED");
    expect(row?.deleted_at).not.toBeNull();
  });

  it("does not delete another company's bale", async () => {
    const response = await agent.delete(`/api/factory/bales/${foreignBaleId}`);

    expect(response.status).toBe(404);
    expect((await baleRow(foreignBaleId))?.deleted_at).toBeNull();
  });
});

describe("PATCH /api/factory/bales/bulk-status", () => {
  it("updates every listed bale and reports how many moved", async () => {
    const ids = [await createBale(), await createBale()];

    const response = await agent.patch("/api/factory/bales/bulk-status").send({ ids, status: "PRESSED" });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(2);
    for (const id of ids) expect((await baleRow(id))?.status).toBe("PRESSED");
  });

  it("sets deletedAt when the bulk status is DELETED, and clears it otherwise", async () => {
    const id = await createBale();

    await agent.patch("/api/factory/bales/bulk-status").send({ ids: [id], status: "DELETED" });
    expect((await baleRow(id))?.deleted_at).not.toBeNull();

    // Moving a bale back out of DELETED has to clear the tombstone, or it stays
    // filtered out of stock while claiming to be IN_STOCK.
    await agent.patch("/api/factory/bales/bulk-status").send({ ids: [id], status: "IN_STOCK" });
    const row = await baleRow(id);
    expect(row?.status).toBe("IN_STOCK");
    expect(row?.deleted_at).toBeNull();
  });

  it("rejects an empty id list or a status outside the allowed set", async () => {
    const id = await createBale({ status: "IN_STOCK" });

    expect((await agent.patch("/api/factory/bales/bulk-status").send({ ids: [], status: "PRESSED" })).status).toBe(400);
    expect((await agent.patch("/api/factory/bales/bulk-status").send({ ids: [id] })).status).toBe(400);
    expect((await agent.patch("/api/factory/bales/bulk-status").send({ ids: [id], status: "NOPE" })).status).toBe(400);

    expect((await baleRow(id))?.status).toBe("IN_STOCK");
  });

  it("silently skips ids belonging to another company", async () => {
    const mine = await createBale();
    const response = await agent
      .patch("/api/factory/bales/bulk-status")
      .send({ ids: [mine, foreignBaleId], status: "PRESSED" });

    expect(response.status).toBe(200);
    // Only the caller's own bale counts, and the other tenant's is untouched.
    expect(response.body.updated).toBe(1);
    expect((await baleRow(mine))?.status).toBe("PRESSED");
    expect((await baleRow(foreignBaleId))?.status).toBe("IN_STOCK");
  });
});

describe("PATCH /api/factory/bales/bulk-date", () => {
  it("sets the stock entry date for the listed bales", async () => {
    const ids = [await createBale(), await createBale()];

    const response = await agent.patch("/api/factory/bales/bulk-date").send({ ids, stockEntryDate: "2026-03-04" });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(2);
    for (const id of ids) {
      // The driver hands back a Date for a date column; compare the calendar
      // day rather than its string rendering, which is timezone-dependent.
      const stored = (await baleRow(id))?.stock_entry_date;
      expect(new Date(stored as unknown as string).toISOString().slice(0, 10)).toBe("2026-03-04");
    }
  });

  it("requires an ISO date rather than accepting any string", async () => {
    const id = await createBale();

    // The column feeds date-ranged stock reports; a free-form string here would
    // either throw at the driver or sort wrongly for every report that reads it.
    for (const stockEntryDate of ["04/03/2026", "March 4 2026", ""]) {
      expect((await agent.patch("/api/factory/bales/bulk-date").send({ ids: [id], stockEntryDate })).status).toBe(400);
    }
    expect((await baleRow(id))?.stock_entry_date).toBeNull();
  });

  it("does not move another company's bale date", async () => {
    const response = await agent
      .patch("/api/factory/bales/bulk-date")
      .send({ ids: [foreignBaleId], stockEntryDate: "2026-03-04" });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(0);
    expect((await baleRow(foreignBaleId))?.stock_entry_date).toBeNull();
  });
});

describe("PATCH /api/factory/bales/:id/product-name", () => {
  it("renames a bale in the session's company", async () => {
    const id = await createBale();

    const response = await agent.patch(`/api/factory/bales/${id}/product-name`).send({ name: "Renamed Product" });

    expect(response.status).toBe(200);
    expect((await baleRow(id))?.product_name).toBe("Renamed Product");
  });

  it("does not rename another company's bale", async () => {
    const before = await baleRow(foreignBaleId);
    const response = await agent.patch(`/api/factory/bales/${foreignBaleId}/product-name`).send({ name: "hijacked" });

    expect(response.status).not.toBe(200);
    expect((await baleRow(foreignBaleId))?.product_name).toBe(before?.product_name ?? null);
  });
});
