/**
 * Behavioural coverage for the factory bale-product bulk write routes.
 *
 * All six were guard-only. A bale product is the catalogue entry every bale,
 * pressing batch and POS sale line points at, and it carries the selling and
 * production prices stock is valued from.
 *
 * The heavy one is `POST .../merge`. It reassigns every referencing row in
 * `factory_bales`, `factory_pressing_batches` and `factory_pos_sale_items` to
 * the target product, rewrites the article code and product name inlined on
 * those rows, and then deactivates the sources. The property that has to hold
 * is that nothing is left pointing at a product that has just been retired —
 * an orphaned bale keeps the old name on every document it appears on, and
 * re-merging cannot find it because its `product_id` no longer matches a
 * source.
 *
 * The rest are guarded on the two ways a bulk endpoint goes wrong: it takes ids
 * straight from the request body, so it must skip rows belonging to another
 * company without counting them, and it must reject a malformed batch outright
 * rather than applying the half it understood.
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { pool } from "../server/db";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "prodblk";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let foreignCompanyId: number;
let seq = 0;

interface ProductRow {
  id: number;
  name: string;
  article_code: string | null;
  active: boolean;
  deleted_at: string | null;
  selling_price: string | null;
  production_price: string | null;
}

async function productRow(id: number): Promise<ProductRow | null> {
  const result = await pool.query<ProductRow>(
    `SELECT id, name, article_code, active, deleted_at, selling_price, production_price
     FROM factory_bale_products WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function createProduct(name: string, companyId = ctx.companyId): Promise<number> {
  seq += 1;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO factory_bale_products (company_id, code, article_code, name, selling_price, production_price)
     VALUES ($1, $2, $3, $4, '10.00', '6.00') RETURNING id`,
    [companyId, `${TEST_PREFIX}-C${seq}`, `${TEST_PREFIX}-A${seq}`, name]
  );
  return result.rows[0].id;
}

async function createBaleFor(productId: number): Promise<number> {
  seq += 1;
  const result = await pool.query<{ id: number }>(
    `INSERT INTO factory_bales
       (company_id, product_id, bale_code, reference_number, article_code, product_name,
        weight_kg, cost_per_kg, total_cost, status)
     VALUES ($1, $2, $3, $3, 'OLD-ART', 'Old Name', '20.000', '1.00', '20.00', 'IN_STOCK')
     RETURNING id`,
    [ctx.companyId, productId, `${TEST_PREFIX}-B${seq}`]
  );
  return result.rows[0].id;
}

async function baleProductLink(baleId: number) {
  const result = await pool.query<{ product_id: number | null; article_code: string | null; product_name: string }>(
    `SELECT product_id, article_code, product_name FROM factory_bales WHERE id = $1`,
    [baleId]
  );
  return result.rows[0];
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
    `INSERT INTO companies (code, name, company_type, base_currency) VALUES ($1, $2, 'factory', 'USD') RETURNING id`,
    [`${TEST_PREFIX.slice(0, 4)}FG`, `${TEST_PREFIX}_Foreign`]
  );
  foreignCompanyId = company.rows[0].id;
}, 120000);

afterAll(async () => {
  await pool.query(`DELETE FROM factory_bales WHERE company_id IN ($1, $2)`, [ctx.companyId, foreignCompanyId]);
  await pool.query(`DELETE FROM factory_bale_products WHERE company_id IN ($1, $2)`, [ctx.companyId, foreignCompanyId]);
  await pool.query(`DELETE FROM companies WHERE id = $1`, [foreignCompanyId]);
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60000);

describe("DELETE /api/factory/bale-products/:id", () => {
  it("soft-deletes by clearing active and stamping deletedAt together", async () => {
    const id = await createProduct(`${TEST_PREFIX} soft`);

    const response = await agent.delete(`/api/factory/bale-products/${id}`);
    expect(response.status).toBe(200);

    const row = await productRow(id);
    // The row survives because bales still reference it; both markers move so
    // neither an `active` filter nor a `deleted_at` filter can still see it.
    expect(row).not.toBeNull();
    expect(row?.active).toBe(false);
    expect(row?.deleted_at).not.toBeNull();
  });

  it("returns 404 for a product in another company", async () => {
    const foreignId = await createProduct(`${TEST_PREFIX} foreign`, foreignCompanyId);

    const response = await agent.delete(`/api/factory/bale-products/${foreignId}`);

    expect(response.status).toBe(404);
    expect((await productRow(foreignId))?.active).toBe(true);
  });
});

describe("POST /api/factory/bale-products/bulk-toggle-active", () => {
  it("toggles every listed product and leaves other companies alone", async () => {
    const mine = await createProduct(`${TEST_PREFIX} toggle`);
    const foreignId = await createProduct(`${TEST_PREFIX} toggle foreign`, foreignCompanyId);

    const response = await agent
      .post("/api/factory/bale-products/bulk-toggle-active")
      .send({ ids: [mine, foreignId], active: false });

    expect(response.status).toBe(200);
    expect((await productRow(mine))?.active).toBe(false);
    // The WHERE clause carries company_id, so the other tenant's row is
    // untouched even though its id was accepted into the batch.
    expect((await productRow(foreignId))?.active).toBe(true);
  });

  it("rejects an empty id list or a non-boolean active flag", async () => {
    const id = await createProduct(`${TEST_PREFIX} toggle bad`);

    expect(
      (await agent.post("/api/factory/bale-products/bulk-toggle-active").send({ ids: [], active: false })).status
    ).toBe(400);
    expect(
      (await agent.post("/api/factory/bale-products/bulk-toggle-active").send({ ids: [id], active: "no" })).status
    ).toBe(400);

    expect((await productRow(id))?.active).toBe(true);
  });
});

describe("POST /api/factory/bale-products/bulk-rename-preview", () => {
  it("reports the replacement without applying it", async () => {
    const id = await createProduct(`${TEST_PREFIX} Winter Coat`);
    const code = (await pool.query<{ code: string }>(`SELECT code FROM factory_bale_products WHERE id = $1`, [id]))
      .rows[0].code;

    const response = await agent
      .post("/api/factory/bale-products/bulk-rename-preview")
      .send({ codePrefix: code, find: "Winter", replace: "Summer" });

    expect(response.status).toBe(200);
    const match = response.body.matches.find((m: { id: number }) => m.id === id);
    expect(match.currentName).toBe(`${TEST_PREFIX} Winter Coat`);
    expect(match.newName).toBe(`${TEST_PREFIX} Summer Coat`);

    // Preview is a dry run.
    expect((await productRow(id))?.name).toBe(`${TEST_PREFIX} Winter Coat`);
  });

  it("requires a prefix and a non-empty find string", async () => {
    expect(
      (await agent.post("/api/factory/bale-products/bulk-rename-preview").send({ find: "a", replace: "b" })).status
    ).toBe(400);
    expect(
      (
        await agent
          .post("/api/factory/bale-products/bulk-rename-preview")
          .send({ codePrefix: "X", find: "", replace: "b" })
      ).status
    ).toBe(400);
  });
});

describe("POST /api/factory/bale-products/bulk-rename-apply", () => {
  it("renames the listed products and counts only those it owns", async () => {
    const mine = await createProduct(`${TEST_PREFIX} Before`);
    const foreignId = await createProduct(`${TEST_PREFIX} Foreign Before`, foreignCompanyId);

    const response = await agent.post("/api/factory/bale-products/bulk-rename-apply").send({
      items: [
        { id: mine, newName: `${TEST_PREFIX} After` },
        { id: foreignId, newName: "hijacked" },
      ],
    });

    expect(response.status).toBe(200);
    // Only the owned row is renamed, and only it is counted.
    expect(response.body.updated).toBe(1);
    expect((await productRow(mine))?.name).toBe(`${TEST_PREFIX} After`);
    expect((await productRow(foreignId))?.name).toBe(`${TEST_PREFIX} Foreign Before`);
  });

  it("rejects an empty item list", async () => {
    expect((await agent.post("/api/factory/bale-products/bulk-rename-apply").send({ items: [] })).status).toBe(400);
  });
});

describe("POST /api/factory/bale-products/merge", () => {
  it("moves every referencing bale onto the target and retires the sources", async () => {
    const target = await createProduct(`${TEST_PREFIX} Target`);
    const sourceA = await createProduct(`${TEST_PREFIX} Source A`);
    const sourceB = await createProduct(`${TEST_PREFIX} Source B`);
    const baleA = await createBaleFor(sourceA);
    const baleB = await createBaleFor(sourceB);

    const response = await agent
      .post("/api/factory/bale-products/merge")
      .send({ targetId: target, sourceIds: [sourceA, sourceB] });

    expect(response.status).toBe(200);
    expect(response.body.movedBales).toBe(2);
    expect(response.body.mergedProducts).toBe(2);

    const targetArticle = (await productRow(target))?.article_code;
    for (const baleId of [baleA, baleB]) {
      const link = await baleProductLink(baleId);
      // Nothing may be left pointing at a retired product: the bale would keep
      // the old name on every document, and a re-merge could not find it.
      expect(link.product_id).toBe(target);
      expect(link.article_code).toBe(targetArticle);
      expect(link.product_name).toBe(`${TEST_PREFIX} Target`);
    }

    expect((await productRow(sourceA))?.active).toBe(false);
    expect((await productRow(sourceB))?.active).toBe(false);
    // The target itself must survive the merge untouched.
    expect((await productRow(target))?.active).toBe(true);
  });

  it("refuses a merge whose source belongs to another company, writing nothing", async () => {
    const target = await createProduct(`${TEST_PREFIX} Target2`);
    const mineSource = await createProduct(`${TEST_PREFIX} Source Mine`);
    const foreignSource = await createProduct(`${TEST_PREFIX} Source Foreign`, foreignCompanyId);
    const bale = await createBaleFor(mineSource);

    const response = await agent
      .post("/api/factory/bale-products/merge")
      .send({ targetId: target, sourceIds: [mineSource, foreignSource] });

    // All-or-nothing: the ownership check runs before the transaction, so the
    // valid half of the batch must not be merged either.
    expect(response.status).toBe(400);
    expect((await baleProductLink(bale)).product_id).toBe(mineSource);
    expect((await productRow(mineSource))?.active).toBe(true);
  });

  it("returns 404 for a target in another company", async () => {
    const foreignTarget = await createProduct(`${TEST_PREFIX} Foreign Target`, foreignCompanyId);
    const source = await createProduct(`${TEST_PREFIX} Source3`);

    const response = await agent
      .post("/api/factory/bale-products/merge")
      .send({ targetId: foreignTarget, sourceIds: [source] });

    expect(response.status).toBe(404);
    expect((await productRow(source))?.active).toBe(true);
  });

  it("requires a target and a non-empty source list", async () => {
    const target = await createProduct(`${TEST_PREFIX} Target4`);

    expect((await agent.post("/api/factory/bale-products/merge").send({ sourceIds: [1] })).status).toBe(400);
    expect(
      (await agent.post("/api/factory/bale-products/merge").send({ targetId: target, sourceIds: [] })).status
    ).toBe(400);
  });
});

describe("POST /api/factory/bale-products/bulk-update-prices", () => {
  it("updates selling and production prices independently", async () => {
    const id = await createProduct(`${TEST_PREFIX} priced`);

    const response = await agent
      .post("/api/factory/bale-products/bulk-update-prices")
      .send({ prices: [{ id, sellingPrice: "19.99" }] });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(1);
    const row = await productRow(id);
    expect(Number(row?.selling_price)).toBeCloseTo(19.99, 2);
    // An omitted field must not be zeroed — production price values stock.
    expect(Number(row?.production_price)).toBeCloseTo(6, 2);
  });

  it("skips rows with no usable price and reports them separately", async () => {
    const id = await createProduct(`${TEST_PREFIX} skipped`);

    const response = await agent.post("/api/factory/bale-products/bulk-update-prices").send({
      prices: [
        { id, sellingPrice: "" },
        { id, sellingPrice: "-5" },
        { id: "not-a-number", sellingPrice: "10" },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(0);
    expect(Number((await productRow(id))?.selling_price)).toBeCloseTo(10, 2);
  });

  it("rejects an empty price list", async () => {
    expect((await agent.post("/api/factory/bale-products/bulk-update-prices").send({ prices: [] })).status).toBe(400);
  });
});
