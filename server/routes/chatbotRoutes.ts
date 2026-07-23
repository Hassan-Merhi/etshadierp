import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { db } from "../db";
import { requireAuth, requireRole, requireNonPOS } from "../auth";
import {
  saveMessage,
  chat,
  getConversationHistory,
  getConversationHistoryForAI,
  getAllChatHistory,
  clearERPContextCache,
} from "../chatService";
import {
  inventory,
  stockItems,
  purchaseOrders,
  vouchers,
  voucherEntries,
  suppliers,
  customers,
  customerBalances,
  locations,
  ledgerAccounts,
  users,
  userCompanyRoles,
  chatMessages,
  systemSettings,
  aiActionLog,
  codePatchHistory,
} from "@shared/schema";
import { eq, and, or, desc, inArray, sql, isNull, ilike } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { requireAIActionPermission, logAIAction } from "../lib/aiActionPermission";
import { resolveWorkspacePath, readProjectFileRaw } from "../lib/codeAgentTools";
import { commitAndPush } from "../lib/githubPush";
import CryptoJS from "crypto-js";
import { registerChatbotPoImportRoutes } from "./chatbotPoImportRoutes";

// ── GitHub token encryption helpers ────────────────────────────────────────
// Key is derived from SESSION_SECRET so it survives restarts without a new env var.
const _tokenKey = () => process.env.SESSION_SECRET ?? "erp-github-token-fallback-key";
function encryptToken(plain: string): string {
  return CryptoJS.AES.encrypt(plain, _tokenKey()).toString();
}
function decryptToken(cipher: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, _tokenKey());
    return bytes.toString(CryptoJS.enc.Utf8) || "";
  } catch {
    return "";
  }
}

const chatMessageRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => `${req.session?.userId ?? "anon"}_${req.session?.currentCompanyId ?? "0"}`,
  handler: (_req: any, res: any) => {
    res.status(429).json({ message: "Too many messages. Please wait a moment before sending again." });
  },
  skip: (req: any) => !req.session?.userId,
});

export function registerChatbotRoutes(app: Express) {
  app.get("/api/chatbot/status", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const companyId = req.session.currentCompanyId;
      const userRole = req.session.currentRole;

      if (!userId || !companyId) {
        return res.json({ enabled: false });
      }

      // Run both DB queries in parallel — they are independent.
      const [userRows, providerRows] = await Promise.all([
        db.select({ chatbotEnabled: users.chatbotEnabled }).from(users).where(eq(users.id, userId)),
        db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "ai_provider")).limit(1),
      ]);
      const [user] = userRows;

      // Get selected AI provider and check if its API key is configured
      const providerSetting = providerRows;
      const selectedProvider =
        providerSetting.length > 0 && providerSetting[0].value ? providerSetting[0].value.toLowerCase() : "gemini";
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

      res.set("Cache-Control", "private, max-age=120");
      res.json({
        enabled: true,
        providerName,
        selectedProvider,
        hasApiKey,
        isAdminOrOwner: userRole === "Admin" || userRole === "Owner" || userRole === "Developer",
      });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
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
        await db
          .update(systemSettings)
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
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app.post("/api/chatbot/message", requireAuth, chatMessageRateLimiter, async (req, res) => {
    try {
      const userId = req.session.userId;
      const companyId = req.session.currentCompanyId;

      if (!userId || !companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const denied = await requireAIActionPermission(req, "read");
      if (denied) return res.status(denied.code).json({ message: denied.message });

      const { message, sessionId, pageContext, sessionReadFiles } = req.body;
      if (!message || !sessionId) {
        return res.status(400).json({ message: "Message and sessionId are required" });
      }

      // Save user message
      await saveMessage(companyId, userId, "user", message, sessionId);

      // Get conversation history for AI context (excluding current message)
      const history = await getConversationHistoryForAI(sessionId, 10);

      // Get AI response (excluding current message from history context)
      const result = await chat(
        message,
        companyId,
        history.slice(0, -1),
        undefined,
        pageContext,
        sessionReadFiles ?? []
      );

      // Save assistant response
      await saveMessage(companyId, userId, "assistant", result.response, sessionId);

      await logAIAction({
        req,
        actionType: "read",
        actionName: "chat_message",
        inputJson: { message, sessionId },
        outputJson: {
          hasDraft: !!(
            result.voucherDraft ||
            result.stockTransferDraft ||
            result.stockItemDraft ||
            result.stockAdjustmentDraft
          ),
        },
        status: "success",
      });

      res.json({
        response: result.response,
        suggestions: result.suggestions,
        provider: result.provider ?? null,
        voucherDraft: result.voucherDraft ?? null,
        stockAdjustmentDraft: result.stockAdjustmentDraft ?? null,
        stockTransferDraft: result.stockTransferDraft ?? null,
        voucherSearchResults: result.voucherSearchResults ?? null,
        stockItemDraft: result.stockItemDraft ?? null,
        priceUpdateDraft: result.priceUpdateDraft ?? null,
        accountQueryResult: result.accountQueryResult ?? null,
        verifyContainerDraft: result.verifyContainerDraft ?? null,
        dataQueryResult: result.dataQueryResult ?? null,
        filePatchDrafts: result.filePatchDrafts ?? null,
        readFiles: result.readFiles ?? null,
      });
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

      // Enrich with username and role
      const userIds = Array.from(new Set(history.map((h) => h.userId)));
      const usersList =
        userIds.length > 0
          ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds))
          : [];

      const userMap = new Map(usersList.map((u) => [u.id, u.username]));

      // Fetch roles for all message authors in this company
      let developerUserIds = new Set<string>();
      if (userIds.length > 0) {
        const roleRows = await db
          .select({ userId: userCompanyRoles.userId, role: userCompanyRoles.role })
          .from(userCompanyRoles)
          .where(
            and(
              eq(userCompanyRoles.companyId, companyId),
              eq(userCompanyRoles.role, "Developer"),
              inArray(userCompanyRoles.userId, userIds.map(String))
            )
          );
        developerUserIds = new Set(roleRows.map((r) => String(r.userId)));
      }

      // Admin/Owner cannot see Developer users' chats; Developer can see everything
      const isDeveloper = userRole === "Developer";
      const filteredHistory = isDeveloper ? history : history.filter((h) => !developerUserIds.has(String(h.userId)));

      const enrichedHistory = filteredHistory.map((h) => ({
        ...h,
        username: userMap.get(h.userId) || "Unknown",
      }));

      res.json(enrichedHistory);
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── My chat sessions (any logged-in user, own history only) ──────────────
  app.get("/api/chatbot/my-sessions", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userId = req.session.userId;
      const companyId = req.session.currentCompanyId;
      if (!userId || !companyId) return res.status(400).json({ message: "Not authenticated" });

      const rows = await db
        .select({
          sessionId: chatMessages.sessionId,
          messageCount: sql<number>`count(*)::int`,
          lastMessageTime: sql<string>`max(${chatMessages.createdAt})`,
          preview: sql<string>`min(case when ${chatMessages.role} = 'user' then ${chatMessages.content} end)`,
        })
        .from(chatMessages)
        .where(and(eq(chatMessages.userId, String(userId)), eq(chatMessages.companyId, companyId)))
        .groupBy(chatMessages.sessionId)
        .orderBy(desc(sql`max(${chatMessages.createdAt})`))
        .limit(100);

      res.json(
        rows.map((r) => ({
          sessionId: r.sessionId,
          messageCount: Number(r.messageCount),
          preview: r.preview ? String(r.preview).slice(0, 100) : "Chat session",
          lastMessageTime: r.lastMessageTime,
        }))
      );
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Delete a chat session ─────────────────────────────────────────────────
  app.delete("/api/chatbot/session/:sessionId", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userId = req.session.userId;
      const companyId = req.session.currentCompanyId;
      const userRole = req.session.currentRole;
      if (!userId || !companyId) return res.status(400).json({ message: "Not authenticated" });

      const { sessionId } = req.params;

      const isDeveloper = userRole === "Developer";
      const isAdminOrOwner = userRole === "Admin" || userRole === "Owner";

      // Determine session owner
      const sessionOwnerRow = await db
        .select({ userId: chatMessages.userId })
        .from(chatMessages)
        .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.companyId, companyId)))
        .limit(1);

      if (sessionOwnerRow.length === 0) {
        return res.status(404).json({ message: "Session not found" });
      }

      const ownerUserId = sessionOwnerRow[0].userId;

      // Admin/Owner cannot delete Developer users' sessions
      if (isAdminOrOwner && !isDeveloper) {
        const ownerRoleRow = await db
          .select({ role: userCompanyRoles.role })
          .from(userCompanyRoles)
          .where(
            and(
              eq(userCompanyRoles.companyId, companyId),
              eq(userCompanyRoles.userId, String(ownerUserId)),
              eq(userCompanyRoles.role, "Developer")
            )
          )
          .limit(1);
        if (ownerRoleRow.length > 0) {
          return res.status(403).json({ message: "Cannot delete a Developer's conversation" });
        }
      }

      // Regular users can only delete their own sessions
      if (!isDeveloper && !isAdminOrOwner && ownerUserId !== String(userId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      await db
        .delete(chatMessages)
        .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.companyId, companyId)));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
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
        .select({
          id: stockItems.id,
          name: stockItems.name,
          code: stockItems.code,
          reorderLevel: stockItems.reorderLevel,
        })
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), eq(stockItems.active, true)));

      const invMap = new Map(inventoryRows.map((i) => [i.stockItemId, parseFloat(i.quantity || "0")]));
      const lowStock = stockRows
        .filter((s) => {
          const lvl = parseFloat(s.reorderLevel || "0");
          return lvl > 0 && (invMap.get(s.id) || 0) <= lvl;
        })
        .map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
          qty: invMap.get(s.id) || 0,
          reorderLevel: parseFloat(s.reorderLevel || "0"),
        }));

      // Open POs (awaiting)
      const openPOs = await db
        .select({
          id: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          supplierId: purchaseOrders.supplierId,
          status: purchaseOrders.status,
        })
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
      const custMap = new Map(customerRows.map((c) => [c.id, c.legalName]));

      const overdueCustomers = customerBalanceRows
        .map((cb) => {
          const balance = parseFloat(cb.totalDebit) - parseFloat(cb.totalCredit);
          return { customerId: cb.customerId, name: custMap.get(cb.customerId) || "Unknown", balance };
        })
        .filter((c) => c.balance > 0.01)
        .slice(0, 10);

      // Pending payrolls (DRAFT status in factory_payrolls)
      let pendingPayrolls: any[] = [];
      try {
        const { factoryPayrolls } = await import("@shared/schema");
        pendingPayrolls = await db
          .select({
            id: factoryPayrolls.id,
            periodStart: factoryPayrolls.periodStart,
            periodEnd: factoryPayrolls.periodEnd,
            status: factoryPayrolls.status,
          })
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
      res.status(500).json({ message: "Internal server error" });
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

      await db.update(users).set({ chatbotEnabled: enabled }).where(eq(users.id, userId));

      res.json({ message: `Chatbot ${enabled ? "enabled" : "disabled"} for user` });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get users with their chatbot status (Admin/Owner only)
  app.get("/api/users/chatbot-status", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userRole = req.session.currentRole;

      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
        return res.status(403).json({ message: "Access denied" });
      }

      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          chatbotEnabled: users.chatbotEnabled,
          active: users.active,
        })
        .from(users)
        .where(eq(users.active, true));

      res.json(allUsers);
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── AI Action Audit Log endpoint ────────────────────────────────────
  app.post("/api/chatbot/log-action", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const companyId = req.session.currentCompanyId;
      if (!userId || !companyId) return res.status(400).json({ message: "No company selected" });

      const { sessionId, prompt, draftJson, actionType, actionName, createdRecordId, status } = req.body;

      // Determine permission tier from client-supplied actionType
      const tier: "read" | "draft" | "write" =
        actionType === "write" ? "write" : actionType === "draft" ? "draft" : "read";

      const denied = await requireAIActionPermission(req, tier);
      if (denied) return res.status(denied.code).json({ message: denied.message });

      await db.insert(aiActionLog).values({
        companyId,
        userId,
        sessionId: sessionId || null,
        prompt: prompt || null,
        draftJson: draftJson || null,
        actionType: tier,
        actionName: actionName || null,
        createdRecordId: createdRecordId || null,
        status: status || "confirmed",
      } as any);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Confirm Stock Transfer ────────────────────────────────────────────
  app.post("/api/chatbot/confirm-stock-transfer", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      const userId = req.session.userId;
      if (!companyId || !userId) return res.status(400).json({ message: "No company selected" });

      const denied = await requireAIActionPermission(req, "write");
      if (denied) return res.status(denied.code).json({ message: denied.message });

      const { date, sourceLocationId, destinationLocationId, notes, items, sessionId, prompt, optional, analysisSummary, analysisDateRange } =
        req.body;
      // Preserve the pre-existing direct/manual chatbot transfer behavior (real transfer,
      // inventory moves immediately) unless the caller explicitly opts into an optional
      // (AI-suggested, non-posting) transfer by sending optional:true. This keeps the
      // long-standing direct "transfer N of X from A to B" flow byte-for-byte unchanged.
      const isOptional = optional === true;

      if (!sourceLocationId || !destinationLocationId)
        return res.status(400).json({ message: "Source and destination locations are required" });
      if (!items?.length) return res.status(400).json({ message: "At least one item is required" });
      if (Number(sourceLocationId) === Number(destinationLocationId))
        return res.status(400).json({ message: "Source and destination must be different" });

      // ── Revalidate before creating anything (never trust the AI-produced numbers) ──
      const [srcLocRow, destLocRow] = await Promise.all([
        db
          .select({ id: locations.id })
          .from(locations)
          .where(and(eq(locations.id, Number(sourceLocationId)), eq(locations.companyId, companyId)))
          .limit(1),
        db
          .select({ id: locations.id })
          .from(locations)
          .where(and(eq(locations.id, Number(destinationLocationId)), eq(locations.companyId, companyId)))
          .limit(1),
      ]);
      if (!srcLocRow[0]) return res.status(404).json({ message: "Source location not found" });
      if (!destLocRow[0]) return res.status(404).json({ message: "Destination location not found" });

      for (const i of items) {
        const stockItemId = Number(i.stockItemId);
        const qty = Number(i.quantity);
        if (!stockItemId || isNaN(qty) || qty <= 0) {
          return res.status(400).json({ message: `Invalid item or quantity: ${JSON.stringify(i)}` });
        }
        const [itemRow] = await db
          .select({ id: stockItems.id })
          .from(stockItems)
          .where(and(eq(stockItems.id, stockItemId), eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)))
          .limit(1);
        if (!itemRow) return res.status(404).json({ message: `Stock item ${stockItemId} not found` });

        // Insufficient-stock enforcement only applies to AI-suggested (optional) drafts —
        // the pre-existing direct/manual chatbot transfer flow (optional:false) forwards to
        // /api/stock-transfers exactly as before, which already owns its own validation and
        // allows the same explicit negative-inventory override the manual UI supports.
        if (isOptional) {
          const [invRow] = await db
            .select({ quantity: inventory.quantity })
            .from(inventory)
            .where(
              and(
                eq(inventory.stockItemId, stockItemId),
                eq(inventory.locationId, Number(sourceLocationId)),
                eq(inventory.companyId, companyId)
              )
            )
            .limit(1);
          const currentStock = parseFloat(invRow?.quantity as any) || 0;
          // AI-driven confirmation must never authorize negative inventory; that override
          // stays a manual, explicit user action on the normal stock transfer screen.
          if (qty > currentStock) {
            return res
              .status(400)
              .json({ message: `Quantity ${qty} for stock item ${stockItemId} exceeds available stock (${currentStock})` });
          }
        }
      }

      const resp = await fetch(`http://localhost:${process.env.PORT || 5000}/api/stock-transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: req.headers.cookie || "" },
        body: JSON.stringify({
          sourceLocationId: Number(sourceLocationId),
          destinationLocationId: Number(destinationLocationId),
          notes: notes || "",
          voucherDate: date || new Date().toISOString().split("T")[0],
          optional: isOptional,
          items: items.map((i: any) => ({
            stockItemId: Number(i.stockItemId),
            quantity: String(i.quantity),
            sourceLocationId: Number(sourceLocationId),
          })),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json(data);

      const createdVoucherId = data.voucher?.id ?? data.voucherId ?? null;
      const createdTransferId = data.transfer?.id ?? data.id ?? null;

      // Write audit log via centralised helper
      await logAIAction({
        req,
        actionType: "write",
        actionName: "stock_transfer",
        inputJson: {
          sourceLocationId,
          destinationLocationId,
          date,
          notes,
          itemCount: items?.length ?? 0,
          optional: isOptional,
          analysisSummary: analysisSummary || null,
          analysisDateRange: analysisDateRange || null,
        },
        outputJson: { transferId: createdTransferId, voucherId: createdVoucherId },
        status: "success",
        createdRecordId: createdTransferId || createdVoucherId || null,
      });

      clearERPContextCache(companyId);
      res.json({ success: true, transferId: createdTransferId, voucherId: createdVoucherId, optional: isOptional, voucher: data.voucher });
    } catch (error: any) {
      console.error("[Chatbot] confirm-stock-transfer error:", error.message);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Last Transaction Lookup ──────────────────────────────────────────
  app.get("/api/chatbot/last-transaction", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const type = (req.query.type as string) || "";
      const typeFilter = ["Payment", "Receipt", "Journal"].includes(type) ? type : null;

      const rows = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          description: vouchers.description,
          totalAmount: vouchers.totalAmount,
        })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            ...(typeFilter ? [eq(vouchers.voucherType, typeFilter)] : [])
          )
        )
        .orderBy(desc(vouchers.createdAt))
        .limit(1);

      if (!rows.length) return res.json({ found: false });

      const v = rows[0];
      const entries = await db
        .select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          accountName: ledgerAccounts.name,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          narration: voucherEntries.narration,
        })
        .from(voucherEntries)
        .leftJoin(ledgerAccounts, eq(voucherEntries.ledgerAccountId, ledgerAccounts.id))
        .where(eq(voucherEntries.voucherId, v.id));

      res.json({ found: true, voucher: v, entries });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Smart Search ─────────────────────────────────────────────────────
  app.get("/api/chatbot/search", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const denied = await requireAIActionPermission(req, "read");
      if (denied) return res.status(denied.code).json({ message: denied.message });

      const q = ((req.query.q as string) || "").trim();
      const modules = ((req.query.modules as string) || "").split(",").filter(Boolean);
      if (!q) return res.json({ results: [] });

      const searchModules = modules.length > 0 ? modules : ["vouchers", "customers", "suppliers", "items"];
      const results: any[] = [];

      if (searchModules.includes("vouchers")) {
        const vrows = await db
          .select({
            id: vouchers.id,
            voucherNumber: vouchers.voucherNumber,
            voucherType: vouchers.voucherType,
            voucherDate: vouchers.voucherDate,
            description: vouchers.description,
            totalAmount: vouchers.totalAmount,
          })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              or(ilike(vouchers.description, `%${q}%`), ilike(vouchers.voucherNumber, `%${q}%`))
            )
          )
          .orderBy(desc(vouchers.voucherDate))
          .limit(5);
        vrows.forEach((r) =>
          results.push({
            module: "Voucher",
            id: r.id,
            title: r.voucherNumber,
            subtitle: r.description || "",
            meta: `${r.voucherType} · ${r.voucherDate} · ${r.totalAmount}`,
            path: `/vouchers`,
          })
        );
      }
      if (searchModules.includes("customers")) {
        const crows = await db
          .select({ id: customers.id, name: customers.legalName, phone: customers.phone })
          .from(customers)
          .where(
            and(eq(customers.companyId, companyId), isNull(customers.deletedAt), ilike(customers.legalName, `%${q}%`))
          )
          .limit(5);
        crows.forEach((r) =>
          results.push({
            module: "Customer",
            id: r.id,
            title: r.name,
            subtitle: r.phone || "",
            meta: "Customer",
            path: `/customers`,
          })
        );
      }
      if (searchModules.includes("suppliers")) {
        const srows = await db
          .select({ id: suppliers.id, legalName: suppliers.legalName, code: suppliers.code })
          .from(suppliers)
          .where(and(isNull(suppliers.deletedAt), ilike(suppliers.legalName, `%${q}%`)))
          .limit(5);
        srows.forEach((r) =>
          results.push({
            module: "Supplier",
            id: r.id,
            title: r.legalName,
            subtitle: r.code || "",
            meta: "Supplier",
            path: `/suppliers`,
          })
        );
      }
      if (searchModules.includes("items")) {
        const irows = await db
          .select({ id: stockItems.id, name: stockItems.name, code: stockItems.code })
          .from(stockItems)
          .where(
            and(
              eq(stockItems.companyId, companyId),
              isNull(stockItems.deletedAt),
              or(ilike(stockItems.name, `%${q}%`), ilike(stockItems.code, `%${q}%`))
            )
          )
          .limit(5);
        irows.forEach((r) =>
          results.push({
            module: "Stock Item",
            id: r.id,
            title: r.name,
            subtitle: r.code || "",
            meta: "Item",
            path: `/stock-items`,
          })
        );
      }

      await logAIAction({
        req,
        actionType: "read",
        actionName: "smart_search",
        inputJson: { q, modules: searchModules },
        outputJson: { resultCount: results.length },
        status: "success",
      });

      res.json({ results });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  registerChatbotPoImportRoutes(app);


  // ============================================================
  // EMPLOYEE SALARY ACCOUNT CLEANUP
  // Migrate legacy EMP-* ledger accounts to use employeeId directly
  // ============================================================

  // Get list of legacy EMP-* salary accounts

  // ── Code Agent: apply file patch ───────────────────────────────────────────
  app.post("/api/chatbot/apply-patch", requireAuth, requireNonPOS, requireRole("Admin", "Owner"), async (req, res) => {
    try {
      const { filePath, originalContent, newContent } = req.body;
      if (!filePath || newContent === undefined || newContent === null) {
        return res.status(400).json({ message: "filePath and newContent are required" });
      }
      const companyId = req.session.currentCompanyId;
      const userId = req.session.userId;

      // Validate path is inside workspace
      let absPath: string;
      try {
        absPath = resolveWorkspacePath(filePath);
      } catch (e: any) {
        return res.status(400).json({ message: e.message });
      }

      // Stale guard: enforce whenever the file exists on disk.
      // - If originalContent is non-empty: compare exactly (protects against concurrent edits).
      // - If originalContent is empty but file already exists: reject — the AI must have read
      //   the file first; an empty originalContent for an existing file means the patch was
      //   generated without seeing the current content and cannot be applied safely.
      // - If file does NOT exist yet: allow creation unconditionally.
      const fileAlreadyExists = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
      if (fileAlreadyExists) {
        const currentContent = await readProjectFileRaw(filePath).catch(() => "");
        if (!originalContent || originalContent.trim() === "") {
          return res.status(409).json({
            message:
              "Cannot overwrite an existing file without a stale-check reference. Please re-ask the AI to regenerate the patch.",
            stale: true,
          });
        }
        if (currentContent !== originalContent) {
          return res.status(409).json({
            message: "The file has changed since the diff was generated. Please re-ask the AI to regenerate the patch.",
            stale: true,
          });
        }
      }

      // Ensure parent directory exists
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write the new content
      fs.writeFileSync(absPath, newContent, "utf8");

      // Log to code_patch_history
      const { description: patchDescription } = req.body;
      try {
        await db.insert(codePatchHistory).values({
          companyId: companyId ?? 0,
          filePath,
          description: patchDescription || null,
          originalContent: originalContent || "",
          newContent,
          appliedByUserId: String(userId),
        });
      } catch (_) {
        /* Non-fatal: don't fail the request if history logging fails */
      }

      await logAIAction({
        req,
        actionType: "write",
        actionName: "apply_patch",
        inputJson: { filePath, lineCount: newContent.split("\n").length },
        outputJson: { success: true },
        status: "success",
      });

      res.json({ success: true, filePath });
    } catch (error: any) {
      console.error("[Chatbot] apply-patch error:", error.message);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Code Agent: patch history (list) ─────────────────────────────────────
  app.get("/api/chatbot/patch-history", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      const userRole = req.session.currentRole;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
        return res.status(403).json({ message: "Access denied" });
      }
      const rows = await db
        .select({
          id: codePatchHistory.id,
          companyId: codePatchHistory.companyId,
          filePath: codePatchHistory.filePath,
          description: codePatchHistory.description,
          appliedByUserId: codePatchHistory.appliedByUserId,
          appliedAt: codePatchHistory.appliedAt,
          commitHash: codePatchHistory.commitHash,
          revertedAt: codePatchHistory.revertedAt,
        })
        .from(codePatchHistory)
        .where(eq(codePatchHistory.companyId, companyId))
        .orderBy(desc(codePatchHistory.appliedAt))
        .limit(100);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Code Agent: revert a patch ────────────────────────────────────────────
  app.post(
    "/api/chatbot/revert-patch/:id",
    requireAuth,
    requireNonPOS,
    requireRole("Admin", "Owner"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const patchId = parseInt(req.params.id, 10);
        if (isNaN(patchId)) return res.status(400).json({ message: "Invalid patch id" });

        const [row] = await db
          .select()
          .from(codePatchHistory)
          .where(and(eq(codePatchHistory.id, patchId), eq(codePatchHistory.companyId, companyId)));
        if (!row) return res.status(404).json({ message: "Patch not found" });
        if (row.revertedAt) return res.status(409).json({ message: "Patch has already been reverted" });

        // Write original content back to disk
        let absPath: string;
        try {
          absPath = resolveWorkspacePath(row.filePath);
        } catch (e: any) {
          return res.status(400).json({ message: e.message });
        }

        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(absPath, row.originalContent ?? "", "utf8");

        // Mark as reverted
        await db
          .update(codePatchHistory)
          .set({ revertedAt: new Date() } as any)
          .where(eq(codePatchHistory.id, patchId));

        await logAIAction({
          req,
          actionType: "write",
          actionName: "revert_patch",
          inputJson: { patchId, filePath: row.filePath },
          outputJson: { success: true },
          status: "success",
        });

        res.json({ success: true, filePath: row.filePath });
      } catch (error: any) {
        console.error("[Chatbot] revert-patch error:", error.message);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  );

  // ── Code Agent: update commit hash after successful git-push ──────────────
  // Called internally by the git-push handler to link the history record.
  async function updatePatchCommitHash(companyId: number, filePath: string, commitHash: string) {
    try {
      // Update the most recent un-pushed patch for this file
      const [latest] = await db
        .select({ id: codePatchHistory.id })
        .from(codePatchHistory)
        .where(
          and(
            eq(codePatchHistory.companyId, companyId),
            eq(codePatchHistory.filePath, filePath),
            isNull(codePatchHistory.commitHash),
            isNull(codePatchHistory.revertedAt)
          )
        )
        .orderBy(desc(codePatchHistory.appliedAt))
        .limit(1);
      if (latest) {
        await db
          .update(codePatchHistory)
          .set({ commitHash } as any)
          .where(eq(codePatchHistory.id, latest.id));
      }
    } catch (_) {
      /* Non-fatal */
    }
  }

  // ── Code Agent: commit and push to GitHub ─────────────────────────────────
  app.post("/api/chatbot/git-push", requireAuth, requireNonPOS, requireRole("Admin", "Owner"), async (req, res) => {
    try {
      const { files, message: commitMessage } = req.body;
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ message: "files array is required" });
      }
      if (!commitMessage || !String(commitMessage).trim()) {
        return res.status(400).json({ message: "Commit message is required" });
      }

      // Validate all paths
      for (const f of files) {
        try {
          resolveWorkspacePath(f);
        } catch (e: any) {
          return res.status(400).json({ message: e.message });
        }
      }

      // Load GitHub settings from DB at request time (not from potentially stale process.env)
      const [urlRow, tokenRow] = await Promise.all([
        db
          .select({ value: systemSettings.value })
          .from(systemSettings)
          .where(eq(systemSettings.key, "github_repo_url"))
          .limit(1),
        db
          .select({ value: systemSettings.value })
          .from(systemSettings)
          .where(eq(systemSettings.key, "github_token"))
          .limit(1),
      ]);

      const baseUrl = urlRow[0]?.value ?? process.env.GITHUB_REPO_URL ?? "";
      const rawToken = tokenRow[0]?.value ?? process.env.GITHUB_TOKEN ?? "";
      // Decrypt if it looks like a CryptoJS AES cipher (base64 with U2FsdGVkX1 prefix)
      const token = rawToken.startsWith("U2FsdGVkX1") ? decryptToken(rawToken) : rawToken;

      if (!baseUrl) {
        return res.status(422).json({
          success: false,
          error: "GitHub repository URL is not configured. Please set it in Chatbot Settings → GitHub Integration.",
        });
      }

      const { buildAuthenticatedUrl } = await import("../lib/githubPush");
      const authenticatedUrl = buildAuthenticatedUrl(baseUrl, token);

      const result = await commitAndPush({
        files,
        message: String(commitMessage).trim(),
        repoUrl: authenticatedUrl,
        authorName: req.session.userId ? String(req.session.userId) : "ERP Agent",
        authorEmail: "agent@erp.local",
      });

      if (!result.success) {
        return res.status(422).json({ success: false, error: result.error });
      }

      // Link commit hash to patch history records for each pushed file
      const gitPushCompanyId = req.session.currentCompanyId;
      if (result.commitHash && gitPushCompanyId) {
        for (const fp of files) {
          await updatePatchCommitHash(gitPushCompanyId, fp, result.commitHash).catch(() => {});
        }
      }

      await logAIAction({
        req,
        actionType: "write",
        actionName: "git_push",
        inputJson: { files, message: commitMessage },
        outputJson: { commitHash: result.commitHash, branch: result.branch },
        status: "success",
      });

      res.json({ success: true, commitHash: result.commitHash, branch: result.branch });
    } catch (error: any) {
      console.error("[Chatbot] git-push error:", error.message);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── GitHub settings ────────────────────────────────────────────────────────
  app.get("/api/chatbot/github-settings", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userRole = req.session.currentRole;
      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
        return res.status(403).json({ message: "Access denied" });
      }

      const [urlRow, tokenRow] = await Promise.all([
        db
          .select({ value: systemSettings.value })
          .from(systemSettings)
          .where(eq(systemSettings.key, "github_repo_url"))
          .limit(1),
        db
          .select({ value: systemSettings.value })
          .from(systemSettings)
          .where(eq(systemSettings.key, "github_token"))
          .limit(1),
      ]);

      const baseUrl = urlRow[0]?.value ?? "";
      const hasToken = !!tokenRow[0]?.value;

      // Strip any embedded token from URL before returning (never expose token)
      const safeUrl = baseUrl.replace(/https?:\/\/[^@]+@/, "https://");

      res.json({ repoUrl: safeUrl, hasToken, configured: !!baseUrl });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/chatbot/github-settings", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userRole = req.session.currentRole;
      if (userRole !== "Admin" && userRole !== "Owner" && userRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin/Developer users can configure GitHub settings" });
      }

      const { repoUrl, token } = req.body;
      if (!repoUrl && !token) {
        return res.status(400).json({ message: "repoUrl or token is required" });
      }

      // Helper to upsert a systemSettings key
      const upsertSetting = async (key: string, value: string) => {
        const existing = await db
          .select({ id: systemSettings.id })
          .from(systemSettings)
          .where(eq(systemSettings.key, key))
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(systemSettings)
            .set({ value, updatedAt: new Date() } as any)
            .where(eq(systemSettings.key, key));
        } else {
          await db.insert(systemSettings).values({ key, value } as any);
        }
      };

      if (repoUrl && typeof repoUrl === "string" && repoUrl.trim()) {
        // Strip any accidentally embedded token from URL — token is stored separately
        const cleanUrl = repoUrl.trim().replace(/https?:\/\/[^@]+@/, "https://");
        await upsertSetting("github_repo_url", cleanUrl);
      }

      if (token && typeof token === "string" && token.trim()) {
        await upsertSetting("github_token", encryptToken(token.trim()));
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
}
