/**
 * PostgreSQL concurrency coverage for loading finalization.
 *
 * The finalize route locks the source LOADING order before calculating and
 * creating a continuation. This test sends both requests at the same time
 * and verifies that the second transaction cannot create a second follow-up
 * after the first transaction finalizes the source order.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pool } from "../server/db";
import { cleanupTestData, closeTestServer, seedTestData, type TestContext } from "./setup";

const TEST_PREFIX = "custload";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let customerId: number;
let proformaId: number;
let orderId: number;

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);

  const login = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (login.status !== 200) throw new Error(`Login failed: ${login.status} ${login.text}`);

  const company = await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
  if (company.status !== 200) throw new Error(`Set company failed: ${company.status} ${company.text}`);

  const customer = await pool.query<{ id: number }>(
    `INSERT INTO customers (company_id, code, legal_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [ctx.companyId, `${TEST_PREFIX}-CUSTOMER`, `${TEST_PREFIX} Customer`]
  );
  customerId = customer.rows[0].id;

  const proforma = await pool.query<{ id: number }>(
    `INSERT INTO customer_proformas (company_id, customer_id, name, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id`,
    [ctx.companyId, customerId, `${TEST_PREFIX} Proforma`]
  );
  proformaId = proforma.rows[0].id;

  await pool.query(
    `INSERT INTO customer_proforma_lines
       (proforma_id, article_code, product_name, quantity, price_per_bale)
     VALUES ($1, 'PARTIAL-A', 'Partial product', 3, '10.00')`,
    [proformaId]
  );

  const order = await pool.query<{ id: number }>(
    `INSERT INTO customer_orders
       (company_id, customer_id, order_date, proforma_id_used, status, location_id)
     VALUES ($1, $2, '2026-08-24', $3, 'LOADING', $4)
     RETURNING id`,
    [ctx.companyId, customerId, proformaId, ctx.locationId]
  );
  orderId = order.rows[0].id;

  const bale = await pool.query<{ id: number }>(
    `INSERT INTO factory_bales
       (company_id, bale_code, reference_number, article_code, product_name,
        weight_kg, cost_per_kg, total_cost, status)
     VALUES ($1, $2, $2, 'PARTIAL-A', 'Partial product', '30.000', '1.50', '45.00', 'RESERVED_FOR_ORDER')
     RETURNING id`,
    [ctx.companyId, `${TEST_PREFIX}-BALE`]
  );

  await pool.query(
    `INSERT INTO customer_order_bales
       (order_id, bale_id, bale_reference, location_id, weight, article_code, price_used)
     VALUES ($1, $2, $3, $4, '30.000', 'PARTIAL-A', '10.00')`,
    [orderId, bale.rows[0].id, `${TEST_PREFIX}-BALE`, ctx.locationId]
  );
}, 120000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("customer loading finalization concurrency", () => {
  it("creates exactly one continuation when two finalizations race", async () => {
    const responses = await Promise.all([
      agent.post(`/api/factory/customer-orders/${orderId}/finalize-loading`).send({ createContinuation: true }),
      agent.post(`/api/factory/customer-orders/${orderId}/finalize-loading`).send({ createContinuation: true }),
    ]);

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(1);

    const order = await pool.query<{ status: string; loading_finalized_at: Date | null }>(
      `SELECT status, loading_finalized_at
       FROM customer_orders
       WHERE id = $1 AND company_id = $2`,
      [orderId, ctx.companyId]
    );
    expect(order.rows).toEqual([{ status: "VERIFIED", loading_finalized_at: expect.anything() }]);

    const continuations = await pool.query<{ id: number; status: string }>(
      `SELECT id, status
       FROM customer_orders
       WHERE company_id = $1
         AND proforma_id_used = $2
         AND id <> $3
         AND deleted_at IS NULL`,
      [ctx.companyId, proformaId, orderId]
    );
    expect(continuations.rows).toEqual([{ id: expect.any(Number), status: "LOADING" }]);
  });
});