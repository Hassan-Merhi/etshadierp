/**
 * Behavioural coverage for the ERP bale write routes in `server/routes/baleRoutes.ts`.
 *
 * These were guard-only. They cover bale CRUD, a bulk import, an Excel price
 * import, and the reference-number pool used for offline label printing.
 *
 * Four properties are worth holding:
 *
 *   - **Barcodes are unique per company.** A bale is identified by its barcode
 *     on the warehouse floor; two bales sharing one cannot be told apart after
 *     the fact, so the create path answers 409 rather than making a second.
 *   - **Cross-company writes are refused, not silently skipped.** These
 *     endpoints look the bale up first and compare `companyId`, so the failure
 *     mode to guard is a 200 that edited another tenant's row.
 *   - **The price import only prices your own bales.** `apply` takes bale ids
 *     straight from the request body and loops, skipping what it does not own.
 *     A missing ownership check there would let one company reprice another's
 *     stock, and the response would still say "updated".
 *   - **Allocated reference numbers never repeat.** `allocate-pool` hands out
 *     refs for labels printed offline, so a repeat means two physical bales
 *     printed with the same identity — undetectable once they are in a load.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "balewr";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let foreignCompanyId: number;
let seq = 0;

function baleBody(barcode: string, price?: string) {
  return {
    barcode,
    category: "Mixed",
    grade: "A",
    origin: "EU",
    weight: "45.000",
    datePressed: "2026-03-01",
    status: "AVAILABLE",
    ...(price === undefined ? {} : { price }),
  };
}

async function createBale(price?: string) {
  seq += 1;
  const barcode = `${TEST_PREFIX}-${seq}`;
  const response = await agent.post("/api/bales").send(baleBody(barcode, price));
  if (response.status !== 200) throw new Error(`Seed bale failed: ${response.status} ${response.text}`);
  return { id: response.body.id as number, barcode };
}

async function baleRow(id: number) {
  const result = await pool.query<{ id: number; company_id: number; price: string | null; grade: string }>(
    `SELECT id, company_id, price, grade FROM bales WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
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

  const company = await pool.query<{ id: number }>(
    `INSERT INTO companies (code, name, company_type, base_currency) VALUES ($1, $2, 'erp', 'USD') RETURNING id`,
    [`${TEST_PREFIX.slice(0, 4)}FG`, `${TEST_PREFIX}_Foreign`]
  );
  foreignCompanyId = company.rows[0].id;
}, 120000);

afterAll(async () => {
  await pool.query(`DELETE FROM bales WHERE company_id IN ($1, $2)`, [ctx.companyId, foreignCompanyId]);
  await pool.query(`DELETE FROM companies WHERE id = $1`, [foreignCompanyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

/** A bale owned by the other company, created directly. */
async function createForeignBale(price = "10.00") {
  seq += 1;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO bales (company_id, barcode, category, grade, origin, weight, date_pressed, price, status)
     VALUES ($1, $2, 'Mixed', 'A', 'EU', '45.000', '2026-03-01', $3, 'AVAILABLE') RETURNING id`,
    [foreignCompanyId, `${TEST_PREFIX}-FGN-${seq}`, price]
  );
  return result.rows[0].id;
}

describe("POST /api/bales", () => {
  it("files the bale under the session's company", async () => {
    const bale = await createBale();
    expect((await baleRow(bale.id))?.company_id).toBe(ctx.companyId);
  });

  it("refuses a barcode that already exists in the company", async () => {
    const bale = await createBale();

    const duplicate = await agent.post("/api/bales").send(baleBody(bale.barcode));

    // Two bales with one barcode cannot be told apart on the floor or in a scan.
    expect(duplicate.status).toBe(409);
    const rows = await pool.query(`SELECT id FROM bales WHERE company_id = $1 AND barcode = $2`, [
      ctx.companyId,
      bale.barcode,
    ]);
    expect(rows.rowCount).toBe(1);
  });

  it("rejects a bale missing required fields", async () => {
    const response = await agent.post("/api/bales").send({ barcode: `${TEST_PREFIX}-incomplete` });
    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/bales/:id", () => {
  it("updates a bale in the session's company", async () => {
    const bale = await createBale();

    const response = await agent.patch(`/api/bales/${bale.id}`).send({ grade: "B" });

    expect(response.status).toBe(200);
    expect((await baleRow(bale.id))?.grade).toBe("B");
  });

  it("refuses an edit whose body names a company the session cannot reach", async () => {
    const bale = await createBale();

    const response = await agent.patch(`/api/bales/${bale.id}`).send({ grade: "C", companyId: foreignCompanyId });

    // The handler also strips companyId from the update, so this would be
    // harmless — but the request never gets there. Both layers are pinned:
    // ownership cannot move, and the attempt does not even reach the write.
    expect(response.status).toBe(403);
    const row = await baleRow(bale.id);
    expect(row?.company_id).toBe(ctx.companyId);
    expect(row?.grade).toBe("A");
  });

  it("refuses to edit another company's bale", async () => {
    const foreignId = await createForeignBale();

    const response = await agent.patch(`/api/bales/${foreignId}`).send({ grade: "Z" });

    expect(response.status).toBe(403);
    expect((await baleRow(foreignId))?.grade).toBe("A");
  });

  it("returns 404 for a bale that does not exist", async () => {
    expect((await agent.patch("/api/bales/999999").send({ grade: "B" })).status).toBe(404);
  });
});

describe("DELETE /api/bales/:id", () => {
  it("deletes a bale in the session's company", async () => {
    const bale = await createBale();

    expect((await agent.delete(`/api/bales/${bale.id}`)).status).toBe(200);
    expect(await baleRow(bale.id)).toBeNull();
  });

  it("refuses to delete another company's bale", async () => {
    const foreignId = await createForeignBale();

    const response = await agent.delete(`/api/bales/${foreignId}`);

    expect(response.status).toBe(403);
    expect(await baleRow(foreignId)).not.toBeNull();
  });
});

describe("POST /api/bales/import", () => {
  it("creates every bale in the batch under the session's company", async () => {
    seq += 1;
    const barcodes = [`${TEST_PREFIX}-imp-${seq}-a`, `${TEST_PREFIX}-imp-${seq}-b`];

    const response = await agent.post("/api/bales/import").send({ bales: barcodes.map((b) => baleBody(b)) });

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
    const rows = await pool.query(`SELECT id FROM bales WHERE company_id = $1 AND barcode = ANY($2)`, [
      ctx.companyId,
      barcodes,
    ]);
    expect(rows.rowCount).toBe(2);
  });

  it("rejects the whole batch when one row is invalid", async () => {
    seq += 1;
    const good = `${TEST_PREFIX}-imp-partial-${seq}`;

    const response = await agent
      .post("/api/bales/import")
      .send({ bales: [baleBody(good), { barcode: `${TEST_PREFIX}-bad-${seq}` }] });

    // Validation runs over the whole array before anything is written, so a bad
    // row must not leave half an import behind.
    expect(response.status).toBe(400);
    const rows = await pool.query(`SELECT id FROM bales WHERE company_id = $1 AND barcode = $2`, [ctx.companyId, good]);
    expect(rows.rowCount).toBe(0);
  });

  it("rejects a payload that is not an array", async () => {
    expect((await agent.post("/api/bales/import").send({ bales: "not-an-array" })).status).toBe(400);
  });
});

describe("POST /api/bales/price-import/preview", () => {
  it("classifies each row without writing anything", async () => {
    const bale = await createBale("10.00");

    const response = await agent.post("/api/bales/price-import/preview").send({
      rows: [
        { barcode: bale.barcode, price: "12.50" },
        { barcode: bale.barcode, price: "10.00" },
        { barcode: `${TEST_PREFIX}-missing`, price: "5.00" },
        { barcode: bale.barcode, price: "abc" },
        { barcode: "", price: "1.00" },
      ],
    });

    expect(response.status).toBe(200);
    const statuses = response.body.preview.map((row: { status: string }) => row.status);
    expect(statuses).toEqual(["will_update", "no_change", "not_found", "invalid_price", "invalid"]);

    // Preview is a dry run — the stored price must be untouched.
    expect(Number((await baleRow(bale.id))?.price)).toBeCloseTo(10, 2);
  });

  it("rejects an empty row set", async () => {
    expect((await agent.post("/api/bales/price-import/preview").send({ rows: [] })).status).toBe(400);
  });
});

describe("POST /api/bales/price-import/apply", () => {
  it("applies the new prices and reports how many landed", async () => {
    const first = await createBale("10.00");
    const second = await createBale("20.00");

    const response = await agent.post("/api/bales/price-import/apply").send({
      rows: [
        { id: first.id, price: "11.25" },
        { id: second.id, price: "22.50" },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(2);
    expect(Number((await baleRow(first.id))?.price)).toBeCloseTo(11.25, 2);
    expect(Number((await baleRow(second.id))?.price)).toBeCloseTo(22.5, 2);
  });

  it("skips bales owned by another company and does not count them", async () => {
    const mine = await createBale("10.00");
    const foreignId = await createForeignBale("10.00");

    const response = await agent.post("/api/bales/price-import/apply").send({
      rows: [
        { id: mine.id, price: "15.00" },
        { id: foreignId, price: "999.00" },
      ],
    });

    expect(response.status).toBe(200);
    // The loop takes ids straight from the body; without the ownership check
    // this would reprice another tenant's stock and still report success.
    expect(response.body.updated).toBe(1);
    expect(Number((await baleRow(mine.id))?.price)).toBeCloseTo(15, 2);
    expect(Number((await baleRow(foreignId))?.price)).toBeCloseTo(10, 2);
  });

  it("skips negative and non-numeric prices", async () => {
    const bale = await createBale("10.00");

    const response = await agent.post("/api/bales/price-import/apply").send({
      rows: [
        { id: bale.id, price: "-5.00" },
        { id: bale.id, price: "abc" },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(0);
    expect(Number((await baleRow(bale.id))?.price)).toBeCloseTo(10, 2);
  });

  it("rejects an empty row set", async () => {
    expect((await agent.post("/api/bales/price-import/apply").send({ rows: [] })).status).toBe(400);
  });
});

describe("POST /api/bale-label-prints/allocate-pool", () => {
  it("hands out the requested number of distinct references", async () => {
    const response = await agent.post("/api/bale-label-prints/allocate-pool").send({ count: 5 });

    expect(response.status).toBe(200);
    expect(response.body.refs).toHaveLength(5);
    expect(new Set(response.body.refs).size).toBe(5);
  });

  it("never repeats a reference across successive allocations", async () => {
    const first = await agent.post("/api/bale-label-prints/allocate-pool").send({ count: 4 });
    const second = await agent.post("/api/bale-label-prints/allocate-pool").send({ count: 4 });

    const all = [...first.body.refs, ...second.body.refs];
    // These are printed onto physical labels offline. A repeat means two bales
    // carrying the same identity, which nothing downstream can untangle.
    expect(new Set(all).size).toBe(all.length);
  });

  it("clamps the requested count into a sane range", async () => {
    const tooMany = await agent.post("/api/bale-label-prints/allocate-pool").send({ count: 5000 });
    expect(tooMany.body.refs).toHaveLength(500);

    const tooFew = await agent.post("/api/bale-label-prints/allocate-pool").send({ count: 0 });
    expect(tooFew.body.refs).toHaveLength(200);
  });
});
