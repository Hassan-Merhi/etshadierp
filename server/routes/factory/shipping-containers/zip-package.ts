/**
 * factoryShippingContainerRoutes: ShippingZipPackage endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import {
  customerOrders,
  customers,
  factoryShippingContainerRows,
  factoryShippingContainerDocuments,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import path from "path";
import fs from "fs";
import archiver from "archiver";

import { fetchInternalBuffer, getCompanyId } from "./_helpers";

export function registerShippingZipPackageRoutes(app: Express) {
  // ── GET download ZIP package ──────────────────────────────────────────────────
  app.get("/api/factory/shipping-container-rows/:id/zip-package", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const fileIds: string[] = ((req.query.fileIds as string) || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      const [row] = await db
        .select({
          id: factoryShippingContainerRows.id,
          customerOrderId: factoryShippingContainerRows.customerOrderId,
          invoiceNumber: customerOrders.invoiceNumber,
          customerId: customerOrders.customerId,
          clientName: customers.legalName,
          containerNumber: customerOrders.containerNumber,
          destination: customerOrders.destination,
        })
        .from(factoryShippingContainerRows)
        .innerJoin(customerOrders, eq(factoryShippingContainerRows.customerOrderId, customerOrders.id))
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(factoryShippingContainerRows.id, id), eq(factoryShippingContainerRows.companyId, companyId)));
      if (!row) return res.status(404).json({ message: "Row not found" });

      function safeFilePart(s: string | null | undefined): string {
        return (s || "")
          .replace(/[^\x20-\x7E]/g, "") // strip non-ASCII (prevents ERR_INVALID_CHAR in headers)
          .replace(/"/g, "")
          .replace(/[\\/*?:[\]<>|]/g, "")
          .replace(/\s+/g, "_")
          .trim();
      }
      function buildZipFilename(parts: (string | null | undefined)[], ext: string): string {
        const joined = parts.map(safeFilePart).filter(Boolean).join("_") || "export";
        return ext ? `${joined}.${ext}` : joined;
      }

      const zipFilename = buildZipFilename([row.containerNumber, row.clientName, row.destination], "zip");

      // Build the entire ZIP in memory before touching the response.
      // This prevents ERR_INVALID_RESPONSE: if we pipe archiver to res immediately
      // and then something fails mid-stream, the response is unrecoverably corrupted.
      const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 6 } });
        const chunks: Buffer[] = [];

        archive.on("data", (chunk: Buffer) => chunks.push(chunk));
        archive.on("end", () => resolve(Buffer.concat(chunks)));
        archive.on("error", (err) => reject(err));

        // Kick off all fetches in parallel, then append and finalize.
        // Previously the Excel fetch and PDF fetch were awaited sequentially — each
        // can take 5-15 s, so sequential = 10-30 s total. Running them concurrently
        // means total wait ≈ max(Excel, PDF, DB) instead of sum.
        (async () => {
          try {
            const docIdNumbers = fileIds
              .filter((f) => f.startsWith("doc_"))
              .map((f) => parseInt(f.slice(4)))
              .filter((n) => !isNaN(n));

            // Fan out all slow operations simultaneously
            const [excelBuf, pdfBuf, docs] = await Promise.all([
              // 1. Commercial invoice Excel
              fileIds.includes("invoice_excel")
                ? fetchInternalBuffer(req, `/api/factory/customer-orders/${row.customerOrderId}/export-excel`)
                : Promise.resolve(null),

              // 2. Customer statement PDF
              fileIds.includes("statement_pdf") && row.customerId
                ? fetchInternalBuffer(req, `/api/factory/customers/${row.customerId}/statement/export-pdf`)
                : Promise.resolve(null),

              // 3. Uploaded documents from DB
              docIdNumbers.length > 0
                ? db
                    .select({
                      id: factoryShippingContainerDocuments.id,
                      fileName: factoryShippingContainerDocuments.fileName,
                      originalName: factoryShippingContainerDocuments.originalName,
                      fileData: factoryShippingContainerDocuments.fileData,
                    })
                    .from(factoryShippingContainerDocuments)
                    .where(
                      and(
                        inArray(factoryShippingContainerDocuments.id, docIdNumbers),
                        eq(factoryShippingContainerDocuments.scrId, id),
                        eq(factoryShippingContainerDocuments.companyId, companyId)
                      )
                    )
                : Promise.resolve(
                    [] as Array<{
                      id: number;
                      fileName: string | null;
                      originalName: string | null;
                      fileData: string | null;
                    }>
                  ),
            ]);

            // Append results into the archive (order doesn't matter for ZIP)
            if (excelBuf) {
              const excelName = buildZipFilename([row.containerNumber, row.clientName, row.destination], "xlsx");
              archive.append(excelBuf, { name: excelName });
            }

            if (pdfBuf) {
              const safeClient = (row.clientName || "client").replace(/[^\w\-]/g, "_");
              archive.append(pdfBuf, { name: `Customer_Statement_${safeClient}.pdf` });
            }

            for (const doc of docs) {
              const entryName = doc.originalName?.trim() || doc.fileName?.trim() || `document_${doc.id}`;
              const diskPath = path.join(process.cwd(), "uploads", "shipping-container-docs", doc.fileName || "");
              if (doc.fileName && fs.existsSync(diskPath)) {
                archive.file(diskPath, { name: entryName });
              } else if (doc.fileData) {
                const buf = Buffer.from(doc.fileData, "base64");
                archive.append(buf, { name: entryName });
              }
            }

            await archive.finalize();
          } catch (innerErr) {
            archive.abort();
            reject(innerErr);
          }
        })();
      });

      // Only send response after the ZIP is fully built — clean, no partial writes
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);
      res.setHeader("Content-Length", zipBuffer.length);
      res.end(zipBuffer);
    } catch (error: unknown) {
      logger.error("Error generating ZIP package:", { error: error });
      if (!res.headersSent) res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
