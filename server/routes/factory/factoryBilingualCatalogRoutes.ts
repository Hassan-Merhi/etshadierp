import type { Express } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  factoryBaleProducts,
  factoryCategories,
  insertFactoryCategorySchema,
} from "@shared/schema";
import {
  parseFactoryCatalogLanguage,
  type FactoryCatalogLanguage,
} from "@shared/factoryBilingualContract";
import {
  mapFactoryLegacyCategoryEdit,
  mapFactoryLegacyProductEdit,
  presentFactoryCatalogCategories,
  presentFactoryCatalogProducts,
} from "@shared/factoryBilingualCatalogPresentation";
import { db } from "../../db";
import { parseId } from "../../lib/parseId";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";

const LANGUAGE_COOKIE = "factory_catalog_language";
const SEARCH_COOKIE = "factory_catalog_search";

function readCookie(header: unknown, name: string): string | null {
  if (typeof header !== "string" || !header) return null;
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return valueParts.join("=");
    }
  }
  return null;
}

export function readFactoryCatalogRequestLanguage(req: any): FactoryCatalogLanguage {
  return parseFactoryCatalogLanguage(
    req.query?.lang ?? req.headers?.["x-factory-catalog-language"] ?? readCookie(req.headers?.cookie, LANGUAGE_COOKIE),
    "en"
  );
}

export function readFactoryCatalogRequestSearch(req: any): string {
  const value = req.query?.catalogSearch ?? readCookie(req.headers?.cookie, SEARCH_COOKIE);
  return typeof value === "string" ? value.trim() : "";
}

function getFactoryCompanyId(req: any): number | null {
  const raw = req.session?.factoryCompanyId ?? req.session?.currentCompanyId;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function localizeResponse(path: string, payload: any, language: FactoryCatalogLanguage, search: string): any {
  if (path === "/bale-products" && Array.isArray(payload)) {
    return presentFactoryCatalogProducts(payload, language, search);
  }
  if (path === "/categories" && Array.isArray(payload)) {
    return presentFactoryCatalogCategories(payload, language);
  }
  if (payload?.product && typeof payload.product === "object") {
    return {
      ...payload,
      product: presentFactoryCatalogProducts([payload.product], language)[0],
    };
  }
  if (/^\/bale-products(?:\/\d+)?$/.test(path) && payload?.id) {
    return presentFactoryCatalogProducts([payload], language)[0];
  }
  if (/^\/categories(?:\/\d+)?$/.test(path) && payload?.id) {
    return presentFactoryCatalogCategories([payload], language)[0];
  }
  return payload;
}

function hasDeferredArabic(update: { nameAr?: string | null; descriptionAr?: string | null }): boolean {
  return update.nameAr !== undefined || update.descriptionAr !== undefined;
}

/**
 * Compatibility middleware for the legacy Bale Explorer. It keeps the existing
 * endpoints and permissions intact while presenting localized names and routing
 * Arabic-mode edits into the nullable Arabic catalog columns.
 */
export function registerFactoryBilingualCatalogMiddleware(app: Express): void {
  app.use("/api/factory", (req: any, res: any, next: any) => {
    const path = req.path;
    const method = req.method.toUpperCase();
    const language = readFactoryCatalogRequestLanguage(req);
    const search = readFactoryCatalogRequestSearch(req);
    let deferredArabic: { nameAr?: string | null; descriptionAr?: string | null } = {};

    if (method === "PATCH" && /^\/categories\/\d+$/.test(path) && req.body) {
      req.body = mapFactoryLegacyCategoryEdit(req.body, language);
    }

    if (method === "PATCH" && /^\/bale-products\/\d+$/.test(path) && req.body) {
      const mapped = mapFactoryLegacyProductEdit(req.body, language);
      req.body = { ...mapped.body, ...mapped.deferredArabic };
    }

    if (method === "POST" && /^\/bale-products\/\d+\/cascade-update$/.test(path) && req.body) {
      const mapped = mapFactoryLegacyProductEdit(req.body, language);
      req.body = mapped.body;
      deferredArabic = mapped.deferredArabic;
    }

    if (method === "POST" && path === "/bale-products" && req.body) {
      if (Object.prototype.hasOwnProperty.call(req.body, "nameAr")) {
        deferredArabic.nameAr = typeof req.body.nameAr === "string" ? req.body.nameAr.trim() || null : null;
        delete req.body.nameAr;
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "descriptionAr")) {
        deferredArabic.descriptionAr =
          typeof req.body.descriptionAr === "string" ? req.body.descriptionAr.trim() || null : null;
        delete req.body.descriptionAr;
      }
      if (typeof req.body.nameEn === "string" && req.body.nameEn.trim()) {
        req.body.name = req.body.nameEn.trim();
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "descriptionEn")) {
        req.body.description = typeof req.body.descriptionEn === "string" ? req.body.descriptionEn.trim() : "";
      }
      delete req.body.nameEn;
      delete req.body.descriptionEn;
    }

    const shouldWrap =
      (method === "GET" && (path === "/bale-products" || path === "/categories")) ||
      (method === "POST" && (path === "/bale-products" || /^\/bale-products\/\d+\/cascade-update$/.test(path))) ||
      (method === "PATCH" && (/^\/bale-products\/\d+$/.test(path) || /^\/categories\/\d+$/.test(path))) ||
      (method === "POST" && path === "/categories");

    if (!shouldWrap) return next();

    const originalJson = res.json.bind(res);
    res.json = ((payload: any) => {
      const send = async () => {
        let responsePayload = payload;

        if (hasDeferredArabic(deferredArabic)) {
          const productId = Number(payload?.product?.id ?? payload?.id);
          const companyId = getFactoryCompanyId(req);
          if (Number.isInteger(productId) && productId > 0 && companyId) {
            const update: typeof factoryBaleProducts.$inferInsert = {} as typeof factoryBaleProducts.$inferInsert;
            if (deferredArabic.nameAr !== undefined) update.nameAr = deferredArabic.nameAr;
            if (deferredArabic.descriptionAr !== undefined) update.descriptionAr = deferredArabic.descriptionAr;
            update.updatedAt = new Date();

            const [updated] = await db
              .update(factoryBaleProducts)
              .set(update)
              .where(
                and(
                  eq(factoryBaleProducts.id, productId),
                  eq(factoryBaleProducts.companyId, companyId),
                  isNull(factoryBaleProducts.deletedAt)
                )
              )
              .returning();

            if (updated) {
              responsePayload = payload?.product
                ? { ...payload, product: updated }
                : updated;
            }
          }
        }

        return originalJson(localizeResponse(path, responsePayload, language, search));
      };

      void send().catch((error) => {
        logger.error("Factory bilingual catalog response transformation failed", {
          error,
          path,
          method,
        });
        if (!res.headersSent) {
          originalJson({ message: getErrorMessage(error) });
        }
      });
      return res;
    }) as typeof res.json;

    return next();
  });
}

function isFactoryCatalogAdmin(req: any): boolean {
  const role = req.user?.role ?? req.session?.currentRole;
  return ["Admin", "Owner", "Developer"].includes(role ?? "");
}

/**
 * Explicit bilingual write endpoints used by the compact Phase 3 controls.
 * They are registered after the legacy Factory registry, so all existing
 * company-resolution and admin middleware executes before these handlers.
 */
export function registerFactoryBilingualCatalogRoutes(app: Express, requireAuth: any): void {
  app.post("/api/factory/catalog-bilingual/categories", requireAuth, async (req: any, res: any) => {
    try {
      if (!isFactoryCatalogAdmin(req)) {
        return res.status(403).json({ message: "Admin authorization required for this action." });
      }
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactoryCategorySchema.parse({
        companyId,
        name: typeof req.body?.name === "string" ? req.body.name.trim() : "",
        nameAr: typeof req.body?.nameAr === "string" ? req.body.nameAr.trim() || null : null,
      });
      const [category] = await db.insert(factoryCategories).values(parsed).returning();
      const language = readFactoryCatalogRequestLanguage(req);
      return res.json(presentFactoryCatalogCategories([category], language)[0]);
    } catch (error) {
      logger.error("Error creating bilingual Factory category", { error });
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.patch("/api/factory/catalog-bilingual/categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const update: Partial<typeof factoryCategories.$inferInsert> = { updatedAt: new Date() };
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "name")) {
        const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
        if (!name) return res.status(400).json({ message: "English category name is required" });
        update.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "nameAr")) {
        update.nameAr = typeof req.body.nameAr === "string" ? req.body.nameAr.trim() || null : null;
      }

      const [category] = await db
        .update(factoryCategories)
        .set(update)
        .where(
          and(
            eq(factoryCategories.id, id),
            eq(factoryCategories.companyId, companyId),
            isNull(factoryCategories.deletedAt)
          )
        )
        .returning();
      if (!category) return res.status(404).json({ message: "Category not found" });
      return res.json(
        presentFactoryCatalogCategories([category], readFactoryCatalogRequestLanguage(req))[0]
      );
    } catch (error) {
      logger.error("Error updating bilingual Factory category", { error });
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.patch("/api/factory/catalog-bilingual/products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const update: Partial<typeof factoryBaleProducts.$inferInsert> = { updatedAt: new Date() };
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "name")) {
        const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
        if (!name) return res.status(400).json({ message: "English product name is required" });
        update.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "nameAr")) {
        update.nameAr = typeof req.body.nameAr === "string" ? req.body.nameAr.trim() || null : null;
      }
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "description")) {
        update.description = typeof req.body.description === "string" ? req.body.description.trim() || null : null;
      }
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "descriptionAr")) {
        update.descriptionAr =
          typeof req.body.descriptionAr === "string" ? req.body.descriptionAr.trim() || null : null;
      }

      const [product] = await db
        .update(factoryBaleProducts)
        .set(update)
        .where(
          and(
            eq(factoryBaleProducts.id, id),
            eq(factoryBaleProducts.companyId, companyId),
            isNull(factoryBaleProducts.deletedAt)
          )
        )
        .returning();
      if (!product) return res.status(404).json({ message: "Product not found" });
      return res.json(
        presentFactoryCatalogProducts([product], readFactoryCatalogRequestLanguage(req))[0]
      );
    } catch (error) {
      logger.error("Error updating bilingual Factory product", { error });
      return res.status(400).json({ message: getErrorMessage(error) });
    }
  });
}
