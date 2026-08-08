/**
 * Behavioural coverage for the factory supplier and bale import write routes.
 *
 * Both were guard-only. The bale import writes straight into `factory_bales` —
 * the stock ledger — and allocates the reference numbers those bales are known
 * by for the rest of their lives.
 *
 * Three properties carry the risk:
 *
 *   - **Cost follows weight, per row.** `total_cost = weight_kg × cost_per_kg`
 *     is computed at import. A spreadsheet with a bad multiplication would
 *     otherwise be trusted, and the error is invisible: each bale looks
 *     plausible on its own, and the stock total is simply wrong.
 *   - **Reference numbers never collide.** They are allocated from
 *     `MAX(existing) + 1` with a floor, and the sequence table is pushed
 *     forward afterwards so hand-entered stock cannot reuse an imported ref.
 *     Two bales sharing a reference cannot be told apart once they are on the
 *     floor.
 *   - **A bad row is skipped, not fatal.** Unlike the ERP bale import — which
 *     validates the whole array before writing anything — these accumulate
 *     per-row errors and import the rest. Both behaviours are deliberate and
 *     both are pinned, because the two endpoints look alike.
 *
 * The supplier import matches on name case-insensitively, so re-importing the
 * same sheet updates rather than duplicating. A duplicate supplier splits one
 * balance across two rows, and the net-position report then shows both.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "facimp";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let seq = 0;

async function supplierByName(name: string) {
  const result = await pool.query<{ id: number; opening_balance: string | null; phone: string | null }>(
    `SELECT id, opening_balance, phone FROM factory_suppliers WHERE company_id = $1 AND name = $2`,
    [ctx.companyId, name]
  );
  return result.rows;
}

async function baleByCode(baleCode: string) {
  const result = await pool.query<{
    id: number;
    reference_number: string;
    weight_kg: string;
    cost_per_kg: string;
    total_cost: string;
    status: string;
  }>(
    `SELECT id, reference_number, weight_kg, cost_per_kg, total_cost, status
     FROM factory_bales WHERE company_id = $1 AND bale_code = $2`,
    [ctx.companyId, baleCode]
  );
  return result.rows[0] ?? null;
}

function baleRow(code: string, overrides: Record<string, unknown> = {}) {
  return { baleCode: code, weightKg: "40.000", costPerKg: "2.50", ...overrides };
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
  await pool.query(`DELETE FROM factory_bale_import_batches WHERE company_id = $1`, [ctx.companyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("POST /api/factory/import/suppliers", () => {
  it("creates new suppliers and reports the count", async () => {
    seq += 1;
    const name = `${TEST_PREFIX} Supplier ${seq}`;

    const response = await agent
      .post("/api/factory/import/suppliers")
      .send({ suppliers: [{ name, openingBalance: "500.00", phone: "111" }] });

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(1);
    expect(response.body.updated).toBe(0);
    const rows = await supplierByName(name);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].opening_balance)).toBeCloseTo(500, 2);
  });

  it("updates an existing supplier rather than creating a second one", async () => {
    seq += 1;
    const name = `${TEST_PREFIX} Supplier ${seq}`;
    await agent.post("/api/factory/import/suppliers").send({ suppliers: [{ name, phone: "111" }] });

    const response = await agent
      .post("/api/factory/import/suppliers")
      .send({ suppliers: [{ name: name.toUpperCase(), phone: "222" }] });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(1);
    expect(response.body.imported).toBe(0);
    // Matching is case-insensitive on purpose: a duplicate supplier splits one
    // balance across two rows and the net-position report then shows both.
    const rows = await supplierByName(name);
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe("222");
  });

  it("reports a nameless row as an error and imports the rest", async () => {
    seq += 1;
    const name = `${TEST_PREFIX} Supplier ${seq}`;

    const response = await agent.post("/api/factory/import/suppliers").send({ suppliers: [{ name: "  " }, { name }] });

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(1);
    expect(response.body.errors).toHaveLength(1);
    expect(String(response.body.errors[0])).toContain("Row 1");
    expect(await supplierByName(name)).toHaveLength(1);
  });

  it("rejects an empty or missing supplier list", async () => {
    expect((await agent.post("/api/factory/import/suppliers").send({ suppliers: [] })).status).toBe(400);
    expect((await agent.post("/api/factory/import/suppliers").send({})).status).toBe(400);
  });
});

describe("POST /api/factory/import/bales", () => {
  it("computes each bale's total cost from its weight and rate", async () => {
    seq += 1;
    const code = `${TEST_PREFIX}-B${seq}`;

    const response = await agent
      .post("/api/factory/import/bales")
      .send({ fileName: "sheet.xlsx", bales: [baleRow(code, { weightKg: "40.000", costPerKg: "2.50" })] });

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(1);
    // 40 x 2.50 = 100. Trusting a total from the spreadsheet instead would make
    // a bad multiplication invisible: the bale looks plausible on its own and
    // only the stock total is wrong.
    const bale = await baleByCode(code);
    expect(Number(bale?.total_cost)).toBeCloseTo(100, 2);
    expect(Number(bale?.weight_kg)).toBeCloseTo(40, 3);
  });

  it("allocates a distinct reference number to every imported bale", async () => {
    seq += 1;
    const codes = [`${TEST_PREFIX}-R${seq}a`, `${TEST_PREFIX}-R${seq}b`, `${TEST_PREFIX}-R${seq}c`];

    const response = await agent
      .post("/api/factory/import/bales")
      .send({ fileName: "sheet.xlsx", bales: codes.map((c) => baleRow(c)) });

    expect(response.status).toBe(200);
    const refs = [];
    for (const code of codes) refs.push((await baleByCode(code))?.reference_number);
    // Two bales sharing a reference cannot be told apart once they are on the
    // floor, and nothing downstream would notice.
    expect(new Set(refs).size).toBe(codes.length);
    for (const ref of refs) expect(ref).toMatch(/^REF\d+$/);
  });

  it("does not reuse a reference across successive imports", async () => {
    seq += 1;
    const first = `${TEST_PREFIX}-S${seq}a`;
    const second = `${TEST_PREFIX}-S${seq}b`;

    await agent.post("/api/factory/import/bales").send({ fileName: "a.xlsx", bales: [baleRow(first)] });
    await agent.post("/api/factory/import/bales").send({ fileName: "b.xlsx", bales: [baleRow(second)] });

    const firstRef = (await baleByCode(first))?.reference_number;
    const secondRef = (await baleByCode(second))?.reference_number;
    expect(firstRef).not.toBe(secondRef);
  });

  it("pushes the bale sequence past the imported references", async () => {
    seq += 1;
    const code = `${TEST_PREFIX}-Q${seq}`;
    await agent.post("/api/factory/import/bales").send({ fileName: "a.xlsx", bales: [baleRow(code)] });

    const ref = Number((await baleByCode(code))?.reference_number.replace("REF", ""));
    const sequence = await pool.query<{ next_number: number }>(
      `SELECT next_number FROM factory_bale_sequences WHERE company_id = $1`,
      [ctx.companyId]
    );

    // Hand-entered stock draws from this table. If it were left behind the
    // imported refs, the next manual bale would collide with an imported one.
    expect(sequence.rowCount).toBe(1);
    expect(sequence.rows[0].next_number).toBeGreaterThan(ref);
  });

  it("skips a row with no code or no weight and imports the rest", async () => {
    seq += 1;
    const good = `${TEST_PREFIX}-P${seq}`;

    const response = await agent.post("/api/factory/import/bales").send({
      fileName: "sheet.xlsx",
      bales: [{ weightKg: "10" }, { baleCode: `${TEST_PREFIX}-noweight-${seq}` }, baleRow(good)],
    });

    expect(response.status).toBe(200);
    // Partial success is deliberate here, and the opposite of the ERP bale
    // import which validates the whole array before writing anything. Pinned on
    // both sides so the difference stays a decision rather than a discrepancy.
    expect(response.body.imported).toBe(1);
    expect(response.body.errors).toHaveLength(2);
    expect(await baleByCode(good)).not.toBeNull();
  });

  it("records the batch with its final counts and total weight", async () => {
    seq += 1;
    const codes = [`${TEST_PREFIX}-T${seq}a`, `${TEST_PREFIX}-T${seq}b`];

    const response = await agent.post("/api/factory/import/bales").send({
      fileName: "counts.xlsx",
      bales: [...codes.map((c) => baleRow(c, { weightKg: "25.000" })), { weightKg: "1" }],
    });

    expect(response.status).toBe(200);
    const batch = await pool.query<{ bale_count: number; error_count: number; total_weight_kg: string }>(
      `SELECT bale_count, error_count, total_weight_kg FROM factory_bale_import_batches WHERE id = $1`,
      [response.body.batchId]
    );
    // The batch row is what the import history shows; counts written before the
    // rows are processed would report a batch that never happened.
    expect(batch.rows[0].bale_count).toBe(2);
    expect(batch.rows[0].error_count).toBe(1);
    expect(Number(batch.rows[0].total_weight_kg)).toBeCloseTo(50, 3);
  });

  it("defaults an unspecified status to IN_STOCK", async () => {
    seq += 1;
    const code = `${TEST_PREFIX}-D${seq}`;

    await agent.post("/api/factory/import/bales").send({ fileName: "a.xlsx", bales: [baleRow(code)] });

    expect((await baleByCode(code))?.status).toBe("IN_STOCK");
  });

  it("rejects an empty or missing bale list", async () => {
    expect((await agent.post("/api/factory/import/bales").send({ bales: [] })).status).toBe(400);
    expect((await agent.post("/api/factory/import/bales").send({})).status).toBe(400);
  });
});
