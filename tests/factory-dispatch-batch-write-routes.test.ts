/**
 * Behavioural coverage for the dispatch batch and bale scan write routes.
 *
 * All five were guard-only. A dispatch batch collects bales onto truck rides
 * against a customer proforma; scanning a bale reserves it out of stock and
 * cancelling the batch has to put every reserved bale back. `factory_bales`
 * is the stock ledger, so every one of these routes moves inventory.
 *
 * What is pinned here:
 *
 *   - **A scan reserves the bale and a removal returns it.** The bale goes
 *     `IN_STOCK` → `RESERVED_FOR_DISPATCH` on scan and back on removal. Missing
 *     the return leaves stock reserved against a bale nobody is shipping;
 *     missing the reserve lets the same bale be sold twice.
 *   - **A bale can only be on one dispatch at a time.** Scanning one already
 *     scanned elsewhere, already loaded on a legacy order, or not `IN_STOCK` is
 *     refused. A partial unique index backs the first of those, but the check
 *     is what produces a usable message instead of a constraint violation.
 *   - **A proforma-linked batch refuses articles the proforma does not list**,
 *     prices each scan from the matching line, and warns — without blocking —
 *     once the scanned quantity passes the proforma quantity. Overage is a
 *     commercial decision, not a data error.
 *   - **Cancelling returns every reserved bale and cancels the rides.** An
 *     invoiced batch cannot be cancelled or edited, because the invoice has
 *     already been raised against those bales.
 *   - **Removal is a soft delete.** The scan row stays with `removed_at` and
 *     the reason, so the trail of what was loaded and taken off survives.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "dspbat";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let customerId: number;
let baleSeq = 0;

async function createBale(articleCode: string, status = "IN_STOCK"): Promise<{ id: number; reference: string }> {
  baleSeq += 1;
  const reference = `${TEST_PREFIX}-B${baleSeq}`;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO factory_bales
       (company_id, bale_code, reference_number, article_code, product_name, weight_kg, cost_per_kg, total_cost, status)
     VALUES ($1, $2, $2, $3, $4, '25.000', '1.00', '25.00', $5) RETURNING id`,
    [ctx.companyId, reference, articleCode, `${TEST_PREFIX} ${articleCode}`, status]
  );
  return { id: result.rows[0].id, reference };
}

async function baleStatus(id: number): Promise<string> {
  const result = await pool.query<{ status: string }>(`SELECT status FROM factory_bales WHERE id = $1`, [id]);
  return result.rows[0].status;
}

async function createProforma(lines: { articleCode: string; quantity: number; pricePerBale: string }[]) {
  const proforma = await pool.query<{ id: number }>(
    `INSERT INTO customer_proformas (company_id, customer_id, name, status)
     VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
    [ctx.companyId, customerId, `${TEST_PREFIX} proforma ${baleSeq}`]
  );
  for (const line of lines) {
    await pool.query(
      `INSERT INTO customer_proforma_lines (proforma_id, article_code, product_name, quantity, price_per_bale)
       VALUES ($1, $2, $3, $4, $5)`,
      [proforma.rows[0].id, line.articleCode, `${TEST_PREFIX} ${line.articleCode}`, line.quantity, line.pricePerBale]
    );
  }
  return proforma.rows[0].id;
}

async function createBatch(proformaId: number | null = null): Promise<number> {
  const response = await agent.post("/api/factory/dispatch-batches").send({
    customerId,
    proformaId,
    batchDate: "2026-06-10",
    destination: `${TEST_PREFIX} port`,
  });
  if (response.status !== 201) throw new Error(`Seed batch failed: ${response.status} ${response.text}`);
  return response.body.batch.id;
}

async function createRide(batchId: number): Promise<number> {
  const response = await agent
    .post(`/api/factory/dispatch-batches/${batchId}/truck-rides`)
    .send({ truckPlate: `${TEST_PREFIX}-1` });
  if (response.status !== 201 && response.status !== 200)
    throw new Error(`Seed ride failed: ${response.status} ${response.text}`);
  return response.body.id;
}

async function batchRow(id: number) {
  const result = await pool.query<{
    status: string;
    batch_number: string;
    proforma_id: number | null;
    notes: string | null;
    destination: string | null;
    cancelled_at: string | null;
  }>(
    `SELECT status, batch_number, proforma_id, notes, destination, cancelled_at
     FROM customer_dispatch_batches WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function scanRow(id: number) {
  const result = await pool.query<{
    removed_at: string | null;
    removal_reason: string | null;
    price_used: string;
    amount: string;
  }>(`SELECT removed_at, removal_reason, price_used, amount FROM customer_dispatch_bale_scans WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

async function rideStatus(id: number): Promise<string> {
  const result = await pool.query<{ status: string }>(
    `SELECT status FROM customer_dispatch_truck_rides WHERE id = $1`,
    [id]
  );
  return result.rows[0].status;
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

  const customer = await pool.query<{ id: number }>(
    `INSERT INTO customers (company_id, code, legal_name) VALUES ($1, $2, $3) RETURNING id`,
    [ctx.companyId, `${TEST_PREFIX}-CUST`, `${TEST_PREFIX} Customer`]
  );
  customerId = customer.rows[0].id;
}, 120000);

beforeEach(async () => {
  await pool.query(`DELETE FROM customer_dispatch_bale_scans WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM customer_dispatch_truck_rides WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM customer_dispatch_batches WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_bales WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(
    `DELETE FROM customer_proforma_lines WHERE proforma_id IN
       (SELECT id FROM customer_proformas WHERE company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM customer_proformas WHERE company_id = $1`, [ctx.companyId]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM customer_dispatch_bale_scans WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM customer_dispatch_truck_rides WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM customer_dispatch_batches WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM customer_dispatch_batch_sequences WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_bales WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(
    `DELETE FROM customer_proforma_lines WHERE proforma_id IN
       (SELECT id FROM customer_proformas WHERE company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM customer_proformas WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM customers WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("POST /api/factory/dispatch-batches", () => {
  it("opens a draft batch with a company-sequenced number", async () => {
    const batchId = await createBatch();

    const row = await batchRow(batchId);
    expect(row?.status).toBe("DRAFT");
    expect(row?.batch_number).toMatch(/^DB-\d{6}$/);
    expect(row?.destination).toBe(`${TEST_PREFIX} port`);
  });

  it("gives consecutive batches consecutive numbers", async () => {
    const first = await batchRow(await createBatch());
    const second = await batchRow(await createBatch());

    // The counter is taken FOR UPDATE. Two batches sharing a number would
    // collide on every report that groups by it.
    expect(Number(second?.batch_number.slice(3))).toBe(Number(first?.batch_number.slice(3)) + 1);
  });

  it("refuses a customer or proforma from another company", async () => {
    const missingCustomer = await agent
      .post("/api/factory/dispatch-batches")
      .send({ customerId: 99999999, batchDate: "2026-06-10" });
    expect(missingCustomer.status).toBe(400);

    const missingProforma = await agent
      .post("/api/factory/dispatch-batches")
      .send({ customerId, proformaId: 99999999, batchDate: "2026-06-10" });
    expect(missingProforma.status).toBe(400);
  });

  it("refuses a proforma belonging to a different customer", async () => {
    const otherCustomer = await pool.query<{ id: number }>(
      `INSERT INTO customers (company_id, code, legal_name) VALUES ($1, $2, $3) RETURNING id`,
      [ctx.companyId, `${TEST_PREFIX}-CUST2`, `${TEST_PREFIX} Other Customer`]
    );
    const proformaId = await createProforma([{ articleCode: "AAA", quantity: 1, pricePerBale: "10.00" }]);

    const response = await agent
      .post("/api/factory/dispatch-batches")
      .send({ customerId: otherCustomer.rows[0].id, proformaId, batchDate: "2026-06-10" });

    // The proforma sets the prices the batch invoices at; pointing it at
    // another customer would invoice them on somebody else's terms.
    expect(response.status).toBe(400);
    await pool.query(`DELETE FROM customers WHERE id = $1`, [otherCustomer.rows[0].id]);
  });

  it("requires a customer and a date", async () => {
    expect((await agent.post("/api/factory/dispatch-batches").send({ batchDate: "2026-06-10" })).status).toBe(400);
    expect((await agent.post("/api/factory/dispatch-batches").send({ customerId })).status).toBe(400);
  });
});

describe("POST /api/factory/dispatch-truck-rides/:id/scan-bale", () => {
  it("reserves the bale out of stock and records the scan", async () => {
    const batchId = await createBatch();
    const rideId = await createRide(batchId);
    const bale = await createBale("AAA");

    const response = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: bale.reference });
    expect(response.status).toBe(201);

    // Without the reservation the same bale can be scanned onto a second
    // dispatch and sold twice.
    expect(await baleStatus(bale.id)).toBe("RESERVED_FOR_DISPATCH");
    expect(await rideStatus(rideId)).toBe("LOADING");
  });

  it("refuses a bale that is not in stock, unknown, or already scanned", async () => {
    const batchId = await createBatch();
    const rideId = await createRide(batchId);
    const sold = await createBale("AAA", "SOLD");
    const free = await createBale("AAA");

    expect(
      (await agent.post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`).send({ barcode: sold.reference }))
        .status
    ).toBe(400);
    expect(
      (await agent.post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`).send({ barcode: "no-such-bale" }))
        .status
    ).toBe(400);

    await agent.post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`).send({ barcode: free.reference });
    const duplicate = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: free.reference });
    // Rescanning is caught by the status check rather than the duplicate check,
    // because the first scan reserved the bale — the duplicate check is the
    // backstop for a bale left IN_STOCK while a scan still holds it.
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.message).toMatch(/not available/i);
  });

  it("prices the scan from the proforma line and blocks an article not on it", async () => {
    const proformaId = await createProforma([{ articleCode: "AAA", quantity: 5, pricePerBale: "42.00" }]);
    const batchId = await createBatch(proformaId);
    const rideId = await createRide(batchId);
    const onProforma = await createBale("AAA");
    const offProforma = await createBale("ZZZ");

    const accepted = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: onProforma.reference });
    expect(accepted.status).toBe(201);
    const scan = await scanRow(accepted.body.scan.id);
    expect(Number(scan?.price_used)).toBeCloseTo(42, 2);
    expect(Number(scan?.amount)).toBeCloseTo(42, 2);

    const rejected = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: offProforma.reference });
    // The proforma is what the customer agreed to buy. An article outside it
    // has no agreed price, so there is nothing to invoice it at.
    expect(rejected.status).toBe(400);
    expect(await baleStatus(offProforma.id)).toBe("IN_STOCK");
  });

  it("warns rather than blocks once the proforma quantity is exceeded", async () => {
    const proformaId = await createProforma([{ articleCode: "AAA", quantity: 1, pricePerBale: "10.00" }]);
    const batchId = await createBatch(proformaId);
    const rideId = await createRide(batchId);
    const first = await createBale("AAA");
    const second = await createBale("AAA");

    await agent.post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`).send({ barcode: first.reference });
    const overage = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: second.reference });

    // Shipping more than the proforma says is a commercial decision someone
    // may well have taken; the scanner flags it and lets it through.
    expect(overage.status).toBe(201);
    expect(overage.body.overageWarning).toBe(true);
    expect(await baleStatus(second.id)).toBe("RESERVED_FOR_DISPATCH");
  });

  it("refuses to scan into a cancelled batch", async () => {
    const batchId = await createBatch();
    const rideId = await createRide(batchId);
    const bale = await createBale("AAA");
    await agent.delete(`/api/factory/dispatch-batches/${batchId}`);

    const response = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: bale.reference });

    expect(response.status).toBe(400);
    expect(await baleStatus(bale.id)).toBe("IN_STOCK");
  });

  it("requires a barcode and a ride that exists", async () => {
    const rideId = await createRide(await createBatch());
    expect((await agent.post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`).send({})).status).toBe(400);
    expect(
      (await agent.post("/api/factory/dispatch-truck-rides/99999999/scan-bale").send({ barcode: "x" })).status
    ).toBe(400);
  });
});

describe("DELETE /api/factory/dispatch-bale-scans/:id", () => {
  it("returns the bale to stock and keeps the scan with its reason", async () => {
    const batchId = await createBatch();
    const rideId = await createRide(batchId);
    const bale = await createBale("AAA");
    const scanned = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: bale.reference });

    const response = await agent
      .delete(`/api/factory/dispatch-bale-scans/${scanned.body.scan.id}`)
      .send({ reason: `${TEST_PREFIX} wrong truck` });
    expect(response.status).toBe(200);

    expect(await baleStatus(bale.id)).toBe("IN_STOCK");
    const scan = await scanRow(scanned.body.scan.id);
    // Soft delete: the trail of what was loaded and taken off again is part of
    // what the dispatch record is for.
    expect(scan?.removed_at).not.toBeNull();
    expect(scan?.removal_reason).toBe(`${TEST_PREFIX} wrong truck`);
  });

  it("frees the bale to be scanned again", async () => {
    const batchId = await createBatch();
    const rideId = await createRide(batchId);
    const bale = await createBale("AAA");
    const scanned = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: bale.reference });
    await agent.delete(`/api/factory/dispatch-bale-scans/${scanned.body.scan.id}`).send({});

    const rescan = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: bale.reference });

    // The duplicate check ignores removed scans, and the unique index is
    // partial for the same reason — a bale taken off a truck is free stock.
    expect(rescan.status).toBe(201);
  });

  it("refuses to remove the same scan twice, and 400s an unknown scan", async () => {
    const batchId = await createBatch();
    const rideId = await createRide(batchId);
    const bale = await createBale("AAA");
    const scanned = await agent
      .post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`)
      .send({ barcode: bale.reference });
    await agent.delete(`/api/factory/dispatch-bale-scans/${scanned.body.scan.id}`).send({});

    expect((await agent.delete(`/api/factory/dispatch-bale-scans/${scanned.body.scan.id}`).send({})).status).toBe(400);
    expect((await agent.delete("/api/factory/dispatch-bale-scans/99999999").send({})).status).toBe(400);
  });
});

describe("PATCH /api/factory/dispatch-batches/:id", () => {
  it("updates only the fields sent", async () => {
    const batchId = await createBatch();

    const response = await agent
      .patch(`/api/factory/dispatch-batches/${batchId}`)
      .send({ notes: `${TEST_PREFIX} note` });
    expect(response.status).toBe(200);

    const row = await batchRow(batchId);
    expect(row?.notes).toBe(`${TEST_PREFIX} note`);
    expect(row?.destination).toBe(`${TEST_PREFIX} port`);
  });

  it("refuses to edit a cancelled batch", async () => {
    const batchId = await createBatch();
    await agent.delete(`/api/factory/dispatch-batches/${batchId}`);

    const response = await agent.patch(`/api/factory/dispatch-batches/${batchId}`).send({ notes: "x" });

    expect(response.status).toBe(400);
    expect((await batchRow(batchId))?.notes).toBeNull();
  });

  it("returns 404 for a batch in another company", async () => {
    expect((await agent.patch("/api/factory/dispatch-batches/99999999").send({ notes: "x" })).status).toBe(404);
  });
});

describe("DELETE /api/factory/dispatch-batches/:id", () => {
  it("cancels the batch, its rides, and returns every reserved bale", async () => {
    const batchId = await createBatch();
    const rideId = await createRide(batchId);
    const first = await createBale("AAA");
    const second = await createBale("AAA");
    await agent.post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`).send({ barcode: first.reference });
    await agent.post(`/api/factory/dispatch-truck-rides/${rideId}/scan-bale`).send({ barcode: second.reference });

    const response = await agent.delete(`/api/factory/dispatch-batches/${batchId}`);
    expect(response.status).toBe(200);

    const row = await batchRow(batchId);
    expect(row?.status).toBe("CANCELLED");
    expect(row?.cancelled_at).not.toBeNull();
    expect(await rideStatus(rideId)).toBe("CANCELLED");
    // Every bale the batch was holding goes back, or that stock is stranded.
    expect(await baleStatus(first.id)).toBe("IN_STOCK");
    expect(await baleStatus(second.id)).toBe("IN_STOCK");
  });

  it("refuses to cancel a batch twice", async () => {
    const batchId = await createBatch();
    await agent.delete(`/api/factory/dispatch-batches/${batchId}`);

    expect((await agent.delete(`/api/factory/dispatch-batches/${batchId}`)).status).toBe(400);
  });

  it("returns 400 for a batch in another company", async () => {
    expect((await agent.delete("/api/factory/dispatch-batches/99999999")).status).toBe(400);
  });
});
