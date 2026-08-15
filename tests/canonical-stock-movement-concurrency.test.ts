/**
 * Concurrency proof for the canonical stock movement journal.
 *
 * canonical_stock_movement_requests carries UNIQUE(company_id, idempotency_key),
 * so the no-double-post guarantee is enforced by the database rather than by the
 * read that precedes it. That distinction only matters under a race: at READ
 * COMMITTED two transactions can both look for an existing request, both find
 * nothing, and both start appending. The constraint is what makes the loser roll
 * back — including the movement rows it had already written — instead of leaving
 * a duplicate stock effect behind.
 *
 * This test drives that race directly, because the single-threaded replay test
 * cannot reach it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { postStockMovementTx } from "../server/services/inventory/stockMovementIntegrityService";
import { createDatabaseStockMovementAdapter } from "../server/services/inventory/databaseStockMovementAdapter";

const TEST_PREFIX = "canonrace";

let ctx: TestContext;
const adapter = createDatabaseStockMovementAdapter();

async function movementCount(companyId: number, sourceId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM canonical_stock_movements WHERE company_id = $1 AND source_id = $2`,
    [companyId, sourceId]
  );
  return rows[0].count;
}

function transferRequest(sourceId: string) {
  return {
    companyId: ctx.companyId,
    stockItemId: ctx.stockItemIds[0],
    kind: "transfer" as const,
    quantity: "2.000",
    unitCost: "5.000000",
    fromLocationId: ctx.locationId,
    toLocationId: ctx.location2Id,
    occurredAt: new Date().toISOString(),
    source: {
      sourceType: "stock-transfer",
      sourceId,
      idempotencyKey: `stock-transfer:${sourceId}:${ctx.stockItemIds[0]}`,
    },
    allowNegativeStock: true,
  };
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
}, 60000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("canonical stock movement concurrency", () => {
  it("posts one movement pair when the same request is sent twice at once", async () => {
    const sourceId = `race-${Date.now()}`;
    const request = transferRequest(sourceId);

    // Both transactions are opened before either commits, so they genuinely
    // overlap rather than running back to back.
    const [first, second] = await Promise.allSettled([
      db.transaction(async (tx) => postStockMovementTx(tx, request, adapter)),
      db.transaction(async (tx) => postStockMovementTx(tx, request, adapter)),
    ]);

    const settled = [first, second];
    const fulfilled = settled.filter((outcome) => outcome.status === "fulfilled");

    // At least one must succeed: a race is not an excuse to lose the write.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Whatever the interleaving, the stock effect is posted exactly once. A
    // loser that rolled back leaves nothing behind, and a loser that read the
    // winner's request row reports a replay instead of appending.
    expect(await movementCount(ctx.companyId, sourceId)).toBe(2);

    for (const outcome of fulfilled) {
      if (outcome.status !== "fulfilled") continue;
      expect(outcome.value.movements.length).toBeGreaterThan(0);
    }

    // The idempotency record is unique per request, which is what forced that.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM canonical_stock_movement_requests
        WHERE company_id = $1 AND idempotency_key = $2`,
      [ctx.companyId, request.source.idempotencyKey]
    );
    expect(rows[0].count).toBe(1);
  }, 30000);

  it("still replays cleanly after a contended write has settled", async () => {
    const sourceId = `race-settled-${Date.now()}`;
    const request = transferRequest(sourceId);

    await db.transaction(async (tx) => postStockMovementTx(tx, request, adapter));
    const replay = await db.transaction(async (tx) => postStockMovementTx(tx, request, adapter));

    expect(replay.idempotent).toBe(true);
    expect(await movementCount(ctx.companyId, sourceId)).toBe(2);
  }, 30000);

  it("keeps distinct requests independent under the same source document", async () => {
    const sourceId = `race-multi-${Date.now()}`;
    const first = transferRequest(sourceId);
    const second = {
      ...transferRequest(sourceId),
      stockItemId: ctx.stockItemIds[1] ?? ctx.stockItemIds[0],
      source: {
        sourceType: "stock-transfer",
        sourceId,
        idempotencyKey: `stock-transfer:${sourceId}:second-line`,
      },
    };

    await Promise.all([
      db.transaction(async (tx) => postStockMovementTx(tx, first, adapter)),
      db.transaction(async (tx) => postStockMovementTx(tx, second, adapter)),
    ]);

    // Two different lines of one transfer are two different requests, so both
    // post: the constraint keys on the idempotency key, not the document.
    expect(await movementCount(ctx.companyId, sourceId)).toBe(4);
  }, 30000);
});
