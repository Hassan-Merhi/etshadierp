import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import * as schema from "../shared/schema";
import {
  cleanupTestData,
  closeTestServer,
  seedTestData,
  type TestContext,
} from "./setup";

const TEST_PREFIX = "xlsexp";

let ctx: TestContext;
let agent: request.SuperAgentTest;
let categoryId: number;
let bilingualProductId: number;
let englishOnlyProductId: number;
let deletedProductId: number;
let otherCompanyId: number;
let otherCategoryId: number;
let otherProductId: number;

async function login(): Promise<void> {
  const loginResponse = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  expect(loginResponse.status).toBe(200);

  const companyResponse = await agent
    .post("/api/auth/set-company")
    .send({ companyId: ctx.companyId });
  expect(companyResponse.status).toBe(200);
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await login();

  const [category] = await db
    .insert(schema.factoryCategories)
    .values({
      companyId: ctx.companyId,
      name: "BAGS & BELTS",
      nameAr: "حقائب وأحزمة",
    })
    .returning();
  categoryId = category.id;

  const [bilingualProduct] = await db
    .insert(schema.factoryBaleProducts)
    .values({
      companyId: ctx.companyId,
      code: "P3-BILINGUAL",
      articleCode: "HMD10014",
      name: "MEN BAG CREME 20KG",
      nameAr: "حقيبة رجالية كريمي 20 كغ",
      description: "Cream men's bags",
      descriptionAr: "حقائب رجالية كريمية",
      categoryId,
    })
    .returning();
  bilingualProductId = bilingualProduct.id;

  const [englishOnlyProduct] = await db
    .insert(schema.factoryBaleProducts)
    .values({
      companyId: ctx.companyId,
      code: "P3-ENGLISH-ONLY",
      articleCode: "HMD11005",
      name: "ASIAN WEAR 40KG",
      nameAr: null,
      description: null,
      descriptionAr: null,
      categoryId,
    })
    .returning();
  englishOnlyProductId = englishOnlyProduct.id;

  const [deletedProduct] = await db
    .insert(schema.factoryBaleProducts)
    .values({
      companyId: ctx.companyId,
      code: "P3-DELETED",
      articleCode: "HMD19999",
      name: "HISTORICAL DELETED PRODUCT",
      nameAr: "منتج تاريخي محذوف",
      categoryId,
      deletedAt: new Date(),
      active: false,
    })
    .returning();
  deletedProductId = deletedProduct.id;

  const [otherCompany] = await db
    .insert(schema.companies)
    .values({
      code: "P3OTHER",
      name: `${TEST_PREFIX}_OtherFactory`,
      companyType: "factory",
      baseCurrency: "USD",
    })
    .returning();
  otherCompanyId = otherCompany.id;

  const [otherCategory] = await db
    .insert(schema.factoryCategories)
    .values({
      companyId: otherCompanyId,
      name: "OTHER BAGS",
      nameAr: "حقائب وأحزمة",
    })
    .returning();
  otherCategoryId = otherCategory.id;

  const [otherProduct] = await db
    .insert(schema.factoryBaleProducts)
    .values({
      companyId: otherCompanyId,
      code: "P3-OTHER-COMPANY",
      articleCode: "HMD10014",
      name: "OTHER COMPANY PRODUCT",
      nameAr: "منتج شركة أخرى",
      categoryId: otherCategoryId,
    })
    .returning();
  otherProductId = otherProduct.id;
}, 90_000);

afterAll(async () => {
  await pool.query(
    "DELETE FROM factory_bale_products WHERE id = ANY($1::int[])",
    [[bilingualProductId, englishOnlyProductId, deletedProductId, otherProductId].filter(Boolean)]
  );
  await pool.query(
    "DELETE FROM factory_categories WHERE id = ANY($1::int[])",
    [[categoryId, otherCategoryId].filter(Boolean)]
  );
  if (otherCompanyId) {
    await db.delete(schema.companies).where(eq(schema.companies.id, otherCompanyId));
  }
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 60_000);

describe("Factory bilingual catalog API", () => {
  it("keeps authentication and Factory company resolution in front of the new handlers", async () => {
    const response = await request(ctx.app).get("/api/factory/bale-products?lang=ar");
    expect(response.status).toBe(401);
  });

  it("searches Arabic category text and returns bilingual display fields", async () => {
    const response = await agent
      .get("/api/factory/bale-products")
      .query({ lang: "ar", q: "حقائب وأحزمة" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((row: any) => row.id)).toEqual(
      expect.arrayContaining([bilingualProductId, englishOnlyProductId])
    );
    expect(response.body.some((row: any) => row.id === otherProductId)).toBe(false);

    const product = response.body.find((row: any) => row.id === bilingualProductId);
    expect(product).toMatchObject({
      articleCode: "HMD10014",
      name: "MEN BAG CREME 20KG",
      nameEn: "MEN BAG CREME 20KG",
      nameAr: "حقيبة رجالية كريمي 20 كغ",
      descriptionEn: "Cream men's bags",
      descriptionAr: "حقائب رجالية كريمية",
      categoryName: "BAGS & BELTS",
      categoryNameAr: "حقائب وأحزمة",
      displayName: "حقيبة رجالية كريمي 20 كغ",
      displayDescription: "حقائب رجالية كريمية",
      displayCategoryName: "حقائب وأحزمة",
      language: "ar",
    });
  });

  it("keeps article-code lookup language-neutral and defaults display to English", async () => {
    const response = await agent
      .get("/api/factory/bale-products")
      .query({ q: "hmd10014" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: bilingualProductId,
      articleCode: "HMD10014",
      name: "MEN BAG CREME 20KG",
      displayName: "MEN BAG CREME 20KG",
      displayCategoryName: "BAGS & BELTS",
      language: "en",
    });
  });

  it("uses English and then article code as Arabic fallbacks", async () => {
    const response = await agent
      .get(`/api/factory/bale-products/${englishOnlyProductId}`)
      .query({ lang: "ar" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: englishOnlyProductId,
      articleCode: "HMD11005",
      displayName: "ASIAN WEAR 40KG",
      displayDescription: "HMD11005",
      displayCategoryName: "حقائب وأحزمة",
      language: "ar",
    });
  });

  it("searches and resolves categories in either language", async () => {
    const response = await agent
      .get("/api/factory/categories")
      .query({ lang: "ar", q: "حقائب" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: categoryId,
        name: "BAGS & BELTS",
        nameEn: "BAGS & BELTS",
        nameAr: "حقائب وأحزمة",
        displayName: "حقائب وأحزمة",
        language: "ar",
      }),
    ]);
  });

  it("preserves the legacy raw response contract when explicitly requested", async () => {
    const response = await agent
      .get("/api/factory/bale-products")
      .query({ legacy: "1" });

    expect(response.status).toBe(200);
    const product = response.body.find((row: any) => row.id === bilingualProductId);
    expect(product).toBeDefined();
    expect(product.name).toBe("MEN BAG CREME 20KG");
    expect(product.displayName).toBeUndefined();
    expect(product.nameEn).toBeUndefined();
  });

  it("preserves historical detail access while keeping deleted products out of lists", async () => {
    const listResponse = await agent
      .get("/api/factory/bale-products")
      .query({ q: "HMD19999", lang: "ar" });
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual([]);

    const detailResponse = await agent
      .get(`/api/factory/bale-products/${deletedProductId}`)
      .query({ lang: "ar" });
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body).toMatchObject({
      id: deletedProductId,
      displayName: "منتج تاريخي محذوف",
      language: "ar",
    });
  });

  it("never exposes a product from another Factory company", async () => {
    const response = await agent
      .get(`/api/factory/bale-products/${otherProductId}`)
      .query({ lang: "ar" });

    expect(response.status).toBe(404);
  });
});
