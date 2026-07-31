import type { Express, Request } from "express";
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { factoryBaleProducts, factoryCategories } from "@shared/schema";
import {
  parseFactoryCatalogLanguage,
  resolveFactoryCategoryName,
  resolveFactoryProductLanguage,
  type FactoryCatalogLanguage,
} from "@shared/factoryBilingualContract";

function getFactoryCompanyId(req: Request): number | null {
  const companyId = Number((req.session as any)?.factoryCompanyId);
  return Number.isSafeInteger(companyId) && companyId > 0 ? companyId : null;
}

function mapCategory(
  category: typeof factoryCategories.$inferSelect,
  language: FactoryCatalogLanguage
) {
  return {
    ...category,
    nameEn: category.name,
    nameAr: category.nameAr,
    displayName: resolveFactoryCategoryName(category, language),
    language,
  };
}

function sendFactoryCompanyAccessError(res: any) {
  return res.status(403).json({
    message: "You do not have access to the selected Factory company.",
    code: "FACTORY_COMPANY_ACCESS_REQUIRED",
  });
}

async function sendCategories(req: any, res: any, companyId: number) {
  const language = parseFactoryCatalogLanguage(req.query.lang);
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const filters = [
    eq(factoryCategories.companyId, companyId),
    isNull(factoryCategories.deletedAt),
  ];
  if (query) {
    filters.push(
      or(
        ilike(factoryCategories.name, `%${query}%`),
        ilike(factoryCategories.nameAr, `%${query}%`)
      )!
    );
  }

  const results = await db
    .select()
    .from(factoryCategories)
    .where(and(...filters))
    .orderBy(asc(factoryCategories.name));

  return res.json(results.map((category) => mapCategory(category, language)));
}

async function sendProducts(req: any, res: any, companyId: number) {
  const language = parseFactoryCatalogLanguage(req.query.lang);
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const filters = [
    eq(factoryBaleProducts.companyId, companyId),
    isNull(factoryBaleProducts.deletedAt),
  ];
  if (query) {
    filters.push(
      or(
        ilike(factoryBaleProducts.articleCode, `%${query}%`),
        ilike(factoryBaleProducts.name, `%${query}%`),
        ilike(factoryBaleProducts.nameAr, `%${query}%`),
        ilike(factoryCategories.name, `%${query}%`),
        ilike(factoryCategories.nameAr, `%${query}%`)
      )!
    );
  }

  const rows = await db
    .select({
      product: factoryBaleProducts,
      categoryName: factoryCategories.name,
      categoryNameAr: factoryCategories.nameAr,
    })
    .from(factoryBaleProducts)
    .leftJoin(
      factoryCategories,
      and(
        eq(factoryCategories.id, factoryBaleProducts.categoryId),
        eq(factoryCategories.companyId, companyId),
        isNull(factoryCategories.deletedAt)
      )
    )
    .where(and(...filters))
    .orderBy(asc(factoryBaleProducts.id));

  return res.json(
    rows.map(({ product, categoryName, categoryNameAr }) => {
      const resolved = resolveFactoryProductLanguage(
        { ...product, categoryName, categoryNameAr },
        language
      );
      return {
        ...product,
        nameEn: product.name,
        nameAr: product.nameAr,
        descriptionEn: product.description,
        descriptionAr: product.descriptionAr,
        categoryName,
        categoryNameAr,
        displayName: resolved.name,
        displayDescription: resolved.description,
        displayCategoryName: resolved.categoryName,
        language,
      };
    })
  );
}

async function sendProductDetail(req: any, res: any, companyId: number, id: number) {
  const language = parseFactoryCatalogLanguage(req.query.lang);
  const [row] = await db
    .select({
      product: factoryBaleProducts,
      categoryName: factoryCategories.name,
      categoryNameAr: factoryCategories.nameAr,
    })
    .from(factoryBaleProducts)
    .leftJoin(
      factoryCategories,
      and(
        eq(factoryCategories.id, factoryBaleProducts.categoryId),
        eq(factoryCategories.companyId, companyId),
        isNull(factoryCategories.deletedAt)
      )
    )
    .where(
      and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId))
    )
    .limit(1);

  if (!row) return res.status(404).json({ message: "Product not found" });
  const resolved = resolveFactoryProductLanguage(
    { ...row.product, categoryName: row.categoryName, categoryNameAr: row.categoryNameAr },
    language
  );

  return res.json({
    ...row.product,
    nameEn: row.product.name,
    nameAr: row.product.nameAr,
    descriptionEn: row.product.description,
    descriptionAr: row.product.descriptionAr,
    categoryName: row.categoryName,
    categoryNameAr: row.categoryNameAr,
    displayName: resolved.name,
    displayDescription: resolved.description,
    displayCategoryName: resolved.categoryName,
    language,
  });
}

async function factoryBilingualCatalogMiddleware(req: any, res: any, next: any) {
  if (req.method !== "GET" || req.query.legacy === "1") return next();

  const categoriesRequest = /^\/categories\/?$/.test(req.path);
  const productsRequest = /^\/bale-products\/?$/.test(req.path);
  const productDetailMatch = req.path.match(/^\/bale-products\/(\d+)\/?$/);
  if (!categoriesRequest && !productsRequest && !productDetailMatch) return next();

  try {
    const companyId = getFactoryCompanyId(req);
    if (!companyId) return sendFactoryCompanyAccessError(res);
    if (categoriesRequest) return await sendCategories(req, res, companyId);
    if (productsRequest) return await sendProducts(req, res, companyId);

    const id = Number(productDetailMatch?.[1]);
    if (!Number.isSafeInteger(id) || id <= 0) return next();
    return await sendProductDetail(req, res, companyId, id);
  } catch (error: unknown) {
    logger.error("Error fetching bilingual Factory catalog", { error });
    return res.status(500).json({ message: getErrorMessage(error) });
  }
}

/**
 * Intercepts the three existing catalog GET endpoints without adding duplicate
 * Express route registrations. Unmatched and explicit legacy requests continue
 * to the original Factory product/category handlers unchanged.
 */
export function registerFactoryBilingualCatalogRoutes(app: Express) {
  app.use("/api/factory", requireAuth, factoryBilingualCatalogMiddleware);
}
