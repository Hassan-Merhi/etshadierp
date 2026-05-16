import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory, syncEmployeeBalancesFromEntries } from "./_helpers";
import { saveMessage, chat, getConversationHistory, getConversationHistoryForAI, getAllChatHistory, saveFeedback, getConfiguredProviders } from "../chatService";
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

      res.json({ response: result.response, suggestions: result.suggestions, voucherDraft: result.voucherDraft ?? null, stockAdjustmentDraft: result.stockAdjustmentDraft ?? null, voucherSearchResults: result.voucherSearchResults ?? null, stockItemDraft: result.stockItemDraft ?? null, priceUpdateDraft: result.priceUpdateDraft ?? null });
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

  // ============================================================
  // EMPLOYEE SALARY ACCOUNT CLEANUP
  // Migrate legacy EMP-* ledger accounts to use employeeId directly
  // ============================================================

  // Get list of legacy EMP-* salary accounts
}
