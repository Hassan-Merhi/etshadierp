import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
} from "./_helpers";
import {
  factorySuppliers, factoryCategories, factoryBaleProducts,
  factoryContainers, factoryRawStock, factoryMixBatches,
  factoryMixBatchSources, factoryDailyUsages, factoryPressingBatches,
  factoryBales, factoryBaleSequences, factoryContainerCommissions,
  baleLabelPrints, stockItems, stockGroups, users,
  insertFactorySupplierSchema, insertFactoryCategorySchema,
  insertFactoryBaleProductSchema, insertFactoryContainerSchema,
  insertFactoryRawStockSchema, insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema, insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema, customerProformas, customerProformaLines,
  customerOrders, customerOrderLines, customerOrderBales,
  customerOrderCharges, customerInvoiceSequences, customerBalances,
  customers, insertCustomerSchema, ledgerAccounts, voucherEntries,
  companies, locations, userCompanyRoles, insertCustomerProformaSchema,
  insertCustomerProformaLineSchema, insertCustomerOrderSchema,
  factoryFxRates, insertFactoryFxRateSchema, factoryDaybookEntries,
  containerDocumentTypes, containerDocuments, containerFreight,
  containerFreightPayments, factoryDaybookEntryEdits,
  containers, factoryUserProfiles, factoryUserPageAccess,
  insertUserSchema, directMessages, insertDirectMessageSchema,
  userPresence, factoryDutyAuditLog, factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges, companySettings, factorySettings,
  factoryWorkers, factoryWorkerCategories, insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments, factoryPayrolls, factoryWorkerDocuments,
  factoryAlerts, employees, factoryWasteEntries, factoryBalePhotos,
  factoryDailyKpiSnapshots, factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots, factoryContainerProfitSnapshots,
  bankAccounts, inventory, exchangeRates, vouchers, suppliers,
  containerSales, factorySupplierPayments, insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers, insertFactorySupplierFxTransferSchema,
  factoryFxAllocations, baleRecodeSessions, baleRecodeItems,
  factoryWorkerAdvances, factoryAdvanceRepayments, factoryBaleWasteDispatches,
  factoryPosSales, factoryPosSaleItems, proformaStockReservations,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

// ── Ownership helpers ──────────────────────────────────────────────────────────

/** Returns true only if the container exists AND belongs to companyId. */
async function verifyContainerOwnership(containerId: number, companyId: number): Promise<boolean> {
  const rows = await db.select({ id: containers.id })
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.companyId, companyId)));
  return rows.length > 0;
}

/** Returns the containerId for a freight row — or null if not found / wrong company. */
async function getFreightContainerId(freightId: number, companyId: number): Promise<number | null> {
  const rows = await db.select({ containerId: containerFreight.containerId })
    .from(containerFreight)
    .where(and(eq(containerFreight.id, freightId), eq(containerFreight.companyId, companyId)));
  return rows.length > 0 ? rows[0].containerId : null;
}

// Safe file-serving: normalise the path and reject traversal attempts.
function safeSendFile(res: any, folder: string, filename: string) {
  const safeFolder = path.basename(folder);
  const safeFile  = path.basename(filename);
  if (!safeFolder || !safeFile || safeFolder !== folder || safeFile !== filename) {
    return res.status(400).json({ message: "Invalid file path" });
  }
  const filePath = path.join(process.cwd(), "uploads", safeFolder, safeFile);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found" });
  res.sendFile(filePath);
}

export function registerFactoryDocsUsersRoutes(app: Express) {

  // ─────────────────────────────────────────────────────────────────────────────
  // ADMIN OVERRIDE VERIFICATION
  // Validates admin credentials and grants a 10-minute session override token
  // that allows non-admin users to perform admin-only actions after approval.
  // ─────────────────────────────────────────────────────────────────────────────
  app.post("/api/factory/admin-verify", requireAuth, async (req: any, res: any) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required." });
      }

      // Look up the user
      const [targetUser] = await db.select().from(users).where(eq(users.username, username));
      if (!targetUser) {
        return res.status(401).json({ message: "Invalid username or password." });
      }

      // Confirm the user account is active
      if (!targetUser.active) {
        return res.status(403).json({ message: "This account is inactive and cannot authorize actions." });
      }

      // Verify password (bcrypt or legacy SHA256)
      const valid = await (async () => {
        if (isLegacySHA256Hash(targetUser.password)) {
          return verifySupervisorPassword(password, targetUser.password);
        }
        return bcrypt.compare(password, targetUser.password);
      })();

      if (!valid) {
        return res.status(401).json({ message: "Invalid username or password." });
      }

      // Confirm the user has an admin-level role (Admin / Owner / Developer)
      const ADMIN_ROLES = ["Admin", "Owner", "Developer"];
      const companyId = req.session?.factoryCompanyId || req.session?.currentCompanyId;

      let hasAdminRole = false;
      if (companyId) {
        const [roleRow] = await db
          .select({ role: userCompanyRoles.role })
          .from(userCompanyRoles)
          .where(and(eq(userCompanyRoles.userId, targetUser.id), eq(userCompanyRoles.companyId, companyId)));
        if (roleRow && ADMIN_ROLES.includes(roleRow.role)) hasAdminRole = true;
      }

      // Fallback: check any company role
      if (!hasAdminRole) {
        const anyAdminRole = await db
          .select({ role: userCompanyRoles.role })
          .from(userCompanyRoles)
          .where(and(eq(userCompanyRoles.userId, targetUser.id), inArray(userCompanyRoles.role, ADMIN_ROLES)));
        if (anyAdminRole.length > 0) hasAdminRole = true;
      }

      if (!hasAdminRole) {
        return res.status(403).json({ message: "The provided credentials do not belong to an admin user." });
      }

      // Grant a 10-minute override window in the session
      const expiresAt = Date.now() + 10 * 60 * 1000;
      req.session.factoryAdminOverrideUntil = expiresAt;
      req.session.factoryAdminOverrideBy = targetUser.username;

      return res.json({ success: true, expiresAt, adminUsername: targetUser.username });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/container-doc-types", requireAuth, async (req: any, res: any) => {
    try {
      const rows = await db.select().from(containerDocumentTypes).orderBy(containerDocumentTypes.label);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/container-doc-types", requireAuth, async (req: any, res: any) => {
    try {
      const [row] = await db.insert(containerDocumentTypes).values(req.body).returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER DOCUMENTS (upload / list / delete) ───────

  app.get("/api/factory/containers/:containerId/documents", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId || !(await verifyContainerOwnership(containerId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const docs = await db.select().from(containerDocuments).where(eq(containerDocuments.containerId, containerId));
      const docTypes = await db.select().from(containerDocumentTypes).orderBy(containerDocumentTypes.label);
      const requiredTypes = docTypes.filter((dt: any) => dt.isRequired);
      const uploadedTypeIds = new Set(docs.map((d: any) => d.docTypeId));
      const completeness = {
        total: requiredTypes.length,
        uploaded: requiredTypes.filter((rt: any) => uploadedTypeIds.has(rt.id)).length,
        complete: requiredTypes.every((rt: any) => uploadedTypeIds.has(rt.id)),
      };
      res.json({ documents: docs, docTypes, completeness });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers/:containerId/documents", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const path = await import("path");
      const fs = await import("fs");
      const uploadDir = path.default.join(process.cwd(), "uploads", "container-docs");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const storage = multer.diskStorage({
        destination: (_req: any, _file: any, cb: any) => cb(null, uploadDir),
        filename: (_req: any, file: any, cb: any) => {
          const ext = path.default.extname(file.originalname);
          cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        },
      });
      const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });
          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const containerId = Number(req.params.containerId);
          const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
          const docTypeId = Number(req.body.docTypeId);
          if (!companyId || !docTypeId) return res.status(400).json({ message: "Missing companyId or docTypeId" });

          if (!(await verifyContainerOwnership(containerId, companyId))) {
            // Remove the uploaded temp file before rejecting
            if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(403).json({ message: "Access denied" });
          }

          const storageKey = `container-docs/${req.file.filename}`;
          const [doc] = await db.insert(containerDocuments).values({
            companyId,
            containerId,
            docTypeId,
            fileName: req.file.originalname,
            storageKey,
            mimeType: req.file.mimetype,
            uploadedBy: (req.session as any).userId || null,
          }).returning();

          const docType = await db.select().from(containerDocumentTypes).where(eq(containerDocumentTypes.id, docTypeId));
          const docTypeName = docType[0]?.label || "Document";

          await writeDaybookEntry(db, {
            companyId,
            txDate: req.body.txDate || getClientDate(req),
            txType: "DOC_UPLOAD",
            referenceId: containerId,
            referenceTable: "containers",
            description: `Uploaded ${docTypeName}: ${req.file.originalname} for container #${containerId}`,
            metaJson: JSON.stringify({ docId: doc.id, docTypeId, fileName: req.file.originalname }),
            createdBy: (req.session as any).userId || undefined,
          });

          const allDocs = await db.select().from(containerDocuments).where(eq(containerDocuments.containerId, containerId));
          const allDocTypes = await db.select().from(containerDocumentTypes);
          const requiredTypes = allDocTypes.filter((dt: any) => dt.isRequired);
          const uploadedTypeIds = new Set(allDocs.map((d: any) => d.docTypeId));
          const allComplete = requiredTypes.every((rt: any) => uploadedTypeIds.has(rt.id));
          await db.update(containers).set({ docReceived: allComplete }).where(eq(containers.id, containerId));

          res.json(doc);
        } catch (innerErr: any) {
          console.error("Error uploading container document:", innerErr);
          res.status(500).json({ message: innerErr.message });
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/containers/:containerId/documents/:docId", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const docId = Number(req.params.docId);
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;

      if (!companyId || !(await verifyContainerOwnership(containerId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const [deleted] = await db.delete(containerDocuments)
        .where(and(eq(containerDocuments.id, docId), eq(containerDocuments.containerId, containerId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Document not found" });

      const fs = await import("fs");
      const path = await import("path");
      const filePath = path.default.join(process.cwd(), "uploads", deleted.storageKey);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await writeDaybookEntry(db, {
        companyId: companyId || deleted.companyId,
        txDate: req.body?.txDate || getClientDate(req),
        txType: "DOC_DELETE",
        referenceId: containerId,
        referenceTable: "containers",
        description: `Deleted document: ${deleted.fileName} from container #${containerId}`,
        metaJson: JSON.stringify({ docId: deleted.id, fileName: deleted.fileName }),
        createdBy: (req.session as any).userId || undefined,
      });

      const allDocs = await db.select().from(containerDocuments).where(eq(containerDocuments.containerId, containerId));
      const allDocTypes = await db.select().from(containerDocumentTypes);
      const requiredTypes = allDocTypes.filter((dt: any) => dt.isRequired);
      const uploadedTypeIds = new Set(allDocs.map((d: any) => d.docTypeId));
      const allComplete = requiredTypes.length > 0 && requiredTypes.every((rt: any) => uploadedTypeIds.has(rt.id));
      await db.update(containers).set({ docReceived: allComplete }).where(eq(containers.id, containerId));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Authenticated, path-traversal-safe file serving.
  // Only the document's owner company can download a container-doc file.
  app.get("/api/factory/uploads/:folder/:filename", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(403).json({ message: "Access denied" });

      const folder   = String(req.params.folder);
      const filename = String(req.params.filename);

      // Reject any path-traversal attempts
      if (
        folder.includes("..") || folder.includes("/") || folder.includes("\\") ||
        filename.includes("..") || filename.includes("/") || filename.includes("\\")
      ) {
        return res.status(400).json({ message: "Invalid file path" });
      }

      // For container-doc files, verify the requesting company owns a document with that key
      const storageKey = `${folder}/${filename}`;
      if (folder === "container-docs") {
        const [doc] = await db
          .select({ companyId: containerDocuments.companyId })
          .from(containerDocuments)
          .where(eq(containerDocuments.storageKey, storageKey));
        if (!doc || doc.companyId !== companyId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      safeSendFile(res, folder, filename);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER FREIGHT ───────

  app.get("/api/factory/containers/:containerId/freight", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId || !(await verifyContainerOwnership(containerId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }
      const freightRows = await db.select().from(containerFreight).where(eq(containerFreight.containerId, containerId));
      const freightWithPayments = await Promise.all(freightRows.map(async (fr: any) => {
        const payments = await db.select().from(containerFreightPayments)
          .where(eq(containerFreightPayments.containerFreightId, fr.id));
        const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        const freightAmount = Number(fr.freightAmount);
        const computedStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
        return { ...fr, payments, totalPaid, computedStatus };
      }));
      res.json(freightWithPayments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers/:containerId/freight", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      if (!(await verifyContainerOwnership(containerId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      const [row] = await db.insert(containerFreight).values({
        companyId,
        containerId,
        vendorName: req.body.vendorName || null,
        vendorSupplierId: req.body.vendorSupplierId || null,
        freightAmount: String(req.body.freightAmount || 0),
        currency: req.body.currency || "USD",
        dueDate: req.body.dueDate || null,
        status: "UNPAID",
        notes: req.body.notes || null,
      }).returning();

      await writeDaybookEntry(db, {
        companyId,
        txDate: req.body.txDate || getClientDate(req),
        txType: "FREIGHT_ADD",
        referenceId: containerId,
        referenceTable: "containers",
        description: `Added freight charge ${row.currency} ${row.freightAmount} for container #${containerId}${row.vendorName ? ` (${row.vendorName})` : ""}`,
        currencyCode: row.currency,
        amountCurrency: Number(row.freightAmount),
        metaJson: JSON.stringify({ freightId: row.id, vendorName: row.vendorName }),
        createdBy: (req.session as any).userId || undefined,
      });

      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/containers/:containerId/freight/:freightId", requireAuth, async (req: any, res: any) => {
    try {
      const freightId = Number(req.params.freightId);
      const containerId = Number(req.params.containerId);
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;

      if (!companyId || !(await verifyContainerOwnership(containerId, companyId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      await db.delete(containerFreightPayments).where(eq(containerFreightPayments.containerFreightId, freightId));
      const [deleted] = await db.delete(containerFreight)
        .where(and(eq(containerFreight.id, freightId), eq(containerFreight.containerId, containerId), eq(containerFreight.companyId, companyId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Freight not found" });

      await writeDaybookEntry(db, {
        companyId: companyId || deleted.companyId,
        txDate: req.body?.txDate || getClientDate(req),
        txType: "FREIGHT_DELETE",
        referenceId: containerId,
        referenceTable: "containers",
        description: `Deleted freight charge ${deleted.currency} ${deleted.freightAmount} from container #${containerId}`,
        currencyCode: deleted.currency,
        amountCurrency: Number(deleted.freightAmount),
        createdBy: (req.session as any).userId || undefined,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── FREIGHT PAYMENTS ───────

  app.post("/api/factory/freight/:freightId/payments", requireAuth, async (req: any, res: any) => {
    try {
      const freightId = Number(req.params.freightId);
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Verify the freight belongs to this company (via its container)
      const freightContainerId = await getFreightContainerId(freightId, companyId);
      if (freightContainerId === null) return res.status(403).json({ message: "Access denied" });

      const [payment] = await db.insert(containerFreightPayments).values({
        companyId,
        containerFreightId: freightId,
        paymentDate: req.body.paymentDate,
        amount: String(req.body.amount),
        method: req.body.method || null,
        reference: req.body.reference || null,
        createdBy: (req.session as any).userId || null,
      }).returning();

      const [fr] = await db.select().from(containerFreight).where(eq(containerFreight.id, freightId));
      const payments = await db.select().from(containerFreightPayments).where(eq(containerFreightPayments.containerFreightId, freightId));
      const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      const freightAmount = Number(fr.freightAmount);
      const newStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
      await db.update(containerFreight).set({ status: newStatus, updatedAt: new Date() }).where(eq(containerFreight.id, freightId));

      await writeDaybookEntry(db, {
        companyId,
        txDate: req.body.paymentDate || getClientDate(req),
        txType: "FREIGHT_PAYMENT",
        referenceId: fr.containerId,
        referenceTable: "containers",
        description: `Freight payment ${fr.currency} ${req.body.amount} for container #${fr.containerId}${fr.vendorName ? ` (${fr.vendorName})` : ""}`,
        currencyCode: fr.currency,
        amountCurrency: Number(req.body.amount),
        metaJson: JSON.stringify({ freightId, paymentId: payment.id }),
        createdBy: (req.session as any).userId || undefined,
      });

      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/freight/:freightId/payments/:paymentId", requireAuth, async (req: any, res: any) => {
    try {
      const freightId = Number(req.params.freightId);
      const paymentId = Number(req.params.paymentId);
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;

      // Verify the freight belongs to this company
      if (!companyId || (await getFreightContainerId(freightId, companyId)) === null) {
        return res.status(403).json({ message: "Access denied" });
      }

      const [deleted] = await db.delete(containerFreightPayments)
        .where(and(eq(containerFreightPayments.id, paymentId), eq(containerFreightPayments.containerFreightId, freightId), eq(containerFreightPayments.companyId, companyId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Payment not found" });

      const [fr] = await db.select().from(containerFreight).where(eq(containerFreight.id, freightId));
      if (fr) {
        const payments = await db.select().from(containerFreightPayments).where(eq(containerFreightPayments.containerFreightId, freightId));
        const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        const freightAmount = Number(fr.freightAmount);
        const newStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
        await db.update(containerFreight).set({ status: newStatus, updatedAt: new Date() }).where(eq(containerFreight.id, freightId));
      }

      await writeDaybookEntry(db, {
        companyId: companyId || deleted.companyId,
        txDate: req.body?.txDate || getClientDate(req),
        txType: "FREIGHT_PAYMENT_DELETE",
        referenceId: fr?.containerId,
        referenceTable: "containers",
        description: `Deleted freight payment of ${deleted.amount} for freight #${freightId}`,
        amountCurrency: Number(deleted.amount),
        createdBy: (req.session as any).userId || undefined,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── BATCH OTW FREIGHT STATUS ───────

  app.get("/api/factory/containers/freight-status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.json({});
      const allFreight = await db.select().from(containerFreight).where(eq(containerFreight.companyId, companyId));
      const freightIds = allFreight.map((f: any) => f.id);
      let allPayments: any[] = [];
      if (freightIds.length > 0) {
        allPayments = await db.select().from(containerFreightPayments).where(inArray(containerFreightPayments.containerFreightId, freightIds));
      }
      const paymentsByFreight = new Map<number, number>();
      for (const p of allPayments) {
        paymentsByFreight.set(p.containerFreightId, (paymentsByFreight.get(p.containerFreightId) || 0) + Number(p.amount));
      }

      const statusByContainer: Record<number, { totalFreight: number; totalPaid: number; status: string }> = {};
      for (const fr of allFreight) {
        const cid = fr.containerId;
        if (!statusByContainer[cid]) statusByContainer[cid] = { totalFreight: 0, totalPaid: 0, status: "NONE" };
        statusByContainer[cid].totalFreight += Number(fr.freightAmount);
        statusByContainer[cid].totalPaid += paymentsByFreight.get(fr.id) || 0;
      }
      for (const cid of Object.keys(statusByContainer)) {
        const s = statusByContainer[Number(cid)];
        s.status = s.totalFreight === 0 ? "NONE" : s.totalPaid >= s.totalFreight ? "PAID" : s.totalPaid > 0 ? "PARTIAL" : "UNPAID";
      }
      res.json(statusByContainer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── DAYBOOK ENTRY EDIT ───────

  app.put("/api/factory/daybook/:entryId", requireAuth, async (req: any, res: any) => {
    try {
      const rawEntryId = Number(req.params.entryId);
      if (isNaN(rawEntryId)) return res.status(400).json({ message: "Invalid entry ID" });
      const session = req.session as any;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      const userId = session.userId || null;
      const { reason, description, amountCurrency, amountUsd, currencyCode, fxRateToUsd, txDate } = req.body;

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({ message: "Edit reason is required" });
      }

      const currentRole = (session.currentRole || session.role || "").toLowerCase();
      const canEdit = ["admin", "owner", "developer"].includes(currentRole) || session.daybookEditDays > 0;
      if (!canEdit) return res.status(403).json({ message: "You do not have permission to edit daybook entries" });

      let existing: any;
      let realEntryId: number;

      if (rawEntryId < 0) {
        // ── Synthetic row: backed by a voucher not yet in factory_daybook_entries ──
        // Negative ID means Math.abs(rawEntryId) is the voucher ID.
        const realVoucherId = Math.abs(rawEntryId);
        const [sourceVoucher] = await db.select().from(vouchers).where(eq(vouchers.id, realVoucherId));
        if (!sourceVoucher) return res.status(404).json({ message: "Source voucher not found" });

        const voucherTxTypeMap: Record<string, string> = { Payment: "PAYMENT", Receipt: "RECEIPT", Journal: "JOURNAL" };
        const txTypeVal = voucherTxTypeMap[sourceVoucher.voucherType] || "JOURNAL";
        const currency = sourceVoucher.currency || "USD";
        const fxRate = parseFloat(sourceVoucher.exchangeRate || "1") || 1;
        const amtCurrency = parseFloat(sourceVoucher.totalAmount || "0");
        const amtUsd = currency === "USD" ? amtCurrency : amtCurrency * fxRate;

        // Insert a real daybook entry from this voucher so it can be edited going forward
        const [inserted] = await db.insert(factoryDaybookEntries).values({
          companyId,
          txDate: sourceVoucher.voucherDate,
          txType: txTypeVal,
          referenceId: realVoucherId,
          referenceTable: "vouchers",
          description: description !== undefined ? description : (sourceVoucher.description || `${sourceVoucher.voucherType} voucher #${sourceVoucher.voucherNumber}`),
          currencyCode: currency,
          amountCurrency: String(amtCurrency),
          fxRateToUsd: String(fxRate),
          amountUsd: String(amtUsd),
          createdBy: userId,
        }).returning();
        existing = inserted;
        realEntryId = inserted.id;
      } else {
        // ── Real daybook entry ────────────────────────────────────────────────
        const [found] = await db.select().from(factoryDaybookEntries)
          .where(and(eq(factoryDaybookEntries.id, rawEntryId), eq(factoryDaybookEntries.companyId, companyId)));
        if (!found) return res.status(404).json({ message: "Daybook entry not found" });
        existing = found;
        realEntryId = rawEntryId;
      }

      const isPrivilegedRole = ["admin", "owner", "developer"].includes(currentRole);
      if (!isPrivilegedRole && session.daybookEditDays) {
        const entryDate = new Date(existing.txDate);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - session.daybookEditDays);
        if (entryDate < cutoff) {
          return res.status(403).json({ message: `Entry is older than ${session.daybookEditDays} days and cannot be edited` });
        }
      }

      const beforeJson = JSON.stringify(existing);

      const updates: any = {};
      if (description !== undefined) updates.description = description;
      if (amountCurrency !== undefined) updates.amountCurrency = String(amountCurrency);
      if (amountUsd !== undefined) updates.amountUsd = String(amountUsd);
      if (currencyCode !== undefined) updates.currencyCode = currencyCode;
      if (fxRateToUsd !== undefined) updates.fxRateToUsd = String(fxRateToUsd);
      if (txDate !== undefined) updates.txDate = txDate;

      const [updated] = await db.update(factoryDaybookEntries).set(updates).where(eq(factoryDaybookEntries.id, realEntryId)).returning();
      const afterJson = JSON.stringify(updated);

      await db.insert(factoryDaybookEntryEdits).values({
        daybookEntryId: realEntryId,
        editedBy: userId,
        beforeJson,
        afterJson,
        reason: reason.trim(),
      });

      // ── Sync description back to the source voucher so Accounts statements stay in sync ──
      if (description !== undefined && updated.referenceTable === "vouchers" && updated.referenceId) {
        await db.update(vouchers)
          .set({ description })
          .where(and(eq(vouchers.id, updated.referenceId), eq(vouchers.companyId, companyId)));
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error editing daybook entry:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/daybook/:entryId/edits", requireAuth, async (req: any, res: any) => {
    try {
      const entryId = Number(req.params.entryId);
      const edits = await db.select().from(factoryDaybookEntryEdits)
        .where(eq(factoryDaybookEntryEdits.daybookEntryId, entryId))
        .orderBy(desc(factoryDaybookEntryEdits.editedAt));
      res.json(edits);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/factory/daybook/entry/:id/void — Void a voucher-backed daybook entry
  app.delete("/api/factory/daybook/entry/:id/void", requireAuth, async (req: any, res: any) => {
    try {
      const session = req.session as any;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      const role = (session.currentRole || session.role || "").toLowerCase();
      if (role !== "admin" && role !== "owner" && role !== "developer") {
        return res.status(403).json({ message: "Only Admin or Owner can void vouchers" });
      }

      const rawId = Number(req.params.id);
      if (isNaN(rawId)) return res.status(400).json({ message: "Invalid entry ID" });

      let voucherId: number;
      let daybookEntryId: number | null = null;

      if (rawId < 0) {
        voucherId = Math.abs(rawId);
      } else {
        const [entry] = await db.select().from(factoryDaybookEntries)
          .where(and(eq(factoryDaybookEntries.id, rawId), eq(factoryDaybookEntries.companyId, companyId)));
        if (!entry) return res.status(404).json({ message: "Daybook entry not found" });
        if (entry.referenceTable !== "vouchers" || !entry.referenceId) {
          return res.status(400).json({ message: "This entry is not voucher-backed and cannot be voided" });
        }
        voucherId = entry.referenceId;
        daybookEntryId = entry.id;
      }

      const [voucher] = await db.select().from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId), sql`${vouchers.deletedAt} IS NULL`));
      if (!voucher) return res.status(404).json({ message: "Voucher not found or already voided" });

      if (!["Payment", "Receipt", "Journal"].includes(voucher.voucherType)) {
        return res.status(400).json({ message: `Cannot void ${voucher.voucherType} vouchers from the daybook` });
      }

      const vNum = voucher.voucherNumber || "";
      const voucherTxTypeMap: Record<string, string> = { Payment: "PAYMENT", Receipt: "RECEIPT", Journal: "JOURNAL" };
      const txTypeVal = voucherTxTypeMap[voucher.voucherType] || "JOURNAL";
      const today = getClientDate(req);

      await db.transaction(async (tx: any) => {
        // 0. Read employee-linked entries BEFORE deletion so we can reverse balances
        const empEntries = await tx.select().from(voucherEntries)
          .where(and(eq(voucherEntries.voucherId, voucherId), sql`${voucherEntries.employeeId} IS NOT NULL`));

        // 1. Delete voucher entries (double-entry lines)
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

        // 2. Soft-delete the voucher
        await tx.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, voucherId));

        // 3. Delete the real daybook entry if it exists
        if (daybookEntryId) {
          await tx.delete(factoryDaybookEntries).where(eq(factoryDaybookEntries.id, daybookEntryId));
        }

        // 4. Cascade effects based on voucher number pattern
        const advPayMatch = vNum.match(/^PAYMENT-ADV-(\d+)-/);
        const payPayMatch = vNum.match(/^PAYMENT-PAY-(\d+)-/);
        const repayMatch = vNum.match(/^RECEIPT-REPAY-(\d+)-/);

        if (advPayMatch) {
          const advanceId = parseInt(advPayMatch[1]);
          await tx.update(factoryWorkerAdvances).set({ cashAccountId: null })
            .where(and(eq(factoryWorkerAdvances.id, advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
        } else if (payPayMatch) {
          const payrollId = parseInt(payPayMatch[1]);
          const [payroll] = await tx.select().from(factoryPayrolls)
            .where(and(eq(factoryPayrolls.id, payrollId), eq(factoryPayrolls.companyId, companyId)));

          await tx.update(factoryPayrolls).set({ status: "DRAFT", cashAccountId: null, paidAt: null })
            .where(and(eq(factoryPayrolls.id, payrollId), eq(factoryPayrolls.companyId, companyId)));

          if (payroll) {
            const advAmt = parseFloat(payroll.advances || "0");
            if (advAmt > 0) {
              const workerAdvances = await tx.select().from(factoryWorkerAdvances)
                .where(and(
                  eq(factoryWorkerAdvances.companyId, companyId),
                  eq(factoryWorkerAdvances.workerId, payroll.workerId),
                  eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
                ))
                .orderBy(desc(factoryWorkerAdvances.advanceDate));

              let toRestore = advAmt;
              for (const adv of workerAdvances) {
                if (toRestore <= 0) break;
                const bal = parseFloat(adv.remainingBalance || "0");
                const originalAmt = parseFloat(adv.amount || "0");
                const room = originalAmt - bal;
                if (room <= 0) continue;
                const restoreAmt = Math.min(room, toRestore);
                const newBal = bal + restoreAmt;
                await tx.update(factoryWorkerAdvances).set({
                  remainingBalance: newBal.toFixed(2),
                  fullyPaid: false,
                }).where(eq(factoryWorkerAdvances.id, adv.id));
                toRestore -= restoreAmt;
              }
            }
          }
        } else if (repayMatch) {
          const repaymentId = parseInt(repayMatch[1]);
          const [repayment] = await tx.select().from(factoryAdvanceRepayments)
            .where(and(eq(factoryAdvanceRepayments.id, repaymentId), eq(factoryAdvanceRepayments.companyId, companyId)));
          if (repayment) {
            const [advance] = await tx.select().from(factoryWorkerAdvances)
              .where(and(eq(factoryWorkerAdvances.id, repayment.advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
            if (advance) {
              const newBalance = parseFloat(advance.remainingBalance || "0") + parseFloat(repayment.amount || "0");
              await tx.update(factoryWorkerAdvances).set({
                remainingBalance: newBalance.toFixed(2),
                fullyPaid: false,
              }).where(eq(factoryWorkerAdvances.id, advance.id));
            }
            await tx.delete(factoryAdvanceRepayments).where(eq(factoryAdvanceRepayments.id, repaymentId));
          }
        }

        // 4b. Reverse employee balance/deposit/withdrawal for EMP-DEP, EMP-WD, EMP-PAY vouchers
        if (empEntries.length > 0 && (vNum.startsWith("EMP-DEP-") || vNum.startsWith("EMP-WD-") || vNum.startsWith("EMP-PAY-"))) {
          // Group deltas by employeeId
          const empDeltas = new Map<number, { creditTotal: number; debitTotal: number }>();
          for (const entry of empEntries) {
            const empId = entry.employeeId as number;
            const cr = parseFloat(entry.creditAmount || "0");
            const dr = parseFloat(entry.debitAmount || "0");
            if (!empDeltas.has(empId)) empDeltas.set(empId, { creditTotal: 0, debitTotal: 0 });
            const d = empDeltas.get(empId)!;
            d.creditTotal += cr;
            d.debitTotal += dr;
          }
          for (const [empId, delta] of empDeltas) {
            const [emp] = await tx.select().from(employees)
              .where(and(eq(employees.id, empId), eq(employees.companyId, companyId)));
            if (!emp) continue;
            const curBal = parseFloat(emp.currentBalance || "0");
            const curDep = parseFloat(emp.totalDeposits || "0");
            const curWith = parseFloat(emp.totalWithdrawals || "0");
            // CR entries = deposits (balance went up) → reverse: subtract
            // DR entries = withdrawals/deductions (balance went down) → reverse: add back
            const newBal = curBal - delta.creditTotal + delta.debitTotal;
            const newDep = Math.max(0, curDep - delta.creditTotal);
            const newWith = Math.max(0, curWith - delta.debitTotal);
            await tx.update(employees).set({
              currentBalance: newBal.toFixed(2),
              totalDeposits: newDep.toFixed(2),
              ...(delta.debitTotal > 0 ? { totalWithdrawals: newWith.toFixed(2) } : {}),
            }).where(eq(employees.id, empId));
          }
        }

        // 5. Write a VOIDED audit daybook entry (no voucher reference so it won't be filtered by soft-delete logic)
        const voidTxType = `${txTypeVal}_VOIDED`;
        const amt = parseFloat(voucher.totalAmount || "0");
        const currency = voucher.currency || "USD";
        const fxRate = parseFloat(voucher.exchangeRate || "1") || 1;
        const amtUsd = currency === "USD" ? amt : amt * fxRate;
        await writeDaybookEntry(tx, {
          companyId,
          txDate: today,
          txType: voidTxType,
          description: `VOIDED: ${voucher.description || voucher.voucherNumber} (voucher #${voucherId})`,
          currencyCode: currency,
          amountCurrency: amt,
          fxRateToUsd: fxRate,
          amountUsd: amtUsd,
          createdBy: session.userId || undefined,
        });
      });

      res.json({ message: "Voucher voided successfully", voucherId });
    } catch (error: any) {
      console.error("Error voiding voucher:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory User Management
  // ───────────────────────────────────────────────

  app.get("/api/factory/users", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      const currentRole = (req.session as any).currentRole;
      const globalRole = req.user?.role;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const isAllowed = ["Admin","Owner","Developer"].includes(currentRole) || ["Admin","Developer"].includes(globalRole);
      if (!isAllowed) return res.status(403).json({ message: "Only Admin or Owner can manage users" });

      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        active: users.active,
        createdAt: users.createdAt,
      }).from(users);

      // Collect user IDs that have the Developer role in ANY company.
      // Match the ERP user-list behaviour: Developer accounts are globally
      // invisible to non-developers, regardless of which company is active.
      const devRoles = await db
        .select({ userId: userCompanyRoles.userId })
        .from(userCompanyRoles)
        .where(eq(userCompanyRoles.role, "Developer"));
      const devUserIds = new Set(devRoles.map((r: any) => r.userId));
      const requesterIsDeveloper = currentRole === "Developer" || globalRole === "Developer";

      const visibleUsers = allUsers.filter((u: any) =>
        requesterIsDeveloper || !devUserIds.has(u.id)
      );

      const profiles = await db.select()
        .from(factoryUserProfiles)
        .where(eq(factoryUserProfiles.companyId, companyId));

      const access = await db.select()
        .from(factoryUserPageAccess)
        .where(eq(factoryUserPageAccess.companyId, companyId));

      const profileMap = new Map(profiles.map((p: any) => [p.userId, p]));
      const accessMap = new Map<string, string[]>();
      access.forEach((a: any) => {
        if (!accessMap.has(a.userId)) accessMap.set(a.userId, []);
        accessMap.get(a.userId)!.push(a.pageKey);
      });

      const result = visibleUsers.map((u: any) => {
        const profile = profileMap.get(u.id);
        return {
          ...u,
          displayName: profile?.displayName || null,
          hasErpAccess: profile?.hasErpAccess ?? true,
          hasFactoryAccess: profile?.hasFactoryAccess ?? true,
          hiddenCostFields: profile?.hiddenCostFields ?? [],
          hideAllCosts: profile?.hideAllCosts ?? false,
          pageAccess: accessMap.get(u.id) || [],
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching factory users:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/users", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      const currentRole = (req.session as any).currentRole;
      const globalRole = req.user?.role;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const isAllowed = ["Admin","Owner"].includes(currentRole) || ["Admin","Developer"].includes(globalRole);
      if (!isAllowed) return res.status(403).json({ message: "Only Admin or Owner can manage users" });

      const { username, password, displayName, pageAccess, hasErpAccess, hasFactoryAccess } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      if (password.length < 4) {
        return res.status(400).json({ message: "Password must be at least 4 characters" });
      }

      const existing = await db.select().from(users).where(eq(users.username, username));
      if (existing.length > 0) {
        return res.status(400).json({ message: "Username already exists" });
      }

      await db.transaction(async (tx: any) => {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [newUser] = await tx.insert(users).values({
          username,
          password: hashedPassword,
          active: true,
        }).returning();

        await tx.insert(userCompanyRoles).values({
          userId: newUser.id,
          companyId,
          role: "User",
        });

        await tx.insert(factoryUserProfiles).values({
          companyId,
          userId: newUser.id,
          displayName: displayName || username,
          hasErpAccess: hasErpAccess ?? true,
          hasFactoryAccess: hasFactoryAccess ?? true,
        });

        if (Array.isArray(pageAccess) && pageAccess.length > 0) {
          await tx.insert(factoryUserPageAccess).values(
            pageAccess.map((pk: string) => ({
              companyId,
              userId: newUser.id,
              pageKey: pk,
            }))
          );
        }

        const { password: _, ...userWithoutPassword } = newUser;
        res.status(201).json({
          ...userWithoutPassword,
          displayName: displayName || username,
          hasErpAccess: hasErpAccess ?? true,
          hasFactoryAccess: hasFactoryAccess ?? true,
          pageAccess: pageAccess || [],
        });
      });
    } catch (error: any) {
      console.error("Error creating factory user:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/users/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      const currentRole = (req.session as any).currentRole;
      const globalRole = req.user?.role;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const isAllowed = ["Admin","Owner"].includes(currentRole) || ["Admin","Developer"].includes(globalRole);
      if (!isAllowed) return res.status(403).json({ message: "Only Admin or Owner can manage users" });

      const { userId } = req.params;
      const { displayName, pageAccess, password, hasErpAccess, hasFactoryAccess, hiddenCostFields, hideAllCosts, username } = req.body;

      await db.transaction(async (tx: any) => {
        const userUpdates: any = {};
        if (password && password.length >= 4) {
          userUpdates.password = await bcrypt.hash(password, 10);
        }
        if (username && username.trim()) {
          const existingWithUsername = await tx.select({ id: users.id }).from(users).where(eq(users.username, username.trim()));
          if (existingWithUsername.length > 0 && existingWithUsername[0].id !== userId) {
            throw new Error("Username already taken");
          }
          userUpdates.username = username.trim();
        }
        if (Object.keys(userUpdates).length > 0) {
          await tx.update(users).set(userUpdates).where(eq(users.id, userId));
        }

        const profileUpdates: any = { updatedAt: new Date() };
        if (displayName !== undefined) profileUpdates.displayName = displayName;
        if (hasErpAccess !== undefined) profileUpdates.hasErpAccess = hasErpAccess;
        if (hasFactoryAccess !== undefined) profileUpdates.hasFactoryAccess = hasFactoryAccess;
        if (Array.isArray(hiddenCostFields)) profileUpdates.hiddenCostFields = hiddenCostFields;
        if (hideAllCosts !== undefined) profileUpdates.hideAllCosts = !!hideAllCosts;

        const existingProfile = await tx.select()
          .from(factoryUserProfiles)
          .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));

        if (existingProfile.length > 0) {
          await tx.update(factoryUserProfiles)
            .set(profileUpdates)
            .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));
        } else {
          await tx.insert(factoryUserProfiles).values({
            companyId,
            userId,
            displayName: displayName || "User",
            hasErpAccess: hasErpAccess ?? true,
            hasFactoryAccess: hasFactoryAccess ?? true,
            hiddenCostFields: Array.isArray(hiddenCostFields) ? hiddenCostFields : [],
            hideAllCosts: !!hideAllCosts,
          });
        }

        if (Array.isArray(pageAccess)) {
          await tx.delete(factoryUserPageAccess)
            .where(and(eq(factoryUserPageAccess.companyId, companyId), eq(factoryUserPageAccess.userId, userId)));

          if (pageAccess.length > 0) {
            await tx.insert(factoryUserPageAccess).values(
              pageAccess.map((pk: string) => ({
                companyId,
                userId,
                pageKey: pk,
              }))
            );
          }
        }
      });

      res.json({ message: "User updated" });
    } catch (error: any) {
      console.error("Error updating factory user:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/users/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      const currentRole = (req.session as any).currentRole;
      const globalRole = req.user?.role;
      const sessionUserId = (req.session as any).userId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const isAllowed = ["Admin","Owner"].includes(currentRole) || ["Admin","Developer"].includes(globalRole);
      if (!isAllowed) return res.status(403).json({ message: "Only Admin or Owner can manage users" });
      const { userId } = req.params;
      if (userId === sessionUserId) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }
      await db.transaction(async (tx: any) => {
        await tx.delete(factoryUserPageAccess)
          .where(and(eq(factoryUserPageAccess.companyId, companyId), eq(factoryUserPageAccess.userId, userId)));
        await tx.delete(factoryUserProfiles)
          .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));
        await tx.update(users).set({ active: false }).where(eq(users.id, userId));
      });
      res.json({ message: "User removed successfully" });
    } catch (error: any) {
      console.error("Error deleting factory user:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/my-access", requireAuth, async (req: any, res: any) => {
    try {
      const userId = (req.session as any).userId;
      const currentCompanyId = (req.session as any).currentCompanyId;
      const pinnedFactoryId = (req.session as any).factoryCompanyId;

      // Resolve the factory company ID:
      // Priority 1: already-pinned factoryCompanyId — but only if it points to a factory-type company
      // Priority 2: currentCompanyId if it is factory type
      // Priority 3: first active factory-type company in the DB
      // Priority 4: fall back to currentCompanyId (legacy / single-company setups)
      let companyId: number | null = null;
      let companyName: string = "";

      if (pinnedFactoryId) {
        const [pinned] = await db.select({ id: companies.id, name: companies.name, companyType: companies.companyType })
          .from(companies).where(eq(companies.id, pinnedFactoryId));
        if (pinned?.companyType === "factory") {
          companyId = pinned.id;
          companyName = pinned.name;
        }
      }

      if (!companyId && currentCompanyId) {
        const [current] = await db.select({ id: companies.id, name: companies.name, companyType: companies.companyType })
          .from(companies).where(eq(companies.id, currentCompanyId));
        if (current?.companyType === "factory") {
          companyId = current.id;
          companyName = current.name;
        }
      }

      if (!companyId) {
        const [factoryComp] = await db.select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(and(eq(companies.companyType, "factory"), eq(companies.active, true)))
          .limit(1);
        if (factoryComp) {
          companyId = factoryComp.id;
          companyName = factoryComp.name;
        }
      }

      if (!companyId) {
        // Last resort: use currentCompanyId (single-company or legacy setups)
        companyId = currentCompanyId;
        if (currentCompanyId) {
          const [c] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, currentCompanyId));
          companyName = c?.name ?? "";
        }
      }

      if (!companyId || !userId) return res.status(400).json({ message: "No company or user" });

      // Pin the resolved factory company ID to the session so cross-tab ERP company
      // switches don't corrupt factory API calls made from other tabs.
      (req.session as any).factoryCompanyId = companyId;

      const role = (req.session as any).currentRole;
      if (role === "Admin" || role === "Owner" || role === "Developer") {
        return res.json({ fullAccess: true, pageKeys: [], hasErpAccess: true, hasFactoryAccess: true, hiddenCostFields: [], hideAllCosts: false, companyId, companyName });
      }

      const [profile] = await db.select({
        hasErpAccess: factoryUserProfiles.hasErpAccess,
        hasFactoryAccess: factoryUserProfiles.hasFactoryAccess,
        hiddenCostFields: factoryUserProfiles.hiddenCostFields,
        hideAllCosts: factoryUserProfiles.hideAllCosts,
      })
        .from(factoryUserProfiles)
        .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));

      const hasErpAccess = profile ? profile.hasErpAccess : true;
      const hasFactoryAccess = profile ? profile.hasFactoryAccess : true;
      const hideAllCosts = profile?.hideAllCosts ?? false;
      // When hideAllCosts is set, treat all cost field keys as hidden
      const ALL_COST_KEYS = [
        "inventory_avg_rate", "inventory_total_value", "inventory_sell_price", "inventory_sell_value",
        "bale_history_cost_per_kg", "bale_history_total_cost", "bales_list_cost_per_kg",
      ];
      const hiddenCostFields = hideAllCosts ? ALL_COST_KEYS : (profile?.hiddenCostFields ?? []);

      const access = await db.select({ pageKey: factoryUserPageAccess.pageKey })
        .from(factoryUserPageAccess)
        .where(and(eq(factoryUserPageAccess.companyId, companyId), eq(factoryUserPageAccess.userId, userId)));

      if (access.length === 0) {
        return res.json({ fullAccess: true, pageKeys: [], hasErpAccess, hasFactoryAccess, hiddenCostFields, hideAllCosts, companyId, companyName });
      }

      res.json({
        fullAccess: false,
        pageKeys: access.map((a: any) => a.pageKey),
        hasErpAccess,
        hasFactoryAccess,
        hiddenCostFields,
        hideAllCosts,
        companyId,
        companyName,
      });
    } catch (error: any) {
      console.error("Error fetching my access:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============ DIRECT MESSAGES / CHAT ============

  const chatUploadsDir = path.resolve("uploads/chat");
  if (!fs.existsSync(chatUploadsDir)) fs.mkdirSync(chatUploadsDir, { recursive: true });

  const chatStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, chatUploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });
  const chatUpload = multer({ storage: chatStorage, limits: { fileSize: 25 * 1024 * 1024 } });

  const typingStatus = new Map<string, { receiverId: string; until: number }>();

  app.post("/api/chat/upload", requireAuth, chatUpload.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const fileUrl = `/uploads/chat/${req.file.filename}`;
      res.json({
        fileUrl,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/chat/typing", requireAuth, async (req: any, res: any) => {
    try {
      const senderId = (req.session as any).userId;
      const { receiverId, isTyping } = req.body;
      if (!receiverId) return res.status(400).json({ message: "receiverId required" });
      if (isTyping) {
        typingStatus.set(senderId, { receiverId, until: Date.now() + 5000 });
      } else {
        typingStatus.delete(senderId);
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/chat/typing/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const otherUserId = req.params.userId;
      const record = typingStatus.get(otherUserId);
      const isTyping = !!record && record.receiverId === currentUserId && record.until > Date.now();
      res.json({ isTyping });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/chat/users", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        active: users.active,
      }).from(users).where(eq(users.active, true));

      const filtered = allUsers.filter((u: any) => u.id !== currentUserId);

      // Fetch all presence records in one query
      const presenceRecords = await db.select().from(userPresence);
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      const usersWithUnread = await Promise.all(filtered.map(async (u: any) => {
        const [unreadResult] = await db.select({ count: sql<number>`count(*)::int` })
          .from(directMessages)
          .where(and(
            eq(directMessages.senderId, u.id),
            eq(directMessages.receiverId, currentUserId),
            sql`${directMessages.readAt} IS NULL`
          ));
        const [msgResult] = await db.select({ count: sql<number>`count(*)::int` })
          .from(directMessages)
          .where(or(
            and(eq(directMessages.senderId, u.id), eq(directMessages.receiverId, currentUserId)),
            and(eq(directMessages.senderId, currentUserId), eq(directMessages.receiverId, u.id))
          ));

        // Find most recent presence record for this user
        const userPresenceRecords = presenceRecords.filter((p: any) => p.userId === u.id);
        const latestPresence = userPresenceRecords.sort((a: any, b: any) =>
          new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
        )[0];
        const isOnline = latestPresence ? new Date(latestPresence.lastSeen) > twoMinutesAgo : false;
        const lastSeen = latestPresence ? latestPresence.lastSeen : null;

        return {
          ...u,
          unreadCount: unreadResult?.count || 0,
          hasMessages: (msgResult?.count || 0) > 0,
          isOnline,
          lastSeen,
        };
      }));

      res.json(usersWithUnread);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/chat/conversations/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const otherUserId = req.params.userId;

      const messages = await db.select()
        .from(directMessages)
        .where(or(
          and(eq(directMessages.senderId, currentUserId), eq(directMessages.receiverId, otherUserId)),
          and(eq(directMessages.senderId, otherUserId), eq(directMessages.receiverId, currentUserId))
        ))
        .orderBy(directMessages.createdAt);

      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/chat/messages", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const parsed = insertDirectMessageSchema.parse({
        ...req.body,
        senderId: currentUserId,
      });

      const [msg] = await db.insert(directMessages).values({
        senderId: currentUserId,
        receiverId: parsed.receiverId,
        message: parsed.message || null,
        fileUrl: parsed.fileUrl || null,
        fileName: parsed.fileName || null,
        fileType: parsed.fileType || null,
        fileSize: parsed.fileSize || null,
      }).returning();

      typingStatus.delete(currentUserId);

      res.json(msg);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/chat/mark-read/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const senderId = req.params.userId;

      await db.update(directMessages)
        .set({ readAt: new Date() })
        .where(and(
          eq(directMessages.senderId, senderId),
          eq(directMessages.receiverId, currentUserId),
          sql`${directMessages.readAt} IS NULL`
        ));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/chat/messages/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const otherUserId = req.params.userId;

      await db.delete(directMessages)
        .where(
          or(
            and(
              eq(directMessages.senderId, currentUserId),
              eq(directMessages.receiverId, otherUserId)
            ),
            and(
              eq(directMessages.senderId, otherUserId),
              eq(directMessages.receiverId, currentUserId)
            )
          )
        );

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/chat/unread-count", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const [result] = await db.select({ count: sql<number>`count(*)::int` })
        .from(directMessages)
        .where(and(
          eq(directMessages.receiverId, currentUserId),
          sql`${directMessages.readAt} IS NULL`
        ));
      res.json({ count: result?.count || 0 });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/export-company-data", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const byCompany = (table: any) => eq(table.companyId, companyId);

      const data: Record<string, any[]> = {};

      data.locations = await db.select().from(locations).where(byCompany(locations));
      data.ledger_accounts = await db.select().from(ledgerAccounts).where(byCompany(ledgerAccounts));
      data.bank_accounts = await db.select().from(bankAccounts).where(byCompany(bankAccounts));
      data.stock_groups = await db.select().from(stockGroups).where(byCompany(stockGroups));
      data.stock_items = await db.select().from(stockItems).where(byCompany(stockItems));
      data.inventory = await db.select().from(inventory).where(byCompany(inventory));
      data.company_settings = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId));
      data.exchange_rates = await db.select().from(exchangeRates).where(byCompany(exchangeRates));
      data.customers = await db.select().from(customers).where(byCompany(customers));
      data.customer_balances = await db.select().from(customerBalances).where(byCompany(customerBalances));
      data.vouchers = await db.select().from(vouchers).where(byCompany(vouchers));

      const voucherIds = data.vouchers.map((v: any) => v.id);
      if (voucherIds.length > 0) {
        data.voucher_entries = await db.select().from(voucherEntries).where(inArray(voucherEntries.voucherId, voucherIds));
      } else {
        data.voucher_entries = [];
      }

      data.factory_settings = await db.select().from(factorySettings).where(eq(factorySettings.companyId, companyId));
      data.factory_suppliers = await db.select().from(factorySuppliers).where(byCompany(factorySuppliers));
      data.factory_categories = await db.select().from(factoryCategories).where(byCompany(factoryCategories));
      data.factory_bale_products = await db.select().from(factoryBaleProducts).where(byCompany(factoryBaleProducts));
      data.factory_fx_rates = await db.select().from(factoryFxRates).where(byCompany(factoryFxRates));
      data.factory_bale_sequences = await db.select().from(factoryBaleSequences).where(eq(factoryBaleSequences.companyId, companyId));
      data.factory_containers = await db.select().from(factoryContainers).where(byCompany(factoryContainers));
      data.factory_raw_stock = await db.select().from(factoryRawStock).where(byCompany(factoryRawStock));
      data.factory_container_commissions = await db.select().from(factoryContainerCommissions).where(byCompany(factoryContainerCommissions));
      data.factory_offload_additional_charges = await db.select().from(factoryOffloadAdditionalCharges).where(byCompany(factoryOffloadAdditionalCharges));
      data.factory_duty_audit_log = await db.select().from(factoryDutyAuditLog).where(byCompany(factoryDutyAuditLog));
      data.factory_mix_batches = await db.select().from(factoryMixBatches).where(byCompany(factoryMixBatches));

      const mixBatchIds = data.factory_mix_batches.map((b: any) => b.id);
      if (mixBatchIds.length > 0) {
        data.factory_mix_batch_sources = await db.select().from(factoryMixBatchSources).where(inArray(factoryMixBatchSources.mixBatchId, mixBatchIds));
        data.factory_daily_usages = await db.select().from(factoryDailyUsages).where(inArray(factoryDailyUsages.mixBatchId, mixBatchIds));
      } else {
        data.factory_mix_batch_sources = [];
        data.factory_daily_usages = [];
      }

      data.factory_pressing_batches = await db.select().from(factoryPressingBatches).where(byCompany(factoryPressingBatches));
      data.factory_bales = await db.select().from(factoryBales).where(byCompany(factoryBales));
      data.factory_workers = await db.select().from(factoryWorkers).where(byCompany(factoryWorkers));
      data.factory_payrolls = await db.select().from(factoryPayrolls).where(byCompany(factoryPayrolls));
      data.factory_worker_documents = await db.select().from(factoryWorkerDocuments).where(byCompany(factoryWorkerDocuments));
      data.factory_daybook_entries = await db.select().from(factoryDaybookEntries).where(byCompany(factoryDaybookEntries));

      const daybookIds = data.factory_daybook_entries.map((e: any) => e.id);
      if (daybookIds.length > 0) {
        data.factory_daybook_entry_edits = await db.select().from(factoryDaybookEntryEdits).where(inArray(factoryDaybookEntryEdits.daybookEntryId, daybookIds));
      } else {
        data.factory_daybook_entry_edits = [];
      }

      data.factory_waste_entries = await db.select().from(factoryWasteEntries).where(byCompany(factoryWasteEntries));
      data.factory_bale_photos = await db.select().from(factoryBalePhotos).where(byCompany(factoryBalePhotos));
      data.factory_alerts = await db.select().from(factoryAlerts).where(byCompany(factoryAlerts));
      data.factory_daily_kpi_snapshots = await db.select().from(factoryDailyKpiSnapshots).where(byCompany(factoryDailyKpiSnapshots));
      data.factory_supplier_score_snapshots = await db.select().from(factorySupplierScoreSnapshots).where(byCompany(factorySupplierScoreSnapshots));
      data.factory_bale_cost_snapshots = await db.select().from(factoryBaleCostSnapshots).where(byCompany(factoryBaleCostSnapshots));
      data.factory_container_profit_snapshots = await db.select().from(factoryContainerProfitSnapshots).where(byCompany(factoryContainerProfitSnapshots));

      data.customer_proformas = await db.select().from(customerProformas).where(byCompany(customerProformas));
      const proformaIds = data.customer_proformas.map((p: any) => p.id);
      if (proformaIds.length > 0) {
        data.customer_proforma_lines = await db.select().from(customerProformaLines).where(inArray(customerProformaLines.proformaId, proformaIds));
      } else {
        data.customer_proforma_lines = [];
      }

      data.customer_invoice_sequences = await db.select().from(customerInvoiceSequences).where(eq(customerInvoiceSequences.companyId, companyId));
      data.customer_orders = await db.select().from(customerOrders).where(byCompany(customerOrders));
      const orderIds = data.customer_orders.map((o: any) => o.id);
      if (orderIds.length > 0) {
        data.customer_order_lines = await db.select().from(customerOrderLines).where(inArray(customerOrderLines.orderId, orderIds));
        data.customer_order_bales = await db.select().from(customerOrderBales).where(inArray(customerOrderBales.orderId, orderIds));
        data.customer_order_charges = await db.select().from(customerOrderCharges).where(inArray(customerOrderCharges.orderId, orderIds));
      } else {
        data.customer_order_lines = [];
        data.customer_order_bales = [];
        data.customer_order_charges = [];
      }

      const exportPayload = {
        version: 1,
        sourceCompanyId: companyId,
        exportedAt: new Date().toISOString(),
        tables: data,
      };

      const jsonStr = JSON.stringify(exportPayload, null, 2);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="company_${companyId}_export_${getClientDate(req)}.json"`);
      res.send(jsonStr);
    } catch (error: any) {
      console.error("Export company data error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import-company-data", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

      upload.single("file")(req, res, async (err: any) => {
        if (err) return res.status(400).json({ message: "File upload error: " + err.message });
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        try {
          const targetCompanyId = (req.session as any).currentCompanyId;
          if (!targetCompanyId) return res.status(400).json({ message: "No company selected" });

          const jsonStr = req.file.buffer.toString("utf-8");
          let payload: any;
          try {
            payload = JSON.parse(jsonStr);
          } catch {
            return res.status(400).json({ message: "Uploaded file is not valid JSON" });
          }

          if (!payload || typeof payload !== "object" || !payload.tables || !payload.sourceCompanyId) {
            return res.status(400).json({ message: "Invalid export file format" });
          }

          if (payload.sourceCompanyId === targetCompanyId) {
            return res.status(400).json({ message: "Cannot import into the same company that was exported. Switch to a different company first." });
          }

          const [existingBales] = await db.select({ count: sql<number>`count(*)::int` }).from(factoryBales).where(eq(factoryBales.companyId, targetCompanyId));
          const [existingContainers] = await db.select({ count: sql<number>`count(*)::int` }).from(factoryContainers).where(eq(factoryContainers.companyId, targetCompanyId));
          const [existingVouchers] = await db.select({ count: sql<number>`count(*)::int` }).from(vouchers).where(eq(vouchers.companyId, targetCompanyId));
          if ((existingBales?.count || 0) > 0 || (existingContainers?.count || 0) > 0 || (existingVouchers?.count || 0) > 0) {
            return res.status(400).json({ message: "Target company already has data (bales, containers, or vouchers). Import should only be done on a new/empty company to avoid duplicates." });
          }

          await db.delete(factorySettings).where(eq(factorySettings.companyId, targetCompanyId));
          await db.delete(factoryBaleSequences).where(eq(factoryBaleSequences.companyId, targetCompanyId));
          await db.delete(customerInvoiceSequences).where(eq(customerInvoiceSequences.companyId, targetCompanyId));
          await db.delete(companySettings).where(eq(companySettings.companyId, targetCompanyId));

          const t = payload.tables;
          const summary: Record<string, number> = {};
          let totalRecords = 0;
          const importSuffix = `_C${targetCompanyId}`;

          const remap: Record<string, Map<number, number>> = {};
          const initRemap = (key: string) => { remap[key] = new Map(); };
          const r = (key: string, oldId: number | null | undefined): number | null => {
            if (oldId == null) return null;
            const mapped = remap[key]?.get(oldId);
            return mapped ?? null;
          };

          async function makeUniqueCode(tx: any, table: any, field: any, baseValue: string): Promise<string> {
            const [existing] = await tx.select({ id: table.id }).from(table).where(eq(field, baseValue)).limit(1);
            if (!existing) return baseValue;
            let attempt = baseValue + importSuffix;
            const [existing2] = await tx.select({ id: table.id }).from(table).where(eq(field, attempt)).limit(1);
            if (!existing2) return attempt;
            let counter = 2;
            while (counter < 1000) {
              const val = `${baseValue}${importSuffix}_${counter}`;
              const [ex] = await tx.select({ id: table.id }).from(table).where(eq(field, val)).limit(1);
              if (!ex) return val;
              counter++;
            }
            return baseValue + importSuffix + "_" + Date.now();
          }

          const tables = [
            "locations", "ledger_accounts", "bank_accounts", "stock_groups", "stock_items",
            "inventory", "company_settings", "exchange_rates", "customers", "customer_balances",
            "factory_settings", "factory_suppliers", "factory_categories", "factory_bale_products",
            "factory_fx_rates", "factory_bale_sequences", "factory_containers", "factory_raw_stock",
            "factory_container_commissions", "factory_offload_additional_charges", "factory_duty_audit_log",
            "factory_daily_usages", "factory_mix_batches", "factory_mix_batch_sources", "factory_pressing_batches",
            "factory_bales", "factory_workers", "factory_payrolls", "factory_worker_documents",
            "factory_daybook_entries", "factory_daybook_entry_edits", "factory_waste_entries",
            "factory_bale_photos", "factory_alerts", "factory_daily_kpi_snapshots",
            "factory_supplier_score_snapshots", "factory_bale_cost_snapshots",
            "factory_container_profit_snapshots", "customer_proformas", "customer_proforma_lines",
            "customer_invoice_sequences", "customer_orders", "customer_order_lines",
            "customer_order_bales", "customer_order_charges", "vouchers", "voucher_entries"
          ];
          tables.forEach(initRemap);

          const dateFieldNames = new Set([
            "createdAt", "updatedAt", "deletedAt", "offloadedAt", "pressedAt",
            "finalizedAt", "paidAt", "generatedAt", "approvedAt", "uploadedAt",
            "editedAt", "readAt", "logoUpdatedAt", "verifiedAt",
            "loadingStartedAt", "loadingFinalizedAt", "lastUpdated",
          ]);
          function fixDates(rec: any) {
            for (const key of Object.keys(rec)) {
              if (rec[key] == null) continue;
              if (dateFieldNames.has(key) && typeof rec[key] === "string") {
                rec[key] = new Date(rec[key]);
              }
            }
            return rec;
          }

          await db.transaction(async (tx: any) => {

            async function insertAndMap(tableName: string, drizzleTable: any, rows: any[], fkRemaps: Record<string, string>, opts?: { hasCompanyId?: boolean, nullifyFields?: string[] }) {
              const hasCompanyId = opts?.hasCompanyId !== false;
              const nullifyFields = opts?.nullifyFields || [];
              let count = 0;
              for (const row of rows) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                if (hasCompanyId) rec.companyId = targetCompanyId;
                for (const [fkField, remapKey] of Object.entries(fkRemaps)) {
                  rec[fkField] = r(remapKey, rec[fkField]);
                }
                for (const field of nullifyFields) {
                  rec[field] = null;
                }
                const [inserted] = await tx.insert(drizzleTable).values(rec).returning({ id: drizzleTable.id });
                if (inserted && oldId != null) {
                  remap[tableName].set(oldId, inserted.id);
                }
                count++;
              }
              summary[tableName] = count;
              totalRecords += count;
            }

            async function insertSelfReferencing(tableName: string, drizzleTable: any, rows: any[], parentField: string, fkRemaps: Record<string, string>, opts?: { hasCompanyId?: boolean }) {
              const hasCompanyId = opts?.hasCompanyId !== false;
              const roots = rows.filter((r: any) => r[parentField] == null);
              const children = rows.filter((r: any) => r[parentField] != null);
              let count = 0;

              for (const row of roots) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                if (hasCompanyId) rec.companyId = targetCompanyId;
                rec[parentField] = null;
                for (const [fkField, remapKey] of Object.entries(fkRemaps)) {
                  rec[fkField] = r(remapKey, rec[fkField]);
                }
                const [inserted] = await tx.insert(drizzleTable).values(rec).returning({ id: drizzleTable.id });
                if (inserted && oldId != null) remap[tableName].set(oldId, inserted.id);
                count++;
              }

              let remaining = [...children];
              let maxPasses = 20;
              while (remaining.length > 0 && maxPasses > 0) {
                const nextRemaining: any[] = [];
                for (const row of remaining) {
                  const parentMapped = r(tableName, row[parentField]);
                  if (parentMapped != null) {
                    const oldId = row.id;
                    const rec: any = fixDates({ ...row });
                    delete rec.id;
                    if (hasCompanyId) rec.companyId = targetCompanyId;
                    rec[parentField] = parentMapped;
                    for (const [fkField, remapKey] of Object.entries(fkRemaps)) {
                      rec[fkField] = r(remapKey, rec[fkField]);
                    }
                    const [inserted] = await tx.insert(drizzleTable).values(rec).returning({ id: drizzleTable.id });
                    if (inserted && oldId != null) remap[tableName].set(oldId, inserted.id);
                    count++;
                  } else {
                    nextRemaining.push(row);
                  }
                }
                remaining = nextRemaining;
                maxPasses--;
              }

              if (remaining.length > 0) {
                for (const row of remaining) {
                  const oldId = row.id;
                  const rec: any = fixDates({ ...row });
                  delete rec.id;
                  if (hasCompanyId) rec.companyId = targetCompanyId;
                  rec[parentField] = null;
                  for (const [fkField, remapKey] of Object.entries(fkRemaps)) {
                    rec[fkField] = r(remapKey, rec[fkField]);
                  }
                  const [inserted] = await tx.insert(drizzleTable).values(rec).returning({ id: drizzleTable.id });
                  if (inserted && oldId != null) remap[tableName].set(oldId, inserted.id);
                  count++;
                }
              }

              summary[tableName] = count;
              totalRecords += count;
            }

            if (t.locations?.length) {
              for (const row of t.locations) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                rec.companyId = targetCompanyId;
                rec.code = await makeUniqueCode(tx, locations, locations.code, rec.code);
                const [inserted] = await tx.insert(locations).values(rec).returning({ id: locations.id });
                if (inserted && oldId != null) remap["locations"].set(oldId, inserted.id);
              }
              summary["locations"] = t.locations.length;
              totalRecords += t.locations.length;
            }

            if (t.ledger_accounts?.length) {
              await insertSelfReferencing("ledger_accounts", ledgerAccounts, t.ledger_accounts, "parentId", {});
            }

            if (t.bank_accounts?.length) {
              for (const row of t.bank_accounts) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                rec.companyId = targetCompanyId;
                rec.linkedLedgerId = r("ledger_accounts", rec.linkedLedgerId);
                rec.code = await makeUniqueCode(tx, bankAccounts, bankAccounts.code, rec.code);
                const [inserted] = await tx.insert(bankAccounts).values(rec).returning({ id: bankAccounts.id });
                if (inserted && oldId != null) remap["bank_accounts"].set(oldId, inserted.id);
              }
              summary["bank_accounts"] = t.bank_accounts.length;
              totalRecords += t.bank_accounts.length;
            }

            if (t.stock_groups?.length) {
              await insertSelfReferencing("stock_groups", stockGroups, t.stock_groups, "parentId", {});
            }

            if (t.stock_items?.length) {
              await insertAndMap("stock_items", stockItems, t.stock_items, { stockGroupId: "stock_groups" });
            }

            if (t.inventory?.length) {
              await insertAndMap("inventory", inventory, t.inventory, { locationId: "locations", stockItemId: "stock_items" });
            }

            if (t.company_settings?.length) {
              await insertAndMap("company_settings", companySettings, t.company_settings, { parentCreditAccountId: "ledger_accounts" });
            }

            if (t.exchange_rates?.length) {
              await insertAndMap("exchange_rates", exchangeRates, t.exchange_rates, {});
            }

            if (t.customers?.length) {
              await insertAndMap("customers", customers, t.customers, { ledgerAccountId: "ledger_accounts" });
            }

            if (t.customer_balances?.length) {
              await insertAndMap("customer_balances", customerBalances, t.customer_balances, { customerId: "customers" });
            }

            if (t.factory_settings?.length) {
              await insertAndMap("factory_settings", factorySettings, t.factory_settings, {});
            }

            if (t.factory_suppliers?.length) {
              await insertAndMap("factory_suppliers", factorySuppliers, t.factory_suppliers, {});
            }

            if (t.factory_categories?.length) {
              await insertAndMap("factory_categories", factoryCategories, t.factory_categories, {});
            }

            if (t.factory_bale_products?.length) {
              await insertAndMap("factory_bale_products", factoryBaleProducts, t.factory_bale_products, { categoryId: "factory_categories" });
            }

            if (t.factory_fx_rates?.length) {
              await insertAndMap("factory_fx_rates", factoryFxRates, t.factory_fx_rates, {});
            }

            if (t.factory_bale_sequences?.length) {
              await insertAndMap("factory_bale_sequences", factoryBaleSequences, t.factory_bale_sequences, {});
            }

            if (t.factory_containers?.length) {
              await insertAndMap("factory_containers", factoryContainers, t.factory_containers, {
                supplierId: "factory_suppliers",
                freightAccountId: "ledger_accounts",
                otherChargesAccountId: "ledger_accounts",
                dutyAccountId: "ledger_accounts",
              });
            }

            if (t.factory_raw_stock?.length) {
              await insertAndMap("factory_raw_stock", factoryRawStock, t.factory_raw_stock, { containerId: "factory_containers" });
            }

            if (t.factory_container_commissions?.length) {
              await insertAndMap("factory_container_commissions", factoryContainerCommissions, t.factory_container_commissions, {
                containerId: "factory_containers",
                ledgerAccountId: "ledger_accounts",
              });
            }

            if (t.factory_offload_additional_charges?.length) {
              await insertAndMap("factory_offload_additional_charges", factoryOffloadAdditionalCharges, t.factory_offload_additional_charges, {
                containerId: "factory_containers",
                ledgerAccountId: "ledger_accounts",
              });
            }

            if (t.factory_duty_audit_log?.length) {
              await insertAndMap("factory_duty_audit_log", factoryDutyAuditLog, t.factory_duty_audit_log, {
                containerId: "factory_containers",
              }, { nullifyFields: ["updatedByUserId"] });
            }

            if (t.factory_mix_batches?.length) {
              await insertAndMap("factory_mix_batches", factoryMixBatches, t.factory_mix_batches, {
                carryForwardFromId: "factory_mix_batches",
              });
            }

            if (t.factory_mix_batch_sources?.length) {
              await insertAndMap("factory_mix_batch_sources", factoryMixBatchSources, t.factory_mix_batch_sources, {
                mixBatchId: "factory_mix_batches",
                containerId: "factory_containers",
                supplierId: "factory_suppliers",
                sourceBatchId: "factory_mix_batches",
              }, { hasCompanyId: false });
            }

            if (t.factory_daily_usages?.length) {
              await insertAndMap("factory_daily_usages", factoryDailyUsages, t.factory_daily_usages, {
                mixBatchId: "factory_mix_batches",
              });
            }

            if (t.factory_pressing_batches?.length) {
              await insertAndMap("factory_pressing_batches", factoryPressingBatches, t.factory_pressing_batches, {
                mixBatchId: "factory_mix_batches",
                productId: "factory_bale_products",
                finalizedLocationId: "locations",
              }, { nullifyFields: ["createdBy"] });
            }

            if (t.factory_bales?.length) {
              await insertAndMap("factory_bales", factoryBales, t.factory_bales, {
                mixBatchId: "factory_mix_batches",
                productId: "factory_bale_products",
                pressingBatchId: "factory_pressing_batches",
                erpLocationId: "locations",
              }, { nullifyFields: ["finalizedBy"] });
            }

            if (t.factory_workers?.length) {
              await insertAndMap("factory_workers", factoryWorkers, t.factory_workers, {});
            }

            if (t.factory_payrolls?.length) {
              await insertAndMap("factory_payrolls", factoryPayrolls, t.factory_payrolls, {
                workerId: "factory_workers",
                cashAccountId: "ledger_accounts",
              }, { nullifyFields: ["approvedBy"] });
            }

            if (t.factory_worker_documents?.length) {
              await insertAndMap("factory_worker_documents", factoryWorkerDocuments, t.factory_worker_documents, {
                workerId: "factory_workers",
              });
            }

            if (t.factory_daybook_entries?.length) {
              await insertAndMap("factory_daybook_entries", factoryDaybookEntries, t.factory_daybook_entries, {}, { nullifyFields: ["createdBy"] });
            }

            if (t.factory_daybook_entry_edits?.length) {
              await insertAndMap("factory_daybook_entry_edits", factoryDaybookEntryEdits, t.factory_daybook_entry_edits, {
                daybookEntryId: "factory_daybook_entries",
              }, { hasCompanyId: false, nullifyFields: ["editedBy"] });
            }

            if (t.factory_waste_entries?.length) {
              await insertAndMap("factory_waste_entries", factoryWasteEntries, t.factory_waste_entries, {
                mixBatchId: "factory_mix_batches",
                supplierId: "factory_suppliers",
                containerId: "factory_containers",
              }, { nullifyFields: ["createdBy"] });
            }

            if (t.factory_bale_photos?.length) {
              await insertAndMap("factory_bale_photos", factoryBalePhotos, t.factory_bale_photos, {
                baleId: "factory_bales",
              }, { nullifyFields: ["uploadedBy"] });
            }

            if (t.factory_alerts?.length) {
              await insertAndMap("factory_alerts", factoryAlerts, t.factory_alerts, {});
            }

            if (t.customer_proformas?.length) {
              await insertAndMap("customer_proformas", customerProformas, t.customer_proformas, {
                customerId: "customers",
              });
            }

            if (t.customer_proforma_lines?.length) {
              await insertAndMap("customer_proforma_lines", customerProformaLines, t.customer_proforma_lines, {
                proformaId: "customer_proformas",
              }, { hasCompanyId: false });
            }

            if (t.customer_invoice_sequences?.length) {
              await insertAndMap("customer_invoice_sequences", customerInvoiceSequences, t.customer_invoice_sequences, {});
            }

            if (t.customer_orders?.length) {
              await insertAndMap("customer_orders", customerOrders, t.customer_orders, {
                customerId: "customers",
                proformaIdUsed: "customer_proformas",
                locationId: "locations",
              }, { nullifyFields: ["verifiedByUserId"] });
            }

            if (t.customer_order_lines?.length) {
              await insertAndMap("customer_order_lines", customerOrderLines, t.customer_order_lines, {
                orderId: "customer_orders",
              }, { hasCompanyId: false });
            }

            if (t.customer_order_bales?.length) {
              await insertAndMap("customer_order_bales", customerOrderBales, t.customer_order_bales, {
                orderId: "customer_orders",
                baleId: "factory_bales",
                locationId: "locations",
              }, { hasCompanyId: false });
            }

            if (t.customer_order_charges?.length) {
              await insertAndMap("customer_order_charges", customerOrderCharges, t.customer_order_charges, {
                orderId: "customer_orders",
              }, { hasCompanyId: false });
            }

            if (t.vouchers?.length) {
              for (const row of t.vouchers) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                rec.companyId = targetCompanyId;
                rec.locationId = r("locations", rec.locationId);
                rec.voucherNumber = await makeUniqueCode(tx, vouchers, vouchers.voucherNumber, rec.voucherNumber);
                const [inserted] = await tx.insert(vouchers).values(rec).returning({ id: vouchers.id });
                if (inserted && oldId != null) remap["vouchers"].set(oldId, inserted.id);
              }
              summary["vouchers"] = t.vouchers.length;
              totalRecords += t.vouchers.length;
            }

            if (t.voucher_entries?.length) {
              await insertAndMap("voucher_entries", voucherEntries, t.voucher_entries, {
                voucherId: "vouchers",
                ledgerAccountId: "ledger_accounts",
                bankAccountId: "bank_accounts",
              }, { hasCompanyId: false, nullifyFields: ["supplierId", "employeeId", "fixedAssetId"] });
            }

            if (t.factory_daily_kpi_snapshots?.length) {
              await insertAndMap("factory_daily_kpi_snapshots", factoryDailyKpiSnapshots, t.factory_daily_kpi_snapshots, {
                topWorkerId: "factory_workers",
              });
            }

            if (t.factory_supplier_score_snapshots?.length) {
              await insertAndMap("factory_supplier_score_snapshots", factorySupplierScoreSnapshots, t.factory_supplier_score_snapshots, {
                supplierId: "factory_suppliers",
              });
            }

            if (t.factory_bale_cost_snapshots?.length) {
              await insertAndMap("factory_bale_cost_snapshots", factoryBaleCostSnapshots, t.factory_bale_cost_snapshots, {
                baleId: "factory_bales",
              });
            }

            if (t.factory_container_profit_snapshots?.length) {
              await insertAndMap("factory_container_profit_snapshots", factoryContainerProfitSnapshots, t.factory_container_profit_snapshots, {
                containerId: "factory_containers",
              });
            }

          });

          res.json({
            success: true,
            message: `Successfully imported ${totalRecords} records across ${Object.keys(summary).length} tables`,
            totalRecords,
            details: summary,
          });
        } catch (importError: any) {
          console.error("Import company data error:", importError);
          res.status(500).json({ message: "Import failed: " + importError.message });
        }
      });
    } catch (error: any) {
      console.error("Import company data error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Factory Analytics: Sales by Customer ─────────────────────────────────
  app.get("/api/factory/analytics/sales-by-customer", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate } = req.query as Record<string, string>;
      const conditions: any[] = [eq(containerSales.companyId, companyId)];
      if (startDate) conditions.push(sql`${containerSales.saleDate} >= ${startDate}`);
      if (endDate) conditions.push(sql`${containerSales.saleDate} <= ${endDate}`);

      const rows = await db
        .select({
          customerId: containerSales.customerId,
          customerName: customers.legalName,
          containers: sql<number>`COUNT(${containerSales.id})`,
          totalAmount: sql<string>`COALESCE(SUM(${containerSales.totalAmount}), '0')`,
          paidAmount: sql<string>`COALESCE(SUM(${containerSales.paidAmount}), '0')`,
        })
        .from(containerSales)
        .leftJoin(customers, eq(containerSales.customerId, customers.id))
        .where(and(...conditions))
        .groupBy(containerSales.customerId, customers.legalName)
        .orderBy(sql`SUM(${containerSales.totalAmount}) DESC`);

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Factory Analytics: POS Sales Summary (by customer + grand total) ─────
  app.get("/api/factory/analytics/pos-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate } = req.query as Record<string, string>;
      const conditions: any[] = [
        eq(factoryPosSales.companyId, companyId),
        ne(factoryPosSales.status, "VOID"),
      ];
      if (startDate) conditions.push(sql`${factoryPosSales.txDate} >= ${startDate}`);
      if (endDate) conditions.push(sql`${factoryPosSales.txDate} <= ${endDate}`);

      // Aggregate POS sales by customer (customerId may be null = walk-in)
      const byCustomer = await db
        .select({
          customerId: factoryPosSales.customerId,
          customerName: sql<string>`COALESCE(${customers.legalName}, ${factoryPosSales.customerName}, 'Walk-in / Cash')`,
          sales: sql<number>`COUNT(${factoryPosSales.id})`,
          totalAmount: sql<string>`COALESCE(SUM(${factoryPosSales.totalAmount}), '0')`,
          depositAmount: sql<string>`COALESCE(SUM(${factoryPosSales.depositAmount}), '0')`,
          cashSales: sql<string>`COALESCE(SUM(CASE WHEN ${factoryPosSales.paymentType} = 'CASH' THEN ${factoryPosSales.totalAmount} ELSE 0 END), '0')`,
          creditSales: sql<string>`COALESCE(SUM(CASE WHEN ${factoryPosSales.paymentType} = 'CREDIT' THEN ${factoryPosSales.totalAmount} ELSE 0 END), '0')`,
        })
        .from(factoryPosSales)
        .leftJoin(customers, eq(factoryPosSales.customerId, customers.id))
        .where(and(...conditions))
        .groupBy(factoryPosSales.customerId, customers.legalName, factoryPosSales.customerName)
        .orderBy(sql`SUM(${factoryPosSales.totalAmount}) DESC`);

      // Grand total
      const [grand] = await db
        .select({
          sales: sql<number>`COUNT(${factoryPosSales.id})`,
          totalAmount: sql<string>`COALESCE(SUM(${factoryPosSales.totalAmount}), '0')`,
          depositAmount: sql<string>`COALESCE(SUM(${factoryPosSales.depositAmount}), '0')`,
          cashSales: sql<string>`COALESCE(SUM(CASE WHEN ${factoryPosSales.paymentType} = 'CASH' THEN ${factoryPosSales.totalAmount} ELSE 0 END), '0')`,
          creditSales: sql<string>`COALESCE(SUM(CASE WHEN ${factoryPosSales.paymentType} = 'CREDIT' THEN ${factoryPosSales.totalAmount} ELSE 0 END), '0')`,
        })
        .from(factoryPosSales)
        .where(and(...conditions));

      res.json({ byCustomer, grand: grand ?? { sales: 0, totalAmount: "0", depositAmount: "0", cashSales: "0", creditSales: "0" } });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Factory Analytics: Container Sales Report (loaded containers by customer) ──
  app.get("/api/factory/analytics/container-sales-report", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate, customerId, paymentStatus } = req.query as Record<string, string>;

      const conditions: any[] = [eq(containerSales.companyId, companyId)];
      if (startDate) conditions.push(sql`${containerSales.saleDate} >= ${startDate}`);
      if (endDate) conditions.push(sql`${containerSales.saleDate} <= ${endDate}`);
      if (customerId && customerId !== "all") conditions.push(eq(containerSales.customerId, parseInt(customerId)));
      if (paymentStatus && paymentStatus !== "all") conditions.push(eq(containerSales.paymentStatus, paymentStatus));

      const rows = await db
        .select({
          id: containerSales.id,
          saleDate: containerSales.saleDate,
          invoiceNumber: containerSales.invoiceNumber,
          paymentStatus: containerSales.paymentStatus,
          totalAmount: containerSales.totalAmount,
          paidAmount: containerSales.paidAmount,
          containerNumber: factoryContainers.containerNumber,
          containerStatus: factoryContainers.status,
          customerId: containerSales.customerId,
          customerName: customers.legalName,
        })
        .from(containerSales)
        .leftJoin(factoryContainers, eq(containerSales.containerId, factoryContainers.id))
        .leftJoin(customers, eq(containerSales.customerId, customers.id))
        .where(and(...conditions))
        .orderBy(desc(containerSales.saleDate));

      const total = rows.reduce((sum, r) => sum + parseFloat(r.totalAmount || "0"), 0);
      const paid = rows.reduce((sum, r) => sum + parseFloat(r.paidAmount || "0"), 0);

      res.json({ rows, summary: { total, paid, outstanding: total - paid, count: rows.length } });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Factory Analytics: Stock Summary (opening + closing stock) ───────────
  app.get("/api/factory/analytics/stock-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Opening stock = total raw material received (cost basis)
      const [rawReceived] = await db
        .select({
          totalCost: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg} * ${factoryRawStock.costPerKgUsd}), '0')`,
          totalKg: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg}), '0')`,
        })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      // Closing stock = remaining raw material (not yet used) + bale stock in stock
      const [rawRemaining] = await db
        .select({
          remainingCost: sql<string>`COALESCE(SUM((${factoryRawStock.receivedKg} - ${factoryRawStock.usedKg}) * ${factoryRawStock.costPerKgUsd}), '0')`,
          remainingKg: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg} - ${factoryRawStock.usedKg}), '0')`,
        })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      const [baleStock] = await db
        .select({
          totalCost: sql<string>`COALESCE(SUM(${factoryBales.totalCost}), '0')`,
          totalWeightKg: sql<string>`COALESCE(SUM(${factoryBales.weightKg}), '0')`,
          count: sql<number>`COUNT(${factoryBales.id})`,
        })
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.status, "IN_STOCK"),
        ));

      const openingStock = parseFloat(rawReceived?.totalCost || "0");
      const closingRaw = parseFloat(rawRemaining?.remainingCost || "0");
      const closingBales = parseFloat(baleStock?.totalCost || "0");
      const closingStock = closingRaw + closingBales;

      res.json({
        openingStock,
        closingStock,
        detail: {
          rawReceived: { cost: openingStock, kg: parseFloat(rawReceived?.totalKg || "0") },
          rawRemaining: { cost: closingRaw, kg: parseFloat(rawRemaining?.remainingKg || "0") },
          balesInStock: {
            cost: closingBales,
            kg: parseFloat(baleStock?.totalWeightKg || "0"),
            count: baleStock?.count ?? 0,
          },
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────────────────────────────────────────────────────
  // BALE RELABELING  (validate → apply → audit history)
  // ─────────────────────────────────────────────────────

  /** POST /api/factory/bales/relabel/validate
   *  Dry-run: checks each currentRef against factory_bales. Returns per-row results.
   */
  app.post("/api/factory/bales/relabel/validate", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows array is required" });
      }

      const refCodes: string[] = rows.map((r: any) => String(r.currentRef || "").trim()).filter(Boolean);
      if (refCodes.length === 0) return res.status(400).json({ message: "No reference codes provided" });

      // fetch all bales in one query
      const baleRows = await db
        .select({
          referenceNumber: factoryBales.referenceNumber,
          productName: factoryBales.productName,
          articleCode: factoryBales.articleCode,
          weightKg: factoryBales.weightKg,
          status: factoryBales.status,
        })
        .from(factoryBales)
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.referenceNumber, refCodes)));

      const baleMap = new Map<string, any>(baleRows.map((b: any) => [b.referenceNumber, b]));

      // detect duplicate refs in the uploaded file
      const seen = new Set<string>();
      const dupes = new Set<string>();
      for (const ref of refCodes) {
        if (seen.has(ref)) dupes.add(ref);
        seen.add(ref);
      }

      const results = rows.map((r: any) => {
        const ref = String(r.currentRef || "").trim();
        if (!ref) return { currentRef: ref, valid: false, error: "Empty reference code" };
        if (dupes.has(ref)) return { currentRef: ref, valid: false, error: "Duplicate in upload" };
        const bale = baleMap.get(ref);
        if (!bale) return { currentRef: ref, valid: false, error: "Not found in inventory" };
        return {
          currentRef: ref,
          valid: true,
          productName: bale.productName || bale.articleCode || "Unknown",
          articleCode: bale.articleCode || "",
          weightKg: bale.weightKg || "0",
          status: bale.status,
        };
      });

      const validCount = results.filter((r: any) => r.valid).length;
      const invalidCount = results.length - validCount;
      res.json({ results, validCount, invalidCount });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  /** POST /api/factory/bales/relabel/apply
   *  Atomically reassigns reference codes and records audit.
   */
  app.post("/api/factory/bales/relabel/apply", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId: string | null = (req.session as any).userId || null;

      const { rows, printFormat, designColor, filename } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows array is required" });
      }

      const validRows = rows.filter((r: any) => String(r.currentRef || "").trim());
      if (validRows.length === 0) return res.status(400).json({ message: "No valid rows to apply" });

      const result = await db.transaction(async (tx: any) => {
        // 1. Fetch bales to recode
        const refCodes = validRows.map((r: any) => String(r.currentRef).trim());
        const baleRows = await tx
          .select({
            id: factoryBales.id,
            referenceNumber: factoryBales.referenceNumber,
            productName: factoryBales.productName,
            articleCode: factoryBales.articleCode,
            weightKg: factoryBales.weightKg,
            status: factoryBales.status,
          })
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.referenceNumber, refCodes)));

        const baleMap = new Map<string, any>(baleRows.map((b: any) => [b.referenceNumber, b]));
        const notFound = refCodes.filter((r) => !baleMap.has(r));
        if (notFound.length > 0) {
          throw new Error(`Bales not found: ${notFound.slice(0, 5).join(", ")}${notFound.length > 5 ? ` +${notFound.length - 5} more` : ""}`);
        }

        // 2. Allocate sequential new REF codes
        const count = refCodes.length;
        const [seqRow] = await tx
          .select({ nextNumber: factoryBaleSequences.nextNumber })
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        const dbMaxResult = await tx.execute(
          sql`SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(reference_number, '[^0-9]', '', 'g') AS BIGINT)), 100875) as maxnum FROM factory_bales WHERE company_id = ${companyId}`
        );
        const dbMaxRow: any = Array.isArray(dbMaxResult) ? dbMaxResult[0] : (dbMaxResult?.rows?.[0] ?? {});
        const dbMax = Number(dbMaxRow?.maxnum ?? 100875);
        const storedNext = seqRow?.nextNumber ?? 1;
        let nextNumber = Math.max(storedNext, dbMax + 1);

        const newRefs: string[] = [];
        for (let i = 0; i < count; i++) {
          newRefs.push(`REF${String(nextNumber + i).padStart(5, "0")}`);
        }

        // Upsert sequence
        if (seqRow) {
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + count })
            .where(eq(factoryBaleSequences.companyId, companyId));
        } else {
          await tx.insert(factoryBaleSequences).values({ companyId, nextNumber: nextNumber + count });
        }

        // 3. Update factory_bales referenceNumber
        const recodeMap: { oldRef: string; newRef: string; bale: any }[] = refCodes.map((oldRef, i) => ({
          oldRef,
          newRef: newRefs[i],
          bale: baleMap.get(oldRef),
        }));

        for (const { oldRef, newRef } of recodeMap) {
          await tx
            .update(factoryBales)
            .set({ referenceNumber: newRef, updatedAt: new Date() })
            .where(and(eq(factoryBales.companyId, companyId), eq(factoryBales.referenceNumber, oldRef)));

          // Also update bale_label_prints if the old ref is there
          await tx
            .update(baleLabelPrints)
            .set({ referenceNumber: newRef })
            .where(and(eq(baleLabelPrints.companyId, companyId), eq(baleLabelPrints.referenceNumber, oldRef)));
        }

        // 4. Write audit session
        const [session] = await tx
          .insert(baleRecodeSessions)
          .values({
            companyId,
            performedBy: userId || null,
            uploadedFilename: filename || null,
            printFormat: printFormat || "A4",
            designColor: designColor || null,
            totalRows: rows.length,
            validRows: recodeMap.length,
            invalidRows: rows.length - recodeMap.length,
          })
          .returning({ id: baleRecodeSessions.id });

        // 5. Write audit items
        const itemValues = recodeMap.map(({ oldRef, newRef, bale }) => ({
          sessionId: session.id,
          oldReferenceCode: oldRef,
          newReferenceCode: newRef,
          productName: bale.productName || bale.articleCode || null,
          articleCode: bale.articleCode || null,
          weightKg: bale.weightKg || null,
          status: "SUCCESS",
          errorMessage: null,
        }));
        await tx.insert(baleRecodeItems).values(itemValues);

        return { sessionId: session.id, items: recodeMap.map(({ oldRef, newRef, bale }) => ({
          oldRef,
          newRef,
          productName: bale.productName || bale.articleCode || "Unknown",
          articleCode: bale.articleCode || "",
          weightKg: bale.weightKg || "0",
        })) };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  /** GET /api/factory/bales/relabel/sessions
   *  Recent relabeling history for the company.
   */
  app.get("/api/factory/bales/relabel/sessions", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessions = await db
        .select()
        .from(baleRecodeSessions)
        .where(eq(baleRecodeSessions.companyId, companyId))
        .orderBy(desc(baleRecodeSessions.createdAt))
        .limit(10);

      // attach items counts
      const sessionIds = sessions.map((s: any) => s.id);
      let itemsBySession: Record<number, any[]> = {};
      if (sessionIds.length > 0) {
        const items = await db
          .select()
          .from(baleRecodeItems)
          .where(inArray(baleRecodeItems.sessionId, sessionIds));
        for (const item of items) {
          if (!itemsBySession[item.sessionId]) itemsBySession[item.sessionId] = [];
          itemsBySession[item.sessionId].push(item);
        }
      }

      const enriched = sessions.map((s: any) => ({
        ...s,
        items: itemsBySession[s.id] || [],
      }));

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Factory Employees ────────────────────────────────────────────────────────

  // GET /api/factory/employees - list employees (employeeType = "Employee") for current company
}
