import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 15 verification for migration 20260802_003.
 *
 * The French snapshot triggers are the only thing writing French text onto
 * historical documents, so their fallback order, company isolation and
 * immutability are asserted against a real PostgreSQL instance rather than
 * inferred from the SQL.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COMPANY = 770001;
const OTHER_COMPANY = 770002;

async function applyMigrations() {
  const root = process.cwd();
  for (const file of [
    "migrations/20260802_001_factory_french_catalog_snapshots.sql",
    "migrations/20260802_003_factory_french_snapshot_insert_triggers.sql",
  ]) {
    await pool.query(fs.readFileSync(path.join(root, file), "utf8"));
  }
}

async function seedCatalog() {
  await pool.query(
    `INSERT INTO factory_categories (company_id, name, name_ar, name_fr)
     VALUES ($1, 'BAGS & BELTS', 'حقائب وأحزمة', 'Sacs et ceintures'),
            ($1, 'SUMMER NO 1', 'صيفي رقم 1', NULL)`,
    [COMPANY]
  );
  const { rows: categories } = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM factory_categories WHERE company_id = $1 ORDER BY name`,
    [COMPANY]
  );
  const bags = categories.find((c) => c.name === "BAGS & BELTS")!.id;
  const summer = categories.find((c) => c.name === "SUMMER NO 1")!.id;

  await pool.query(
    `INSERT INTO factory_bale_products (company_id, category_id, code, article_code, name, name_ar, name_fr)
     VALUES ($1, $2, 'C1', 'FRT10014', 'MEN BAG CREME 20KG', 'حقيبة رجالية', 'Sac homme crème 20KG'),
            ($1, $3, 'C2', 'FRT10015', 'BATH MAT 40KG', 'حصيرة حمام', NULL),
            ($1, $3, 'C3', 'FRT10016', '   ', 'قميص شتوي', NULL),
            ($1, $3, 'C4', 'FRT10017', '   ', '   ', NULL)`,
    [COMPANY, bags, summer]
  );
}

async function insertBale(fields: Record<string, unknown>) {
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  await pool.query(`INSERT INTO factory_bales (${columns.join(", ")}) VALUES (${placeholders})`, values);
}

async function frenchFor(reference: string) {
  const { rows } = await pool.query<{ product_name_fr: string | null; category_fr: string | null }>(
    `SELECT product_name_fr, category_fr FROM factory_bales WHERE reference_number = $1`,
    [reference]
  );
  return rows[0];
}

async function cleanup() {
  await pool.query(`DELETE FROM factory_bales WHERE company_id = ANY($1::int[])`, [[COMPANY, OTHER_COMPANY]]);
  await pool.query(`DELETE FROM factory_bale_products WHERE company_id = $1`, [COMPANY]);
  await pool.query(`DELETE FROM factory_categories WHERE company_id = $1`, [COMPANY]);
}

describe("French snapshot insert triggers", () => {
  beforeAll(async () => {
    await applyMigrations();
    await cleanup();
    await seedCatalog();
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("uses French when the catalog has it", async () => {
    await insertBale({
      company_id: COMPANY,
      article_code: "FRT10014",
      product_name: "MEN BAG CREME 20KG",
      reference_number: "FR-T1",
      bale_code: "FRB1",
      weight_kg: 20,
    });
    const row = await frenchFor("FR-T1");
    expect(row.product_name_fr).toBe("Sac homme crème 20KG");
    expect(row.category_fr).toBe("Sacs et ceintures");
  });

  it("falls back to English, then Arabic, then the article code", async () => {
    await insertBale({
      company_id: COMPANY,
      article_code: "FRT10015",
      product_name: "BATH MAT 40KG",
      reference_number: "FR-T2",
      bale_code: "FRB2",
      weight_kg: 20,
    });
    await insertBale({
      company_id: COMPANY,
      article_code: "FRT10016",
      reference_number: "FR-T3",
      bale_code: "FRB3",
      weight_kg: 20,
    });
    await insertBale({
      company_id: COMPANY,
      article_code: "FRT10017",
      reference_number: "FR-T4",
      bale_code: "FRB4",
      weight_kg: 20,
    });

    expect((await frenchFor("FR-T2")).product_name_fr).toBe("BATH MAT 40KG");
    expect((await frenchFor("FR-T3")).product_name_fr).toBe("قميص شتوي");
    expect((await frenchFor("FR-T4")).product_name_fr).toBe("FRT10017");
  });

  it("matches the catalog on article code regardless of case", async () => {
    await insertBale({
      company_id: COMPANY,
      article_code: "frt10014",
      product_name: "MEN BAG CREME 20KG",
      reference_number: "FR-T5",
      bale_code: "FRB5",
      weight_kg: 20,
    });
    expect((await frenchFor("FR-T5")).product_name_fr).toBe("Sac homme crème 20KG");
  });

  it("never resolves French from another company's catalog", async () => {
    await insertBale({
      company_id: OTHER_COMPANY,
      article_code: "FRT10014",
      product_name: "MEN BAG CREME 20KG",
      reference_number: "FR-T6",
      bale_code: "FRB6",
      weight_kg: 20,
    });
    const row = await frenchFor("FR-T6");
    expect(row.product_name_fr).toBe("MEN BAG CREME 20KG");
    expect(row.product_name_fr).not.toBe("Sac homme crème 20KG");
  });

  it("preserves French text supplied by the caller", async () => {
    await insertBale({
      company_id: COMPANY,
      article_code: "FRT10014",
      product_name: "MEN BAG CREME 20KG",
      product_name_fr: "Texte explicite du caller",
      category_fr: "Categorie explicite",
      reference_number: "FR-T7",
      bale_code: "FRB7",
      weight_kg: 20,
    });
    const row = await frenchFor("FR-T7");
    expect(row.product_name_fr).toBe("Texte explicite du caller");
    expect(row.category_fr).toBe("Categorie explicite");
  });

  it("does not rewrite issued documents when the catalog translation changes", async () => {
    const before = await frenchFor("FR-T1");
    await pool.query(
      `UPDATE factory_bale_products SET name_fr = 'NOUVEAU NOM' WHERE company_id = $1 AND article_code = 'FRT10014'`,
      [COMPANY]
    );
    await pool.query(
      `UPDATE factory_categories SET name_fr = 'NOUVELLE CATEGORIE' WHERE company_id = $1 AND name = 'BAGS & BELTS'`,
      [COMPANY]
    );
    expect(await frenchFor("FR-T1")).toEqual(before);
  });

  it("installs no UPDATE trigger on any snapshot table", async () => {
    const { rows } = await pool.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
       WHERE NOT tgisinternal AND tgname LIKE '%french_snapshot%' AND (tgtype & 16) <> 0`
    );
    expect(rows).toEqual([]);
  });
});
