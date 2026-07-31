import type { Express } from "express";
import multer from "multer";
import { and, eq, isNull } from "drizzle-orm";
import { factoryBaleProducts, factoryCategories } from "@shared/schema";
import { requireAuth } from "../../auth";
import { db } from "../../db";
import { contentDisposition } from "../../lib/contentDisposition";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import {
  createArabicTranslationErrorWorkbook,
  createArabicTranslationTemplate,
  parseArabicTranslationWorkbook,
  previewArabicTranslationImport,
  type TranslationCatalogProduct,
  type TranslationImportMode,
} from "../../services/factoryArabicTranslationWorkbook";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const isXlsx =
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.originalname.toLowerCase().endsWith(".xlsx");
    callback(isXlsx ? null : new Error("Only .xlsx files are supported"), isXlsx);
  },
});

function getFactoryCompanyId(req: any): number | null {
  const value = req.session?.factoryCompanyId;
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseMode(value: unknown): TranslationImportMode {
  return value === "replace" ? "replace" : "fill-missing";
}

async function loadCatalog(companyId: number): Promise<TranslationCatalogProduct[]> {
  return db
    .select({
      id: factoryBaleProducts.id,
      categoryId: factoryBaleProducts.categoryId,
      articleCode: factoryBaleProducts.articleCode,
      name: factoryBaleProducts.name,
      nameAr: factoryBaleProducts.nameAr,
      descriptionAr: factoryBaleProducts.descriptionAr,
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
    .where(and(eq(factoryBaleProducts.companyId, companyId), isNull(factoryBaleProducts.deletedAt)))
    .orderBy(factoryBaleProducts.id);
}

function ensureUpload(req: any, res: any): Buffer | null {
  if (!req.file?.buffer) {
    res.status(400).json({ message: "An .xlsx workbook is required" });
    return null;
  }
  return req.file.buffer;
}

export function registerFactoryArabicTranslationRoutes(app: Express) {
  app.get("/api/factory/bale-products/arabic-template", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(403).json({ message: "Factory company access required" });
      const workbook = await createArabicTranslationTemplate(await loadCatalog(companyId));
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", contentDisposition("attachment", "factory-arabic-names-template.xlsx"));
      return res.send(workbook);
    } catch (error) {
      logger.error("Failed to export Factory Arabic translation template", { error });
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post(
    "/api/factory/bale-products/arabic-import/preview",
    requireAuth,
    upload.single("file"),
    async (req: any, res: any) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) return res.status(403).json({ message: "Factory company access required" });
        const buffer = ensureUpload(req, res);
        if (!buffer) return;
        const rows = await parseArabicTranslationWorkbook(buffer);
        const preview = previewArabicTranslationImport(rows, await loadCatalog(companyId), parseMode(req.body?.mode));
        return res.json(preview);
      } catch (error) {
        return res.status(400).json({ message: getErrorMessage(error) });
      }
    }
  );

  app.post(
    "/api/factory/bale-products/arabic-import/errors",
    requireAuth,
    upload.single("file"),
    async (req: any, res: any) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) return res.status(403).json({ message: "Factory company access required" });
        const buffer = ensureUpload(req, res);
        if (!buffer) return;
        const rows = await parseArabicTranslationWorkbook(buffer);
        const preview = previewArabicTranslationImport(rows, await loadCatalog(companyId), parseMode(req.body?.mode));
        const workbook = await createArabicTranslationErrorWorkbook(preview);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", contentDisposition("attachment", "factory-arabic-import-errors.xlsx"));
        return res.send(workbook);
      } catch (error) {
        return res.status(400).json({ message: getErrorMessage(error) });
      }
    }
  );

  app.post(
    "/api/factory/bale-products/arabic-import/apply",
    requireAuth,
    upload.single("file"),
    async (req: any, res: any) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) return res.status(403).json({ message: "Factory company access required" });
        const buffer = ensureUpload(req, res);
        if (!buffer) return;
        const mode = parseMode(req.body?.mode);
        const rows = await parseArabicTranslationWorkbook(buffer);
        const catalog = await loadCatalog(companyId);
        const preview = previewArabicTranslationImport(rows, catalog, mode);
        if (preview.blocked) {
          return res.status(409).json({ message: "Import is blocked by duplicate codes or category conflicts", preview });
        }

        const productById = new Map(catalog.map((product) => [product.id, product]));
        const changedProductIds: number[] = [];
        const changedCategoryIds = new Set<number>();

        await db.transaction(async (tx) => {
          for (const row of preview.rows) {
            if (row.status !== "update" || !row.productId) continue;
            const current = productById.get(row.productId);
            if (!current) continue;

            const productChanges: { nameAr?: string; descriptionAr?: string; updatedAt: Date } = { updatedAt: new Date() };
            if (mode === "replace" || !current.nameAr) productChanges.nameAr = row.productNameAr || current.nameAr || "";
            if (mode === "replace" || !current.descriptionAr) {
              productChanges.descriptionAr = row.descriptionAr || current.descriptionAr || "";
            }

            const [updatedProduct] = await tx
              .update(factoryBaleProducts)
              .set(productChanges)
              .where(
                and(
                  eq(factoryBaleProducts.id, row.productId),
                  eq(factoryBaleProducts.companyId, companyId),
                  isNull(factoryBaleProducts.deletedAt)
                )
              )
              .returning({ id: factoryBaleProducts.id });
            if (!updatedProduct) throw new Error(`Product ${row.productId} is no longer available`);
            changedProductIds.push(updatedProduct.id);

            if (row.categoryId && row.categoryNameAr && (mode === "replace" || !current.categoryNameAr)) {
              const [updatedCategory] = await tx
                .update(factoryCategories)
                .set({ nameAr: row.categoryNameAr, updatedAt: new Date() })
                .where(
                  and(
                    eq(factoryCategories.id, row.categoryId),
                    eq(factoryCategories.companyId, companyId),
                    isNull(factoryCategories.deletedAt)
                  )
                )
                .returning({ id: factoryCategories.id });
              if (!updatedCategory) throw new Error(`Category ${row.categoryId} is no longer available`);
              changedCategoryIds.add(updatedCategory.id);
            }
          }
        });

        const summary = {
          ...preview,
          fileName: req.file.originalname,
          mode,
          changedProductIds: [...new Set(changedProductIds)],
          changedCategoryIds: [...changedCategoryIds],
          appliedByUserId: req.session.userId,
          companyId,
        };
        logger.info("Factory Arabic translation import applied", summary);
        return res.json(summary);
      } catch (error) {
        logger.error("Failed to apply Factory Arabic translation import", { error });
        return res.status(400).json({ message: getErrorMessage(error) });
      }
    }
  );
}
