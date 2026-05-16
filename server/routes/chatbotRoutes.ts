import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, syncEmployeeBalancesFromEntries } from "./_helpers";
import { saveMessage, chat, getConversationHistory, getConversationHistoryForAI, getAllChatHistory, saveFeedback, getConfiguredProviders, extractPOFromText } from "../chatService";
import {
  inventory, stockItems, stockGroups, stockItemCodeAliases,
  stockItemLocationPrices, stockTransferVouchers, stockTransferItems,
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
  storedFiles, spreadsheets, liveSpreadsheets,
  agentAccounts, insertAgentAccountSchema,
  salaryAdvances, salaryAdvanceDeductions,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  chatMessages,
  
  systemSettings,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";
import path from "path";
import fs from "fs";

export function registerChatbotRoutes(app: Express) {
  app.get("/api/chatbot/status", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const companyId = req.session.currentCompanyId;
      const userRole = req.session.currentRole;
      
      if (!userId || !companyId) {
        return res.json({ enabled: false });
      }

      // Get user chatbot status
      const [user] = await db.select({ chatbotEnabled: users.chatbotEnabled })
        .from(users)
        .where(eq(users.id, userId));

      // Get selected AI provider and check if its API key is configured
      const providerSetting = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "ai_provider")).limit(1);
      const selectedProvider = (providerSetting.length > 0 && providerSetting[0].value) ? providerSetting[0].value.toLowerCase() : "gemini";
      let hasApiKey = false;
      let providerName = "Gemini";
      if (selectedProvider === "chatgpt") {
        hasApiKey = !!process.env.OPENAI_API_KEY;
        providerName = "OpenAI";
      } else if (selectedProvider === "grok") {
        hasApiKey = !!process.env.XAI_API_KEY;
        providerName = "Grok";
      } else {
        hasApiKey = !!process.env.GEMINI_API_KEY;
        providerName = "Gemini";
      }

      res.json({
        enabled: true,
        providerName,
        selectedProvider,
        hasApiKey,
        isAdminOrOwner: userRole === "Admin" || userRole === "Owner" || userRole === "Developer",
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Send a chat message

  // Update AI provider setting
  app.patch("/api/chatbot/provider", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userRole = req.session.currentRole;
      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
        return res.status(403).json({ message: "Only admins can change AI provider" });
      }

      const { provider } = req.body;
      if (!provider || !["gemini", "chatgpt", "grok"].includes(provider.toLowerCase())) {
        return res.status(400).json({ message: "Invalid provider. Must be gemini, chatgpt, or grok" });
      }

      const normalizedProvider = provider.toLowerCase();
      
      // Check if setting exists
      const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, "ai_provider")).limit(1);
      
      if (existing.length > 0) {
        await db.update(systemSettings)
          .set({ value: normalizedProvider, updatedAt: new Date() })
          .where(eq(systemSettings.key, "ai_provider"));
      } else {
        await db.insert(systemSettings).values({
          key: "ai_provider",
          value: normalizedProvider,
        } as any);
      }

      res.json({ success: true, provider: normalizedProvider });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  app.post("/api/chatbot/message", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const companyId = req.session.currentCompanyId;
      
      if (!userId || !companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { message, sessionId } = req.body;
      if (!message || !sessionId) {
        return res.status(400).json({ message: "Message and sessionId are required" });
      }

      // Save user message
      await saveMessage(companyId, userId, "user", message, sessionId);

      // Get conversation history for AI context (excluding current message)
      const history = await getConversationHistoryForAI(sessionId, 10);

      // Get AI response (excluding current message from history context)
      const result = await chat(message, companyId, history.slice(0, -1));

      // Save assistant response
      await saveMessage(companyId, userId, "assistant", result.response, sessionId);

      res.json({ response: result.response, suggestions: result.suggestions, voucherDraft: result.voucherDraft ?? null, stockAdjustmentDraft: result.stockAdjustmentDraft ?? null, voucherSearchResults: result.voucherSearchResults ?? null, stockItemDraft: result.stockItemDraft ?? null, priceUpdateDraft: result.priceUpdateDraft ?? null, accountQueryResult: result.accountQueryResult ?? null, verifyContainerDraft: result.verifyContainerDraft ?? null });
    } catch (error: any) {
      console.error("[Chatbot] ERROR:", error.message);
      console.error("[Chatbot] Stack:", error.stack);
      res.status(500).json({ message: "Chat error: " + error.message });
    }
  });

  // Get chat history for current session
  app.get("/api/chatbot/history/:sessionId", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { sessionId } = req.params;
      // Pass userId to ensure users can only access their own chat history
      const history = await getConversationHistory(sessionId, userId, 50);
      res.json(history);
    } catch (error: any) {
      console.error("[Chatbot] History ERROR:", error.message);
      console.error("[Chatbot] History Stack:", error.stack);
      res.status(500).json({ message: "History error: " + error.message });
    }
  });

  // Get all chat history (Admin/Owner only)
  app.get("/api/chatbot/all-history", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      const userRole = req.session.currentRole;
      
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Only Admin/Owner can view all chat history
      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
        return res.status(403).json({ message: "Access denied" });
      }

      const history = await getAllChatHistory(companyId, 200);
      
      // Enrich with username
      const userIds = Array.from(new Set(history.map(h => h.userId)));
      const usersList = userIds.length > 0 
        ? await db.select({ id: users.id, username: users.username })
            .from(users)
            .where(inArray(users.id, userIds))
        : [];
      
      const userMap = new Map(usersList.map(u => [u.id, u.username]));
      
      const enrichedHistory = history.map(h => ({
        ...h,
        username: userMap.get(h.userId) || "Unknown",
      }));

      res.json(enrichedHistory);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── PROACTIVE ALERTS DIGEST (5a) ──
  app.get("/api/chatbot/alerts", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Low stock items
      const inventoryRows = await db
        .select({ stockItemId: inventory.stockItemId, quantity: inventory.quantity })
        .from(inventory)
        .where(eq(inventory.companyId, companyId));

      const stockRows = await db
        .select({ id: stockItems.id, name: stockItems.name, code: stockItems.code, reorderLevel: stockItems.reorderLevel })
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), eq(stockItems.active, true)));

      const invMap = new Map(inventoryRows.map(i => [i.stockItemId, parseFloat(i.quantity || "0")]));
      const lowStock = stockRows
        .filter(s => {
          const lvl = parseFloat(s.reorderLevel || "0");
          return lvl > 0 && (invMap.get(s.id) || 0) <= lvl;
        })
        .map(s => ({ id: s.id, name: s.name, code: s.code, qty: invMap.get(s.id) || 0, reorderLevel: parseFloat(s.reorderLevel || "0") }));

      // Open POs (awaiting)
      const openPOs = await db
        .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, supplierId: purchaseOrders.supplierId, status: purchaseOrders.status })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.companyId, companyId), eq(purchaseOrders.status, "Open")));

      // Customer receivables (overdue balances > 0)
      const customerBalanceRows = await db
        .select({
          customerId: customerBalances.customerId,
          totalDebit: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS NUMERIC)), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${customerBalances.creditAmount} AS NUMERIC)), 0)`,
        })
        .from(customerBalances)
        .where(eq(customerBalances.companyId, companyId))
        .groupBy(customerBalances.customerId);

      const customerRows = await db
        .select({ id: customers.id, legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.companyId, companyId));
      const custMap = new Map(customerRows.map(c => [c.id, c.legalName]));

      const overdueCustomers = customerBalanceRows
        .map(cb => {
          const balance = parseFloat(cb.totalDebit) - parseFloat(cb.totalCredit);
          return { customerId: cb.customerId, name: custMap.get(cb.customerId) || "Unknown", balance };
        })
        .filter(c => c.balance > 0.01)
        .slice(0, 10);

      // Pending payrolls (DRAFT status in factory_payrolls)
      let pendingPayrolls: any[] = [];
      try {
        const { factoryPayrolls } = await import("@shared/schema");
        pendingPayrolls = await db
          .select({ id: factoryPayrolls.id, periodStart: factoryPayrolls.periodStart, periodEnd: factoryPayrolls.periodEnd, status: factoryPayrolls.status })
          .from(factoryPayrolls)
          .where(and(eq(factoryPayrolls.companyId, companyId), eq(factoryPayrolls.status, "DRAFT")))
          .limit(5);
      } catch (_) {}

      res.json({
        lowStock: lowStock.slice(0, 10),
        openPOs: openPOs.slice(0, 10),
        overdueCustomers,
        pendingPayrolls,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Toggle chatbot for a user (Admin/Owner only)
  app.patch("/api/users/:userId/chatbot", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userRole = req.session.currentRole;
      
      // Only Admin/Owner can toggle chatbot
      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
        return res.status(403).json({ message: "Access denied" });
      }

      const { userId } = req.params;
      const { enabled } = req.body;

      await db.update(users)
        .set({ chatbotEnabled: enabled })
        .where(eq(users.id, userId));

      res.json({ message: `Chatbot ${enabled ? "enabled" : "disabled"} for user` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get users with their chatbot status (Admin/Owner only)
  app.get("/api/users/chatbot-status", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userRole = req.session.currentRole;
      
      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
        return res.status(403).json({ message: "Access denied" });
      }

      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        chatbotEnabled: users.chatbotEnabled,
        active: users.active,
      })
        .from(users)
        .where(eq(users.active, true));

      res.json(allUsers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── PO File Parse (AI-powered) ────────────────────────────────────
  app.post("/api/chatbot/parse-po-file", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const fileExt = (req.file.originalname || "").toLowerCase().split(".").pop();
      const allSuppliers  = await storage.getAllSuppliers();
      const allStockItems = await storage.getAllStockItems(companyId);

      // ── Helper: match supplier from raw string ──────────────────────
      function tryMatchSupplier(raw: string): { id: number; name: string } | null {
        if (!raw) return null;
        const lo = raw.toLowerCase();
        const byCode = allSuppliers.find(s => s.code?.toLowerCase() === lo);
        if (byCode) return { id: byCode.id, name: byCode.legalName };
        const byName = allSuppliers.find(s =>
          s.legalName.toLowerCase().includes(lo) || lo.includes(s.legalName.toLowerCase())
        );
        return byName ? { id: byName.id, name: byName.legalName } : null;
      }

      // ── Helper: match stock item ────────────────────────────────────
      async function tryMatchItem(code: string, name: string): Promise<{ id: number; name: string } | null> {
        if (code) {
          const si = await storage.getStockItemByCodeOrAlias(code, companyId);
          if (si) return { id: si.id, name: si.name };
        }
        if (name) {
          const lo = name.toLowerCase();
          const si = allStockItems.find(s =>
            s.name.toLowerCase() === lo || s.code?.toLowerCase() === lo
          );
          if (si) return { id: si.id, name: si.name };
        }
        return null;
      }

      // ── Helper: build response from extracted data ──────────────────
      async function buildResponse(extracted: {
        poNumber: string; containerNumber: string; supplierName: string; supplierCode: string;
        importDate: string; currency: string;
        items: { name: string; code: string; quantity: number; rate: number }[];
        freight: number; surcharge: number; fumigation: number;
        documentCharges: number; discount: number; otherCharges: number;
      }) {
        const supplier = tryMatchSupplier(extracted.supplierCode) || tryMatchSupplier(extracted.supplierName);
        const lines: any[] = [];
        for (const item of extracted.items) {
          if (item.quantity <= 0) continue;
          const matched = await tryMatchItem(item.code || "", item.name || "");
          lines.push({
            rawName:       item.name || item.code || "Unknown",
            rawCode:       item.code || "",
            stockItemId:   matched?.id ?? null,
            stockItemName: matched?.name ?? "",
            qty:           item.quantity.toString(),
            rate:          (item.rate || 0).toFixed(2),
            lineTotal:     (item.quantity * (item.rate || 0)).toFixed(2),
          });
        }
        const itemsTotal  = lines.reduce((s, l) => s + parseFloat(l.lineTotal), 0);
        const chargesNet  = extracted.freight + extracted.surcharge + extracted.fumigation +
                            extracted.documentCharges - extracted.discount + extracted.otherCharges;
        const grandTotal  = itemsTotal + chargesNet;
        const unresolvedItems = lines
          .map((l, i) => l.stockItemId ? null : { index: i, rawName: l.rawName, rawCode: l.rawCode })
          .filter(Boolean);

        return {
          poNumber:          extracted.poNumber || "",
          containerNumber:   extracted.containerNumber || "",
          importDate:        extracted.importDate || new Date().toISOString().split("T")[0],
          currency:          extracted.currency || "USD",
          supplierId:        supplier?.id ?? null,
          supplierName:      supplier?.name ?? (extracted.supplierCode || extracted.supplierName || ""),
          supplierRaw:       extracted.supplierCode || extracted.supplierName || "",
          lines,
          charges: {
            freight:         extracted.freight,
            surcharge:       extracted.surcharge,
            fumigation:      extracted.fumigation,
            documentCharges: extracted.documentCharges,
            discount:        extracted.discount,
            otherCharges:    extracted.otherCharges,
          },
          itemsTotal:        itemsTotal.toFixed(2),
          grandTotal:        grandTotal.toFixed(2),
          unresolvedSupplier: !supplier,
          unresolvedItems,
          allSuppliers:      allSuppliers.map(s => ({ id: s.id, name: s.legalName, code: s.code || "" })),
          allStockItems:     allStockItems.map(s => ({ id: s.id, name: s.name, code: s.code || "" })),
        };
      }

      // ── Flexible column lookup (Excel/CSV) ──────────────────────────
      function col(row: Record<string, any>, ...keys: string[]): string {
        for (const key of keys) {
          const norm = key.toLowerCase().replace(/[\s_]+/g, "");
          const found = Object.keys(row).find(k => k.toLowerCase().replace(/[\s_]+/g, "") === norm);
          if (found !== undefined && row[found] != null && row[found] !== "")
            return String(row[found]).trim();
        }
        return "";
      }

      // ════════════════════════════════════════════════════════════════
      // PDF → always use AI extraction
      // ════════════════════════════════════════════════════════════════
      if (fileExt === "pdf") {
        let pdfText = "";
        try {
          const pdfParse = (await import("pdf-parse")).default;
          const parsed = await pdfParse(req.file.buffer);
          pdfText = parsed.text;
        } catch (pdfErr: any) {
          return res.status(400).json({ message: `Could not read PDF: ${pdfErr.message}` });
        }
        if (!pdfText.trim()) return res.status(400).json({ message: "PDF appears to be empty or is image-only (no extractable text)" });

        const extracted = await extractPOFromText(pdfText);
        if (!extracted || !extracted.items.length) {
          return res.status(400).json({ message: "AI could not find any purchase order items in this PDF. Make sure the PDF contains readable text." });
        }
        return res.json(await buildResponse(extracted));
      }

      // ════════════════════════════════════════════════════════════════
      // Excel / CSV → try column mapping first, AI fallback if needed
      // ════════════════════════════════════════════════════════════════
      let rows: Record<string, any>[] = [];
      if (fileExt === "csv") {
        const text = req.file.buffer.toString("utf-8");
        const csvLines = text.split(/\r?\n/).filter(l => l.trim());
        if (csvLines.length < 2) return res.status(400).json({ message: "CSV file has no data rows" });
        const headers = csvLines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
        for (let i = 1; i < csvLines.length; i++) {
          const vals = csvLines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
          if (vals.every(v => !v)) continue;
          const row: Record<string, any> = {};
          headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
          rows.push(row);
        }
      } else {
        // Excel (.xlsx, .xls, .ods, etc.)
        let wb;
        try {
          wb = await readExcel(req.file.buffer);
        } catch (xlErr: any) {
          return res.status(400).json({ message: `Could not read file: ${xlErr.message}` });
        }
        const sheetName = wb.SheetNames[0];
        if (!sheetName) return res.status(400).json({ message: "Excel file is empty" });
        rows = sheetToJson(wb.Sheets[sheetName]) as Record<string, any>[];
      }

      if (!rows.length) return res.status(400).json({ message: "File has no data rows" });

      // Try standard column mapping
      const first = rows[0];
      const poNumber       = col(first, "PO_Number","PONumber","PO Number","PO#","po_number","PONo","PO No","Invoice Number","InvoiceNumber");
      const containerNumber= col(first, "Container_Number","ContainerNumber","Container Number","Container","CONT","Container#","Shipment");
      const supplierCode   = col(first, "Supplier_Code","SupplierCode","Supplier Code","Vendor Code","VendorCode");
      const supplierName   = col(first, "Supplier_Name","SupplierName","Supplier","Vendor","Vendor Name","From");
      const currency       = col(first, "Currency","currency") || "USD";
      const importDateRaw  = col(first, "Import_Date","ImportDate","Import Date","Date","PO_Date","PODate","Invoice Date","Invoice_Date");
      const importDate     = importDateRaw || new Date().toISOString().split("T")[0];
      const freight        = parseFloat(col(first,"Freight","freight")||"0")||0;
      const surcharge      = parseFloat(col(first,"Surcharge","surcharge")||"0")||0;
      const fumigation     = parseFloat(col(first,"Fumigation","fumigation")||"0")||0;
      const documentCharges= parseFloat(col(first,"Document_Charges","DocumentCharges","Doc Charges","DocCharges","Document Charges")||"0")||0;
      const discount       = parseFloat(col(first,"Discount","discount")||"0")||0;
      const otherCharges   = parseFloat(col(first,"Other_Charges","OtherCharges","Other Charges")||"0")||0;

      const mappedLines: any[] = [];
      for (const row of rows) {
        const itemCode = col(row,"Item_Barcode","ItemBarcode","Barcode","barcode","Item_Code","ItemCode","Code","SKU","Item Code","Barcode/Code");
        const itemName = col(row,"Item_Name","ItemName","Name","Description","Item","Product","Item Description");
        const qty  = parseFloat(col(row,"Quantity","Qty","quantity","qty","Units","units")||"0");
        const rate = parseFloat(col(row,"Rate","Price","Unit_Price","UnitPrice","Unit Price","rate","price","Unit Cost")||"0");
        if ((!itemName && !itemCode) || qty <= 0) continue;
        const matched = await tryMatchItem(itemCode, itemName);
        mappedLines.push({
          rawName:       itemName || itemCode,
          rawCode:       itemCode || "",
          stockItemId:   matched?.id ?? null,
          stockItemName: matched?.name ?? "",
          qty:           qty.toString(),
          rate:          rate.toFixed(2),
          lineTotal:     (qty * rate).toFixed(2),
        });
      }

      // If standard mapping found items — use them directly
      if (mappedLines.length > 0) {
        const supplier = tryMatchSupplier(supplierCode) || tryMatchSupplier(supplierName);
        const itemsTotal = mappedLines.reduce((s, l) => s + parseFloat(l.lineTotal), 0);
        const chargesNet = freight + surcharge + fumigation + documentCharges - discount + otherCharges;
        const unresolvedItems = mappedLines
          .map((l, i) => l.stockItemId ? null : { index: i, rawName: l.rawName, rawCode: l.rawCode })
          .filter(Boolean);
        return res.json({
          poNumber, containerNumber, importDate, currency,
          supplierId:        supplier?.id ?? null,
          supplierName:      supplier?.name ?? (supplierCode || supplierName || ""),
          supplierRaw:       supplierCode || supplierName || "",
          lines:             mappedLines,
          charges:           { freight, surcharge, fumigation, documentCharges, discount, otherCharges },
          itemsTotal:        itemsTotal.toFixed(2),
          grandTotal:        (itemsTotal + chargesNet).toFixed(2),
          unresolvedSupplier: !supplier,
          unresolvedItems,
          allSuppliers:      allSuppliers.map(s => ({ id: s.id, name: s.legalName, code: s.code || "" })),
          allStockItems:     allStockItems.map(s => ({ id: s.id, name: s.name, code: s.code || "" })),
        });
      }

      // AI fallback — flatten rows to plain text and ask AI to parse
      const rawText = rows.map(r => Object.entries(r).map(([k,v]) => `${k}: ${v}`).join(" | ")).join("\n");
      const extracted = await extractPOFromText(rawText);
      if (!extracted || !extracted.items.length) {
        return res.status(400).json({
          message: "Could not find item rows in the file. Expected columns like Item_Name / Quantity / Rate, or the file may be in an unusual layout.",
          rowCount: rows.length,
          detectedColumns: Object.keys(rows[0] || {}),
        });
      }
      // Merge header-level fields we did find with AI-extracted items
      if (!extracted.poNumber && poNumber)       extracted.poNumber = poNumber;
      if (!extracted.containerNumber && containerNumber) extracted.containerNumber = containerNumber;
      if (!extracted.supplierName && supplierName)      extracted.supplierName = supplierName;
      if (!extracted.supplierCode && supplierCode)      extracted.supplierCode = supplierCode;
      if (!extracted.importDate && importDateRaw)       extracted.importDate = importDateRaw;
      return res.json(await buildResponse(extracted));

    } catch (error: any) {
      console.error("PO file parse error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── PO Import Confirm ─────────────────────────────────────────────
  app.post("/api/chatbot/confirm-po-import", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { poNumber, containerNumber, importDate, currency, supplierId, lines, charges } = req.body;

      if (!poNumber)        return res.status(400).json({ message: "PO number is required" });
      if (!containerNumber) return res.status(400).json({ message: "Container number is required" });
      if (!supplierId)      return res.status(400).json({ message: "Supplier is required" });
      if (!lines?.length)   return res.status(400).json({ message: "At least one line item is required" });

      const unresolved = lines.filter((l: any) => !l.stockItemId);
      if (unresolved.length > 0) {
        return res.status(400).json({
          message: `${unresolved.length} item(s) still unresolved: ${unresolved.map((l: any) => l.rawName || l.itemName).join(", ")}`,
        });
      }

      // Duplicate PO number check
      const existingPO = await db
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.poNumber, poNumber), eq(purchaseOrders.companyId, companyId)))
        .limit(1);
      if (existingPO.length > 0) {
        return res.status(409).json({ message: `A purchase order with number "${poNumber}" already exists. Please use a different PO number.` });
      }

      // Get or create container
      let container = await storage.getContainerByNumber(containerNumber);
      if (!container) {
        container = await storage.createContainer({
          companyId,
          containerNumber,
          supplierId: Number(supplierId),
          status: "OTW",
          importDate: importDate || new Date().toISOString().split("T")[0],
        });
      }

      const itemsTotal      = lines.reduce((s: number, l: any) => s + parseFloat(l.qty) * parseFloat(l.rate), 0);
      const freightAmt      = parseFloat(charges?.freight       || "0") || 0;
      const surchargeAmt    = parseFloat(charges?.surcharge     || "0") || 0;
      const fumigationAmt   = parseFloat(charges?.fumigation    || "0") || 0;
      const docChargesAmt   = parseFloat(charges?.documentCharges || "0") || 0;
      const discountAmt     = parseFloat(charges?.discount      || "0") || 0;
      const otherChargesAmt = parseFloat(charges?.otherCharges  || "0") || 0;
      const grandTotal      = itemsTotal + freightAmt + surchargeAmt + fumigationAmt + docChargesAmt - discountAmt + otherChargesAmt;

      const po = await storage.createPurchaseOrder({
        companyId,
        poNumber,
        containerId:      container.id,
        supplierId:       Number(supplierId),
        currency:         currency || "USD",
        itemsTotal:       itemsTotal.toFixed(2),
        freight:          freightAmt.toFixed(2),
        surcharge:        surchargeAmt.toFixed(2),
        fumigation:       fumigationAmt.toFixed(2),
        documentCharges:  docChargesAmt.toFixed(2),
        discount:         discountAmt.toFixed(2),
        otherCharges:     otherChargesAmt.toFixed(2),
        status:           "Open",
        chargesEdited:    freightAmt > 0 || surchargeAmt > 0 || fumigationAmt > 0 || docChargesAmt > 0 || discountAmt > 0 || otherChargesAmt > 0,
      }, importDate);

      for (const line of lines) {
        const q = parseFloat(line.qty);
        const r = parseFloat(line.rate);
        await db.insert(poLineItems).values({
          poId:        po.id,
          stockItemId: Number(line.stockItemId),
          itemName:    line.itemName || line.rawName || "Unknown Item",
          quantity:    q.toFixed(3),
          rate:        r.toFixed(2),
          lineTotal:   (q * r).toFixed(2),
        });
      }

      // Fetch available proformas for the download-after-import offer
      const { supplierProformas } = await import("@shared/schema");
      const availableProformas = await db
        .select({ id: supplierProformas.id, reference: supplierProformas.reference })
        .from(supplierProformas)
        .where(and(eq(supplierProformas.companyId, companyId), eq(supplierProformas.supplierId, Number(supplierId))))
        .orderBy(desc(supplierProformas.createdAt));

      res.json({
        success:            true,
        poId:               po.id,
        poNumber:           po.poNumber,
        containerNumber,
        containerId:        container.id,
        supplierId:         Number(supplierId),
        lineCount:          lines.length,
        itemsTotal:         itemsTotal.toFixed(2),
        grandTotal:         grandTotal.toFixed(2),
        crossCompany:       !!(await storage.getParentCompanyId()),
        availableProformas,
      });
    } catch (error: any) {
      console.error("PO import confirm error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // EMPLOYEE SALARY ACCOUNT CLEANUP
  // Migrate legacy EMP-* ledger accounts to use employeeId directly
  // ============================================================

  // Get list of legacy EMP-* salary accounts
}
