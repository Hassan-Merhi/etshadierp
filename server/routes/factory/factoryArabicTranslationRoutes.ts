import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { and, eq, isNull } from "drizzle-orm";
import { factoryBaleProducts, factoryCategories } from "@shared/schema";
import { parseFactoryArabicImportMode } from "@shared/factoryBilingualContract";
import { requireAuth } from "../../auth";
import { db } from "../../db";
import { contentDisposition } from "../../lib/contentDisposition";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { writeAuditEvent } from "../../services/audit/auditService";
import {
  createArabicTranslationErrorWorkbook,
  createArabicTranslationPreviewEnvelope,
  createArabicTranslationTemplate,
  createWorkbookSha256,
  parseArabicTranslationWorkbook,
  previewArabicTranslationImport,
  type TranslationCatalogProduct,
  type TranslationImportMode,
  type TranslationPreview,
  type TranslationPreviewEnvelope,
} from "../../services/factoryArabicTranslationWorkbook";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const validExtension = file.originalname.toLowerCase().endsWith(".xlsx");
    const validMime = file.mimetype === XLSX_MIME || file.mimetype === "application/octet-stream";
    callback(validExtension && validMime ? null : new Error("Only .xlsx files are supported"), validExtension && validMime);
  },
});
const receiveArabicWorkbook = upload.single("file");

class TranslationRouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TranslationRouteError";
  }
}

function uploadArabicWorkbook(req: Request, res: Response, next: NextFunction): void {
  receiveArabicWorkbook(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "Workbook exceeds the 10 MB upload limit"
        : getErrorMessage(error);
    res.status(400).json({ message });
  });
}

function getFactoryCompanyId(req: Request): number | null {
  const value = Number((req.session as any)?.factoryCompanyId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function getImportMode(value: unknown): TranslationImportMode {
  return parseFactoryArabicImportMode(value);
}

function getUpload(req: Request): { buffer: Buffer; fileName: string } {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.buffer) throw new TranslationRouteError(400, "An .xlsx workbook is required");
  return {
    buffer: file.buffer,
    fileName: file.originalname.trim().slice(0, 255) || "factory-arabic-names.xlsx",
  };
}

async function loadCatalog(
  companyId: number,
  executor: Pick<typeof db, "select"> = db
): Promise<TranslationCatalogProduct[]> {
  return executor
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
    .where(
      and(
        eq(factoryBaleProducts.companyId, companyId),
        isNull(factoryBaleProducts.deletedAt)
      )
    )
    .orderBy(factoryBaleProducts.id);
}

function previewSummary(preview: TranslationPreview) {
  return {
    totalRows: preview.totalRows,
    matchedProducts: preview.matchedProducts,
    unchangedRows: preview.unchangedRows,
    rowsToApply: preview.rowsToApply,
    productsToUpdate: preview.productsToUpdate,
    categoriesToUpdate: preview.categoriesToUpdate,
    unknownArticleCodes: preview.unknownArticleCodes,
    duplicateArticleCodes: preview.duplicateArticleCodes,
    ambiguousArticleCodes: preview.ambiguousArticleCodes,
    blankOrInvalidArabicNames: preview.blankOrInvalidArabicNames,
    categoryConflicts: preview.categoryConflicts,
    blocked: preview.blocked,
    rejectedRows: preview.rows.filter(
      (row) => !["update", "unchanged"].includes(row.status)
    ).length,
  };
}

async function buildPreview(input: {
  companyId: number;
  buffer: Buffer;
  mode: TranslationImportMode;
  executor?: Pick<typeof db, "select">;
}): Promise<TranslationPreviewEnvelope> {
  const rows = await parseArabicTranslationWorkbook(input.buffer);
  const preview = previewArabicTranslationImport(
    rows,
    await loadCatalog(input.companyId, input.executor ?? db),
    input.mode
  );
  return createArabicTranslationPreviewEnvelope({
    companyId: input.companyId,
    mode: input.mode,
    workbookSha256: createWorkbookSha256(input.buffer),
    preview,
  });
}

function sendWorkbook(res: Response, workbook: Buffer, fileName: string): Response {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", contentDisposition("attachment", fileName));
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(workbook);
}

function sendRouteError(res: Response, error: unknown): Response {
  if (error instanceof TranslationRouteError) {
    return res.status(error.status).json({ message: error.message, ...error.details });
  }
  return res.status(400).json({ message: getErrorMessage(error) });
}

export function registerFactoryArabicTranslationRoutes(app: Express) {
  app.get(
    "/api/factory/bale-products/arabic-template",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) {
          throw new TranslationRouteError(403, "Factory company access required");
        }
        const workbook = await createArabicTranslationTemplate(await loadCatalog(companyId));
        return sendWorkbook(res, workbook, "factory-arabic-names-template.xlsx");
      } catch (error) {
        logger.error("Failed to export Factory Arabic translation template", { error });
        return sendRouteError(res, error);
      }
    }
  );

  app.post(
    "/api/factory/bale-products/arabic-import/preview",
    requireAuth,
    uploadArabicWorkbook,
    async (req: Request, res: Response) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) {
          throw new TranslationRouteError(403, "Factory company access required");
        }
        const { buffer } = getUpload(req);
        const preview = await buildPreview({
          companyId,
          buffer,
          mode: getImportMode((req.body as Record<string, unknown> | undefined)?.mode),
        });
        return res.json(preview);
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
  );

  app.post(
    "/api/factory/bale-products/arabic-import/errors",
    requireAuth,
    uploadArabicWorkbook,
    async (req: Request, res: Response) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) {
          throw new TranslationRouteError(403, "Factory company access required");
        }
        const { buffer } = getUpload(req);
        const preview = await buildPreview({
          companyId,
          buffer,
          mode: getImportMode((req.body as Record<string, unknown> | undefined)?.mode),
        });
        return sendWorkbook(
          res,
          await createArabicTranslationErrorWorkbook(preview),
          "factory-arabic-import-errors.xlsx"
        );
      } catch (error) {
        return sendRouteError(res, error);
      }
    }
  );

  app.post(
    "/api/factory/bale-products/arabic-import/apply",
    requireAuth,
    uploadArabicWorkbook,
    async (req: Request, res: Response) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) {
          throw new TranslationRouteError(403, "Factory company access required");
        }
        const { buffer, fileName } = getUpload(req);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const mode = getImportMode(body.mode);
        const suppliedPreviewToken =
          typeof body.previewToken === "string" ? body.previewToken.trim() : "";
        if (!suppliedPreviewToken) {
          throw new TranslationRouteError(
            400,
            "Preview the workbook before applying it"
          );
        }

        const result = await db.transaction(async (tx) => {
          const preview = await buildPreview({
            companyId,
            buffer,
            mode,
            executor: tx as unknown as Pick<typeof db, "select">,
          });

          if (preview.previewToken !== suppliedPreviewToken) {
            throw new TranslationRouteError(
              409,
              "The workbook or catalog changed after preview. Preview it again before applying.",
              { preview }
            );
          }
          if (preview.blocked) {
            throw new TranslationRouteError(
              409,
              "Import is blocked by duplicate codes, ambiguous catalog codes, or category conflicts",
              { preview }
            );
          }

          const changedProductIds: number[] = [];
          const changedCategoryIds: number[] = [];
          const categoryTargets = new Map<number, string>();

          for (const row of preview.rows) {
            if (row.status !== "update" || !row.productId) continue;

            const productChanges: {
              nameAr?: string;
              descriptionAr?: string;
              updatedAt: Date;
            } = { updatedAt: new Date() };
            if (row.changes.productNameAr && row.targetProductNameAr) {
              productChanges.nameAr = row.targetProductNameAr;
            }
            if (row.changes.descriptionAr && row.targetDescriptionAr) {
              productChanges.descriptionAr = row.targetDescriptionAr;
            }

            if (row.changes.productNameAr || row.changes.descriptionAr) {
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
              if (!updatedProduct) {
                throw new TranslationRouteError(
                  409,
                  `Product ${row.productId} changed during import. Preview again.`
                );
              }
              changedProductIds.push(updatedProduct.id);
            }

            if (
              row.categoryId &&
              row.changes.categoryNameAr &&
              row.targetCategoryNameAr
            ) {
              categoryTargets.set(row.categoryId, row.targetCategoryNameAr);
            }
          }

          for (const [categoryId, nameAr] of categoryTargets) {
            const [updatedCategory] = await tx
              .update(factoryCategories)
              .set({ nameAr, updatedAt: new Date() })
              .where(
                and(
                  eq(factoryCategories.id, categoryId),
                  eq(factoryCategories.companyId, companyId),
                  isNull(factoryCategories.deletedAt)
                )
              )
              .returning({ id: factoryCategories.id });
            if (!updatedCategory) {
              throw new TranslationRouteError(
                409,
                `Category ${categoryId} changed during import. Preview again.`
              );
            }
            changedCategoryIds.push(updatedCategory.id);
          }

          const uniqueProductIds = [...new Set(changedProductIds)];
          const uniqueCategoryIds = [...new Set(changedCategoryIds)];
          const summary = {
            fileName,
            mode,
            workbookSha256: preview.workbookSha256,
            previewToken: preview.previewToken,
            ...previewSummary(preview),
            changedProductIds: uniqueProductIds,
            changedCategoryIds: uniqueCategoryIds,
            appliedByUserId: String((req.session as any).userId),
            companyId,
          };

          await writeAuditEvent(
            {
              userId: String((req.session as any).userId ?? ""),
              username: String(
                (req.session as any).username ?? (req.session as any).userId ?? "unknown"
              ),
              companyId,
              action: "import",
              tableName: "factory_bale_products",
              recordIdentifier: fileName,
              changes: {
                arabicTranslationImport: { new: summary },
              },
            },
            tx as any
          );

          return summary;
        });

        logger.info("Factory Arabic translation import applied", result);
        return res.json(result);
      } catch (error) {
        logger.error("Failed to apply Factory Arabic translation import", { error });
        return sendRouteError(res, error);
      }
    }
  );
}
