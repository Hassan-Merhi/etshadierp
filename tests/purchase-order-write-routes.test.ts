/**
 * Behavioural coverage for PATCH/DELETE /api/purchase-orders/:id.
 *
 * These routes change container landed-cost totals and can also remove the
 * purchase order's accounting artifacts.  The guard sweep only proved that an
 * unauthenticated caller is rejected; this suite pins what the routes actually
 * write.
 */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../server/db";
import { cleanupTestData, closeTestServer, seedTestData, type TestContext } from "./setup";

const TEST_PREFIX = "powr";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let supplierId: number;
let sequence = 0;

function nextCode(label: string): string {
  sequence += 1;
  return `${TEST_PREFIX}-${label}-${sequence}`;
}

async function createContainer(options?: {
  companyId?: number;
  itemsTotal?: string;
  chargesTotal?: string;
  grandTotal?: string;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO containers
       (company_id, container_number, supplier_id, status, import_date, items_total, charges_total, grand_total)
     VALUES ($1, $2, $3, 'OTW', '2026-06-01', $4, $5, $6)
     RETURNING id`,
    [
      options?.companyId ?? ctx.companyId,
      nextCode("CNT"),
      supplierId,
      options?.itemsTotal ?? "0",
      options?.chargesTotal ?? "0",
      options?.grandTotal ?? "0",
    ]
  );
  return result.rows[0].id;
}

async function createPurchaseOrder(options: {
  containerId: number;
  companyId?: number;
  itemsTotal: string;
  freight?: string;
  surcharge?: string;
  fumigation?: string;
  documentCharges?: string;
  discount?: string;
  otherCharges?: string;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO purchase_orders
       (company_id, po_number, container_id, supplier_id, currency, items_total,
        freight, surcharge, fumigation, document_charges, discount, other_charges, status)
     VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, $8, $9, $10, $11, 'Open')
     RETURNING id`,
    [
      options.companyId ?? ctx.companyId,
      nextCode("PO"),
      options.containerId,
      supplierId,
      options.itemsTotal,
      options.freight ?? "0",
      options.surcharge ?? "0",
      options.fumigation ?? "0",
      options.documentCharges ?? "0",
      options.discount ?? "0",
      options.otherCharges ?? "0",
    ]
  );
  return result.rows[0].id;
}

async function addLineItem(poId: number, lineTotal: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO po_line_items (po_id, stock_item_id, item_name, quantity, rate, line_total)
     VALUES ($1, $2, $3, '1', $4, $4)
     RETURNING id`,
    [poId, ctx.stockItemIds[0], `${TEST_PREFIX} item`, lineTotal]
  );
  return result.rows[0].id;
}

async function clearPurchaseOrderFixtures(): Promise<void> {
  await pool.query(
    `DELETE FROM po_line_items WHERE po_id IN
       (SELECT id FROM purchase_orders WHERE po_number LIKE $1)`,
    [`${TEST_PREFIX}-%`]
  );
  await pool.query(`DELETE FROM purchase_orders WHERE po_number LIKE $1`, [`${TEST_PREFIX}-%`]);
  await pool.query(
    `DELETE FROM container_charges WHERE container_id IN
       (SELECT id FROM containers WHERE container_number LIKE $1)`,
    [`${TEST_PREFIX}-%`]
  );
  await pool.query(
    `DELETE FROM import_logs WHERE container_id IN
       (SELECT id FROM containers WHERE container_number LIKE $1)`,
    [`${TEST_PREFIX}-%`]
  );
  await pool.query(`DELETE FROM containers WHERE container_number LIKE $1`, [`${TEST_PREFIX}-%`]);
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

  const supplier = await pool.query<{ id: number }>(
    `INSERT INTO suppliers (code, legal_name, email, active)
     VALUES ($1, $2, $3, true)
     RETURNING id`,
    [nextCode("SUP"), `${TEST_PREFIX} Supplier`, `${TEST_PREFIX}@example.test`]
  );
  supplierId = supplier.rows[0].id;
}, 120000);

beforeEach(async () => {
  await clearPurchaseOrderFixtures();
});

afterAll(async () => {
  await clearPurchaseOrderFixtures();
  await pool.query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("PATCH /api/purchase-orders/:id", () => {
  it("recalculates the container from every PO charge component", async () => {
    const containerId = await createContainer({ itemsTotal: "100", chargesTotal: "15", grandTotal: "115" });
    const poId = await createPurchaseOrder({
      containerId,
      itemsTotal: "100",
      freight: "10",
      surcharge: "2",
      fumigation: "1",
      documentCharges: "1",
      discount: "1",
      otherCharges: "2",
    });

    const response = await agent.patch(`/api/purchase-orders/${poId}`).send({
      itemsTotal: "100",
      freight: "12",
      surcharge: "8",
      fumigation: "4",
      documentCharges: "3",
      discount: "2",
      otherCharges: "5",
    });

    expect(response.status).toBe(200);

    const po = await pool.query<{
      freight: string;
      surcharge: string;
      fumigation: string;
      document_charges: string;
      discount: string;
      other_charges: string;
      charges_edited: boolean;
    }>(
      `SELECT freight, surcharge, fumigation, document_charges, discount, other_charges, charges_edited
       FROM purchase_orders WHERE id = $1`,
      [poId]
    );
    expect(Number(po.rows[0].freight)).toBeCloseTo(12, 2);
    expect(Number(po.rows[0].surcharge)).toBeCloseTo(8, 2);
    expect(Number(po.rows[0].fumigation)).toBeCloseTo(4, 2);
    expect(Number(po.rows[0].document_charges)).toBeCloseTo(3, 2);
    expect(Number(po.rows[0].discount)).toBeCloseTo(2, 2);
    expect(Number(po.rows[0].other_charges)).toBeCloseTo(5, 2);
    expect(po.rows[0].charges_edited).toBe(true);

    const container = await pool.query<{ items_total: string; charges_total: string; grand_total: string }>(
      `SELECT items_total, charges_total, grand_total FROM containers WHERE id = $1`,
      [containerId]
    );
    // 12 + 8 + 4 + 3 - 2 + 5 = 30.
    expect(Number(container.rows[0].items_total)).toBeCloseTo(100, 2);
    expect(Number(container.rows[0].charges_total)).toBeCloseTo(30, 2);
    expect(Number(container.rows[0].grand_total)).toBeCloseTo(130, 2);

    const charges = await pool.query<{ charge_type: string; amount: string }>(
      `SELECT charge_type, amount FROM container_charges WHERE container_id = $1`,
      [containerId]
    );
    const byType = new Map(charges.rows.map((row) => [row.charge_type, Number(row.amount)]));
    expect(byType.get("Freight")).toBeCloseTo(12, 2);
    expect(byType.get("Surcharge")).toBeCloseTo(8, 2);
    expect(byType.get("Fumigation")).toBeCloseTo(4, 2);
    expect(byType.get("Document Charges")).toBeCloseTo(3, 2);
    expect(byType.get("Discount")).toBeCloseTo(-2, 2);
    expect(byType.get("Other Charges")).toBeCloseTo(5, 2);
  });
});

describe("DELETE /api/purchase-orders/:id", () => {
  it("removes exactly that PO's items and full net charges from a shared container", async () => {
    const containerId = await createContainer({ itemsTotal: "300", chargesTotal: "28", grandTotal: "328" });
    const deleteId = await createPurchaseOrder({
      containerId,
      itemsTotal: "100",
      freight: "10",
      surcharge: "5",
      fumigation: "3",
      documentCharges: "2",
      discount: "6",
      otherCharges: "4",
    });
    const keepId = await createPurchaseOrder({
      containerId,
      itemsTotal: "200",
      freight: "7",
      surcharge: "1",
      otherCharges: "2",
    });
    const deletedLineId = await addLineItem(deleteId, "100");
    await addLineItem(keepId, "200");

    const response = await agent.delete(`/api/purchase-orders/${deleteId}`);
    expect(response.status).toBe(200);

    expect((await pool.query(`SELECT id FROM purchase_orders WHERE id = $1`, [deleteId])).rowCount).toBe(0);
    expect((await pool.query(`SELECT id FROM po_line_items WHERE id = $1`, [deletedLineId])).rowCount).toBe(0);
    expect((await pool.query(`SELECT id FROM purchase_orders WHERE id = $1`, [keepId])).rowCount).toBe(1);

    const container = await pool.query<{ items_total: string; charges_total: string; grand_total: string }>(
      `SELECT items_total, charges_total, grand_total FROM containers WHERE id = $1`,
      [containerId]
    );
    // Deleted PO net charges: 10 + 5 + 3 + 2 - 6 + 4 = 18.
    // The sibling PO leaves 200 of items and 10 of charges.
    expect(Number(container.rows[0].items_total)).toBeCloseTo(200, 2);
    expect(Number(container.rows[0].charges_total)).toBeCloseTo(10, 2);
    expect(Number(container.rows[0].grand_total)).toBeCloseTo(210, 2);
  });

  it("deletes the container and its dependent charge/import rows when the last PO is removed", async () => {
    const containerId = await createContainer({ itemsTotal: "50", chargesTotal: "4", grandTotal: "54" });
    const poId = await createPurchaseOrder({ containerId, itemsTotal: "50", freight: "4" });
    await addLineItem(poId, "50");
    await pool.query(`INSERT INTO container_charges (container_id, charge_type, amount) VALUES ($1, 'Freight', '4')`, [
      containerId,
    ]);
    await pool.query(
      `INSERT INTO import_logs (file_name, file_hash, row_count, container_id, status)
       VALUES ($1, $2, 1, $3, 'completed')`,
      [`${TEST_PREFIX}.xlsx`, nextCode("HASH"), containerId]
    );

    const response = await agent.delete(`/api/purchase-orders/${poId}`);
    expect(response.status).toBe(200);

    expect((await pool.query(`SELECT id FROM purchase_orders WHERE id = $1`, [poId])).rowCount).toBe(0);
    expect((await pool.query(`SELECT id FROM containers WHERE id = $1`, [containerId])).rowCount).toBe(0);
    expect((await pool.query(`SELECT id FROM container_charges WHERE container_id = $1`, [containerId])).rowCount).toBe(
      0
    );
    expect((await pool.query(`SELECT id FROM import_logs WHERE container_id = $1`, [containerId])).rowCount).toBe(0);
  });

  it("refuses to delete a purchase order owned by another company", async () => {
    const foreign = await pool.query<{ id: number }>(
      `INSERT INTO companies (code, name, company_type, base_currency)
       VALUES ($1, $2, 'erp', 'USD') RETURNING id`,
      [nextCode("CO"), `${TEST_PREFIX} Foreign Company`]
    );
    const foreignCompanyId = foreign.rows[0].id;
    const containerId = await createContainer({ companyId: foreignCompanyId, itemsTotal: "25", grandTotal: "25" });
    const poId = await createPurchaseOrder({ containerId, companyId: foreignCompanyId, itemsTotal: "25" });

    const response = await agent.delete(`/api/purchase-orders/${poId}`);
    expect(response.status).toBe(403);
    expect((await pool.query(`SELECT id FROM purchase_orders WHERE id = $1`, [poId])).rowCount).toBe(1);

    await pool.query(`DELETE FROM purchase_orders WHERE id = $1`, [poId]);
    await pool.query(`DELETE FROM containers WHERE id = $1`, [containerId]);
    await pool.query(`DELETE FROM companies WHERE id = $1`, [foreignCompanyId]);
  });
});
