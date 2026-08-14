/**
 * One voucher, one stock adjustment — even when two submissions arrive at once.
 *
 * The route refused a second adjustment for a voucher that already had one, but
 * it asked that question on a different connection from the one that did the
 * insert. Two submissions arriving together both saw nothing and both applied
 * their items, so the same production was added to stock twice with no record
 * that anything unusual had happened.
 *
 * The check now happens under a lock on the voucher row, inside the transaction
 * that inserts. These cases prove it by racing the endpoint against itself and
 * then reading inventory back.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, getInventoryQty, type TestContext } from "./setup";
import { pool } from "../server/db";

const TEST_PREFIX = "adjrace";

let ctx: TestContext;
let agent: request.SuperAgentTest;

async function createAdjustmentVoucher(label: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO vouchers (company_id, voucher_type, voucher_number, voucher_date, description, total_amount, optional)
     VALUES ($1, 'Stock Adjustment', $2, CURRENT_DATE, $3, '0', false)
     RETURNING id`,
    [ctx.companyId, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label]
  );
  return Number(rows[0].id);
}

async function adjustmentCount(voucherId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM stock_adjustment_vouchers WHERE voucher_id = $1`,
    [voucherId]
  );
  return rows[0].count;
}

function adjustmentBody(voucherId: number, quantity: string) {
  return {
    voucherId,
    locationId: ctx.locationId,
    adjustmentType: "Production" as const,
    notes: "concurrency probe",
    items: [{ stockItemId: ctx.stockItemIds[0], quantity, rate: "3.00" }],
  };
}

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

describe("stock adjustment concurrency", () => {
  it("applies one adjustment when two submissions race on the same voucher", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const voucherId = await createAdjustmentVoucher("ADJ-RACE");
    const quantityBefore = await getInventoryQty(ctx.locationId, stockItemId);

    const [first, second] = await Promise.all([
      agent.post("/api/stock-adjustments").send(adjustmentBody(voucherId, "5")),
      agent.post("/api/stock-adjustments").send(adjustmentBody(voucherId, "5")),
    ]);

    const statuses = [first.status, second.status].sort();
    // One creates it; the other is told the voucher is already adjusted. What
    // must never happen is both succeeding.
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(409);

    expect(await adjustmentCount(voucherId)).toBe(1);
    expect(await getInventoryQty(ctx.locationId, stockItemId)).toBe(quantityBefore + 5);
  }, 60000);

  it("refuses a sequential second adjustment for the same voucher", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const voucherId = await createAdjustmentVoucher("ADJ-SEQ");
    const quantityBefore = await getInventoryQty(ctx.locationId, stockItemId);

    const first = await agent.post("/api/stock-adjustments").send(adjustmentBody(voucherId, "4"));
    expect(first.status).toBe(201);

    const second = await agent.post("/api/stock-adjustments").send(adjustmentBody(voucherId, "4"));
    expect(second.status).toBe(409);

    expect(await adjustmentCount(voucherId)).toBe(1);
    expect(await getInventoryQty(ctx.locationId, stockItemId)).toBe(quantityBefore + 4);
  }, 60000);

  it("leaves separate vouchers free to be adjusted independently", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const firstVoucherId = await createAdjustmentVoucher("ADJ-ONE");
    const secondVoucherId = await createAdjustmentVoucher("ADJ-TWO");
    const quantityBefore = await getInventoryQty(ctx.locationId, stockItemId);

    const first = await agent.post("/api/stock-adjustments").send(adjustmentBody(firstVoucherId, "2"));
    const second = await agent.post("/api/stock-adjustments").send(adjustmentBody(secondVoucherId, "3"));

    // The lock is on the voucher, not on adjustments in general: two real
    // documents still both post.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await getInventoryQty(ctx.locationId, stockItemId)).toBe(quantityBefore + 5);
  }, 60000);
});
