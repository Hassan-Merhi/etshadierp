/**
 * Canonical journal evidence for container offloads.
 *
 * An offload receives a container's stock into a location at the container's
 * weighted cost after charges. That is the largest single stock-in this system
 * performs, and it recorded nothing the reconciliation could read.
 *
 * The offload lifecycle is exercised directly rather than through the route
 * because the route only assembles the same input and calls this service; what
 * has to be proven is that the journal is written on the transaction that
 * applies the inventory.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { pool } from "../server/db";
import { executeContainerOffloadLifecycle } from "../server/services/containers/offload-lifecycle/execute";

const TEST_PREFIX = "canonoffl";

let ctx: TestContext;
let supplierId: number;

async function offloadJournalRows(companyId: number) {
  const { rows } = await pool.query(
    `SELECT quantity_delta, unit_cost, movement_kind, location_id, stock_item_id, source_id, idempotency_key
       FROM canonical_stock_movements
      WHERE company_id = $1 AND source_type = 'container-offload'
      ORDER BY id`,
    [companyId]
  );
  return rows;
}

async function createContainerWithPurchaseOrder(quantity: string, rate: string) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { rows: containerRows } = await pool.query(
    `INSERT INTO containers (company_id, container_number, supplier_id, status, import_date)
     VALUES ($1, $2, $3, 'OTW', CURRENT_DATE)
     RETURNING id`,
    [ctx.companyId, `CN-${suffix}`.slice(0, 30), supplierId]
  );
  const containerId = Number(containerRows[0].id);

  const { rows: poRows } = await pool.query(
    `INSERT INTO purchase_orders (company_id, po_number, container_id, supplier_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [ctx.companyId, `PO-${suffix}`.slice(0, 30), containerId, supplierId]
  );

  await pool.query(
    `INSERT INTO po_line_items (po_id, stock_item_id, item_name, quantity, rate, line_total)
     VALUES ($1, $2, 'offload line', $3, $4, $5)`,
    [Number(poRows[0].id), ctx.stockItemIds[0], quantity, rate, (Number(quantity) * Number(rate)).toFixed(2)]
  );

  return containerId;
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  const { rows } = await pool.query(
    `INSERT INTO suppliers (company_id, code, legal_name, email) VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      ctx.companyId,
      `${TEST_PREFIX}SUP`.slice(0, 20).toUpperCase(),
      `${TEST_PREFIX}_supplier`,
      `${TEST_PREFIX}@example.test`,
    ]
  );
  supplierId = Number(rows[0].id);
}, 60000);

afterAll(async () => {
  await pool.query(`DELETE FROM canonical_stock_movement_audit WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM canonical_stock_movement_requests WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM canonical_stock_movements WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM po_line_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE company_id = $1)`, [
    ctx.companyId,
  ]);
  await pool.query(`DELETE FROM purchase_orders WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(
    `DELETE FROM container_offload_items WHERE offload_id IN (
       SELECT id FROM container_offloads WHERE container_id IN (SELECT id FROM containers WHERE company_id = $1))`,
    [ctx.companyId]
  );
  await pool.query(
    `DELETE FROM container_offloads WHERE container_id IN (SELECT id FROM containers WHERE company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM containers WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM suppliers WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("canonical journal for container offloads", () => {
  it("records a receipt at the offload's stored cost", async () => {
    const containerId = await createContainerWithPurchaseOrder("10.000", "7.00");

    const result = await executeContainerOffloadLifecycle({
      containerId,
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      offloadDate: new Date().toISOString().split("T")[0],
      duties: "0",
      officeCharges: "0",
      transferCharges: "0",
      transportFees: "0",
      mode: "offload",
      userId: ctx.userId,
      username: `${TEST_PREFIX}_testuser`,
    } as Parameters<typeof executeContainerOffloadLifecycle>[0]);

    const offloadId = String(result.offload.id);
    const rows = (await offloadJournalRows(ctx.companyId)).filter((row) => row.source_id === offloadId);

    expect(rows).toHaveLength(1);
    expect(rows[0].movement_kind).toBe("receipt");
    expect(Number(rows[0].quantity_delta)).toBe(10);
    expect(Number(rows[0].location_id)).toBe(ctx.locationId);
    expect(Number(rows[0].stock_item_id)).toBe(ctx.stockItemIds[0]);

    // With no charges the weighted cost is the purchase rate, and the journal
    // records what the offload line stored rather than recomputing it.
    const { rows: offloadItems } = await pool.query(
      `SELECT quantity, rate FROM container_offload_items WHERE offload_id = $1`,
      [Number(result.offload.id)]
    );
    expect(Number(rows[0].unit_cost)).toBeCloseTo(Number(offloadItems[0].rate), 2);
    expect(Number(rows[0].quantity_delta)).toBeCloseTo(Number(offloadItems[0].quantity), 3);
  }, 60000);

  it("keeps each offload's evidence separate", async () => {
    const containerId = await createContainerWithPurchaseOrder("4.000", "3.00");

    const result = await executeContainerOffloadLifecycle({
      containerId,
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      offloadDate: new Date().toISOString().split("T")[0],
      duties: "0",
      officeCharges: "0",
      transferCharges: "0",
      transportFees: "0",
      mode: "offload",
      userId: ctx.userId,
      username: `${TEST_PREFIX}_testuser`,
    } as Parameters<typeof executeContainerOffloadLifecycle>[0]);

    const rows = (await offloadJournalRows(ctx.companyId)).filter((row) => row.source_id === String(result.offload.id));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity_delta)).toBe(4);

    // Every offload keys its own evidence, so one container's stock-in is never
    // mistaken for another's replay.
    const all = await offloadJournalRows(ctx.companyId);
    const keys = new Set(all.map((row) => row.idempotency_key));
    expect(keys.size).toBe(all.length);
  }, 60000);
});
