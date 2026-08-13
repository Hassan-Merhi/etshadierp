/**
 * End-to-end proof that the canonical stock movement journal is written by the
 * live transfer path and that convergence reconciliation reads it.
 *
 * Phase 4 shipped the reconciler, the evidence loaders and the movement
 * boundary without any of them being reachable: no route or service called
 * them, and the table they query was created by a migration no wired runner
 * executes. These tests exercise the real API endpoint and then read the
 * journal directly, so the wiring cannot silently stop working.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db, pool } from "../server/db";
import { loadDatabaseStockTransferDocuments } from "../server/services/inventory/databaseStockTransferConvergenceAdapter";
import { loadDatabaseCanonicalStockTransferEvidence } from "../server/services/inventory/databaseCanonicalStockTransferEvidence";
import { mergeStockTransferConvergenceEvidence } from "../server/services/inventory/databaseStockTransferConvergenceAdapter";

const TEST_PREFIX = "canonjrnl";

let ctx: TestContext;
let agent: request.SuperAgentTest;

async function journalRows(companyId: number) {
  const { rows } = await pool.query(
    `SELECT company_id, stock_item_id, location_id, quantity_delta, unit_cost, movement_kind,
            source_type, source_id, idempotency_key
       FROM canonical_stock_movements
      WHERE company_id = $1
      ORDER BY id`,
    [companyId]
  );
  return rows;
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
  // The journal holds a restricting foreign key to companies, so its rows go
  // before the fixture company they belong to.
  await pool.query(`DELETE FROM canonical_stock_movement_audit WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM canonical_stock_movement_requests WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM canonical_stock_movements WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("canonical stock transfer journal", () => {
  it("records balanced issue and receipt evidence for a posted transfer", async () => {
    const before = await journalRows(ctx.companyId);

    const res = await agent.post("/api/stock-transfers").send({
      sourceLocationId: ctx.locationId,
      destinationLocationId: ctx.location2Id,
      items: [
        {
          stockItemId: ctx.stockItemIds[0],
          quantity: 4,
          rate: "2.50",
          sourceLocationId: ctx.locationId,
        },
      ],
      notes: "canonical journal transfer",
      voucherDate: new Date().toISOString().split("T")[0],
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const after = await journalRows(ctx.companyId);
    const written = after.slice(before.length);

    // One transfer leg is two rows: stock leaves the source and arrives at the
    // destination, equal and opposite, at the same unit cost.
    expect(written).toHaveLength(2);
    const issue = written.find((row) => Number(row.quantity_delta) < 0);
    const receipt = written.find((row) => Number(row.quantity_delta) > 0);
    expect(issue).toBeDefined();
    expect(receipt).toBeDefined();
    expect(Number(issue!.quantity_delta)).toBe(-4);
    expect(Number(receipt!.quantity_delta)).toBe(4);
    expect(Number(issue!.location_id)).toBe(ctx.locationId);
    expect(Number(receipt!.location_id)).toBe(ctx.location2Id);
    expect(Number(issue!.unit_cost)).toBe(Number(receipt!.unit_cost));
    expect(issue!.movement_kind).toBe("transfer");
    expect(issue!.source_type).toBe("stock-transfer");
    expect(issue!.source_id).toBe(receipt!.source_id);
    expect(Number(issue!.company_id)).toBe(ctx.companyId);
  });

  it("reconciles the transfer document against its canonical evidence", async () => {
    const documents = await db.transaction(async (tx) =>
      loadDatabaseStockTransferDocuments({ tx, companyId: ctx.companyId })
    );
    expect(documents.length).toBeGreaterThan(0);

    const evidence = await db.transaction(async (tx) =>
      loadDatabaseCanonicalStockTransferEvidence({ tx, companyId: ctx.companyId, documents })
    );

    const snapshots = mergeStockTransferConvergenceEvidence({
      companyId: ctx.companyId,
      documents,
      evidence,
    });

    // Every applied transfer document has evidence, and the quantity and value
    // the document claims are what the journal recorded.
    for (const snapshot of snapshots) {
      expect(snapshot.companyId).toBe(ctx.companyId);
      expect(Number(snapshot.movementQuantity)).toBeCloseTo(Number(snapshot.documentQuantity), 6);
      expect(Number(snapshot.movementValue)).toBeCloseTo(Number(snapshot.documentValue), 6);
    }
  });

  it("does not double-post when the same transfer leg is replayed", async () => {
    const before = await journalRows(ctx.companyId);

    // Replaying the same source identity must return the first attempt's
    // movements rather than appending a second pair.
    const { postStockMovementTx } = await import("../server/services/inventory/stockMovementIntegrityService");
    const { createDatabaseStockMovementAdapter } =
      await import("../server/services/inventory/databaseStockMovementAdapter");
    const adapter = createDatabaseStockMovementAdapter();

    const request = {
      companyId: ctx.companyId,
      stockItemId: ctx.stockItemIds[0],
      kind: "transfer" as const,
      quantity: "3.000",
      unitCost: "1.500000",
      fromLocationId: ctx.locationId,
      toLocationId: ctx.location2Id,
      occurredAt: new Date().toISOString(),
      source: {
        sourceType: "stock-transfer",
        sourceId: "replay-probe",
        idempotencyKey: `stock-transfer:replay-probe:${ctx.stockItemIds[0]}`,
      },
      allowNegativeStock: true,
    };

    const first = await db.transaction(async (tx) => postStockMovementTx(tx, request, adapter));
    expect(first.idempotent).toBe(false);

    const replay = await db.transaction(async (tx) => postStockMovementTx(tx, request, adapter));
    expect(replay.idempotent).toBe(true);
    expect(replay.quantity).toBe(first.quantity);
    expect(replay.value).toBe(first.value);

    const after = await journalRows(ctx.companyId);
    expect(after).toHaveLength(before.length + 2);
  });

  it("records a receipt for a production adjustment posted through the API", async () => {
    const before = await journalRows(ctx.companyId);

    // The adjustment endpoint posts against an existing voucher, so the
    // document is created first exactly as the application does.
    const { rows: voucherRows } = await pool.query(
      `INSERT INTO vouchers (company_id, voucher_type, voucher_number, voucher_date, description, total_amount, optional)
       VALUES ($1, 'Stock Adjustment', $2, CURRENT_DATE, 'canonical journal adjustment', '0', false)
       RETURNING id`,
      [ctx.companyId, `ADJ-CANON-${Date.now()}`]
    );

    const res = await agent.post("/api/stock-adjustments").send({
      voucherId: Number(voucherRows[0].id),
      locationId: ctx.locationId,
      adjustmentType: "Production",
      notes: "canonical journal adjustment",
      items: [{ stockItemId: ctx.stockItemIds[0], quantity: "6", rate: "3.00" }],
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const written = (await journalRows(ctx.companyId)).slice(before.length);

    // Production adds stock at one location, so it is a single receipt row —
    // not the balanced pair a transfer writes.
    expect(written).toHaveLength(1);
    expect(written[0].movement_kind).toBe("receipt");
    expect(written[0].source_type).toBe("stock-adjustment");
    expect(Number(written[0].quantity_delta)).toBe(6);
    expect(Number(written[0].location_id)).toBe(ctx.locationId);
    expect(Number(written[0].unit_cost)).toBe(3);
  });
});
