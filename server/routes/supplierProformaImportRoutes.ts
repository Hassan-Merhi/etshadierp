import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { parseId } from "../lib/parseId";
import { logger } from "../lib/logger";
import { supplierProformaLines, supplierProformas } from "@shared/schema";
import { buildAliasMap, resolveBarcode } from "./helpers/proformaBarcodeHelpers";
import { normalizeProformaImportLines, type NormalizedProformaImportLine } from "./helpers/proformaImportValidation";

const MAX_IMPORT_LINES = 10_000;
const BULK_CHUNK_SIZE = 50;

type InsertableLine = NormalizedProformaImportLine & { proformaId: number };

async function insertAtomically(lines: InsertableLine[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < lines.length; i += BULK_CHUNK_SIZE) {
      await tx.insert(supplierProformaLines).values(lines.slice(i, i + BULK_CHUNK_SIZE));
    }
  });
}

async function insertAtomicallyOneByOne(lines: InsertableLine[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const line of lines) {
      await tx.insert(supplierProformaLines).values(line);
    }
  });
}

/**
 * Registers the hardened supplier-proforma import before the legacy supplier
 * proforma registrar. Express stops at this handler after a response is sent,
 * so all other supplier-proforma endpoints keep their existing implementation.
 */
export function registerSupplierProformaImportRoutes(app: Express, requireAuth: RequestHandler): void {
  app.post(
    "/api/suppliers/:supplierId/proformas/:proformaId/import-lines",
    requireAuth,
    async (req: Request, res: Response) => {
      const companyId = req.session.currentCompanyId;
      const supplierId = parseId(req.params.supplierId);
      const proformaId = parseId(req.params.proformaId);

      try {
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        if (supplierId === null || proformaId === null) {
          return res.status(400).json({ message: "Invalid supplier or proforma id" });
        }

        const [proforma] = await db
          .select({ id: supplierProformas.id })
          .from(supplierProformas)
          .where(
            and(
              eq(supplierProformas.id, proformaId),
              eq(supplierProformas.supplierId, supplierId),
              eq(supplierProformas.companyId, companyId)
            )
          );
        if (!proforma) return res.status(404).json({ message: "Proforma not found" });

        const rawLines = req.body?.lines;
        if (!Array.isArray(rawLines) || rawLines.length === 0) {
          return res.status(400).json({ message: "No lines to import" });
        }
        if (rawLines.length > MAX_IMPORT_LINES) {
          return res.status(400).json({
            message: `Import is limited to ${MAX_IMPORT_LINES.toLocaleString()} lines at a time`,
          });
        }

        const validation = normalizeProformaImportLines(rawLines);
        if (validation.errors.length > 0 || validation.lines.length !== rawLines.length) {
          const firstErrors = validation.errors.slice(0, 5);
          const remaining = Math.max(0, validation.errors.length - firstErrors.length);
          return res.status(400).json({
            message: `Import stopped: ${firstErrors.join("; ")}${remaining ? `; plus ${remaining} more issue${remaining === 1 ? "" : "s"}` : ""}`,
            errors: validation.errors,
          });
        }

        const { map: aliasMap } = await buildAliasMap(companyId);
        const lineValues: InsertableLine[] = validation.lines.map((line) => ({
          ...line,
          proformaId,
          barcode: resolveBarcode(line.barcode, aliasMap),
        }));

        try {
          await insertAtomically(lineValues);
        } catch (bulkError: unknown) {
          // The first transaction is rolled back before this fallback. Retrying
          // one row at a time avoids oversized multi-row parameter payloads while
          // keeping the entire import all-or-nothing inside a fresh transaction.
          logger.warn("Supplier proforma bulk import insert failed; retrying row-by-row", {
            companyId,
            supplierId,
            proformaId,
            rowCount: lineValues.length,
            errorType: bulkError instanceof Error ? bulkError.name : typeof bulkError,
          });
          await insertAtomicallyOneByOne(lineValues);
        }

        await db.update(supplierProformas).set({ updatedAt: new Date() }).where(eq(supplierProformas.id, proformaId));
        const allLines = await db
          .select()
          .from(supplierProformaLines)
          .where(eq(supplierProformaLines.proformaId, proformaId));

        return res.json({ imported: lineValues.length, lines: allLines });
      } catch (error: unknown) {
        logger.error("Supplier proforma import failed", {
          companyId: companyId || null,
          supplierId,
          proformaId,
          errorType: error instanceof Error ? error.name : typeof error,
        });
        return res.status(500).json({
          message: "Import could not be saved. No rows were imported. Check the spreadsheet values and try again.",
        });
      }
    }
  );
}
