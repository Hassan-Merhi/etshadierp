import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import {
  customerOrders, customers,
  factoryShippingContainerRows, factoryShippingContainerDocuments,
} from "@shared/schema";
import { eq, and, desc, inArray, isNull, sql } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import http from "http";
import archiver from "archiver";

function getCompanyId(req: any): number | null {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId || null;
}

const scrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

/** Internal HTTP fetch — reuses session cookie so requireAuth passes. */
function fetchInternalBuffer(req: any, urlPath: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      const localPort = (req.socket as any)?.localPort || process.env.PORT || 5000;
      const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: Number(localPort),
        path: urlPath,
        method: "GET",
        headers: { cookie: req.headers.cookie || "" },
      };
      const chunks: Buffer[] = [];
      const r = http.request(options, (res2) => {
        if ((res2.statusCode ?? 0) >= 400) { resolve(null); return; }
        res2.on("data", (d: Buffer) => chunks.push(d));
        res2.on("end", () => resolve(Buffer.concat(chunks)));
        res2.on("error", () => resolve(null));
      });
      r.on("error", () => resolve(null));
      r.setTimeout(30000, () => { r.destroy(); resolve(null); });
      r.end();
    } catch { resolve(null); }
  });
}

export function registerFactoryShippingContainerRoutes(app: Express) {

  // ── GET available-invoices for dropdown ──────────────────────────────────────
  // Must be registered BEFORE /:id routes so Express doesn't treat "available-invoices" as an id.
  app.get("/api/factory/shipping-container-rows/available-invoices", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          customerName: customers.legalName,
          customerPhone: customers.phone,
          status: customerOrders.status,
          orderDate: customerOrders.orderDate,
          loadingDate: customerOrders.loadingStartedAt,
          finalizedDate: customerOrders.loadingFinalizedAt,
          containerNumber: customerOrders.containerNumber,
          shippingCompany: customerOrders.shippingCompany,
          destination: customerOrders.destination,
          alreadyHasRow: sql<boolean>`EXISTS (
            SELECT 1 FROM factory_shipping_container_rows fscr
            WHERE fscr.customer_order_id = ${customerOrders.id}
              AND fscr.company_id = ${companyId}
          )`,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(
          eq(customerOrders.companyId, companyId),
          isNull(customerOrders.deletedAt),
          sql`${customerOrders.status} = ANY(ARRAY['LOADING','PENDING_VERIFICATION','VERIFIED','FINALIZED'])`,
        ))
        .orderBy(desc(customerOrders.createdAt));

      res.json(rows);
    } catch (error: any) {
      console.error("Error fetching available invoices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── GET list all shipping container rows ─────────────────────────────────────
  app.get("/api/factory/shipping-container-rows", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select({
          // Row fields
          id: factoryShippingContainerRows.id,
          companyId: factoryShippingContainerRows.companyId,
          customerOrderId: factoryShippingContainerRows.customerOrderId,
          orderDate: factoryShippingContainerRows.orderDate,
          containerArrivedDate: factoryShippingContainerRows.containerArrivedDate,
          note: factoryShippingContainerRows.note,
          isDone: factoryShippingContainerRows.isDone,
          doneAt: factoryShippingContainerRows.doneAt,
          doneBy: factoryShippingContainerRows.doneBy,
          whatsappSentAt: factoryShippingContainerRows.whatsappSentAt,
          createdAt: factoryShippingContainerRows.createdAt,
          // Live from customer_orders (source of truth)
          invoiceNumber: customerOrders.invoiceNumber,
          customerId: customerOrders.customerId,
          clientName: customers.legalName,
          customerPhone: customers.phone,
          status: customerOrders.status,
          loadingDate: customerOrders.loadingStartedAt,
          finalizedDate: customerOrders.loadingFinalizedAt,
          containerNumber: customerOrders.containerNumber,
          shippingCompany: customerOrders.shippingCompany,
          destination: customerOrders.destination,
          documentCount: sql<number>`(
            SELECT COUNT(*)::int FROM factory_shipping_container_documents fscd
            WHERE fscd.scr_id = ${factoryShippingContainerRows.id}
          )`,
        })
        .from(factoryShippingContainerRows)
        .innerJoin(customerOrders, eq(factoryShippingContainerRows.customerOrderId, customerOrders.id))
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(eq(factoryShippingContainerRows.companyId, companyId))
        .orderBy(desc(factoryShippingContainerRows.createdAt));

      res.json(rows);
    } catch (error: any) {
      console.error("Error fetching shipping container rows:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── POST create row ───────────────────────────────────────────────────────────
  app.post("/api/factory/shipping-container-rows", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerOrderId, orderDate, containerArrivedDate, note } = req.body;
      if (!customerOrderId || !orderDate) {
        return res.status(400).json({ message: "customerOrderId and orderDate are required" });
      }

      // Verify the order belongs to this company
      const [order] = await db
        .select({ id: customerOrders.id })
        .from(customerOrders)
        .where(and(
          eq(customerOrders.id, Number(customerOrderId)),
          eq(customerOrders.companyId, companyId),
          isNull(customerOrders.deletedAt),
        ));
      if (!order) return res.status(404).json({ message: "Invoice not found" });

      // Uniqueness check (belt-and-suspenders on top of the DB unique index)
      const existing = await db
        .select({ id: factoryShippingContainerRows.id })
        .from(factoryShippingContainerRows)
        .where(and(
          eq(factoryShippingContainerRows.companyId, companyId),
          eq(factoryShippingContainerRows.customerOrderId, Number(customerOrderId)),
        ))
        .limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ message: "This invoice already has a shipping container row" });
      }

      const [newRow] = await db.insert(factoryShippingContainerRows).values({
        companyId,
        customerOrderId: Number(customerOrderId),
        orderDate,
        containerArrivedDate: containerArrivedDate || null,
        note: note || null,
      }).returning();

      res.status(201).json(newRow);
    } catch (error: any) {
      console.error("Error creating shipping container row:", error);
      if (error.code === "23505") {
        return res.status(409).json({ message: "This invoice already has a shipping container row" });
      }
      res.status(400).json({ message: error.message });
    }
  });

  // ── PATCH update row-only fields (arrived date, note) ────────────────────────
  app.patch("/api/factory/shipping-container-rows/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [existing] = await db
        .select({ id: factoryShippingContainerRows.id })
        .from(factoryShippingContainerRows)
        .where(and(
          eq(factoryShippingContainerRows.id, id),
          eq(factoryShippingContainerRows.companyId, companyId),
        ));
      if (!existing) return res.status(404).json({ message: "Row not found" });

      const patch: any = { updatedAt: new Date() };
      if (req.body.containerArrivedDate !== undefined) patch.containerArrivedDate = req.body.containerArrivedDate || null;
      if (req.body.note !== undefined) patch.note = req.body.note || null;

      const [updated] = await db
        .update(factoryShippingContainerRows)
        .set(patch)
        .where(eq(factoryShippingContainerRows.id, id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating shipping container row:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ── PATCH sync editable fields to customer_orders ────────────────────────────
  app.patch("/api/factory/shipping-container-rows/:id/sync-order", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [row] = await db
        .select({ customerOrderId: factoryShippingContainerRows.customerOrderId })
        .from(factoryShippingContainerRows)
        .where(and(
          eq(factoryShippingContainerRows.id, id),
          eq(factoryShippingContainerRows.companyId, companyId),
        ));
      if (!row) return res.status(404).json({ message: "Row not found" });

      const patch: any = { updatedAt: new Date() };
      if (req.body.containerNumber !== undefined) patch.containerNumber = req.body.containerNumber || null;
      if (req.body.shippingCompany !== undefined) patch.shippingCompany = req.body.shippingCompany || null;
      if (req.body.destination !== undefined) patch.destination = req.body.destination || null;

      const [updated] = await db
        .update(customerOrders)
        .set(patch)
        .where(and(
          eq(customerOrders.id, row.customerOrderId),
          eq(customerOrders.companyId, companyId),
        ))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error syncing order fields:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ── POST mark as done ─────────────────────────────────────────────────────────
  app.post("/api/factory/shipping-container-rows/:id/done", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [existing] = await db
        .select({ id: factoryShippingContainerRows.id })
        .from(factoryShippingContainerRows)
        .where(and(
          eq(factoryShippingContainerRows.id, id),
          eq(factoryShippingContainerRows.companyId, companyId),
        ));
      if (!existing) return res.status(404).json({ message: "Row not found" });

      const username: string =
        (req.session as any).username ||
        (req.session as any).email ||
        (req.session as any).name ||
        "Unknown";
      const now = new Date();

      const patch: any = { isDone: true, doneAt: now, doneBy: username, updatedAt: now };
      if (req.body.markWhatsappSent) patch.whatsappSentAt = now;

      const [updated] = await db
        .update(factoryShippingContainerRows)
        .set(patch)
        .where(eq(factoryShippingContainerRows.id, id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error marking row as done:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ── POST restore ──────────────────────────────────────────────────────────────
  app.post("/api/factory/shipping-container-rows/:id/restore", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [existing] = await db
        .select({ id: factoryShippingContainerRows.id })
        .from(factoryShippingContainerRows)
        .where(and(
          eq(factoryShippingContainerRows.id, id),
          eq(factoryShippingContainerRows.companyId, companyId),
        ));
      if (!existing) return res.status(404).json({ message: "Row not found" });

      const [updated] = await db
        .update(factoryShippingContainerRows)
        .set({ isDone: false, doneAt: null, doneBy: null, whatsappSentAt: null, updatedAt: new Date() })
        .where(eq(factoryShippingContainerRows.id, id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error restoring row:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ── GET documents for a row ───────────────────────────────────────────────────
  app.get("/api/factory/shipping-container-rows/:id/documents", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [row] = await db
        .select({ id: factoryShippingContainerRows.id })
        .from(factoryShippingContainerRows)
        .where(and(
          eq(factoryShippingContainerRows.id, id),
          eq(factoryShippingContainerRows.companyId, companyId),
        ));
      if (!row) return res.status(404).json({ message: "Row not found" });

      const docs = await db
        .select({
          id: factoryShippingContainerDocuments.id,
          scrId: factoryShippingContainerDocuments.scrId,
          displayName: factoryShippingContainerDocuments.displayName,
          fileName: factoryShippingContainerDocuments.fileName,
          originalName: factoryShippingContainerDocuments.originalName,
          fileUrl: factoryShippingContainerDocuments.fileUrl,
          fileType: factoryShippingContainerDocuments.fileType,
          fileSize: factoryShippingContainerDocuments.fileSize,
          uploadedBy: factoryShippingContainerDocuments.uploadedBy,
          uploadedAt: factoryShippingContainerDocuments.uploadedAt,
          // fileData intentionally excluded — large blob not needed for listing
        })
        .from(factoryShippingContainerDocuments)
        .where(and(
          eq(factoryShippingContainerDocuments.scrId, id),
          eq(factoryShippingContainerDocuments.companyId, companyId),
        ))
        .orderBy(factoryShippingContainerDocuments.uploadedAt);

      res.json(docs);
    } catch (error: any) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── POST upload document ──────────────────────────────────────────────────────
  app.post(
    "/api/factory/shipping-container-rows/:id/documents",
    requireAuth,
    scrUpload.single("file"),
    async (req: any, res: any) => {
      try {
        const companyId = getCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const [row] = await db
          .select({ id: factoryShippingContainerRows.id })
          .from(factoryShippingContainerRows)
          .where(and(
            eq(factoryShippingContainerRows.id, id),
            eq(factoryShippingContainerRows.companyId, companyId),
          ));
        if (!row) return res.status(404).json({ message: "Row not found" });

        const displayName: string = (req.body.displayName as string)?.trim() ||
          req.file.originalname.replace(/\.[^.]+$/, "");
        const ext = path.extname(req.file.originalname);
        const generatedFilename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        const fileUrl = `/api/factory/shipping-container-docs/${generatedFilename}`;
        const fileData = req.file.buffer.toString("base64");

        // Disk cache (non-fatal — DB is source of truth)
        try {
          const dir = path.join(process.cwd(), "uploads", "shipping-container-docs");
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, generatedFilename), req.file.buffer);
        } catch (e) {
          console.warn("Shipping container doc disk cache write failed (non-fatal):", e);
        }

        const username: string =
          (req.session as any).username ||
          (req.session as any).email ||
          (req.session as any).name ||
          null;

        const [doc] = await db
          .insert(factoryShippingContainerDocuments)
          .values({
            companyId,
            scrId: id,
            displayName,
            fileName: generatedFilename,
            originalName: req.file.originalname,
            fileUrl,
            fileType: req.file.mimetype,
            fileSize: req.file.size,
            fileData,
            uploadedBy: username,
          })
          .returning({
            id: factoryShippingContainerDocuments.id,
            scrId: factoryShippingContainerDocuments.scrId,
            displayName: factoryShippingContainerDocuments.displayName,
            fileName: factoryShippingContainerDocuments.fileName,
            originalName: factoryShippingContainerDocuments.originalName,
            fileUrl: factoryShippingContainerDocuments.fileUrl,
            fileType: factoryShippingContainerDocuments.fileType,
            fileSize: factoryShippingContainerDocuments.fileSize,
            uploadedBy: factoryShippingContainerDocuments.uploadedBy,
            uploadedAt: factoryShippingContainerDocuments.uploadedAt,
          });

        res.json(doc);
      } catch (error: any) {
        console.error("Error uploading document:", error);
        res.status(400).json({ message: error.message });
      }
    },
  );

  // ── DELETE document ───────────────────────────────────────────────────────────
  app.delete(
    "/api/factory/shipping-container-rows/:id/documents/:docId",
    requireAuth,
    async (req: any, res: any) => {
      try {
        const companyId = getCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const id = parseInt(req.params.id);
        const docId = parseInt(req.params.docId);
        if (isNaN(id) || isNaN(docId)) return res.status(400).json({ message: "Invalid id" });

        // Verify ownership through both tables in one query
        const [doc] = await db
          .select({
            id: factoryShippingContainerDocuments.id,
            fileName: factoryShippingContainerDocuments.fileName,
          })
          .from(factoryShippingContainerDocuments)
          .innerJoin(
            factoryShippingContainerRows,
            eq(factoryShippingContainerDocuments.scrId, factoryShippingContainerRows.id),
          )
          .where(and(
            eq(factoryShippingContainerDocuments.id, docId),
            eq(factoryShippingContainerDocuments.scrId, id),
            eq(factoryShippingContainerRows.companyId, companyId),
          ));
        if (!doc) return res.status(404).json({ message: "Document not found" });

        await db
          .delete(factoryShippingContainerDocuments)
          .where(eq(factoryShippingContainerDocuments.id, docId));

        // Remove disk cache (non-fatal)
        try {
          const diskPath = path.join(process.cwd(), "uploads", "shipping-container-docs", doc.fileName);
          if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
        } catch {}

        res.json({ success: true });
      } catch (error: any) {
        console.error("Error deleting document:", error);
        res.status(400).json({ message: error.message });
      }
    },
  );

  // ── GET serve document file ───────────────────────────────────────────────────
  app.get("/api/factory/shipping-container-docs/:filename", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const filename = req.params.filename;

      // Try disk cache first
      const diskPath = path.join(process.cwd(), "uploads", "shipping-container-docs", filename);
      if (fs.existsSync(diskPath)) return res.sendFile(diskPath);

      // Fall back to DB
      const [docRow] = await db
        .select({
          fileData: factoryShippingContainerDocuments.fileData,
          fileType: factoryShippingContainerDocuments.fileType,
          originalName: factoryShippingContainerDocuments.originalName,
          companyId: factoryShippingContainerDocuments.companyId,
        })
        .from(factoryShippingContainerDocuments)
        .where(eq(factoryShippingContainerDocuments.fileName, filename));

      if (!docRow) return res.status(404).json({ message: "File not found" });
      if (docRow.companyId !== companyId) return res.status(403).json({ message: "Forbidden" });
      if (!docRow.fileData) return res.status(404).json({ message: "File data unavailable" });

      const buffer = Buffer.from(docRow.fileData, "base64");
      if (docRow.fileType) res.setHeader("Content-Type", docRow.fileType);
      res.setHeader("Content-Disposition", `attachment; filename="${docRow.originalName}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Error serving document:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── GET WhatsApp preview ──────────────────────────────────────────────────────
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
        .where(and(
          eq(factoryShippingContainerRows.id, id),
          eq(factoryShippingContainerRows.companyId, companyId),
        ));
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
        .where(and(
          eq(factoryShippingContainerDocuments.scrId, id),
          eq(factoryShippingContainerDocuments.companyId, companyId),
        ))
        .orderBy(factoryShippingContainerDocuments.uploadedAt);

      const files: any[] = [
        {
          id: "invoice_pdf",
          name: `Commercial Invoice — ${row.invoiceNumber || ""}`,
          fileType: "PDF",
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

      const availableNames = files.filter((f) => f.available).map((f) => `- ${f.name}`).join("\n");
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
    } catch (error: any) {
      console.error("Error building WhatsApp preview:", error);
      res.status(500).json({ message: error.message });
    }
  });

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
        })
        .from(factoryShippingContainerRows)
        .innerJoin(customerOrders, eq(factoryShippingContainerRows.customerOrderId, customerOrders.id))
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(
          eq(factoryShippingContainerRows.id, id),
          eq(factoryShippingContainerRows.companyId, companyId),
        ));
      if (!row) return res.status(404).json({ message: "Row not found" });

      const safeName = (row.invoiceNumber || `row_${id}`).replace(/[^\w\-]/g, "_");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="shipping_package_${safeName}.zip"`);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", (err) => {
        console.error("Archiver error:", err);
        if (!res.headersSent) res.status(500).end();
      });
      archive.pipe(res);

      // 1. Commercial invoice PDF
      if (fileIds.includes("invoice_pdf")) {
        const buf = await fetchInternalBuffer(
          req,
          `/api/factory/customer-orders/${row.customerOrderId}/export-pdf`,
        );
        if (buf) archive.append(buf, { name: `Commercial_Invoice_${safeName}.pdf` });
      }

      // 2. Customer statement PDF
      if (fileIds.includes("statement_pdf") && row.customerId) {
        const safeClient = (row.clientName || "client").replace(/[^\w\-]/g, "_");
        const buf = await fetchInternalBuffer(
          req,
          `/api/factory/customers/${row.customerId}/statement/export-pdf`,
        );
        if (buf) archive.append(buf, { name: `Customer_Statement_${safeClient}.pdf` });
      }

      // 3. Uploaded documents
      const docIdNumbers = fileIds
        .filter((f) => f.startsWith("doc_"))
        .map((f) => parseInt(f.slice(4)))
        .filter((n) => !isNaN(n));

      if (docIdNumbers.length > 0) {
        const docs = await db
          .select({
            fileName: factoryShippingContainerDocuments.fileName,
            originalName: factoryShippingContainerDocuments.originalName,
            fileData: factoryShippingContainerDocuments.fileData,
          })
          .from(factoryShippingContainerDocuments)
          .where(and(
            inArray(factoryShippingContainerDocuments.id, docIdNumbers),
            eq(factoryShippingContainerDocuments.scrId, id),
            eq(factoryShippingContainerDocuments.companyId, companyId),
          ));

        for (const doc of docs) {
          const diskPath = path.join(process.cwd(), "uploads", "shipping-container-docs", doc.fileName);
          if (fs.existsSync(diskPath)) {
            archive.file(diskPath, { name: doc.originalName });
          } else if (doc.fileData) {
            const buf = Buffer.from(doc.fileData, "base64");
            archive.append(buf, { name: doc.originalName });
          }
        }
      }

      await archive.finalize();
    } catch (error: any) {
      console.error("Error generating ZIP package:", error);
      if (!res.headersSent) res.status(500).json({ message: error.message });
    }
  });
}
