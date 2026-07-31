import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  baleRecodeItems,
  customerDispatchBaleScans,
  customerOrderBaleRemovals,
  customerOrderBales,
  customerOrderBalesHistory,
  customerOrderExpectedLines,
  customerOrderLines,
  customerProformaLines,
  factoryBaleProducts,
  factoryBales,
  factoryCategories,
  factoryInvoiceLoadingBales,
  factoryPosSaleItems,
  factoryV3LoadBales,
  insertFactoryBaleProductSchema,
  insertFactoryBaleSchema,
  insertFactoryCategorySchema,
} from "../shared/schema";

const root = process.cwd();
const migrationPath = path.join(root, "migrations/20260731_001_factory_bilingual_catalog_snapshots.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function expectColumnProperties(table: Parameters<typeof getTableColumns>[0], properties: string[]) {
  const columns = getTableColumns(table);
  expect(Object.keys(columns)).toEqual(expect.arrayContaining(properties));
}

describe("Phase 2 Factory bilingual schema", () => {
  it("exposes additive Arabic catalog and snapshot columns", () => {
    expectColumnProperties(factoryCategories, ["nameAr"]);
    expectColumnProperties(factoryBaleProducts, ["nameAr", "descriptionAr"]);
    expectColumnProperties(factoryBales, ["productNameAr", "categoryAr"]);
    expectColumnProperties(customerProformaLines, ["productNameAr"]);
    expectColumnProperties(customerOrderLines, ["baleNameAr"]);
    expectColumnProperties(customerOrderBales, ["baleNameAr"]);
    expectColumnProperties(customerOrderBalesHistory, ["baleNameAr"]);
    expectColumnProperties(customerOrderExpectedLines, ["productNameAr"]);
    expectColumnProperties(factoryPosSaleItems, ["productNameAr"]);
    expectColumnProperties(customerOrderBaleRemovals, ["productNameAr"]);
    expectColumnProperties(factoryV3LoadBales, ["productNameAr"]);
    expectColumnProperties(factoryInvoiceLoadingBales, ["productNameAr"]);
    expectColumnProperties(customerDispatchBaleScans, ["productNameAr"]);
    expectColumnProperties(baleRecodeItems, ["productNameAr"]);
  });

  it("keeps Arabic Unicode unchanged through catalog and bale input schemas", () => {
    const productNameAr = "حقيبة رجالية كريمي 20 كغ";
    const categoryNameAr = "حقائب وأحزمة";
    const descriptionAr = "وصف عربي محفوظ كما أُدخل";

    const category = insertFactoryCategorySchema.parse({
      companyId: 1,
      name: "BAGS & BELTS",
      nameAr: categoryNameAr,
    });
    const product = insertFactoryBaleProductSchema.parse({
      companyId: 1,
      articleCode: "00-AR-019",
      name: "MEN BAG CREAM 20KG",
      nameAr: productNameAr,
      descriptionAr,
    });
    const bale = insertFactoryBaleSchema.parse({
      companyId: 1,
      baleCode: "B000001",
      referenceNumber: "REF-000001",
      articleCode: "00-AR-019",
      productName: "MEN BAG CREAM 20KG",
      productNameAr,
      category: "BAGS & BELTS",
      categoryAr: categoryNameAr,
      weightKg: "20.000",
    });
    const roundTrip = JSON.parse(JSON.stringify({ category, product, bale }));

    expect(roundTrip.category.nameAr).toBe(categoryNameAr);
    expect(roundTrip.product.nameAr).toBe(productNameAr);
    expect(roundTrip.product.descriptionAr).toBe(descriptionAr);
    expect(roundTrip.bale.productNameAr).toBe(productNameAr);
    expect(roundTrip.bale.categoryAr).toBe(categoryNameAr);
    expect(roundTrip.product.name).toBe("MEN BAG CREAM 20KG");
  });

  it("keeps the migration additive, idempotent, and article-code scoped", () => {
    const expectedFragments = [
      "ALTER TABLE factory_categories",
      "ADD COLUMN IF NOT EXISTS name_ar",
      "ADD COLUMN IF NOT EXISTS description_ar",
      "ADD COLUMN IF NOT EXISTS product_name_ar",
      "ADD COLUMN IF NOT EXISTS category_ar",
      "ADD COLUMN IF NOT EXISTS bale_name_ar",
      "factory_bale_products_company_article_code_normalized_idx",
      "UPPER(BTRIM(article_code))",
    ];

    for (const fragment of expectedFragments) expect(migrationSql).toContain(fragment);
    expect(migrationSql).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i);
  });

  it("guards every optional linked table before altering it", () => {
    const optionalTables = [
      "factory_pos_sale_items",
      "customer_order_bale_removals",
      "factory_v3_load_bales",
      "factory_invoice_loading_bales",
      "customer_dispatch_bale_scans",
      "bale_recode_items",
    ];

    for (const tableName of optionalTables) {
      expect(migrationSql).toContain(`to_regclass('public.${tableName}')`);
      expect(migrationSql).toContain(`ALTER TABLE ${tableName}`);
    }
  });

  it("registers the versioned migration and preloads the startup repair", () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(root, "migrations/meta/_journal.json"), "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> };
    const supplierBridge = fs.readFileSync(
      path.join(root, "server/supplierCompanyScopeBridge.mjs"),
      "utf8"
    );
    const bilingualBridge = fs.readFileSync(
      path.join(root, "server/factoryBilingualSchemaBridge.mjs"),
      "utf8"
    );

    expect(journal.entries.at(-1)).toEqual(
      expect.objectContaining({
        idx: 15,
        tag: "20260731_001_factory_bilingual_catalog_snapshots",
      })
    );
    expect(supplierBridge).toContain('import "./factoryBilingualSchemaBridge.mjs"');
    expect(bilingualBridge).toContain("Factory bilingual schema verification failed; aborting startup");
    expect(bilingualBridge).toContain("UPPER(BTRIM(article_code))");
  });

  const databaseIt = process.env.DATABASE_URL ? it : it.skip;

  databaseIt("applies twice and round-trips Arabic text without changing English snapshots", async () => {
    const { pool } = await import("../server/db");

    await pool.query(migrationSql);
    await pool.query(migrationSql);

    const client = await pool.connect();
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
    const englishProductName = `PHASE2 ENGLISH PRODUCT ${suffix}`;
    const arabicProductName = "حقيبة رجالية كريمي 20 كغ";
    const englishCategoryName = `PHASE2 ENGLISH CATEGORY ${suffix}`;
    const arabicCategoryName = "حقائب وأحزمة";
    const arabicDescription = "وصف عربي محفوظ كما أُدخل";
    const articleCode = `00-AR-${suffix}`.slice(0, 50);

    try {
      await client.query("BEGIN");
      const companyResult = await client.query(
        `INSERT INTO companies (code, name, company_type, base_currency)
         VALUES ($1, $2, 'factory', 'USD')
         RETURNING id`,
        [`P2C${suffix}`.slice(0, 50), `Phase 2 Bilingual Test ${suffix}`]
      );
      const companyId = companyResult.rows[0].id;

      const categoryResult = await client.query(
        `INSERT INTO factory_categories (company_id, name, name_ar)
         VALUES ($1, $2, $3)
         RETURNING id, name, name_ar`,
        [companyId, englishCategoryName, arabicCategoryName]
      );
      const categoryId = categoryResult.rows[0].id;

      const productResult = await client.query(
        `INSERT INTO factory_bale_products
           (company_id, code, article_code, name, name_ar, description_ar, category_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, name_ar, description_ar`,
        [
          companyId,
          `P2${suffix}`.slice(0, 50),
          articleCode,
          englishProductName,
          arabicProductName,
          arabicDescription,
          categoryId,
        ]
      );
      const productId = productResult.rows[0].id;

      const baleResult = await client.query(
        `INSERT INTO factory_bales
           (company_id, product_id, bale_code, reference_number, article_code,
            product_name, product_name_ar, category, category_ar, weight_kg)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING product_name, product_name_ar, category, category_ar`,
        [
          companyId,
          productId,
          `B${suffix}`.slice(0, 50),
          `REF-${suffix}`.slice(0, 100),
          articleCode,
          englishProductName,
          arabicProductName,
          englishCategoryName,
          arabicCategoryName,
          "20.000",
        ]
      );

      expect(categoryResult.rows[0]).toMatchObject({
        name: englishCategoryName,
        name_ar: arabicCategoryName,
      });
      expect(productResult.rows[0]).toMatchObject({
        name: englishProductName,
        name_ar: arabicProductName,
        description_ar: arabicDescription,
      });
      expect(baleResult.rows[0]).toMatchObject({
        product_name: englishProductName,
        product_name_ar: arabicProductName,
        category: englishCategoryName,
        category_ar: arabicCategoryName,
      });
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
