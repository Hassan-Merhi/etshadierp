import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db, pool } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { sqlArray } from "../../lib/sqlArray";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, syncEmployeeBalancesFromEntries } from "../_helpers";
import {
  factoryCategories, factoryBaleProducts, factoryContainers, factoryRawStock,
  factoryRawMaterialAdjustments, factoryMixBatches, factoryBales,
  customerProformas, customerProformaLines, customerOrders, customerOrderLines,
  customerOrderBales, customerOrderCharges, proformaStockReservations,
  inventory, stockItems, stockGroups, stockItemCodeAliases,
  stockItemLocationPrices, stockTransferVouchers, stockTransferItems,
  stockTransferRevisionItems, stockGroupLocationArchiveItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, containerSales,
  containerCharges, containerTrackingImportRowSchema, updateContainerTrackingSchema,
  bankAccounts, fixedAssets, insertBankAccountSchema, insertFixedAssetSchema,
  insertStockGroupSchema, insertStockItemSchema, insertStockItemCodeAliasSchema,
  insertContainerSchema, offloadRequestSchema,
  purchaseOrders, poLineItems, insertContainerSaleSchema,
  vouchers, voucherEntries, salesItems, insertVoucherSchema, insertVoucherEntrySchema,
  insertSalesItemSchema,
  suppliers, customers, customerBalances, locations, employees, userLocations,
  auditLog, interCompanyTransfers, insertInterCompanyTransferSchema,
  ledgerAccounts, insertLedgerAccountSchema, 
  companies, users, userCompanyRoles, companySettings,
  FEATURE_KEYS, fiscalPeriodClosures,
  wasteDispatches, wasteDispatchItems, insertWasteDispatchSchema,
  bales, baleProducts, baleProductCategories, baleTransfers,
  insertBaleSchema, insertBaleTransferSchema,
  
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, 
  pendingBarcodes, insertPendingBarcodeSchema,
  storedFiles, fileFolders, spreadsheets, liveSpreadsheets,
  agentAccounts, insertAgentAccountSchema,
  freightAccounts,
  snapshotPinnedAccounts,
  salaryAdvances, salaryAdvanceDeductions,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  employeeGroupMembers, employeeBaleRates, employeeBalePctRates,
  erpWorkerDocs, erpPayrollRunItems,
  chatMessages,
  propertyPayments,
  factoryTransporterTransactions,
  
  systemSettings,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../../netPositionHelper";
import path from "path";
import fs from "fs";


export function registerImportExportRoutes(app: Express) {
  app.get("/api/file-folders", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      const folders = await db.select().from(fileFolders)
        .where(eq(fileFolders.companyId, companyId))
        .orderBy(asc(fileFolders.name));
      res.json(folders);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/file-folders", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Folder name required" });
      const [folder] = await db.insert(fileFolders).values({ companyId, name: name.trim() }).returning();
      res.json(folder);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch("/api/file-folders/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const folderId = parseInt(req.params.id);
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Folder name required" });
      const [updated] = await db.update(fileFolders)
        .set({ name: name.trim() })
        .where(and(eq(fileFolders.id, folderId), eq(fileFolders.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Folder not found" });
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete("/api/file-folders/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const folderId = parseInt(req.params.id);
      const filesInFolder = await db.select({ id: storedFiles.id }).from(storedFiles)
        .where(and(eq(storedFiles.companyId, companyId), eq(storedFiles.folderId, folderId)));
      if (filesInFolder.length > 0) {
        return res.status(409).json({ message: `Folder has ${filesInFolder.length} file(s). Move or delete them first.`, fileCount: filesInFolder.length });
      }
      const [deleted] = await db.delete(fileFolders)
        .where(and(eq(fileFolders.id, folderId), eq(fileFolders.companyId, companyId)))
        .returning({ id: fileFolders.id });
      if (!deleted) return res.status(404).json({ message: "Folder not found" });
      res.json({ message: "Folder deleted" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // ── File Storage ─────────────────────────────────────────────
  app.get("/api/files", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      const files = await db
        .select({
          id: storedFiles.id,
          folderId: storedFiles.folderId,
          fileName: storedFiles.fileName,
          displayName: storedFiles.displayName,
          fileType: storedFiles.fileType,
          fileSize: storedFiles.fileSize,
          description: storedFiles.description,
          uploadedBy: storedFiles.uploadedBy,
          uploadedAt: storedFiles.uploadedAt,
        })
        .from(storedFiles)
        .where(eq(storedFiles.companyId, companyId))
        .orderBy(desc(storedFiles.uploadedAt));
      res.json(files);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/files/upload", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company context" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const { description, folderId } = req.body;
      const fileData = req.file.buffer.toString("base64");
      const folderIdNum = folderId ? parseInt(folderId) : null;
      const [inserted] = await db.insert(storedFiles).values({
        companyId,
        folderId: folderIdNum,
        fileName: req.file.originalname,
        displayName: null,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        fileData,
        description: description || null,
        uploadedBy: null,
      }).returning({ id: storedFiles.id });
      res.json({ id: inserted.id, message: "File uploaded successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/files/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const { displayName, folderId } = req.body;
      const updates: any = {};
      if (displayName !== undefined) updates.displayName = displayName || null;
      if (folderId !== undefined) updates.folderId = folderId === null ? null : parseInt(folderId);
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: "Nothing to update" });
      const [updated] = await db.update(storedFiles).set(updates)
        .where(and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId)))
        .returning({ id: storedFiles.id });
      if (!updated) return res.status(404).json({ message: "File not found" });
      res.json({ message: "File updated" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.get("/api/files/:id/download", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const [file] = await db.select().from(storedFiles).where(
        and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId))
      );
      if (!file) return res.status(404).json({ message: "File not found" });
      const buffer = Buffer.from(file.fileData, "base64");
      const outName = file.displayName || file.fileName;
      res.set("Content-Type", file.fileType);
      res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(outName)}"`);
      res.set("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/files/:id/preview", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const [file] = await db.select().from(storedFiles).where(
        and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId))
      );
      if (!file) return res.status(404).json({ message: "File not found" });
      const buffer = Buffer.from(file.fileData, "base64");
      res.set("Content-Type", file.fileType);
      res.set("Content-Disposition", `inline; filename="${encodeURIComponent(file.displayName || file.fileName)}"`);
      res.set("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/files/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const fileId = parseInt(req.params.id);
      const [deleted] = await db.delete(storedFiles).where(
        and(eq(storedFiles.id, fileId), eq(storedFiles.companyId, companyId))
      ).returning({ id: storedFiles.id });
      if (!deleted) return res.status(404).json({ message: "File not found" });
      res.json({ message: "File deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Spreadsheets ───────────────────────────────────────────────────────────
  app.get("/api/spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const list = await storage.listSpreadsheets(companyId);
      res.json(list);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      const sheet = await storage.getSpreadsheet(id, companyId);
      if (!sheet) return res.status(404).json({ message: "Spreadsheet not found" });
      res.json(sheet);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const username = req.session?.username ?? req.session?.userId ?? "Unknown";
      const { name, data } = req.body;
      const sheet = await storage.createSpreadsheet(companyId, name || "Untitled Spreadsheet", data ?? [], username);
      res.status(201).json(sheet);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      const { name, data } = req.body;
      const fields: { name?: string; data?: any } = {};
      if (name !== undefined) fields.name = name;
      if (data !== undefined) fields.data = data;
      const sheet = await storage.updateSpreadsheet(id, companyId, fields);
      if (!sheet) return res.status(404).json({ message: "Spreadsheet not found" });
      res.json(sheet);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      await storage.deleteSpreadsheet(id, companyId);
      res.json({ message: "Spreadsheet deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Live Spreadsheet Links ───

  app.get("/api/live-spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = req.session?.currentCompanyId;
      const isAdmin = req.session?.currentRole === "Admin" || req.session?.currentRole === "Owner" || req.session?.currentRole === "Developer";
      const sheets = await storage.getLiveSpreadsheets(companyId, !isAdmin);
      res.json(sheets);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/live-spreadsheets", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const role = req.session?.currentRole;
      if (role !== "Admin" && role !== "Owner" && role !== "Developer") {
        return res.status(403).json({ message: "Admin or Owner role required" });
      }
      const companyId = req.session?.currentCompanyId;
      const parsed = insertLiveSpreadsheetSchema.parse({ ...req.body, companyId });
      const sheet = await storage.createLiveSpreadsheet(parsed);
      res.json(sheet);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/live-spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const role = req.session?.currentRole;
      if (role !== "Admin" && role !== "Owner" && role !== "Developer") {
        return res.status(403).json({ message: "Admin or Owner role required" });
      }
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      const fields = insertLiveSpreadsheetSchema.partial().parse(req.body);
      const sheet = await storage.updateLiveSpreadsheet(id, companyId, fields);
      if (!sheet) return res.status(404).json({ message: "Not found" });
      res.json(sheet);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/live-spreadsheets/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const role = req.session?.currentRole;
      if (role !== "Admin" && role !== "Owner" && role !== "Developer") {
        return res.status(403).json({ message: "Admin or Owner role required" });
      }
      const companyId = req.session?.currentCompanyId;
      const id = parseInt(req.params.id);
      await storage.deleteLiveSpreadsheet(id, companyId);
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });


  app.get("/api/agent-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await db.select().from(agentAccounts).where(eq(agentAccounts.companyId, companyId));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/agent-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { accountId, accountType, accountName } = req.body;
      if (!accountId || !accountType || !accountName) return res.status(400).json({ message: "accountId, accountType, and accountName are required" });
      const [row] = await db.insert(agentAccounts)
        .values({ companyId, accountId, accountType, accountName })
        .onConflictDoUpdate({ target: [agentAccounts.companyId, agentAccounts.accountId], set: { accountName, accountType } })
        .returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/agent-accounts/:accountId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = decodeURIComponent(req.params.accountId);
      await db.delete(agentAccounts).where(and(eq(agentAccounts.companyId, companyId), eq(agentAccounts.accountId, accountId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── FREIGHT ACCOUNTS (Financial Snapshot) ─────────────────────────────────
  app.get("/api/freight-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await db.select().from(freightAccounts).where(eq(freightAccounts.companyId, companyId));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/freight-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { accountId, accountType, accountName } = req.body;
      if (!accountId || !accountType || !accountName) return res.status(400).json({ message: "accountId, accountType, and accountName are required" });
      const [row] = await db.insert(freightAccounts)
        .values({ companyId, accountId, accountType, accountName })
        .onConflictDoUpdate({ target: [freightAccounts.companyId, freightAccounts.accountId], set: { accountName, accountType } })
        .returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/freight-accounts/:accountId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = decodeURIComponent(req.params.accountId);
      await db.delete(freightAccounts).where(and(eq(freightAccounts.companyId, companyId), eq(freightAccounts.accountId, accountId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── SNAPSHOT PINNED ACCOUNTS (supplier / customer / advance + future cards) ─
  const ALLOWED_CARD_KEYS = new Set(["supplier", "customer", "advance"]);

  app.get("/api/snapshot-pinned-accounts/:cardKey", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { cardKey } = req.params;
      if (!ALLOWED_CARD_KEYS.has(cardKey)) return res.status(400).json({ message: "Invalid cardKey" });
      const rows = await db.select().from(snapshotPinnedAccounts)
        .where(and(eq(snapshotPinnedAccounts.companyId, companyId), eq(snapshotPinnedAccounts.cardKey, cardKey)));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/snapshot-pinned-accounts/:cardKey", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { cardKey } = req.params;
      if (!ALLOWED_CARD_KEYS.has(cardKey)) return res.status(400).json({ message: "Invalid cardKey" });
      const { accountId, accountType, accountName } = req.body;
      if (!accountId || !accountType || !accountName) return res.status(400).json({ message: "accountId, accountType, and accountName are required" });
      const [row] = await db.insert(snapshotPinnedAccounts)
        .values({ companyId, cardKey, accountId, accountType, accountName })
        .onConflictDoUpdate({
          target: [snapshotPinnedAccounts.companyId, snapshotPinnedAccounts.cardKey, snapshotPinnedAccounts.accountId],
          set: { accountName, accountType },
        })
        .returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/snapshot-pinned-accounts/:cardKey/:accountId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { cardKey } = req.params;
      if (!ALLOWED_CARD_KEYS.has(cardKey)) return res.status(400).json({ message: "Invalid cardKey" });
      const accountId = decodeURIComponent(req.params.accountId);
      await db.delete(snapshotPinnedAccounts).where(
        and(
          eq(snapshotPinnedAccounts.companyId, companyId),
          eq(snapshotPinnedAccounts.cardKey, cardKey),
          eq(snapshotPinnedAccounts.accountId, accountId),
        )
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNT MIGRATION — move ledger accounts + their statements between companies
  // Supports migrating multiple accounts at once in a single atomic transaction.
  // Voucher exclusivity is evaluated against the whole batch: a voucher that
  // touches only accounts within the migrating batch is moved entirely.
  // ═══════════════════════════════════════════════════════════════════════════

  // List all companies (for source/destination pickers)
  app.get("/api/admin/account-migration/companies", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const all = await storage.getAllCompanies();
      res.json(all);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // List ledger accounts in a company
  app.get("/api/admin/account-migration/accounts/:companyId", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const companyId = parseInt(req.params.companyId);
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid companyId" });
      const accounts = await storage.getAllLedgerAccounts(companyId, true);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Preview a batch migration — accepts accountIds array
  app.post("/api/admin/account-migration/preview", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const { accountIds, srcCompanyId, destCompanyId } = req.body;
      if (!Array.isArray(accountIds) || accountIds.length === 0 || !srcCompanyId || !destCompanyId)
        return res.status(400).json({ message: "accountIds (array), srcCompanyId and destCompanyId are required" });
      if (srcCompanyId === destCompanyId)
        return res.status(400).json({ message: "Source and destination must be different companies" });

      const batchSet = new Set<number>(accountIds);

      const accountPreviews = [];
      let grandTotalDebit = 0;
      let grandTotalCredit = 0;
      let grandTotalEntries = 0;

      for (const accountId of accountIds) {
        // Verify account belongs to source company
        const [account] = await db.select().from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, srcCompanyId)));
        if (!account)
          return res.status(404).json({ message: `Account ${accountId} not found in source company` });

        // Get all voucher entries for this account
        const entryRows = await db.select({
          voucherId: voucherEntries.voucherId,
          debit: voucherEntries.debitAmount,
          credit: voucherEntries.creditAmount,
        }).from(voucherEntries).where(eq(voucherEntries.ledgerAccountId, accountId));

        const totalDebit  = entryRows.reduce((s, r) => s + parseFloat(r.debit  || "0"), 0);
        const totalCredit = entryRows.reduce((s, r) => s + parseFloat(r.credit || "0"), 0);
        grandTotalDebit  += totalDebit;
        grandTotalCredit += totalCredit;
        grandTotalEntries += entryRows.length;

        const touchedVoucherIds = [...new Set(entryRows.map(r => r.voucherId))];

        // A voucher is exclusive to the batch only if:
        //   • every ledger-account entry belongs to the migrated batch, AND
        //   • it has NO supplier entries (supplier balance must stay in source company), AND
        //   • it has NO employee entries (employee balance must stay in source company)
        let exclusiveVoucherCount = 0;
        let sharedVoucherCount = 0;
        for (const vid of touchedVoucherIds) {
          const allEntries = await db.select({
            la:         voucherEntries.ledgerAccountId,
            supplierId: voucherEntries.supplierId,
            employeeId: voucherEntries.employeeId,
          }).from(voucherEntries).where(eq(voucherEntries.voucherId, vid));
          const isShared = allEntries.some(e =>
            e.supplierId !== null ||
            e.employeeId !== null ||
            (e.la !== null && !batchSet.has(e.la as number))
          );
          if (!isShared) exclusiveVoucherCount++;
          else sharedVoucherCount++;
        }

        // Check code conflict in destination
        const [codeConflict] = await db.select().from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, destCompanyId), eq(ledgerAccounts.code, account.code)));

        accountPreviews.push({
          account,
          entryCount: entryRows.length,
          totalDebit,
          totalCredit,
          touchedVoucherCount: touchedVoucherIds.length,
          exclusiveVoucherCount,
          sharedVoucherCount,
          codeConflict: codeConflict ? { id: codeConflict.id, name: codeConflict.name } : null,
        });
      }

      const srcCompany  = await storage.getCompanyById(srcCompanyId);
      const destCompany = await storage.getCompanyById(destCompanyId);

      res.json({
        accounts: accountPreviews,
        srcCompany,
        destCompany,
        grandTotalEntries,
        grandTotalDebit,
        grandTotalCredit,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Execute a batch migration — moves all accounts atomically in one transaction
  app.post("/api/admin/account-migration/execute", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const { accountIds, srcCompanyId, destCompanyId } = req.body;
      if (!Array.isArray(accountIds) || accountIds.length === 0 || !srcCompanyId || !destCompanyId)
        return res.status(400).json({ message: "accountIds (array), srcCompanyId and destCompanyId are required" });
      if (srcCompanyId === destCompanyId)
        return res.status(400).json({ message: "Source and destination must be different companies" });

      const batchSet = new Set<number>(accountIds);

      // Build per-account plan (code conflict resolution + entry counts)
      const accountPlans: Array<{
        account: any;
        originalCode: string;
        finalCode: string;
        entryCount: number;
        touchedVoucherIds: number[];
      }> = [];

      // Track ALL voucher IDs touched by ANY account in the batch
      const allTouchedVoucherIds = new Set<number>();

      for (const accountId of accountIds) {
        const [account] = await db.select().from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, srcCompanyId)));
        if (!account)
          return res.status(404).json({ message: `Account ${accountId} not found in source company` });

        // Auto-resolve code conflict with -MIGRATED suffix
        const [codeConflict] = await db.select().from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, destCompanyId), eq(ledgerAccounts.code, account.code)));
        const finalCode = codeConflict ? `${account.code}-MIGRATED` : account.code;

        const entryRows = await db.select({ voucherId: voucherEntries.voucherId })
          .from(voucherEntries).where(eq(voucherEntries.ledgerAccountId, accountId));
        const touchedVoucherIds = [...new Set(entryRows.map(r => r.voucherId))];
        touchedVoucherIds.forEach(v => allTouchedVoucherIds.add(v));

        accountPlans.push({ account, originalCode: account.code, finalCode, entryCount: entryRows.length, touchedVoucherIds });
      }

      // Determine which vouchers are exclusive to this batch.
      // A voucher is exclusive only if ALL of the following are true:
      //   • every ledger-account entry belongs to the migrated batch
      //   • it has NO supplier entries (those must stay in the source company)
      //   • it has NO employee entries (those must stay in the source company)
      // Any voucher with a supplier or employee side is treated as "shared"
      // and left in the source company so balances stay correct on both sides.
      const exclusiveVoucherIds: number[] = [];
      for (const vid of allTouchedVoucherIds) {
        const allEntries = await db.select({
          la:         voucherEntries.ledgerAccountId,
          supplierId: voucherEntries.supplierId,
          employeeId: voucherEntries.employeeId,
        }).from(voucherEntries).where(eq(voucherEntries.voucherId, vid));
        const isShared = allEntries.some(e =>
          e.supplierId !== null ||
          e.employeeId !== null ||
          (e.la !== null && !batchSet.has(e.la as number))
        );
        if (!isShared) exclusiveVoucherIds.push(vid);
      }

      // ── Execute everything in one atomic transaction ────────────────────────
      await db.transaction(async (tx) => {
        for (const plan of accountPlans) {
          await tx.update(ledgerAccounts)
            .set({ companyId: destCompanyId, code: plan.finalCode, parentId: null })
            .where(eq(ledgerAccounts.id, plan.account.id));
        }
        if (exclusiveVoucherIds.length > 0) {
          await tx.update(vouchers)
            .set({ companyId: destCompanyId })
            .where(inArray(vouchers.id, exclusiveVoucherIds));
        }
      });

      const sharedVoucherCount = allTouchedVoucherIds.size - exclusiveVoucherIds.length;
      const totalEntries = accountPlans.reduce((s, p) => s + p.entryCount, 0);

      console.log(
        `[AccountMigration] Batch of ${accountIds.length} account(s) moved from company ${srcCompanyId} → ${destCompanyId}. ` +
        `${totalEntries} entries, ${exclusiveVoucherIds.length} vouchers moved, ${sharedVoucherCount} shared vouchers left in source.`
      );

      res.json({
        success: true,
        srcCompanyId,
        destCompanyId,
        totalEntries,
        movedVoucherIds: exclusiveVoucherIds,
        movedVoucherCount: exclusiveVoucherIds.length,
        sharedVoucherCount,
        accounts: accountPlans.map(p => ({
          accountId: p.account.id,
          accountName: p.account.name,
          originalCode: p.originalCode,
          finalCode: p.finalCode,
          entryCount: p.entryCount,
          wasRenamed: p.originalCode !== p.finalCode,
        })),
      });
    } catch (error: any) {
      console.error("[AccountMigration] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Undo a batch migration — moves all accounts back atomically
  app.post("/api/admin/account-migration/undo", requireAuth, requireRole("Admin", "Developer"), async (req: any, res: any) => {
    try {
      const { accounts, movedVoucherIds, srcCompanyId, destCompanyId } = req.body;
      // accounts = [{ accountId, originalCode }]
      if (!Array.isArray(accounts) || accounts.length === 0 || !srcCompanyId || !destCompanyId)
        return res.status(400).json({ message: "accounts (array), srcCompanyId and destCompanyId are required" });

      // Sanity-check: all accounts should currently be in destCompany
      for (const a of accounts) {
        const [row] = await db.select({ id: ledgerAccounts.id }).from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, a.accountId), eq(ledgerAccounts.companyId, destCompanyId)));
        if (!row)
          return res.status(404).json({
            message: `Account ${a.accountId} not found in destination company — it may have already been moved or re-migrated.`,
          });
      }

      await db.transaction(async (tx) => {
        for (const a of accounts) {
          await tx.update(ledgerAccounts)
            .set({ companyId: srcCompanyId, code: a.originalCode, parentId: null })
            .where(eq(ledgerAccounts.id, a.accountId));
        }
        if (Array.isArray(movedVoucherIds) && movedVoucherIds.length > 0) {
          await tx.update(vouchers)
            .set({ companyId: srcCompanyId })
            .where(inArray(vouchers.id, movedVoucherIds));
        }
      });

      console.log(
        `[AccountMigration] UNDO: ${accounts.length} account(s) moved back from company ${destCompanyId} → ${srcCompanyId}. ` +
        `${(movedVoucherIds ?? []).length} vouchers restored.`
      );

      res.json({
        success: true,
        restoredAccountCount: accounts.length,
        restoredVoucherCount: (movedVoucherIds ?? []).length,
      });
    } catch (error: any) {
      console.error("[AccountMigration] Undo error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Deployment migration diagnostics ────────────────────────────────────────
  // Returns counts (no sensitive data) useful for verifying a Render deploy.
}
