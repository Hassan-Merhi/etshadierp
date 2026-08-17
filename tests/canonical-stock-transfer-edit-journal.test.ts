/**
 * Editing a stock transfer leaves evidence, not just an effect.
 *
 * Creating a transfer wrote canonical journal rows from the day the journal
 * existed. Editing one wrote none — so the journal recorded the issue and never
 * the return, and a transfer edited from ten units to two left evidence saying
 * ten units moved. Convergence reconciliation compares the document against the
 * journal, so this is not a discrepancy it reports; it is one it cannot see,
 * and the document quietly wins.
 *
 * The journal is append-only, so an edit appends its own reversal and reissue
 * under a fresh revision rather than rewriting what the original post recorded.
 * These tests read the rows back out of the database after driving the real
 * routes, because the only convincing proof that evidence was written is
 * finding it there afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import * as schema from "../shared/schema";

const TEST_PREFIX = "cantxedit";

let ctx: TestContext;
let agent: request.SuperAgentTest;

interface JournalRow {
  movement_kind: string;
  quantity_delta: string;
  unit_cost: string;
  location_id: number;
  stock_item_id: number;
  idempotency_key: string;
}

async function transferJournalRows(transferId: number): Promise<JournalRow[]> {
  const { rows } = await pool.query(
    `SELECT movement_kind, quantity_delta, unit_cost, location_id, stock_item_id, idempotency_key
       FROM canonical_stock_movements
      WHERE company_id = $1 AND source_type = 'stock-transfer' AND source_id = $2
      ORDER BY id`,
    [ctx.companyId, String(transferId)]
  );
  return rows;
}

/** The revision index embedded in an edit's idempotency key. */
function revisionOf(key: string): number {
  const match = key.match(/:rev(\d+):/);
  expect(match, `${key} carries no revision`).not.toBeNull();
  return Number(match![1]);
}

async function inventoryQuantity(locationId: number, stockItemId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(quantity, '0') AS quantity FROM inventory WHERE location_id = $1 AND stock_item_id = $2`,
    [locationId, stockItemId]
  );
  return Number(rows[0]?.quantity ?? 0);
}

/** Creates a transfer through the real route and returns its id. */
async function createTransfer(quantity: number): Promise<number> {
  const response = await agent.post("/api/stock-transfers").send({
    sourceLocationId: ctx.locationId,
    destinationLocationId: ctx.location2Id,
    items: [{ stockItemId: ctx.stockItemIds[0], quantity: String(quantity), sourceLocationId: ctx.locationId }],
    notes: "edit-journal probe",
    voucherDate: new Date().toISOString().split("T")[0],
    clientRequestId: `cantxedit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  });
  expect(response.status).toBe(201);
  return Number(response.body.transfer.id);
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await agent.post("/api/auth/login").send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });

  await db
    .insert(schema.inventory)
    .values({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: ctx.stockItemIds[0],
      quantity: "500.000",
      averageRate: "10.00",
      totalValue: "5000.00",
    })
    .onConflictDoNothing();
}, 60000);

afterAll(async () => {
  // Revision rows reference stock items by foreign key, and the shared cleanup
  // deletes the items — so they have to go first or the whole teardown fails
  // and the next run inherits a company it cannot seed.
  await pool.query(
    `DELETE FROM stock_transfer_revision_items
      WHERE revision_id IN (
        SELECT r.id FROM stock_transfer_revisions r
          JOIN stock_transfer_vouchers stv ON stv.id = r.transfer_id
          JOIN vouchers v ON v.id = stv.voucher_id
         WHERE v.company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(
    `DELETE FROM stock_transfer_revisions
      WHERE transfer_id IN (
        SELECT stv.id FROM stock_transfer_vouchers stv
          JOIN vouchers v ON v.id = stv.voucher_id
         WHERE v.company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM canonical_stock_movement_audit WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM canonical_stock_movement_requests WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM canonical_stock_movements WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("stock transfer revision journal", () => {
  async function stockItemName(stockItemId: number): Promise<string> {
    const { rows } = await pool.query(`SELECT name FROM stock_items WHERE id = $1`, [stockItemId]);
    return String(rows[0].name);
  }

  async function reviseAndApprove(transferId: number, newQuantity: number, originalQuantity: number) {
    const stockItemId = ctx.stockItemIds[0];
    // Submitted as pending, then approved. A revision created non-pending is
    // recorded as already approved and never makes the pending -> approved
    // transition that moves the stock, so it would exercise nothing here.
    const created = await agent.post(`/api/stock-transfers/${transferId}/revisions`).send({
      note: "revision journal probe",
      optional: true,
      items: [
        {
          stockItemId,
          stockItemName: await stockItemName(stockItemId),
          sourceLocationId: ctx.locationId,
          originalQuantity,
          newQuantity,
        },
      ],
    });
    expect(created.status).toBe(201);

    const revisionId = Number(created.body?.revision?.id ?? created.body?.id);
    const approved = await agent.post(`/api/stock-transfer-revisions/${revisionId}/approve`);
    expect(approved.status).toBe(200);
  }

  it("records an increase as an issue in the direction the stock moved", async () => {
    const transferId = await createTransfer(4);
    await reviseAndApprove(transferId, 9, 4);

    const rows = await transferJournalRows(transferId);
    const revisionRows = rows.filter((row) => row.idempotency_key.includes(":issue:"));
    expect(revisionRows.length).toBeGreaterThan(0);

    // The revision moved five more units out, not nine: a journal that recorded
    // the new total instead of the delta would double-count the original four.
    expect(revisionRows.some((row) => Math.abs(Number(row.quantity_delta)) === 5)).toBe(true);
  });

  it("records a decrease as a return, with the legs the other way round", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const transferId = await createTransfer(9);
    await reviseAndApprove(transferId, 3, 9);

    const rows = await transferJournalRows(transferId);
    const reverseRows = rows.filter((row) => row.idempotency_key.includes(":reverse:"));

    // A revision downwards brings stock back from the destination. Logging it as
    // a negative issue would leave the journal describing a movement in the
    // opposite direction to the one that happened.
    expect(reverseRows.length).toBeGreaterThan(0);
    expect(reverseRows.some((row) => row.location_id === ctx.locationId && Number(row.quantity_delta) > 0)).toBe(true);
    expect(reverseRows.some((row) => row.location_id === ctx.location2Id && Number(row.quantity_delta) < 0)).toBe(true);

    const journalNetAtDestination = rows
      .filter((row) => row.location_id === ctx.location2Id)
      .reduce((total, row) => total + Number(row.quantity_delta), 0);
    expect(journalNetAtDestination).toBeCloseTo(3, 3);
    void stockItemId;
  });
});

describe("stock transfer deletion journal", () => {
  it("records the return, and the record outlives the document", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const transferId = await createTransfer(7);
    const sourceBefore = await inventoryQuantity(ctx.locationId, stockItemId);

    const { rows: voucherRows } = await pool.query(`SELECT voucher_id FROM stock_transfer_vouchers WHERE id = $1`, [
      transferId,
    ]);
    const voucherId = Number(voucherRows[0].voucher_id);

    const response = await agent.delete(`/api/vouchers/${voucherId}`);
    expect(response.status).toBe(200);

    const rows = await transferJournalRows(transferId);
    const reverseRows = rows.filter((row) => row.idempotency_key.includes(":reverse:"));
    const sourceAfter = await inventoryQuantity(ctx.locationId, stockItemId);

    // The transfer document is gone. Without this row nothing in the database
    // would say the seven units ever came back — the outbound evidence from
    // creation would be the only account of the movement, and it would be a
    // lie about the current position.
    expect(reverseRows.length).toBeGreaterThan(0);
    expect(sourceAfter - sourceBefore).toBeCloseTo(7, 3);

    const journalNetAtSource = rows
      .filter((row) => row.location_id === ctx.locationId)
      .reduce((total, row) => total + Number(row.quantity_delta), 0);
    expect(journalNetAtSource).toBeCloseTo(0, 3);
  });
});

describe("stock transfer edit journal", () => {
  it("appends a reversal and a reissue instead of rewriting the original", async () => {
    const transferId = await createTransfer(10);
    const afterCreate = await transferJournalRows(transferId);
    // Creation records the issue leg and the receipt leg of one movement.
    expect(afterCreate.length).toBeGreaterThan(0);

    const response = await agent.put(`/api/stock-transfers/${transferId}`).send({
      destinationLocationId: ctx.location2Id,
      notes: "edited",
      items: [{ stockItemId: ctx.stockItemIds[0], sourceLocationId: ctx.locationId, quantity: 2, rate: 10 }],
    });
    expect(response.status).toBe(200);

    const afterEdit = await transferJournalRows(transferId);
    const keys = afterEdit.map((row) => row.idempotency_key);

    // The original rows are still there: an append-only journal that lost its
    // first posting on edit would be no better than no journal at all.
    for (const row of afterCreate) expect(keys).toContain(row.idempotency_key);

    const reverseKey = keys.find((key) => key.includes(":reverse:"));
    const issueKey = keys.find((key) => key.includes(":issue:"));
    expect(reverseKey, "the edit recorded no reversal").toBeDefined();
    expect(issueKey, "the edit recorded no reissue").toBeDefined();

    // Both halves of one edit carry the same revision, so the pair reads back as
    // a single event rather than two movements that happen to be adjacent.
    expect(revisionOf(reverseKey!)).toBe(revisionOf(issueKey!));
  });

  it("reverses the quantity the transfer originally moved, not the edited one", async () => {
    const transferId = await createTransfer(8);
    await agent.put(`/api/stock-transfers/${transferId}`).send({
      destinationLocationId: ctx.location2Id,
      notes: "edited down",
      items: [{ stockItemId: ctx.stockItemIds[0], sourceLocationId: ctx.locationId, quantity: 3, rate: 10 }],
    });

    const rows = await transferJournalRows(transferId);
    const reverseRows = rows.filter((row) => row.idempotency_key.includes(":reverse:"));
    const reissueRows = rows.filter((row) => row.idempotency_key.includes(":issue:"));

    // Reversing the edited quantity instead of the original is the subtle way
    // this goes wrong: the journal would net to a five-unit movement that never
    // happened, and every later reconciliation would inherit it.
    expect(reverseRows.length).toBeGreaterThan(0);
    expect(reissueRows.length).toBeGreaterThan(0);
    expect(reverseRows.some((row) => Math.abs(Number(row.quantity_delta)) === 8)).toBe(true);
    expect(reissueRows.some((row) => Math.abs(Number(row.quantity_delta)) === 3)).toBe(true);
  });

  it("nets to the stock the balances actually show", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const destinationBefore = await inventoryQuantity(ctx.location2Id, stockItemId);

    const transferId = await createTransfer(6);
    await agent.put(`/api/stock-transfers/${transferId}`).send({
      destinationLocationId: ctx.location2Id,
      notes: "edited",
      items: [{ stockItemId, sourceLocationId: ctx.locationId, quantity: 4, rate: 10 }],
    });

    const destinationAfter = await inventoryQuantity(ctx.location2Id, stockItemId);
    const rows = await transferJournalRows(transferId);
    const journalNetAtDestination = rows
      .filter((row) => row.location_id === ctx.location2Id)
      .reduce((total, row) => total + Number(row.quantity_delta), 0);

    // The point of the evidence: what the journal says arrived at the
    // destination has to be what the balance says arrived. This is the exact
    // comparison convergence reconciliation makes, run here against a document
    // that was created and then edited.
    expect(destinationAfter - destinationBefore).toBeCloseTo(4, 3);
    expect(journalNetAtDestination).toBeCloseTo(4, 3);
  });

  it("journals both sources when one item is drawn from two locations", async () => {
    const stockItemId = ctx.stockItemIds[0];
    const [thirdLocation] = await db
      .insert(schema.locations)
      .values({
        companyId: ctx.companyId,
        code: `${TEST_PREFIX}-src2-${Date.now()}`,
        name: "Second multi-source origin",
      })
      .returning();
    await db
      .insert(schema.inventory)
      .values({
        companyId: ctx.companyId,
        locationId: thirdLocation.id,
        stockItemId,
        quantity: "500.000",
        averageRate: "10.00",
        totalValue: "5000.00",
      })
      .onConflictDoNothing();

    const transferId = await createTransfer(3);
    const before = await transferJournalRows(transferId);

    const response = await agent.put(`/api/stock-transfers/${transferId}`).send({
      destinationLocationId: ctx.location2Id,
      notes: "two origins, one item",
      items: [
        { stockItemId, sourceLocationId: ctx.locationId, quantity: 6, rate: 10 },
        { stockItemId, sourceLocationId: thirdLocation.id, quantity: 4, rate: 10 },
      ],
    });
    expect(response.status).toBe(200);

    const added = (await transferJournalRows(transferId)).filter(
      (row) => !before.some((existing) => existing.idempotency_key === row.idempotency_key)
    );
    const issueKeys = new Set(
      added.filter((row) => row.idempotency_key.includes(":issue:")).map((row) => row.idempotency_key)
    );

    // Both legs share the transfer, the revision, the phase and the stock item.
    // Keyed on those alone they are the same key, postStockMovementTx reads the
    // second call as a replay of the first and returns without writing, and one
    // source's four units move in inventory with nothing in the journal saying
    // so. The two must be distinct keys.
    expect(issueKeys.size, "the two sources collapsed onto one idempotency key").toBe(2);

    for (const locationId of [ctx.locationId, thirdLocation.id]) {
      const issuedHere = added
        .filter((row) => row.idempotency_key.includes(":issue:") && row.location_id === locationId)
        .reduce((total, row) => total + Number(row.quantity_delta), 0);
      expect(issuedHere, `location ${locationId} issued nothing`).toBeLessThan(0);
    }

    const arrived = added
      .filter((row) => row.idempotency_key.includes(":issue:") && row.location_id === ctx.location2Id)
      .reduce((total, row) => total + Number(row.quantity_delta), 0);
    expect(arrived).toBeCloseTo(10, 3);
  });

  it("keeps a repeated edit from posting the same movement twice", async () => {
    const transferId = await createTransfer(5);
    const body = {
      destinationLocationId: ctx.location2Id,
      notes: "edited twice",
      items: [{ stockItemId: ctx.stockItemIds[0], sourceLocationId: ctx.locationId, quantity: 5, rate: 10 }],
    };

    await agent.put(`/api/stock-transfers/${transferId}`).send(body);
    const afterFirst = await transferJournalRows(transferId);
    await agent.put(`/api/stock-transfers/${transferId}`).send(body);
    const afterSecond = await transferJournalRows(transferId);

    // A second edit is a genuinely new event and gets its own revision, so the
    // journal grows. A revision index that did not advance would collide with
    // the first edit's keys, postStockMovementTx would treat the second edit as
    // a replay, and its evidence would be silently dropped.
    expect(afterSecond.length).toBeGreaterThan(afterFirst.length);

    const revisions = afterSecond
      .map((row) => row.idempotency_key)
      .filter((key) => key.includes(":rev"))
      .map(revisionOf);
    expect(new Set(revisions).size, "both edits landed on one revision").toBeGreaterThan(1);

    // One movement writes two rows — the leg it left and the leg it arrived at —
    // so a key appearing more than twice means a movement was posted twice.
    const perKey = new Map<string, number>();
    for (const row of afterSecond) perKey.set(row.idempotency_key, (perKey.get(row.idempotency_key) ?? 0) + 1);
    for (const [key, count] of perKey) expect(count, `${key} was posted more than once`).toBeLessThanOrEqual(2);
  });
});
