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
});
