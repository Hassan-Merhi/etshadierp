/**
 * A stock transfer submitted twice moves stock once.
 *
 * The create endpoint numbered its vouchers `ST-${Date.now()}` and had no other
 * notion of request identity, so a double click, a browser retry or a proxy
 * replay produced two transfers and moved the stock twice. Inventory has no way
 * to tell the difference afterwards: both movements look deliberate.
 *
 * These cases exercise the live endpoint and then read inventory, the transfer
 * tables and the canonical journal back, because the response alone cannot show
 * whether stock moved once or twice.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, getInventoryQty, type TestContext } from "./setup";
import { pool } from "../server/db";

const TEST_PREFIX = "sttidem";

let ctx: TestContext;
let agent: request.SuperAgentTest;

function transferBody(quantity: number, clientRequestId?: string) {
  return {
    sourceLocationId: ctx.locationId,
    destinationLocationId: ctx.location2Id,
    items: [
      {
        stockItemId: ctx.stockItemIds[0],
        quantity: String(quantity),
        sourceLocationId: ctx.locationId,
      },
    ],
    notes: "idempotency probe",
    voucherDate: new Date().toISOString().split("T")[0],
    ...(clientRequestId ? { clientRequestId } : {}),
  };
}

async function transferCount(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
       FROM stock_transfer_vouchers stv
       JOIN vouchers v ON v.id = stv.voucher_id
      WHERE v.company_id = $1`,
    [ctx.companyId]
  );
  return rows[0].count;
}

async function journalRowCount(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM canonical_stock_movements
      WHERE company_id = $1 AND source_type = 'stock-transfer'`,
    [ctx.companyId]
  );
  return rows[0].count;
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

describe("stock transfer request identity", () => {
  it("moves stock once when the same request id is submitted twice", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const sourceBefore = await getInventoryQty(ctx.locationId, stockItemId);
    const destinationBefore = await getInventoryQty(ctx.location2Id, stockItemId);
    const transfersBefore = await transferCount();
    const journalBefore = await journalRowCount();

    const body = transferBody(3, `stt-retry-${Date.now()}`);
    const first = await agent.post("/api/stock-transfers").send(body);
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);

    const replay = await agent.post("/api/stock-transfers").send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.replayed).toBe(true);
    // The replay answers with the original document rather than a new one.
    expect(replay.body.transfer.id).toBe(first.body.transfer.id);
    expect(replay.body.voucher.id).toBe(first.body.voucher.id);
    expect(replay.body.items).toHaveLength(first.body.items.length);

    expect(await transferCount()).toBe(transfersBefore + 1);
    expect(await journalRowCount()).toBe(journalBefore + 2);
    expect(await getInventoryQty(ctx.locationId, stockItemId)).toBe(sourceBefore - 3);
    expect(await getInventoryQty(ctx.location2Id, stockItemId)).toBe(destinationBefore + 3);
  }, 60000);

  it("moves stock once when two identical submissions race", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const sourceBefore = await getInventoryQty(ctx.locationId, stockItemId);
    const transfersBefore = await transferCount();

    const body = transferBody(2, `stt-race-${Date.now()}`);
    const [first, second] = await Promise.all([
      agent.post("/api/stock-transfers").send(body),
      agent.post("/api/stock-transfers").send(body),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Whichever request lost the race waited on the advisory lock and then read
    // the marker the winner had just committed.
    expect(second.body.transfer.id).toBe(first.body.transfer.id);
    expect([first.body.replayed, second.body.replayed].filter(Boolean)).toHaveLength(1);

    expect(await transferCount()).toBe(transfersBefore + 1);
    expect(await getInventoryQty(ctx.locationId, stockItemId)).toBe(sourceBefore - 2);
  }, 60000);

  it("creates a second transfer when the request id differs", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const sourceBefore = await getInventoryQty(ctx.locationId, stockItemId);
    const transfersBefore = await transferCount();

    const first = await agent.post("/api/stock-transfers").send(transferBody(1, `stt-a-${Date.now()}`));
    const second = await agent.post("/api/stock-transfers").send(transferBody(1, `stt-b-${Date.now()}`));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Two deliberate transfers of the same item on the same day are a normal
    // thing to do; only a repeated request id means "this is the same one".
    expect(second.body.transfer.id).not.toBe(first.body.transfer.id);
    expect(await transferCount()).toBe(transfersBefore + 2);
    expect(await getInventoryQty(ctx.locationId, stockItemId)).toBe(sourceBefore - 2);
  }, 60000);

  it("still serves a caller that sends no request id", async () => {
    const transfersBefore = await transferCount();

    const res = await agent.post("/api/stock-transfers").send(transferBody(1));
    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(false);
    expect(await transferCount()).toBe(transfersBefore + 1);
  }, 60000);

  it("refuses a second transfer document for a voucher that already has one", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const { rows } = await pool.query(
      `INSERT INTO vouchers (company_id, voucher_type, voucher_number, voucher_date, description, total_amount, optional)
       VALUES ($1, 'Stock Transfer', $2, CURRENT_DATE, 'existing voucher branch', '0', false)
       RETURNING id`,
      [ctx.companyId, `ST-EXIST-${Date.now()}`]
    );
    const voucherId = Number(rows[0].id);
    const body = {
      voucherId,
      destinationLocationId: ctx.location2Id,
      notes: "existing voucher branch",
      items: [{ stockItemId, sourceLocationId: ctx.locationId, quantity: "2", rate: "2.50" }],
    };

    const sourceBefore = await getInventoryQty(ctx.locationId, stockItemId);
    const first = await agent.post("/api/stock-transfers").send(body);
    expect(first.status).toBe(201);

    // This branch attaches a transfer to a voucher the client created a moment
    // earlier, and had no duplicate guard at all: submitting it twice built a
    // second document and moved the stock again under the same voucher.
    const second = await agent.post("/api/stock-transfers").send(body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("STOCK_TRANSFER_ALREADY_EXISTS");

    expect(await getInventoryQty(ctx.locationId, stockItemId)).toBe(sourceBefore - 2);
  }, 60000);

  it("rejects an oversized request id instead of ignoring it", async () => {
    const res = await agent.post("/api/stock-transfers").send(transferBody(1, "x".repeat(201)));

    // Silently dropping an unusable key would leave the caller believing the
    // request was protected when it was not.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("STOCK_DOCUMENT_REQUEST_ID_INVALID");
  }, 60000);
});
