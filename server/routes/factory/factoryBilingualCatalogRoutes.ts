import type { Express, Request } from "express";
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import {
  companies,
  factoryBaleProducts,
  factoryCategories,
  userCompanyRoles,
} from "@shared/schema";
import {
  normalizeFactoryLanguage,
  resolveFactoryProductLanguage,
  resolveFactoryText,
} from "@shared/factoryBilingual";

async function resolveAuthorizedFactoryCompanyId(req: Request): Promise<number | null> {
  const session = req.session as any;
  const requestedCompanyId = Number(session?.factoryCompanyId || session?.currentCompanyId);
  const userId = Number(session?.userId);
  if (!Number.isInteger(requestedCompanyId) || requestedCompanyId <= 0) return null;
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const [company] = await db
    .select({ id: companies.id, companyType: companies.companyType, active: companies.active })
    .from(companies)
    .where(eq(companies.id, requestedCompanyId))
    .limit(1);

  if (!company?.active || !["factory", "factory_v2"].includes(company.companyType)) return null;
  if (session.currentRole === "Developer") return company.id;

  const [membership] = await db
    .select({ companyId: userCompanyRoles.companyId })
    .from(userCompanyRoles)
    .where(
      and(
        eq(userCompanyRoles.userId, userId),
        eq(userCompanyRoles.companyId, requestedCompanyId)
      )
    )
    .limit(1);

  return membership ? company.id : null;
}

function mapCategory(category: typeof factoryCategories.$inferSelect, language: "en" | "ar") {
  return {
    ...category,
    nameEn: category.name,
    nameAr: category.nameAr,
    displayName: resolveFactoryText(
      { en: category.name, ar: category.nameAr, fallback: String(category.id) },
      language
    ),
    language,
  };
}

export function registerFactoryBilingualCatalogRoutes(app: Express) {
  app.get("/api/factory/categories", requireAuth, async (req: any, res: any, next: any) => {
    if (req.query.legacy === "1") return next();
    try {
      const companyId = await resolveAuthorizedFactoryCompanyId(req);
      if (!companyId) {
        return res.status(403).json({
          message: "You do not have access to the selected Factory company.",
          code: "FACTORY_COMPANY_ACCESS_REQUIRED",
        });
      }

      const language = normalizeFactoryLanguage(req.query.lang);
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

      res.json(results.map((category) => mapCategory(category, language)));
    } catch (error: unknown) {
      logger.error("Error fetching bilingual factory categories", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/bale-products", requireAuth, async (req: any, res: any, next: any) => {
    if (req.query.legacy === "1") return next();
    try {
      const companyId = await resolveAuthorizedFactoryCompanyId(req);
      if (!companyId) {
        return res.status(403).json({
          message: "You do not have access to the selected Factory company.",
          code: "FACTORY_COMPANY_ACCESS_REQUIRED",
        });
      }

      const language = normalizeFactoryLanguage(req.query.lang);
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

      res.json(
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
    } catch (error: unknown) {
      logger.error("Error fetching bilingual factory bale products", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any, next: any) => {
    if (req.query.legacy === "1") return next();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return next();

    try {
      const companyId = await resolveAuthorizedFactoryCompanyId(req);
      if (!companyId) {
        return res.status(403).json({
          message: "You do not have access to the selected Factory company.",
          code: "FACTORY_COMPANY_ACCESS_REQUIRED",
        });
      }

      const language = normalizeFactoryLanguage(req.query.lang);
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
          and(
            eq(factoryBaleProducts.id, id),
            eq(factoryBaleProducts.companyId, companyId),
            isNull(factoryBaleProducts.deletedAt)
          )
        )
        .limit(1);

      if (!row) return res.status(404).json({ message: "Product not found" });
      const resolved = resolveFactoryProductLanguage(
        { ...row.product, categoryName: row.categoryName, categoryNameAr: row.categoryNameAr },
        language
      );

      res.json({
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
    } catch (error: unknown) {
      logger.error("Error fetching bilingual factory bale product", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
