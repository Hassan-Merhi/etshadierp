/**
 * factoryShippingContainerRoutes: ShippingWhatsappPreview endpoints.
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
import { eq, and } from "drizzle-orm";
import { getCompanyId } from "./_helpers";

export function registerShippingWhatsappPreviewRoutes(app: Express) {
  app.get("/api/factory/shipping-container-rows/:id/whatsapp-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [row] = await db
        .select({
          id: factoryShippingContainerRows.id,
          customerOrderId: factoryShippingContainerRows.customerOrderId,
          invoiceNumber: customerOrders.invoiceNumber,
          customerId: customerOrders.customerId,
          clientName: customers.legalName,
          customerPhone: customers.phone,
          containerNumber: customerOrders.containerNumber,
          shippingCompany: customerOrders.shippingCompany,
          destination: customerOrders.destination,
        })
        .from(factoryShippingContainerRows)
        .innerJoin(customerOrders, eq(factoryShippingContainerRows.customerOrderId, customerOrders.id))
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(factoryShippingContainerRows.id, id), eq(factoryShippingContainerRows.companyId, companyId)));
      if (!row) return res.status(404).json({ message: "Row not found" });

      const docs = await db
        .select({
          id: factoryShippingContainerDocuments.id,
          displayName: factoryShippingContainerDocuments.displayName,
          originalName: factoryShippingContainerDocuments.originalName,
          fileType: factoryShippingContainerDocuments.fileType,
          fileUrl: factoryShippingContainerDocuments.fileUrl,
        })
        .from(factoryShippingContainerDocuments)
        .where(
          and(
            eq(factoryShippingContainerDocuments.scrId, id),
            eq(factoryShippingContainerDocuments.companyId, companyId)
          )
        )
        .orderBy(factoryShippingContainerDocuments.uploadedAt);

      const files: any[] = [
        {
          id: "invoice_excel",
          name: `Commercial Invoice — ${row.invoiceNumber || ""}`,
          fileType: "XLSX",
          source: "Commercial Invoice",
          available: true,
        },
        {
          id: "statement_pdf",
          name: `Customer Statement — ${row.clientName || "Customer"}`,
          fileType: "PDF",
          source: "Customer Statement",
          available: !!row.customerId,
          unavailableReason: row.customerId ? undefined : "No customer linked to invoice",
        },
        ...docs.map((d) => ({
          id: `doc_${d.id}`,
          name: d.displayName,
          fileType: (d.fileType || "application/octet-stream").split("/").pop()?.toUpperCase() || "FILE",
          source: "Uploaded Document",
          available: true,
          fileUrl: d.fileUrl,
        })),
      ];

      const availableNames = files
        .filter((f) => f.available)
        .map((f) => `- ${f.name}`)
        .join("\n");
      const defaultMessage = [
        "Hello,",
        "",
        "Please find attached the documents for:",
        "",
        `Client: ${row.clientName || "—"}`,
        `Invoice: ${row.invoiceNumber || "—"}`,
        `Container: ${row.containerNumber || "—"}`,
        `Destination: ${row.destination || "—"}`,
        `Shipping Company: ${row.shippingCompany || "—"}`,
        "",
        "Documents attached:",
        availableNames || "- (none selected)",
        "",
        "Thank you.",
      ].join("\n");

      res.json({
        row,
        files,
        defaultMessage,
        whatsappContact: row.customerPhone || null,
      });
    } catch (error: unknown) {
      logger.error("Error building WhatsApp preview:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
