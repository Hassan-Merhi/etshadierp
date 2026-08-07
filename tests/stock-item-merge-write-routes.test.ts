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
 * and value onto the kept item without creating or destroying any, and
 * unmerging must put both back exactly as they were.
 *
 * Writing this surfaced a defect the endpoint had been hiding. The audit row it
 * needs to reverse a merge never persisted, because
 * stock_item_merge_logs.merged_by_user_id was `integer NOT NULL` while users.id
 * is a varchar UUID — so every insert threw and the handler swallowed it as
 * "non-fatal, merge already committed". Every merge was unaudited and
 * irreversible. Fixed in startup-schema/016; these tests are the regression
 * guard.
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

    const logs = await pool.query<{ id: number }>(
      `SELECT id FROM stock_item_merge_logs
       WHERE company_id = $1 AND kept_item_id = $2 AND merged_item_id = $3
       ORDER BY id DESC LIMIT 1`,
      [ctx.companyId, kept, duplicate]
    );
    const logId = logs.rows[0]?.id;
    // Without a log row the merge is irreversible, so this is part of the
    // contract rather than a detail. It is also the regression guard for the
    // defect this file first characterized: merged_by_user_id was `integer`
    // while users.id is a varchar UUID, so every insert here threw and the
    // handler swallowed it as "non-fatal, merge already committed".
    expect(logId, "merge must record a log row it can be reversed from").toBeTruthy();

    const unmerge = await agent.post(`/api/stock-items/merge-logs/${logId}/unmerge`).send({});
    expect(unmerge.status, JSON.stringify(unmerge.body)).toBe(200);

    const keptRestored = await inventoryTotals(kept);
    const duplicateRestored = await inventoryTotals(duplicate);

    // Unmerge must put both items back exactly as they were.
    expect(keptRestored.quantity).toBeCloseTo(keptBefore.quantity, 3);
    expect(keptRestored.value).toBeCloseTo(keptBefore.value, 2);
    expect(duplicateRestored.quantity).toBeCloseTo(duplicateBefore.quantity, 3);
    expect(duplicateRestored.value).toBeCloseTo(duplicateBefore.value, 2);
    expect(await isSoftDeleted(duplicate)).toBe(false);
  }, 60000);

  it("records who performed the merge", async () => {
    const [kept, , third] = ctx.stockItemIds;

    const merge = await agent
      .post(`/api/stock-items/${kept}/merge`)
      .send({ duplicateId: third, confirm: "MERGE", notes: "audit attribution" });
    expect(merge.status, JSON.stringify(merge.body)).toBe(200);

    const log = await pool.query<{ merged_by_user_id: string; notes: string | null }>(
      `SELECT merged_by_user_id, notes FROM stock_item_merge_logs
       WHERE company_id = $1 AND merged_item_id = $2 ORDER BY id DESC LIMIT 1`,
      [ctx.companyId, third]
    );

    // The whole point of the audit row: a destructive stock operation is
    // attributable. users.id is a varchar UUID, so this column has to be one
    // too — it was `integer`, which is what made every insert fail silently.
    expect(log.rows[0]?.merged_by_user_id).toBe(ctx.userId);
    expect(log.rows[0]?.notes).toBe("audit attribution");
  }, 60000);
});
