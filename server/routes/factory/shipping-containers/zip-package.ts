/**
 * factoryShippingContainerRoutes: ShippingZipPackage endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
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
  app.get("/api/factory/shipping-container-rows/:id/zip-package", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const fileIds: string[] = ((req.query.fileIds as string) || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (fileIds.length === 0) return res.status(400).json({ message: "No files selected" });

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

      function safeZipEntryName(name: string | null | undefined, fallback: string): string {
        const leaf = (name || "")
          .split(/[\\/]/)
          .pop()
          ?.replace(/[\r\n]/g, "")
          .trim();
        return leaf || fallback;
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

        // Fetch generated files and stored documents in parallel. Every selected
        // item must resolve to non-empty bytes; otherwise we fail instead of
        // returning a valid-looking ZIP with no files inside it.
        (async () => {
          try {
            const docIdNumbers = fileIds
              .filter((f) => f.startsWith("doc_"))
              .map((f) => parseInt(f.slice(4)))
              .filter((n) => !isNaN(n));

            const [excelBuf, pdfBuf, docs] = await Promise.all([
              fileIds.includes("invoice_excel")
                ? fetchInternalBuffer(req, `/api/factory/customer-orders/${row.customerOrderId}/export-excel`)
                : Promise.resolve(null),
              fileIds.includes("statement_pdf") && row.customerId
                ? fetchInternalBuffer(req, `/api/factory/customers/${row.customerId}/statement/export-pdf`)
                : Promise.resolve(null),
              docIdNumbers.length > 0
                ? db
                    .select({
                      id: factoryShippingContainerDocuments.id,
                      fileName: factoryShippingContainerDocuments.fileName,
                      originalName: factoryShippingContainerDocuments.originalName,
                      displayName: factoryShippingContainerDocuments.displayName,
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
                      displayName: string | null;
                      fileData: string | null;
                    }>
                  ),
            ]);

            const missingFiles: string[] = [];
            let appendedEntries = 0;

            if (fileIds.includes("invoice_excel")) {
              if (excelBuf && excelBuf.length > 0) {
                const excelName = buildZipFilename([row.containerNumber, row.clientName, row.destination], "xlsx");
                archive.append(excelBuf, { name: excelName });
                appendedEntries += 1;
              } else {
                missingFiles.push("Commercial Invoice");
              }
            }

            if (fileIds.includes("statement_pdf")) {
              if (pdfBuf && pdfBuf.length > 0) {
                const safeClient = (row.clientName || "client").replace(/[^\w-]/g, "_");
                archive.append(pdfBuf, { name: `Customer_Statement_${safeClient}.pdf` });
                appendedEntries += 1;
              } else {
                missingFiles.push("Customer Statement");
              }
            }

            const docsById = new Map(docs.map((doc) => [doc.id, doc]));
            for (const docId of docIdNumbers) {
              const doc = docsById.get(docId);
              if (!doc) {
                missingFiles.push(`Uploaded document ${docId}`);
                continue;
              }

              const entryName = safeZipEntryName(
                doc.originalName?.trim() || doc.displayName?.trim() || doc.fileName?.trim(),
                `document_${doc.id}`
              );

              let fileBuffer: Buffer | null = null;
              if (doc.fileData?.trim()) {
                const decoded = Buffer.from(doc.fileData, "base64");
                if (decoded.length > 0) fileBuffer = decoded;
              }

              // Disk is only a cache in production, but keeping this fallback lets
              // older rows still download if their cache happens to be present.
              if (!fileBuffer && doc.fileName?.trim()) {
                const diskPath = path.join(process.cwd(), "uploads", "shipping-container-docs", doc.fileName);
                if (fs.existsSync(diskPath)) {
                  const diskBuffer = fs.readFileSync(diskPath);
                  if (diskBuffer.length > 0) fileBuffer = diskBuffer;
                }
              }

              if (!fileBuffer) {
                missingFiles.push(entryName);
                continue;
              }

              archive.append(fileBuffer, { name: entryName });
              appendedEntries += 1;
            }

            if (missingFiles.length > 0) {
              throw new Error(
                `Selected files are unavailable or empty: ${missingFiles.join(", ")}. Refresh the file list and re-upload any broken documents.`
              );
            }
            if (appendedEntries === 0) {
              throw new Error("No selected files contained downloadable data. Refresh the file list and try again.");
            }

            await archive.finalize();
          } catch (innerErr) {
            archive.abort();
            reject(innerErr);
          }
        })();
      });

      // Only send response after the ZIP is fully built — clean, no partial writes.
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
