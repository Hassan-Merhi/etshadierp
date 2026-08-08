/**
 * Behavioural coverage for the three bale-pressing routes.
 *
 * All three were guard-only. They are the only place bales come into
 * existence, and each one draws reference numbers from a per-company counter
 * (`factory_bale_sequences`) that it advances by the quantity pressed. That
 * counter is the whole reason this cluster needs pinning: reference numbers are
 * unique per company, so anything that lets the counter go backwards or reissue
 * a number stops pressing working for that company until someone repairs it by
 * hand.
 *
 * What is pinned here:
 *
 *   - **Reference numbers never repeat and never rewind.** Two consecutive
 *     batches take disjoint blocks, and the counter after each batch equals the
 *     first number plus the quantity pressed.
 *   - **A negative or fractional quantity is rejected.** It used to be taken at
 *     face value: `nextNumber + quantity` with a negative quantity moved the
 *     counter *backwards*, and the next batch collided with bales already
 *     pressed. The loop never ran, so the request looked successful — an empty
 *     batch and a poisoned counter, with nothing to point at.
 *   - **Bales are born PENDING_PRESSING, not in stock.** A pressed bale is not
 *     sellable stock until pressing is finalized; created IN_STOCK it would be
 *     allocatable to an order before it physically exists.
 *   - **A product from another company is refused.** Pressing copies the
 *     product's code, article code and name onto every bale — that is what the
 *     label prints — so a foreign product would stamp another company's
 *     catalogue onto this company's stock.
 *   - **A bad product part-way through a multi-item batch rolls the whole thing
 *     back** — including the counter. A partial batch that kept the counter
 *     advanced would leave a gap and half a batch of orphan bales.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "prswr";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let productAId: number;
let productBId: number;
let productSeq = 0;

interface BaleRow {
  id: number;
  reference_number: string;
  status: string;
  weight_kg: string | null;
  product_id: number | null;
  bale_code: string | null;
  product_name: string | null;
}

async function createProduct(name: string, productionPrice: string): Promise<number> {
  productSeq += 1;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO factory_bale_products (company_id, code, article_code, name, production_price)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ctx.companyId, `${TEST_PREFIX}C${productSeq}`, `${TEST_PREFIX}A${productSeq}`, name, productionPrice]
  );
  return result.rows[0].id;
}

async function balesOfBatch(pressingBatchId: number): Promise<BaleRow[]> {
  const result = await pool.query<BaleRow>(
    `SELECT id, reference_number, status, weight_kg, product_id, bale_code, product_name
     FROM factory_bales WHERE pressing_batch_id = $1 ORDER BY reference_number`,
    [pressingBatchId]
  );
  return result.rows;
}

async function sequenceNumber(): Promise<number | null> {
  const result = await pool.query<{ next_number: number }>(
    `SELECT next_number FROM factory_bale_sequences WHERE company_id = $1`,
    [ctx.companyId]
  );
  return result.rows[0]?.next_number ?? null;
}

async function batchRow(id: number) {
  const result = await pool.query<{ id: number; product_id: number | null; expected_count: number; status: string }>(
    `SELECT id, product_id, expected_count, status FROM factory_pressing_batches WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function batchCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM factory_pressing_batches WHERE company_id = $1`,
    [ctx.companyId]
  );
  return Number(result.rows[0].count);
}

/** Each test starts from a known counter so it can assert exact numbers. */
async function resetPressing() {
  await pool.query(
    `DELETE FROM factory_bales WHERE company_id = $1 AND pressing_batch_id IS NOT NULL`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM factory_pressing_batches WHERE company_id = $1`, [ctx.companyId]);
  await pool.query(`DELETE FROM factory_bale_sequences WHERE company_id = $1`, [ctx.companyId]);
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

  productAId = await createProduct(`${TEST_PREFIX} Product A`, "12.50");
  productBId = await createProduct(`${TEST_PREFIX} Product B`, "7.25");
}, 120000);

beforeEach(async () => {
  await resetPressing();
});

afterAll(async () => {
  await resetPressing();
  await pool.query(`DELETE FROM factory_bale_products WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("POST /api/factory/pressing/create-and-print", () => {
  it("presses the requested bales and opens the counter at 200000", async () => {
    const response = await agent
      .post("/api/factory/pressing/create-and-print")
      .send({ productId: productAId, quantity: 3, weightPerBale: "45.5" });
    expect(response.status).toBe(200);

    const bales = await balesOfBatch(response.body.pressingBatchId);
    expect(bales.map((bale) => bale.reference_number)).toEqual(["REF200000", "REF200001", "REF200002"]);
    // The counter now points past the block just issued. Anything else and the
    // next batch either skips numbers or collides with these.
    expect(await sequenceNumber()).toBe(200003);

    // A pressed bale is not sellable stock until pressing is finalized.
    expect(bales.every((bale) => bale.status === "PENDING_PRESSING")).toBe(true);
    expect(Number(bales[0].weight_kg)).toBeCloseTo(45.5, 2);
    // The bale carries the product's identity, which is what the label prints.
    expect(bales[0].product_name).toBe(`${TEST_PREFIX} Product A`);
    expect(bales[0].bale_code).toBe(`${TEST_PREFIX}C1`);

    const batch = await batchRow(response.body.pressingBatchId);
    expect(batch?.expected_count).toBe(3);
    expect(batch?.status).toBe("PENDING");
  });

  it("gives consecutive batches disjoint reference blocks", async () => {
    const first = await agent
      .post("/api/factory/pressing/create-and-print")
      .send({ productId: productAId, quantity: 2, weightPerBale: "40" });
    const second = await agent
      .post("/api/factory/pressing/create-and-print")
      .send({ productId: productAId, quantity: 2, weightPerBale: "40" });

    const firstRefs = (await balesOfBatch(first.body.pressingBatchId)).map((bale) => bale.reference_number);
    const secondRefs = (await balesOfBatch(second.body.pressingBatchId)).map((bale) => bale.reference_number);

    expect(firstRefs).toEqual(["REF200000", "REF200001"]);
    expect(secondRefs).toEqual(["REF200002", "REF200003"]);
    expect(new Set([...firstRefs, ...secondRefs]).size).toBe(4);
  });

  it("rejects a negative or fractional quantity without touching the counter", async () => {
    await agent
      .post("/api/factory/pressing/create-and-print")
      .send({ productId: productAId, quantity: 2, weightPerBale: "40" });
    const before = await sequenceNumber();

    for (const quantity of [-5, 2.5]) {
      const response = await agent
        .post("/api/factory/pressing/create-and-print")
        .send({ productId: productAId, quantity, weightPerBale: "40" });
      expect(response.status).toBe(400);
    }

    // A negative quantity used to be taken at face value: the counter moved
    // backwards, the loop never ran, and the request still looked successful —
    // an empty batch and a counter that would collide on the next press.
    expect(await sequenceNumber()).toBe(before);
    expect(await batchCount()).toBe(1);
  });

  it("requires a product, a quantity and a weight", async () => {
    const bodies = [
      { quantity: 1, weightPerBale: "40" },
      { productId: productAId, weightPerBale: "40" },
      { productId: productAId, quantity: 1 },
    ];
    for (const body of bodies) {
      expect((await agent.post("/api/factory/pressing/create-and-print").send(body)).status).toBe(400);
    }
    expect(await batchCount()).toBe(0);
  });

  it("refuses a product belonging to another company", async () => {
    const foreign = await pool.query<{ id: number }>(
      `SELECT id FROM factory_bale_products WHERE company_id <> $1 ORDER BY id LIMIT 1`,
      [ctx.companyId]
    );
    if (foreign.rowCount === 0) return;

    const response = await agent
      .post("/api/factory/pressing/create-and-print")
      .send({ productId: foreign.rows[0].id, quantity: 1, weightPerBale: "40" });

    // Pressing stamps the product's code, name and price onto every bale, so a
    // foreign product would put another company's catalogue into this stock.
    expect(response.status).toBe(400);
    expect(await batchCount()).toBe(0);
  });

  it("records the pressing in the daybook", async () => {
    const response = await agent
      .post("/api/factory/pressing/create-and-print")
      .send({ productId: productAId, quantity: 2, weightPerBale: "40", txDate: "2026-05-20" });
    expect(response.status).toBe(200);

    const entry = await pool.query<{ description: string }>(
      `SELECT description FROM factory_daybook_entries
       WHERE company_id = $1 AND reference_table = 'factory_pressing_batches' AND reference_id = $2`,
      [ctx.companyId, response.body.pressingBatchId]
    );
    expect(entry.rowCount).toBe(1);
    expect(entry.rows[0].description).toContain("2 bales");
  });
});

describe("POST /api/factory/pressing/create-multi", () => {
  it("presses one contiguous block across several products", async () => {
    const response = await agent.post("/api/factory/pressing/create-multi").send({
      items: [
        { productId: productAId, quantity: 2, weightPerBale: "50" },
        { productId: productBId, quantity: 1, weightPerBale: "30" },
      ],
    });
    expect(response.status).toBe(200);

    const bales = await balesOfBatch(response.body.pressingBatchId);
    expect(bales.map((bale) => bale.reference_number)).toEqual(["REF200000", "REF200001", "REF200002"]);
    expect(bales.filter((bale) => bale.product_id === productAId)).toHaveLength(2);
    expect(bales.filter((bale) => bale.product_id === productBId)).toHaveLength(1);
    // Each bale carries its own product's weight and identity, not the batch's.
    const productBBale = bales.find((bale) => bale.product_id === productBId);
    expect(Number(productBBale?.weight_kg)).toBeCloseTo(30, 2);
    expect(productBBale?.product_name).toBe(`${TEST_PREFIX} Product B`);

    const batch = await batchRow(response.body.pressingBatchId);
    expect(batch?.expected_count).toBe(3);
    expect(await sequenceNumber()).toBe(200003);
  });

  it("rolls the whole batch back when one item names an unknown product", async () => {
    const foreign = await pool.query<{ id: number }>(
      `SELECT id FROM factory_bale_products WHERE company_id <> $1 ORDER BY id LIMIT 1`,
      [ctx.companyId]
    );
    const badProductId = foreign.rows[0]?.id ?? 99999999;

    const response = await agent.post("/api/factory/pressing/create-multi").send({
      items: [
        { productId: productAId, quantity: 2, weightPerBale: "50" },
        { productId: badProductId, quantity: 1, weightPerBale: "30" },
      ],
    });

    expect(response.status).toBe(400);
    // Nothing survives — not the batch, not the two good bales, and not the
    // counter. A partial batch that kept the counter advanced would leave a gap
    // and half a batch of orphans.
    expect(await batchCount()).toBe(0);
    expect(await sequenceNumber()).toBeNull();
  });

  it("rejects an item with a negative quantity before pressing anything", async () => {
    const response = await agent.post("/api/factory/pressing/create-multi").send({
      items: [
        { productId: productAId, quantity: 2, weightPerBale: "50" },
        { productId: productBId, quantity: -3, weightPerBale: "30" },
      ],
    });

    expect(response.status).toBe(400);
    expect(await batchCount()).toBe(0);
    expect(await sequenceNumber()).toBeNull();
  });

  it("rejects a missing or empty items array", async () => {
    expect((await agent.post("/api/factory/pressing/create-multi").send({})).status).toBe(400);
    expect((await agent.post("/api/factory/pressing/create-multi").send({ items: [] })).status).toBe(400);
  });
});

describe("POST /api/factory/bales/create-batch", () => {
  it("presses the batch and advances the counter", async () => {
    const response = await agent
      .post("/api/factory/bales/create-batch")
      .send({ productId: productAId, quantity: 2, weightPerBale: "38" });
    expect(response.status).toBe(200);

    const bales = await balesOfBatch(response.body.pressingBatchId);
    expect(bales.map((bale) => bale.reference_number)).toEqual(["REF200000", "REF200001"]);
    expect(bales.every((bale) => bale.status === "PENDING_PRESSING")).toBe(true);
    expect(await sequenceNumber()).toBe(200002);
  });

  it("draws from the same counter as the pressing routes", async () => {
    await agent
      .post("/api/factory/pressing/create-and-print")
      .send({ productId: productAId, quantity: 2, weightPerBale: "40" });

    const response = await agent
      .post("/api/factory/bales/create-batch")
      .send({ productId: productAId, quantity: 1, weightPerBale: "40" });

    // Three routes, one counter. If any of them kept its own, two bales would
    // end up sharing a reference number and the unique index would start
    // rejecting presses.
    const bales = await balesOfBatch(response.body.pressingBatchId);
    expect(bales.map((bale) => bale.reference_number)).toEqual(["REF200002"]);
  });

  it("rejects a negative quantity without touching the counter", async () => {
    const response = await agent
      .post("/api/factory/bales/create-batch")
      .send({ productId: productAId, quantity: -2, weightPerBale: "40" });

    expect(response.status).toBe(400);
    expect(await sequenceNumber()).toBeNull();
    expect(await batchCount()).toBe(0);
  });

  it("refuses a product belonging to another company", async () => {
    const foreign = await pool.query<{ id: number }>(
      `SELECT id FROM factory_bale_products WHERE company_id <> $1 ORDER BY id LIMIT 1`,
      [ctx.companyId]
    );
    if (foreign.rowCount === 0) return;

    const response = await agent
      .post("/api/factory/bales/create-batch")
      .send({ productId: foreign.rows[0].id, quantity: 1, weightPerBale: "40" });

    expect(response.status).toBe(400);
    expect(await batchCount()).toBe(0);
  });
});
