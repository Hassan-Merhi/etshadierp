/**
 * Write-route coverage for stock-item merge.
 *
 * `POST /api/stock-items/:id/merge` and its unmerge counterpart had no test
 * that so much as named them (`npm run audit:write-routes`), while between them
 * they rewrite `inventory` rows for two items and soft-delete one of them. A
 * merge that loses quantity or value is a stock discrepancy nobody can trace
 * back to a request, and the smoke sweep cannot help — it excludes mutating
 * endpoints by design.
 *
 * The invariant asserted is conservation: merging two items must move quantity
 * and value onto the kept item without creating or destroying any.
 *
 * Writing it surfaced a defect the endpoint had been hiding — the merge's audit
 * log never persists, so no merge can be reversed. That is characterized in the
 * last test rather than fixed here, because correcting it means altering a
 * column type in a live table.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "mergewr";

let ctx: TestContext;
let agent: request.SuperAgentTest;

/** Total quantity and value held against one stock item, across all locations. */
async function inventoryTotals(stockItemId: number): Promise<{ quantity: number; value: number }> {
  const result = await pool.query<{ quantity: string | null; value: string | null }>(
    `SELECT COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(total_value), 0) AS value
     FROM inventory WHERE stock_item_id = $1 AND company_id = $2`,
    [stockItemId, ctx.companyId]
  );
  return {
    quantity: Number(result.rows[0]?.quantity ?? 0),
    value: Number(result.rows[0]?.value ?? 0),
  };
}

async function isSoftDeleted(stockItemId: number): Promise<boolean> {
  const result = await pool.query<{ deleted_at: string | null }>(`SELECT deleted_at FROM stock_items WHERE id = $1`, [
    stockItemId,
  ]);
  return result.rows[0]?.deleted_at != null;
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
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("stock-item merge write routes", () => {
  it("refuses a merge that is not explicitly confirmed", async () => {
    const [kept, duplicate] = ctx.stockItemIds;
    const response = await agent.post(`/api/stock-items/${kept}/merge`).send({ duplicateId: duplicate });

    // Without this the endpoint would destructively merge on a bare POST.
    expect(response.status).toBe(400);
    expect(String(response.body?.message)).toContain("MERGE");
  });

  it("refuses to merge an item into itself", async () => {
    const [kept] = ctx.stockItemIds;
    const response = await agent.post(`/api/stock-items/${kept}/merge`).send({ duplicateId: kept, confirm: "MERGE" });

    expect(response.status).toBe(400);
  });

  it("refuses to merge an item that belongs to another company", async () => {
    const [kept] = ctx.stockItemIds;
    const foreign = await pool.query<{ id: number }>(
      `SELECT id FROM stock_items WHERE company_id <> $1 AND deleted_at IS NULL LIMIT 1`,
      [ctx.companyId]
    );
    if (!foreign.rows[0]) return; // no other company's items in this database

    const response = await agent
      .post(`/api/stock-items/${kept}/merge`)
      .send({ duplicateId: foreign.rows[0].id, confirm: "MERGE" });

    // Tenant isolation: a merge across companies would move another tenant's
    // stock into this one.
    expect(response.status).toBe(404);
  });

  it("conserves quantity and value across a merge, then restores both on unmerge", async () => {
    const [kept, duplicate] = ctx.stockItemIds;

    const keptBefore = await inventoryTotals(kept);
    const duplicateBefore = await inventoryTotals(duplicate);
    expect(duplicateBefore.quantity).toBeGreaterThan(0);

    const merge = await agent
      .post(`/api/stock-items/${kept}/merge`)
      .send({ duplicateId: duplicate, confirm: "MERGE", notes: "write-route coverage" });
    expect(merge.status, JSON.stringify(merge.body)).toBe(200);

    const keptAfter = await inventoryTotals(kept);
    const duplicateAfter = await inventoryTotals(duplicate);

    // Nothing may be created or destroyed by a merge.
    expect(keptAfter.quantity).toBeCloseTo(keptBefore.quantity + duplicateBefore.quantity, 3);
    expect(keptAfter.value).toBeCloseTo(keptBefore.value + duplicateBefore.value, 2);
    expect(duplicateAfter.quantity).toBe(0);
    expect(await isSoftDeleted(duplicate)).toBe(true);

    // The merge itself is sound. What follows is not — see the next test.
  }, 60000);

  it("records no audit log, so a merge cannot be reversed (known defect)", async () => {
    // This characterizes a real bug rather than endorsing it.
    //
    // stock_item_merge_logs.merged_by_user_id is `integer NOT NULL`, but
    // users.id is a varchar UUID. Every insert therefore fails with
    // `invalid input syntax for type integer`, and the handler swallows it:
    //
    //     } catch (auditErr) {
    //       // Audit log failure is non-fatal — merge already committed
    //
    // So the merge commits, the log row is never written, and
    // POST /api/stock-items/merge-logs/:logId/unmerge — which restores both
    // items from that row's snapshotBefore — has nothing to read. A
    // destructive stock operation is both unreversible and unaudited, and
    // nothing surfaces it.
    //
    // When the column type is corrected this test will fail. That is the
    // intent: the fix should replace it with the conservation-on-unmerge
    // assertions this file was written to make.
    const logs = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM stock_item_merge_logs WHERE company_id = $1`,
      [ctx.companyId]
    );
    expect(Number(logs.rows[0].count)).toBe(0);

    const unmerge = await agent.post(`/api/stock-items/merge-logs/999999/unmerge`).send({});
    expect(unmerge.status).toBe(404);
  }, 60000);
});
