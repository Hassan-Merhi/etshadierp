/**
 * Direct-ID company isolation regression coverage.
 *
 * These requests deliberately use database-assigned IDs from a second company.
 * A route that only checks that an ID exists (instead of scoping the lookup to
 * the active company) would therefore fail this suite.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pool } from "../server/db";
import { cleanupTestData, closeTestServer, seedTestData, type TestContext } from "./setup";

const TEST_PREFIX = "idiso";
const FOREIGN_COMPANY_CODE = `${TEST_PREFIX}_FOREIGN`;

let ctx: TestContext;
let agent: request.SuperAgentTest;
let foreignCompanyId: number;
let supplierId: number;
let foreignSupplierId: number;
let containerId: number;
let foreignContainerId: number;
let purchaseOrderId: number;
let foreignPurchaseOrderId: number;
let customerId: number;
let foreignCustomerId: number;
let foreignLedgerAccountId: number;
let mixBatchId: number;
let foreignMixBatchId: number;

async function insertIds() {
  const company = await pool.query<{ id: number }>(
    `INSERT INTO companies (code, name, company_type, base_currency)
     VALUES ($1, $2, 'erp', 'USD') RETURNING id`,
    [FOREIGN_COMPANY_CODE, "Foreign isolation company"],
  );
  foreignCompanyId = company.rows[0].id;

  const supplier = await pool.query<{ id: number }>(
    `INSERT INTO suppliers (company_id, code, legal_name, email)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [ctx.companyId, `${TEST_PREFIX}-A-SUP`, `${TEST_PREFIX} A Supplier`, `${TEST_PREFIX}-a@example.test`],
  );
  supplierId = supplier.rows[0].id;
  const foreignSupplier = await pool.query<{ id: number }>(
    `INSERT INTO suppliers (company_id, code, legal_name, email)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [foreignCompanyId, `${TEST_PREFIX}-B-SUP`, `${TEST_PREFIX} B Supplier`, `${TEST_PREFIX}-b@example.test`],
  );
  foreignSupplierId = foreignSupplier.rows[0].id;

  const containers = await pool.query<{ id: number }>(
    `INSERT INTO containers
       (company_id, container_number, supplier_id, status, import_date, items_total, charges_total, grand_total)
     VALUES
       ($1, $2, $4, 'OTW', '2026-08-01', '100.00', '0.00', '100.00'),
       ($3, $5, $6, 'OTW', '2026-08-01', '200.00', '0.00', '200.00')
     RETURNING id`,
    [
      ctx.companyId,
      `${TEST_PREFIX}-A-CONT`,
      foreignCompanyId,
      supplierId,
      `${TEST_PREFIX}-B-CONT`,
      foreignSupplierId,
    ],
  );
  containerId = containers.rows[0].id;
  foreignContainerId = containers.rows[1].id;

  const pos = await pool.query<{ id: number }>(
    `INSERT INTO purchase_orders
       (company_id, po_number, container_id, supplier_id, currency, items_total)
     VALUES
       ($1, $2, $3, $5, 'USD', '100.00'),
       ($4, $6, $7, $8, 'USD', '200.00')
     RETURNING id`,
    [
      ctx.companyId,
      `${TEST_PREFIX}-A-PO`,
      containerId,
      foreignCompanyId,
      supplierId,
      `${TEST_PREFIX}-B-PO`,
      foreignContainerId,
      foreignSupplierId,
    ],
  );
  purchaseOrderId = pos.rows[0].id;
  foreignPurchaseOrderId = pos.rows[1].id;

  const customers = await pool.query<{ id: number }>(
    `INSERT INTO customers (company_id, code, legal_name)
     VALUES ($1, $2, $3), ($4, $5, $6) RETURNING id`,
    [
      ctx.companyId,
      `${TEST_PREFIX}-A-CUST`,
      `${TEST_PREFIX} A Customer`,
      foreignCompanyId,
      `${TEST_PREFIX}-B-CUST`,
      `${TEST_PREFIX} B Customer`,
    ],
  );
  customerId = customers.rows[0].id;
  foreignCustomerId = customers.rows[1].id;

  const foreignAccount = await pool.query<{ id: number }>(
    `INSERT INTO ledger_accounts
       (company_id, code, name, account_type, sub_type, opening_balance, opening_balance_side)
     VALUES ($1, $2, $3, 'Cash', 'Cash', '0', 'Dr') RETURNING id`,
    [foreignCompanyId, `${TEST_PREFIX}-B-LEDGER`, `${TEST_PREFIX} B Ledger`],
  );
  foreignLedgerAccountId = foreignAccount.rows[0].id;

  const batches = await pool.query<{ id: number }>(
    `INSERT INTO mix_batches
       (company_id, batch_code, total_weight_kg, used_kg, cost_per_kg, total_cost, status)
     VALUES
       ($1, $2, '100.000', '0', '2.0000', '200.00', 'ACTIVE'),
       ($3, $4, '200.000', '0', '3.0000', '600.00', 'ACTIVE')
     RETURNING id`,
    [ctx.companyId, `${TEST_PREFIX}-A-MIX`, foreignCompanyId, `${TEST_PREFIX}-B-MIX`],
  );
  mixBatchId = batches.rows[0].id;
  foreignMixBatchId = batches.rows[1].id;
}

async function removeStaleForeignFixture() {
  const companies = await pool.query<{ id: number }>(
    "SELECT id FROM companies WHERE code = $1",
    [FOREIGN_COMPANY_CODE],
  );
  for (const company of companies.rows) {
    await pool.query("DELETE FROM mix_batches WHERE company_id = $1", [company.id]);
    await pool.query("DELETE FROM customers WHERE company_id = $1", [company.id]);
    await pool.query("DELETE FROM purchase_orders WHERE company_id = $1", [company.id]);
    await pool.query("DELETE FROM containers WHERE company_id = $1", [company.id]);
    await pool.query("DELETE FROM ledger_accounts WHERE company_id = $1", [company.id]);
    await pool.query("DELETE FROM suppliers WHERE company_id = $1", [company.id]);
    await pool.query("DELETE FROM companies WHERE id = $1", [company.id]);
  }
}

async function removeStaleContainerRows() {
  await pool.query(
    `DELETE FROM mix_batches
     WHERE company_id IN (SELECT id FROM companies WHERE name LIKE $1)`,
    [`%${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM purchase_orders
     WHERE company_id IN (SELECT id FROM companies WHERE name LIKE $1)`,
    [`%${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM containers
     WHERE company_id IN (SELECT id FROM companies WHERE name LIKE $1)`,
    [`%${TEST_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM suppliers
     WHERE company_id IN (SELECT id FROM companies WHERE name LIKE $1)`,
    [`%${TEST_PREFIX}%`],
  );
}

beforeAll(async () => {
  await removeStaleContainerRows();
  await removeStaleForeignFixture();
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  const login = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  expect(login.status).toBe(200);
  const selected = await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
  expect(selected.status).toBe(200);
  await insertIds();
}, 60000);

afterAll(async () => {
  if (foreignCompanyId) {
    await pool.query("DELETE FROM mix_batches WHERE company_id = $1", [foreignCompanyId]);
    await pool.query("DELETE FROM customers WHERE company_id = $1", [foreignCompanyId]);
    await pool.query("DELETE FROM purchase_orders WHERE company_id = $1", [foreignCompanyId]);
    await pool.query("DELETE FROM containers WHERE company_id = $1", [foreignCompanyId]);
    await pool.query("DELETE FROM ledger_accounts WHERE company_id = $1", [foreignCompanyId]);
    await pool.query("DELETE FROM suppliers WHERE company_id = $1", [foreignCompanyId]);
    await pool.query("DELETE FROM companies WHERE id = $1", [foreignCompanyId]);
  }
  if (ctx) {
    await pool.query("DELETE FROM mix_batches WHERE company_id = $1", [ctx.companyId]);
    await pool.query("DELETE FROM purchase_orders WHERE company_id = $1", [ctx.companyId]);
    await pool.query("DELETE FROM containers WHERE company_id = $1", [ctx.companyId]);
    await pool.query("DELETE FROM suppliers WHERE company_id = $1", [ctx.companyId]);
  }
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("container direct-ID reads", () => {
  it("allows same-company detail, export, and costing preview", async () => {
    expect((await agent.get(`/api/containers/${containerId}`)).status).toBe(200);
    expect((await agent.get(`/api/containers/${containerId}/export`)).status).toBe(200);
    const costing = await agent
      .post(`/api/containers/${containerId}/price-import/preview`)
      .send({ rows: [{ barcode: "missing", price: "1.00" }] });
    expect(costing.status).toBe(200);
  });

  it("denies foreign container detail, export, and costing preview", async () => {
    expect((await agent.get(`/api/containers/${foreignContainerId}`)).status).toBe(404);
    expect((await agent.get(`/api/containers/${foreignContainerId}/export`)).status).toBe(404);
    const costing = await agent
      .post(`/api/containers/${foreignContainerId}/price-import/preview`)
      .send({ rows: [{ barcode: "missing", price: "1.00" }] });
    expect(costing.status).toBe(404);
  });
});

describe("purchase order, ledger, customer, and factory direct-ID reads", () => {
  it("allows same-company purchase order, ledger, customer, and mix-batch reads", async () => {
    expect((await agent.get(`/api/purchase-orders/${purchaseOrderId}`)).status).toBe(200);
    expect((await agent.get(`/api/ledger-accounts/${ctx.cashAccountId}`)).status).toBe(200);
    expect((await agent.get(`/api/customers/${customerId}`)).status).toBe(200);
    expect((await agent.get(`/api/mix-batches/${mixBatchId}`)).status).toBe(200);
  });

  it("denies foreign purchase order, ledger, customer, and mix-batch IDs", async () => {
    expect((await agent.get(`/api/purchase-orders/${foreignPurchaseOrderId}`)).status).toBe(403);
    expect((await agent.get(`/api/ledger-accounts/${foreignLedgerAccountId}`)).status).toBe(404);
    expect((await agent.get(`/api/customers/${foreignCustomerId}`)).status).toBe(404);
    expect((await agent.get(`/api/mix-batches/${foreignMixBatchId}`)).status).toBe(404);
  });
});

describe("cross-company mutation isolation", () => {
  it("rejects container PATCH and DELETE without changing the foreign container", async () => {
    const before = await pool.query(
      "SELECT container_number, status, grand_total FROM containers WHERE id = $1",
      [foreignContainerId],
    );

    const patch = await agent
      .patch(`/api/containers/${foreignContainerId}/number`)
      .send({ containerNumber: `${TEST_PREFIX}-B-CHANGED` });
    expect([403, 404]).toContain(patch.status);

    const del = await agent.delete(`/api/containers/${foreignContainerId}`);
    expect([403, 404]).toContain(del.status);

    const after = await pool.query(
      "SELECT container_number, status, grand_total FROM containers WHERE id = $1",
      [foreignContainerId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("rejects container creation carrying a foreign company claim", async () => {
    const response = await agent.post("/api/containers").send({
      companyId: foreignCompanyId,
      containerNumber: `${TEST_PREFIX}-SHOULD-NOT-CREATE`,
      supplierId,
      status: "OTW",
      importDate: "2026-08-02",
    });
    expect(response.status).toBe(403);
    const created = await pool.query(
      "SELECT id FROM containers WHERE container_number = $1",
      [`${TEST_PREFIX}-SHOULD-NOT-CREATE`],
    );
    expect(created.rows).toHaveLength(0);
  });

  it("rejects container creation carrying a foreign supplier ID", async () => {
    const response = await agent.post("/api/containers").send({
      containerNumber: `${TEST_PREFIX}-FOREIGN-SUPPLIER`,
      supplierId: foreignSupplierId,
      status: "OTW",
      importDate: "2026-08-02",
    });
    expect(response.status).toBe(403);
    const created = await pool.query(
      "SELECT id FROM containers WHERE container_number = $1",
      [`${TEST_PREFIX}-FOREIGN-SUPPLIER`],
    );
    expect(created.rows).toHaveLength(0);
  });

  it("rejects purchase-order PATCH and DELETE without changing the foreign PO", async () => {
    const before = await pool.query(
      "SELECT po_number, items_total, currency, status FROM purchase_orders WHERE id = $1",
      [foreignPurchaseOrderId],
    );

    const patch = await agent
      .patch(`/api/purchase-orders/${foreignPurchaseOrderId}`)
      .send({ poNumber: `${TEST_PREFIX}-B-CHANGED`, itemsTotal: "999.00" });
    expect([403, 404]).toContain(patch.status);

    const del = await agent.delete(`/api/purchase-orders/${foreignPurchaseOrderId}`);
    expect([403, 404]).toContain(del.status);

    const after = await pool.query(
      "SELECT po_number, items_total, currency, status FROM purchase_orders WHERE id = $1",
      [foreignPurchaseOrderId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("rejects foreign freight ledger IDs before changing the local PO or voucher", async () => {
    const before = await pool.query(
      `SELECT po_number, freight, freight_paid_by, freight_own_account_id, freight_parent_account_id
       FROM purchase_orders WHERE id = $1`,
      [purchaseOrderId],
    );
    const voucherBefore = await pool.query(
      `SELECT v.total_amount, ve.ledger_account_id, ve.debit_amount, ve.credit_amount
       FROM vouchers v
       LEFT JOIN voucher_entries ve ON ve.voucher_id = v.id
       WHERE v.id = (SELECT voucher_id FROM purchase_orders WHERE id = $1)
       ORDER BY ve.id`,
      [purchaseOrderId],
    );

    const response = await agent.patch(`/api/purchase-orders/${purchaseOrderId}`).send({
      freight: "10.00",
      freightPaidBy: "own",
      freightOwnAccountId: foreignLedgerAccountId,
    });
    expect(response.status).toBe(400);

    const after = await pool.query(
      `SELECT po_number, freight, freight_paid_by, freight_own_account_id, freight_parent_account_id
       FROM purchase_orders WHERE id = $1`,
      [purchaseOrderId],
    );
    const voucherAfter = await pool.query(
      `SELECT v.total_amount, ve.ledger_account_id, ve.debit_amount, ve.credit_amount
       FROM vouchers v
       LEFT JOIN voucher_entries ve ON ve.voucher_id = v.id
       WHERE v.id = (SELECT voucher_id FROM purchase_orders WHERE id = $1)
       ORDER BY ve.id`,
      [purchaseOrderId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(voucherAfter.rows).toEqual(voucherBefore.rows);
  });

  it("rejects ledger-account POST, PUT, and DELETE across companies", async () => {
    const before = await pool.query(
      "SELECT code, name, opening_balance FROM ledger_accounts WHERE id = $1",
      [foreignLedgerAccountId],
    );

    const post = await agent.post("/api/ledger-accounts").send({
      companyId: foreignCompanyId,
      code: `${TEST_PREFIX}-NEW-FOREIGN`,
      name: `${TEST_PREFIX} New Foreign`,
      accountType: "Cash",
      subType: "Cash",
      openingBalance: "0",
      openingBalanceSide: "Dr",
    });
    expect(post.status).toBe(403);

    const put = await agent
      .put(`/api/ledger-accounts/${foreignLedgerAccountId}`)
      .send({ name: `${TEST_PREFIX} Changed Foreign` });
    expect([403, 404]).toContain(put.status);

    const del = await agent.delete(`/api/ledger-accounts/${foreignLedgerAccountId}`);
    expect([403, 404]).toContain(del.status);

    const after = await pool.query(
      "SELECT code, name, opening_balance FROM ledger_accounts WHERE id = $1",
      [foreignLedgerAccountId],
    );
    expect(after.rows).toEqual(before.rows);
    const created = await pool.query(
      "SELECT id FROM ledger_accounts WHERE code = $1",
      [`${TEST_PREFIX}-NEW-FOREIGN`],
    );
    expect(created.rows).toHaveLength(0);
  });

  it("rejects customer POST, PUT, and DELETE across companies", async () => {
    const before = await pool.query(
      "SELECT code, legal_name, active FROM customers WHERE id = $1",
      [foreignCustomerId],
    );

    const post = await agent.post("/api/customers").send({
      companyId: foreignCompanyId,
      legalName: `${TEST_PREFIX} New Foreign`,
    });
    expect(post.status).toBe(403);

    const put = await agent
      .put(`/api/customers/${foreignCustomerId}`)
      .send({ legalName: `${TEST_PREFIX} Changed Foreign` });
    expect([403, 404]).toContain(put.status);

    const del = await agent.delete(`/api/customers/${foreignCustomerId}`);
    expect([403, 404]).toContain(del.status);

    const after = await pool.query(
      "SELECT code, legal_name, active FROM customers WHERE id = $1",
      [foreignCustomerId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("rejects customer creation with a foreign linked ledger before creating a customer", async () => {
    const legalName = `${TEST_PREFIX} Foreign Ledger Customer`;
    const localBefore = await pool.query(
      "SELECT code, legal_name, ledger_account_id FROM customers WHERE id = $1",
      [customerId],
    );
    const response = await agent.post("/api/customers").send({
      legalName,
      ledgerAccountId: foreignLedgerAccountId,
    });
    expect(response.status).toBe(400);

    const created = await pool.query(
      "SELECT id, company_id, ledger_account_id FROM customers WHERE legal_name = $1",
      [legalName],
    );
    expect(created.rows).toHaveLength(0);
    const localAfter = await pool.query(
      "SELECT code, legal_name, ledger_account_id FROM customers WHERE id = $1",
      [customerId],
    );
    expect(localAfter.rows).toEqual(localBefore.rows);
  });

  it("rejects factory mix-batch POSTs that claim or source another company", async () => {
    const before = await pool.query(
      "SELECT batch_code, total_weight_kg, used_kg, status FROM mix_batches WHERE id = $1",
      [foreignMixBatchId],
    );

    const claimed = await agent.post("/api/mix-batches").send({
      companyId: foreignCompanyId,
      sources: [{ containerId: containerId, weightKg: 1, costPerKg: 2 }],
      name: `${TEST_PREFIX} Claimed Foreign`,
    });
    expect(claimed.status).toBe(403);

    const foreignSource = await agent.post("/api/mix-batches").send({
      batchSources: [{ sourceBatchId: foreignMixBatchId, weightKg: 1 }],
      name: `${TEST_PREFIX} Cross Company Source`,
    });
    expect(foreignSource.status).toBe(400);

    const after = await pool.query(
      "SELECT batch_code, total_weight_kg, used_kg, status FROM mix_batches WHERE id = $1",
      [foreignMixBatchId],
    );
    expect(after.rows).toEqual(before.rows);
  });
});