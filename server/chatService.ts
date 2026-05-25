import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { db } from "./db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, lt, gt, gte, isNull, asc, ilike, or, inArray } from "drizzle-orm";

// AI Provider types
type AIProvider = "gemini" | "chatgpt" | "grok";

// Initialize AI clients lazily (only when needed)
function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getGrokClient() {
  if (!process.env.XAI_API_KEY) return null;
  return new OpenAI({ 
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1"
  });
}

// Get the selected AI provider from system settings
async function getSelectedAIProvider(): Promise<AIProvider> {
  try {
    const setting = await db
      .select({ value: schema.systemSettings.value })
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, "ai_provider"))
      .limit(1);
    
    if (setting.length > 0 && setting[0].value) {
      const provider = setting[0].value.toLowerCase() as AIProvider;
      if (["gemini", "chatgpt", "grok"].includes(provider)) {
        return provider;
      }
    }
  } catch (error) {
    console.log("[ChatService] Could not get AI provider setting, using default");
  }
  return "gemini"; // Default to Gemini
}

// Get available providers (those with API keys configured)
function getAvailableProviders(): AIProvider[] {
  const available: AIProvider[] = [];
  if (process.env.GEMINI_API_KEY) available.push("gemini");
  if (process.env.OPENAI_API_KEY) available.push("chatgpt");
  if (process.env.XAI_API_KEY) available.push("grok");
  return available;
}

// Call Gemini API
async function callGemini(systemPrompt: string, conversationHistory: { role: string; content: string }[], userMessage: string): Promise<string> {
  const client = getGeminiClient();
  if (!client) throw new Error("Gemini API key not configured");
  
  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "I understand. I'm your ERP Assistant, ready to help you understand your business data, provide insights, and answer questions in any language. How can I help you today?" }] },
    ...conversationHistory.map(msg => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }]
    })),
    { role: "user", parts: [{ text: userMessage }] }
  ];

  const response = await client.models.generateContent({
    model: "gemini-2.0-flash",
    contents: contents,
  });
  
  return response.text || "I couldn't generate a response.";
}

// Call ChatGPT API
async function callChatGPT(systemPrompt: string, conversationHistory: { role: string; content: string }[], userMessage: string): Promise<string> {
  const client = getOpenAIClient();
  if (!client) throw new Error("OpenAI API key not configured");
  
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map(msg => ({
      role: msg.role as "user" | "assistant",
      content: msg.content
    })),
    { role: "user", content: userMessage }
  ];

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: messages,
    max_tokens: 2000,
  });
  
  return response.choices[0]?.message?.content || "I couldn't generate a response.";
}

// Call Grok API (uses OpenAI-compatible format)
async function callGrok(systemPrompt: string, conversationHistory: { role: string; content: string }[], userMessage: string): Promise<string> {
  const client = getGrokClient();
  if (!client) throw new Error("xAI/Grok API key not configured");
  
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map(msg => ({
      role: msg.role as "user" | "assistant",
      content: msg.content
    })),
    { role: "user", content: userMessage }
  ];

  const response = await client.chat.completions.create({
    model: "grok-2-latest",
    messages: messages,
    max_tokens: 2000,
  });
  
  return response.choices[0]?.message?.content || "I couldn't generate a response.";
}

// Call AI with fallback to other providers
async function callAIWithFallback(
  provider: AIProvider,
  systemPrompt: string, 
  conversationHistory: { role: string; content: string }[], 
  userMessage: string
): Promise<{ response: string; usedProvider: AIProvider }> {
  const available = getAvailableProviders();
  
  // Build fallback order starting with selected provider
  const fallbackOrder = [provider, ...available.filter(p => p !== provider)];
  
  let lastError: Error | null = null;
  
  for (const currentProvider of fallbackOrder) {
    if (!available.includes(currentProvider)) continue;
    
    try {
      console.log(`[ChatService] Trying ${currentProvider}...`);
      let response: string;
      
      switch (currentProvider) {
        case "gemini":
          response = await callGemini(systemPrompt, conversationHistory, userMessage);
          break;
        case "chatgpt":
          response = await callChatGPT(systemPrompt, conversationHistory, userMessage);
          break;
        case "grok":
          response = await callGrok(systemPrompt, conversationHistory, userMessage);
          break;
        default:
          continue;
      }
      
      console.log(`[ChatService] Successfully used ${currentProvider}`);
      return { response, usedProvider: currentProvider };
    } catch (error: any) {
      console.error(`[ChatService] ${currentProvider} failed:`, error.message);
      lastError = error;
      // Continue to next provider
    }
  }
  
  throw lastError || new Error("No AI providers available");
}

// ── Intent types ──────────────────────────────────────────────────────────────
type ChatIntent =
  | "create_voucher"
  | "create_stock_adjustment"
  | "create_stock_transfer"
  | "create_stock_item"
  | "price_update"
  | "search_voucher"
  | "account_query"
  | "inventory_query"
  | "supplier_query"
  | "customer_query"
  | "sales_query"
  | "excel_import"
  | "business_summary"
  | "general";

// ── Module-level intent regexes (shared between classifyChatIntent + chat) ────
const RE_VOUCHER = /\b(create|make|record|add|post|enter|book)\b.{0,80}\b(payment|receipt|journal|voucher|entry|invoice|transaction)\b|\b(pay|paid|receive[d]?|collect[ed]?|transfer[red]?|deposit[ed]?)\b.{0,60}\$?\d|\b(journal|receipt|payment)\b.{0,40}\$?\d/i;
const RE_STOCK_ADJ = /\b(produce|producing|production|consume|consuming|consumption|stock\s+adjust|adjust\s+stock|record\s+production|record\s+consumption|produced|consumed)\b/i;
const RE_STOCK_TRANSFER = /\b(transfer|move|shift)\b.{0,80}\b(stock|item|inventory)\b|\b(stock|item|inventory)\b.{0,60}\b(transfer|move|shift)\b|\btransfer\b.{0,40}\bfrom\b.{0,40}\bto\b/i;
const RE_STOCK_ITEM_CREATE = /\b(create\s+(a\s+)?stock\s+item|add\s+(a\s+)?stock\s+item|new\s+stock\s+item|create\s+(a\s+)?new\s+item|add\s+(a\s+)?new\s+item|new\s+item)\b/i;
const RE_PRICE_UPDATE = /\b(update.*price|change.*price|set.*price|price.*to|price.*for|update.*selling|change.*selling|new price|price list)\b/i;
const RE_VOUCHER_SEARCH = /\b(when did (i|we) pay|find (the )?(payment|receipt|voucher|transaction)|search (for )?(voucher|payment|receipt)|show (me )?(the )?(voucher|payment|receipt)|paid for|receipt for|voucher for|payment (for|of)|what voucher|which voucher|show.*payment.*for|show.*receipt.*for)\b/i;
const RE_ACCOUNT_QUERY = /\b(balance of|account.*balance|how much.*account|account.*how much|what.*balance|balance.*account|when did.*account|account.*transactions|transactions.*account|paid.*from account|received.*account|when.*balance.*was|balance.*was.*when|ledger.*balance|account.*paid|account.*received)\b/i;

// ── ERP context in-memory cache (TTL = 60 s per companyId) ───────────────────
const ERP_CACHE_TTL_MS = 60_000;
interface ERPCacheEntry { context: ERPContext; expiresAt: number; }
const erpContextCache = new Map<string, ERPCacheEntry>();

export function clearERPContextCache(companyId?: number): void {
  if (companyId !== undefined) {
    const key = `erp-context:${companyId}`;
    erpContextCache.delete(key);
    console.log(`[ChatService] Cache cleared for company ${companyId}`);
  } else {
    erpContextCache.clear();
    console.log("[ChatService] Cache cleared for all companies");
  }
}

async function getCachedERPContext(companyId: number): Promise<ERPContext> {
  const key = `erp-context:${companyId}`;
  const now = Date.now();
  const cached = erpContextCache.get(key);
  if (cached && now < cached.expiresAt) {
    const ageMs = now - (cached.expiresAt - ERP_CACHE_TTL_MS);
    console.log(`[ChatService] Cache HIT for company ${companyId} (age ${Math.round(ageMs / 1000)}s)`);
    return cached.context;
  }
  console.log(`[ChatService] Cache MISS for company ${companyId} — fetching`);
  const t0 = Date.now();
  const context = await getERPContext(companyId);
  console.log(`[ChatService] Context loaded in ${Date.now() - t0}ms`);
  erpContextCache.set(key, { context, expiresAt: now + ERP_CACHE_TTL_MS });
  return context;
}

interface ERPContext {
  dataFetchedAt: string; // ISO timestamp when data was fetched
  inventory: any[];
  stockItems: any[];
  stockGroups: any[];
  ledgerAccounts: any[];
  suppliers: any[];
  customers: any[];
  locations: any[];
  recentVouchers: any[];
  salesSummary: any;
  profitAnalysis: any;
  todaysSales: any;
  thisMonthSales: any;
  lowStockAlerts: any[];
  supplierBalances: any[];
  customerBalances: any[];
  purchaseOrders: any[];
  containerSales: any[];
  financialSummary: any;
  inventoryValueByLocation: any[];
  topSellingItems: any[];
  recentTransactions: any[];
  // New smart data
  slowMovingStock: any[];
  overdueContainers: any[];
  employeeBalances: any[];
  itemsToMarkdown: any[];
  containersInTransit: any[];
  // Full searchable data
  stockItemsWithInventory: any[];
  recentSalesHistory: any[];
  // Profit/loss per item
  itemProfitabilityReport: any[];
  // Price vs cost for items currently in stock
  pricingHealthReport: any[];
  // Sales broken down by stock group
  salesByGroup: any[];
  salesByGroupToday: any[];
  salesByGroupThisMonth: any[];
}

interface UserPreferences {
  currency?: string;
  language?: string;
  dateFormat?: string;
  reportsTimeframe?: string;
}

export async function getERPContext(companyId: number): Promise<ERPContext> {
  // Capture exact timestamp when data fetch begins - this is REAL-TIME data
  const dataFetchedAt = new Date().toISOString();
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    inventory,
    stockItems,
    stockGroups,
    ledgerAccounts,
    suppliers,
    customers,
    locations,
    recentVouchers,
    purchaseOrders,
    containerSales,
  ] = await Promise.all([
    db.select({
      stockItemId: schema.inventory.stockItemId,
      locationId: schema.inventory.locationId,
      quantity: schema.inventory.quantity,
      averageRate: schema.inventory.averageRate,
      totalValue: schema.inventory.totalValue,
    })
      .from(schema.inventory)
      .where(eq(schema.inventory.companyId, companyId)),

    db.select({
      id: schema.stockItems.id,
      code: schema.stockItems.code,
      name: schema.stockItems.name,
      stockGroupId: schema.stockItems.stockGroupId,
      sellingPrice: schema.stockItems.sellingPrice,
      reorderLevel: schema.stockItems.reorderLevel,
    })
      .from(schema.stockItems)
      .where(and(
        eq(schema.stockItems.companyId, companyId),
        eq(schema.stockItems.active, true)
      )),

    db.select({
      id: schema.stockGroups.id,
      code: schema.stockGroups.code,
      name: schema.stockGroups.name,
    })
      .from(schema.stockGroups)
      .where(eq(schema.stockGroups.companyId, companyId)),

    db.select({
      id: schema.ledgerAccounts.id,
      code: schema.ledgerAccounts.code,
      name: schema.ledgerAccounts.name,
      accountType: schema.ledgerAccounts.accountType,
      openingBalance: schema.ledgerAccounts.openingBalance,
    })
      .from(schema.ledgerAccounts)
      .where(and(
        eq(schema.ledgerAccounts.companyId, companyId),
        eq(schema.ledgerAccounts.active, true)
      )),

    db.select({
      id: schema.suppliers.id,
      code: schema.suppliers.code,
      legalName: schema.suppliers.legalName,
      phone: schema.suppliers.phone,
      email: schema.suppliers.email,
    })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.active, true)),

    db.select({
      id: schema.customers.id,
      code: schema.customers.code,
      legalName: schema.customers.legalName,
      phone: schema.customers.phone,
    })
      .from(schema.customers)
      .where(and(
        eq(schema.customers.companyId, companyId),
        eq(schema.customers.active, true)
      )),

    db.select({
      id: schema.locations.id,
      code: schema.locations.code,
      name: schema.locations.name,
      city: schema.locations.city,
    })
      .from(schema.locations)
      .where(and(
        eq(schema.locations.companyId, companyId),
        eq(schema.locations.active, true)
      )),

    db.select({
      id: schema.vouchers.id,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherType: schema.vouchers.voucherType,
      voucherDate: schema.vouchers.voucherDate,
      totalAmount: schema.vouchers.totalAmount,
      description: schema.vouchers.description,
    })
      .from(schema.vouchers)
      .where(and(
        eq(schema.vouchers.companyId, companyId),
        isNull(schema.vouchers.deletedAt)
      ))
      .orderBy(desc(schema.vouchers.createdAt))
      .limit(200),

    db.select({
      id: schema.purchaseOrders.id,
      poNumber: schema.purchaseOrders.poNumber,
      supplierId: schema.purchaseOrders.supplierId,
      status: schema.purchaseOrders.status,
      itemsTotal: schema.purchaseOrders.itemsTotal,
      freight: schema.purchaseOrders.freight,
      currency: schema.purchaseOrders.currency,
      createdAt: schema.purchaseOrders.createdAt,
    })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.companyId, companyId))
      .orderBy(desc(schema.purchaseOrders.createdAt)),

    db.select({
      id: schema.containerSales.id,
      containerId: schema.containerSales.containerId,
      customerId: schema.containerSales.customerId,
      containerCost: schema.containerSales.containerCost,
      commission: schema.containerSales.commission,
      totalAmount: schema.containerSales.totalAmount,
      paymentStatus: schema.containerSales.paymentStatus,
      paidAmount: schema.containerSales.paidAmount,
      saleDate: schema.containerSales.saleDate,
    })
      .from(schema.containerSales)
      .where(eq(schema.containerSales.companyId, companyId))
      .orderBy(desc(schema.containerSales.saleDate)),
  ]);

  const salesSummary = await db
    .select({
      totalSales: sql<string>`COALESCE(SUM(CAST(${schema.vouchers.totalAmount} AS NUMERIC)), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(schema.vouchers)
    .where(and(
      eq(schema.vouchers.companyId, companyId),
      eq(schema.vouchers.voucherType, "Receipt"),
      isNull(schema.vouchers.deletedAt)
    ));

  const profitAnalysis = await db
    .select({
      totalSales: sql<string>`COALESCE(SUM(CAST(${schema.salesItems.totalSales} AS NUMERIC)), 0)`,
      totalCost: sql<string>`COALESCE(SUM(CAST(${schema.salesItems.totalCost} AS NUMERIC)), 0)`,
      totalProfit: sql<string>`COALESCE(SUM(CAST(${schema.salesItems.profit} AS NUMERIC)), 0)`,
      itemsSold: sql<number>`COUNT(*)`,
    })
    .from(schema.salesItems)
    .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
    .where(and(
      eq(schema.vouchers.companyId, companyId),
      isNull(schema.vouchers.deletedAt)
    ));

  // ── Today's sales ──────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split("T")[0];
  const monthStartStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

  const [todaysSalesRaw, thisMonthSalesRaw, itemProfitabilityRaw] = await Promise.all([
    db
      .select({
        revenue:          sql<string>`COALESCE(SUM(CAST(${schema.salesItems.totalSales} AS NUMERIC)), 0)`,
        cost:             sql<string>`COALESCE(SUM(CAST(${schema.salesItems.totalCost} AS NUMERIC)), 0)`,
        profit:           sql<string>`COALESCE(SUM(CAST(${schema.salesItems.profit} AS NUMERIC)), 0)`,
        transactionCount: sql<number>`COUNT(DISTINCT ${schema.salesItems.voucherId})`,
        unitsSold:        sql<string>`COALESCE(SUM(CAST(${schema.salesItems.quantity} AS NUMERIC)), 0)`,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .where(and(
        eq(schema.vouchers.companyId, companyId),
        eq(schema.vouchers.voucherDate, todayStr),
        isNull(schema.vouchers.deletedAt)
      )),

    db
      .select({
        revenue:          sql<string>`COALESCE(SUM(CAST(${schema.salesItems.totalSales} AS NUMERIC)), 0)`,
        cost:             sql<string>`COALESCE(SUM(CAST(${schema.salesItems.totalCost} AS NUMERIC)), 0)`,
        profit:           sql<string>`COALESCE(SUM(CAST(${schema.salesItems.profit} AS NUMERIC)), 0)`,
        transactionCount: sql<number>`COUNT(DISTINCT ${schema.salesItems.voucherId})`,
        unitsSold:        sql<string>`COALESCE(SUM(CAST(${schema.salesItems.quantity} AS NUMERIC)), 0)`,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .where(and(
        eq(schema.vouchers.companyId, companyId),
        gte(schema.vouchers.voucherDate, monthStartStr),
        isNull(schema.vouchers.deletedAt)
      )),

    // Per-item profitability: every stock item that has ever been sold
    db
      .select({
        stockItemId:         schema.salesItems.stockItemId,
        totalQty:            sql<string>`SUM(CAST(${schema.salesItems.quantity} AS NUMERIC))`,
        totalRevenue:        sql<string>`SUM(CAST(${schema.salesItems.totalSales} AS NUMERIC))`,
        totalCost:           sql<string>`SUM(CAST(${schema.salesItems.totalCost} AS NUMERIC))`,
        totalProfit:         sql<string>`SUM(CAST(${schema.salesItems.profit} AS NUMERIC))`,
        avgSellingPrice:     sql<string>`AVG(CAST(${schema.salesItems.sellingPrice} AS NUMERIC))`,
        avgConfiguredPrice:  sql<string>`AVG(CAST(COALESCE(${schema.salesItems.configuredPrice}, ${schema.salesItems.sellingPrice}) AS NUMERIC))`,
        avgCostPrice:        sql<string>`AVG(CAST(${schema.salesItems.costPrice} AS NUMERIC))`,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .where(and(
        eq(schema.vouchers.companyId, companyId),
        isNull(schema.vouchers.deletedAt)
      ))
      .groupBy(schema.salesItems.stockItemId),
  ]);

  const todaysSales = {
    date:             todayStr,
    revenue:          parseFloat(todaysSalesRaw[0]?.revenue || "0"),
    cost:             parseFloat(todaysSalesRaw[0]?.cost || "0"),
    profit:           parseFloat(todaysSalesRaw[0]?.profit || "0"),
    transactionCount: todaysSalesRaw[0]?.transactionCount || 0,
    unitsSold:        parseFloat(todaysSalesRaw[0]?.unitsSold || "0"),
    margin:           parseFloat(todaysSalesRaw[0]?.revenue || "0") > 0
                        ? ((parseFloat(todaysSalesRaw[0]?.profit || "0") / parseFloat(todaysSalesRaw[0]?.revenue || "1")) * 100).toFixed(1)
                        : "0",
  };

  const thisMonthSales = {
    monthStart:       monthStartStr,
    revenue:          parseFloat(thisMonthSalesRaw[0]?.revenue || "0"),
    cost:             parseFloat(thisMonthSalesRaw[0]?.cost || "0"),
    profit:           parseFloat(thisMonthSalesRaw[0]?.profit || "0"),
    transactionCount: thisMonthSalesRaw[0]?.transactionCount || 0,
    unitsSold:        parseFloat(thisMonthSalesRaw[0]?.unitsSold || "0"),
    margin:           parseFloat(thisMonthSalesRaw[0]?.revenue || "0") > 0
                        ? ((parseFloat(thisMonthSalesRaw[0]?.profit || "0") / parseFloat(thisMonthSalesRaw[0]?.revenue || "1")) * 100).toFixed(1)
                        : "0",
  };

  // Enrich per-item data with stock item name and classify as winner/loser
  const itemProfitabilityReport = itemProfitabilityRaw.map(row => {
    const si = stockItems.find(s => s.id === row.stockItemId);
    const qty        = parseFloat(row.totalQty || "0");
    const revenue    = parseFloat(row.totalRevenue || "0");
    const cost       = parseFloat(row.totalCost || "0");
    const profit     = parseFloat(row.totalProfit || "0");
    const avgCfg     = parseFloat(row.avgConfiguredPrice || "0");
    const avgCost    = parseFloat(row.avgCostPrice || "0");
    const margin     = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : "0";
    const profitPerUnit = qty > 0 ? (profit / qty).toFixed(2) : "0";
    return {
      itemId:            row.stockItemId,
      itemName:          si?.name || "Unknown",
      itemCode:          si?.code || "",
      totalQty:          qty.toFixed(2),
      totalRevenue:      revenue.toFixed(2),
      totalCost:         cost.toFixed(2),
      totalProfit:       profit.toFixed(2),
      profitPerUnit,
      profitMargin:      margin + "%",
      avgConfiguredPrice: avgCfg.toFixed(2),
      avgCostPrice:      avgCost.toFixed(2),
      // If configured price < cost price OR total profit < 0 → losing money
      isLosing:          profit < 0 || avgCfg < avgCost,
      lossAmount:        profit < 0 ? Math.abs(profit).toFixed(2) : "0",
    };
  }).sort((a, b) => parseFloat(a.totalProfit) - parseFloat(b.totalProfit)); // most losing first

  // ── Sales by stock group ────────────────────────────────────────────
  const [salesByGroupRaw, salesByGroupTodayRaw, salesByGroupThisMonthRaw] = await Promise.all([
    // All-time by group
    db
      .select({
        stockGroupId:  schema.stockItems.stockGroupId,
        totalQty:      sql<string>`SUM(CAST(${schema.salesItems.quantity} AS NUMERIC))`,
        totalRevenue:  sql<string>`SUM(CAST(${schema.salesItems.totalSales} AS NUMERIC))`,
        totalCost:     sql<string>`SUM(CAST(${schema.salesItems.totalCost} AS NUMERIC))`,
        totalProfit:   sql<string>`SUM(CAST(${schema.salesItems.profit} AS NUMERIC))`,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers,    eq(schema.salesItems.voucherId,    schema.vouchers.id))
      .innerJoin(schema.stockItems,  eq(schema.salesItems.stockItemId,  schema.stockItems.id))
      .where(and(eq(schema.vouchers.companyId, companyId), isNull(schema.vouchers.deletedAt)))
      .groupBy(schema.stockItems.stockGroupId),

    // Today by group
    db
      .select({
        stockGroupId:  schema.stockItems.stockGroupId,
        totalQty:      sql<string>`SUM(CAST(${schema.salesItems.quantity} AS NUMERIC))`,
        totalRevenue:  sql<string>`SUM(CAST(${schema.salesItems.totalSales} AS NUMERIC))`,
        totalCost:     sql<string>`SUM(CAST(${schema.salesItems.totalCost} AS NUMERIC))`,
        totalProfit:   sql<string>`SUM(CAST(${schema.salesItems.profit} AS NUMERIC))`,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers,    eq(schema.salesItems.voucherId,    schema.vouchers.id))
      .innerJoin(schema.stockItems,  eq(schema.salesItems.stockItemId,  schema.stockItems.id))
      .where(and(
        eq(schema.vouchers.companyId, companyId),
        eq(schema.vouchers.voucherDate, todayStr),
        isNull(schema.vouchers.deletedAt)
      ))
      .groupBy(schema.stockItems.stockGroupId),

    // This month by group
    db
      .select({
        stockGroupId:  schema.stockItems.stockGroupId,
        totalQty:      sql<string>`SUM(CAST(${schema.salesItems.quantity} AS NUMERIC))`,
        totalRevenue:  sql<string>`SUM(CAST(${schema.salesItems.totalSales} AS NUMERIC))`,
        totalCost:     sql<string>`SUM(CAST(${schema.salesItems.totalCost} AS NUMERIC))`,
        totalProfit:   sql<string>`SUM(CAST(${schema.salesItems.profit} AS NUMERIC))`,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers,    eq(schema.salesItems.voucherId,    schema.vouchers.id))
      .innerJoin(schema.stockItems,  eq(schema.salesItems.stockItemId,  schema.stockItems.id))
      .where(and(
        eq(schema.vouchers.companyId, companyId),
        gte(schema.vouchers.voucherDate, monthStartStr),
        isNull(schema.vouchers.deletedAt)
      ))
      .groupBy(schema.stockItems.stockGroupId),
  ]);

  // Helper: enrich group row with name
  function enrichGroupRow(row: any) {
    const grp = stockGroups.find((g: any) => g.id === row.stockGroupId);
    const rev  = parseFloat(row.totalRevenue || "0");
    const prof = parseFloat(row.totalProfit  || "0");
    return {
      groupId:      row.stockGroupId,
      groupName:    grp?.name || (row.stockGroupId ? "Unknown Group" : "Uncategorized"),
      groupCode:    grp?.code || "",
      totalQty:     parseFloat(row.totalQty || "0").toFixed(2),
      totalRevenue: rev.toFixed(2),
      totalCost:    parseFloat(row.totalCost || "0").toFixed(2),
      totalProfit:  prof.toFixed(2),
      profitMargin: rev > 0 ? ((prof / rev) * 100).toFixed(1) + "%" : "0%",
      isLosing:     prof < 0,
    };
  }

  const salesByGroup          = salesByGroupRaw.map(enrichGroupRow)
                                   .sort((a, b) => parseFloat(a.totalProfit) - parseFloat(b.totalProfit));
  const salesByGroupToday     = salesByGroupTodayRaw.map(enrichGroupRow)
                                   .sort((a, b) => parseFloat(b.totalRevenue) - parseFloat(a.totalRevenue));
  const salesByGroupThisMonth = salesByGroupThisMonthRaw.map(enrichGroupRow)
                                   .sort((a, b) => parseFloat(b.totalRevenue) - parseFloat(a.totalRevenue));

  // Pricing health: current stock items where selling price < average cost (selling below cost)
  const inventoryMap = new Map(inventory.map(i => [i.stockItemId, i]));
  const pricingHealthReport = stockItems
    .map(item => {
      const inv = inventoryMap.get(item.id);
      const avgCost     = parseFloat(inv?.averageRate || "0");
      const sellPrice   = parseFloat(item.sellingPrice || "0");
      const qty         = parseFloat(inv?.quantity || "0");
      const gap         = sellPrice - avgCost;
      return {
        itemId:       item.id,
        itemName:     item.name,
        itemCode:     item.code || "",
        sellingPrice: sellPrice.toFixed(2),
        avgCostPrice: avgCost.toFixed(2),
        priceGap:     gap.toFixed(2),
        stockQty:     qty.toFixed(2),
        status:       gap < 0 ? "LOSING" : gap === 0 ? "BREAK_EVEN" : "PROFITABLE",
        potentialLoss: qty > 0 && gap < 0 ? (Math.abs(gap) * qty).toFixed(2) : "0",
      };
    })
    .filter(item => parseFloat(item.avgCostPrice) > 0) // only items with known cost
    .sort((a, b) => parseFloat(a.priceGap) - parseFloat(b.priceGap)); // most losing first

  
  const lowStockAlerts: any[] = [];
  for (const item of stockItems) {
    const qty = inventoryMap.get(item.id) || 0;
    const reorderLevel = parseFloat(item.reorderLevel || '0');
    if (reorderLevel > 0 && qty <= reorderLevel) {
      lowStockAlerts.push({
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        currentQty: qty,
        reorderLevel: reorderLevel,
        status: qty === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
      });
    }
  }

  // Fetch full supplier data including opening balances
  const suppliersWithBalances = await db
    .select({
      id: schema.suppliers.id,
      code: schema.suppliers.code,
      legalName: schema.suppliers.legalName,
      openingBalance: schema.suppliers.openingBalance,
    })
    .from(schema.suppliers)
    .where(eq(schema.suppliers.active, true));

  // Get voucher entries for each supplier (matching supplier page calculation)
  const supplierBalances = await Promise.all(
    suppliersWithBalances.map(async (supplier) => {
      const entries = await db
        .select({
          debitAmount: schema.voucherEntries.debitAmount,
          creditAmount: schema.voucherEntries.creditAmount,
        })
        .from(schema.voucherEntries)
        .innerJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
        .where(and(
          eq(schema.voucherEntries.supplierId, supplier.id),
          eq(schema.vouchers.companyId, companyId),
          eq(schema.vouchers.optional, false),
          isNull(schema.vouchers.deletedAt)
        ));

      // Calculate balance same as supplier page: Opening Balance + Credits - Debits
      const openingBalance = parseFloat(supplier.openingBalance || "0");
      const balance = entries.reduce((sum, entry) => {
        const credit = parseFloat(entry.creditAmount || "0");
        const debit = parseFloat(entry.debitAmount || "0");
        return sum + (credit - debit);
      }, openingBalance);

      return {
        supplierId: supplier.id,
        supplierCode: supplier.code,
        supplierName: supplier.legalName || 'Unknown',
        openingBalance: openingBalance,
        balance: balance,
        status: balance > 0 ? 'PAYABLE' : balance < 0 ? 'OVERPAID' : 'SETTLED',
      };
    })
  );

  // Filter to only show suppliers with non-zero balances
  const filteredSupplierBalances = supplierBalances.filter(sb => Math.abs(sb.balance) > 0.01);

  let customerBalancesList: any[] = [];
  try {
    const customerBalancesRaw = await db
      .select({
        customerId: schema.customerBalances.customerId,
        totalDebit: sql<string>`COALESCE(SUM(CAST(${schema.customerBalances.debitAmount} AS NUMERIC)), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(CAST(${schema.customerBalances.creditAmount} AS NUMERIC)), 0)`,
      })
      .from(schema.customerBalances)
      .where(eq(schema.customerBalances.companyId, companyId))
      .groupBy(schema.customerBalances.customerId);

    customerBalancesList = customerBalancesRaw.map(cb => {
      const customer = customers.find(c => c.id === cb.customerId);
      const balance = parseFloat(cb.totalDebit) - parseFloat(cb.totalCredit);
      return {
        customerId: cb.customerId,
        customerName: customer?.legalName || 'Unknown',
        balance: balance,
      };
    }).filter(cb => Math.abs(cb.balance) > 0.01);
  } catch (error) {
    console.error("Error fetching customer balances:", error);
  }

  const financialSummary = {
    totalPayables: filteredSupplierBalances.filter(s => s.balance > 0).reduce((sum, s) => sum + s.balance, 0),
    totalReceivables: customerBalancesList.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0),
    openPurchaseOrders: purchaseOrders.filter(po => po.status === 'Open').length,
    pendingContainerSales: containerSales.filter(cs => cs.paymentStatus !== 'PAID').length,
  };

  const inventoryValueByLocation = await db
    .select({
      locationId: schema.inventory.locationId,
      totalValue: sql<string>`COALESCE(SUM(CAST(${schema.inventory.totalValue} AS NUMERIC)), 0)`,
      itemCount: sql<number>`COUNT(DISTINCT ${schema.inventory.stockItemId})`,
    })
    .from(schema.inventory)
    .where(eq(schema.inventory.companyId, companyId))
    .groupBy(schema.inventory.locationId);

  const inventoryByLocationWithNames = inventoryValueByLocation.map(inv => {
    const location = locations.find(l => l.id === inv.locationId);
    return {
      locationId: inv.locationId,
      locationName: location?.name || 'Unknown',
      totalValue: parseFloat(inv.totalValue),
      itemCount: inv.itemCount,
    };
  });

  const topSellingItems = await db
    .select({
      stockItemId: schema.salesItems.stockItemId,
      totalQuantity: sql<string>`SUM(CAST(${schema.salesItems.quantity} AS NUMERIC))`,
      totalRevenue: sql<string>`SUM(CAST(${schema.salesItems.totalSales} AS NUMERIC))`,
      totalProfit: sql<string>`SUM(CAST(${schema.salesItems.profit} AS NUMERIC))`,
    })
    .from(schema.salesItems)
    .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
    .where(and(
      eq(schema.vouchers.companyId, companyId),
      isNull(schema.vouchers.deletedAt)
    ))
    .groupBy(schema.salesItems.stockItemId)
    .orderBy(desc(sql`SUM(CAST(${schema.salesItems.totalSales} AS NUMERIC))`))
    .limit(10);

  const topSellingWithNames = topSellingItems.map(item => {
    const stockItem = stockItems.find(s => s.id === item.stockItemId);
    const profitMargin = parseFloat(item.totalRevenue) > 0 
      ? (parseFloat(item.totalProfit) / parseFloat(item.totalRevenue) * 100).toFixed(1)
      : '0';
    return {
      itemId: item.stockItemId,
      itemName: stockItem?.name || 'Unknown',
      itemCode: stockItem?.code || 'N/A',
      totalQuantity: parseFloat(item.totalQuantity).toFixed(2),
      totalRevenue: parseFloat(item.totalRevenue).toFixed(2),
      totalProfit: parseFloat(item.totalProfit).toFixed(2),
      profitMargin: profitMargin + '%',
    };
  });

  const recentTransactions = recentVouchers.slice(0, 20).map(v => ({
    id: v.id,
    number: v.voucherNumber,
    type: v.voucherType,
    date: v.voucherDate,
    amount: v.totalAmount,
    description: v.description,
  }));

  // Slow-moving stock: items that exist in inventory but haven't been sold in 60+ days
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  
  const recentlySoldItemIds = new Set(
    (await db
      .select({ stockItemId: schema.salesItems.stockItemId })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .where(and(
        eq(schema.vouchers.companyId, companyId),
        gt(schema.vouchers.voucherDate, sixtyDaysAgo.toISOString().split('T')[0]),
        isNull(schema.vouchers.deletedAt)
      ))
    ).map(r => r.stockItemId)
  );

  const slowMovingStock = stockItems
    .filter(item => {
      const qty = inventoryMap.get(item.id) || 0;
      return qty > 0 && !recentlySoldItemIds.has(item.id);
    })
    .map(item => {
      const qty = inventoryMap.get(item.id) || 0;
      const invRecord = inventory.find(i => i.stockItemId === item.id);
      const value = invRecord ? parseFloat(invRecord.totalValue || '0') : 0;
      return {
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        quantity: qty,
        value: value,
        daysSinceLastSale: '60+',
        recommendation: value > 500 ? 'Consider markdown/promotion' : 'Monitor',
      };
    })
    .slice(0, 20);

  // Items to markdown: slow-moving with high value
  const itemsToMarkdown = slowMovingStock
    .filter(item => item.value > 100)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Overdue containers: OTW status for more than 90 days
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const overdueContainers = purchaseOrders
    .filter(po => po.status === 'OTW')
    .filter(po => {
      const createdDate = new Date(po.createdAt);
      return createdDate < ninetyDaysAgo;
    })
    .map(po => {
      const supplier = suppliers.find(s => s.id === po.supplierId);
      const daysInTransit = Math.floor((Date.now() - new Date(po.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      return {
        poNumber: po.poNumber,
        supplierName: supplier?.legalName || 'Unknown',
        amount: parseFloat(po.itemsTotal || '0') + parseFloat(po.freight || '0'),
        daysInTransit,
        status: 'OVERDUE',
      };
    });

  // Containers in transit (all OTW)
  const containersInTransit = purchaseOrders
    .filter(po => po.status === 'OTW')
    .map(po => {
      const supplier = suppliers.find(s => s.id === po.supplierId);
      const daysInTransit = Math.floor((Date.now() - new Date(po.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      return {
        poNumber: po.poNumber,
        supplierName: supplier?.legalName || 'Unknown',
        amount: parseFloat(po.itemsTotal || '0') + parseFloat(po.freight || '0'),
        daysInTransit,
        isOverdue: daysInTransit > 90,
      };
    });

  // Employee balances
  const employees = await db
    .select({
      id: schema.employees.id,
      code: schema.employees.code,
      firstName: schema.employees.firstName,
      lastName: schema.employees.lastName,
      currentBalance: schema.employees.currentBalance,
      openingBalance: schema.employees.openingBalance,
    })
    .from(schema.employees)
    .where(and(
      eq(schema.employees.companyId, companyId),
      eq(schema.employees.active, true)
    ));

  const employeeBalancesList = employees
    .map(emp => ({
      employeeId: emp.id,
      employeeCode: emp.code,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      balance: parseFloat(emp.currentBalance || '0'),
      openingBalance: parseFloat(emp.openingBalance || '0'),
    }))
    .filter(e => Math.abs(e.balance) > 0.01);

  // Build comprehensive stock items with inventory by location (for full search)
  const stockItemsWithInventory = stockItems.map(item => {
    const stockGroup = stockGroups.find(g => g.id === item.stockGroupId);
    const itemInventory = inventory.filter(inv => inv.stockItemId === item.id);
    const inventoryByLocation = itemInventory.map(inv => {
      const location = locations.find(l => l.id === inv.locationId);
      return {
        locationName: location?.name || 'Unknown',
        locationCode: location?.code || '',
        quantity: parseFloat(inv.quantity || '0'),
        averageRate: parseFloat(inv.averageRate || '0'),
        totalValue: parseFloat(inv.totalValue || '0'),
      };
    });
    const totalQuantity = inventoryByLocation.reduce((sum, l) => sum + l.quantity, 0);
    const totalValue = inventoryByLocation.reduce((sum, l) => sum + l.totalValue, 0);
    
    return {
      code: item.code,
      name: item.name,
      groupName: stockGroup?.name || '',
      sellingPrice: parseFloat(item.sellingPrice || '0'),
      reorderLevel: parseFloat(item.reorderLevel || '0'),
      totalQuantity,
      totalValue,
      locations: inventoryByLocation.filter(l => l.quantity > 0),
    };
  });

  // Fetch ALL sales history with prices (no date limit)
  const allSalesData = await db
    .select({
      stockItemId: schema.salesItems.stockItemId,
      locationId: schema.vouchers.locationId,
      quantity: schema.salesItems.quantity,
      sellingPrice: schema.salesItems.sellingPrice,
      totalSales: schema.salesItems.totalSales,
      totalCost: schema.salesItems.totalCost,
      profit: schema.salesItems.profit,
      voucherDate: schema.vouchers.voucherDate,
      voucherNumber: schema.vouchers.voucherNumber,
    })
    .from(schema.salesItems)
    .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
    .where(and(
      eq(schema.vouchers.companyId, companyId),
      isNull(schema.vouchers.deletedAt)
    ))
    .orderBy(desc(schema.vouchers.voucherDate))
    .limit(500);

  const recentSalesHistory = allSalesData.map(sale => {
    const item = stockItems.find(i => i.id === sale.stockItemId);
    const location = locations.find(l => l.id === sale.locationId);
    return {
      itemCode: item?.code || 'Unknown',
      itemName: item?.name || 'Unknown',
      locationName: location?.name || 'Unknown',
      quantity: parseFloat(sale.quantity || '0'),
      sellingPrice: parseFloat(sale.sellingPrice || '0'),
      totalSales: parseFloat(sale.totalSales || '0'),
      profit: parseFloat(sale.profit || '0'),
      date: sale.voucherDate,
      voucherNumber: sale.voucherNumber,
    };
  });

  return {
    dataFetchedAt, // Real-time timestamp
    inventory,
    stockItems,
    stockGroups,
    ledgerAccounts,
    suppliers,
    customers,
    locations,
    recentVouchers,
    salesSummary: salesSummary[0] || { totalSales: "0", count: 0 },
    profitAnalysis: profitAnalysis[0] || { totalSales: "0", totalCost: "0", totalProfit: "0", itemsSold: 0 },
    todaysSales,
    thisMonthSales,
    lowStockAlerts,
    supplierBalances: filteredSupplierBalances,
    customerBalances: customerBalancesList,
    purchaseOrders,
    containerSales,
    financialSummary,
    inventoryValueByLocation: inventoryByLocationWithNames,
    topSellingItems: topSellingWithNames,
    recentTransactions,
    // New smart data
    slowMovingStock,
    overdueContainers,
    employeeBalances: employeeBalancesList,
    itemsToMarkdown,
    containersInTransit,
    // Full searchable data
    stockItemsWithInventory,
    recentSalesHistory,
    // Profit/loss per item
    itemProfitabilityReport,
    pricingHealthReport,
    // Sales by stock group
    salesByGroup,
    salesByGroupToday,
    salesByGroupThisMonth,
  };
}

function buildSystemPrompt(context: ERPContext, userPreferences?: UserPreferences): string {
  const currency = userPreferences?.currency || 'USD';
  const profitMargin = parseFloat(context.profitAnalysis.totalSales) > 0
    ? ((parseFloat(context.profitAnalysis.totalProfit) / parseFloat(context.profitAnalysis.totalSales)) * 100).toFixed(1)
    : '0';

  // Format the timestamp for display
  const fetchTime = new Date(context.dataFetchedAt);
  const formattedTime = fetchTime.toLocaleString('en-US', { 
    dateStyle: 'medium', 
    timeStyle: 'medium' 
  });

  return `You are an intelligent AI assistant for an ERP/POS system called "ERP Assistant". You help business owners and managers understand their data, make decisions, and get insights.

## ⚡ REAL-TIME DATA (fetched: ${formattedTime})
All data below is LIVE from the database - not cached. These numbers reflect the current state RIGHT NOW.

## YOUR CAPABILITIES:
1. **Data Analysis**: Answer questions about inventory, sales, finances, suppliers, and customers
2. **Full Text Search**: Search through ALL stock items by partial name match (e.g., "dress cream" finds all items containing those words)
3. **Sales History Lookup**: Find when items were last sold and at what price, per location
4. **Business Insights**: Provide actionable recommendations based on data patterns
5. **What-If Analysis**: Help users simulate scenarios (pricing changes, stock projections)
6. **Alerts & Monitoring**: Highlight critical issues that need attention
7. **Multi-language**: Respond in the same language as the user's question

## SEARCH INSTRUCTIONS:
- When user asks about items by partial name (e.g., "items with 'cream' in the name"), search through the COMPLETE STOCK ITEMS list below
- When user asks "what was the last price for X", look in the RECENT SALES HISTORY for that item
- When user asks about quantities at a location, check the COMPLETE STOCK ITEMS list which includes inventory by location
- Case-insensitive matching is expected - "Dress Cream" matches "DRESS CREAM" and "dress cream"

## CURRENT COMPANY DATA (REAL-TIME as of ${formattedTime}):

### 📊 EXECUTIVE SUMMARY:
- Total Inventory Items: ${context.inventory.length} items across ${context.locations.length} locations
- Total Inventory Value: $${context.inventoryValueByLocation.reduce((sum, l) => sum + l.totalValue, 0).toLocaleString()}
- Active Stock Items: ${context.stockItems.length}
- Active Suppliers: ${context.suppliers.length}
- Active Customers: ${context.customers.length}

### 📅 SALES TODAY (${context.todaysSales.date}):
- Revenue: $${context.todaysSales.revenue.toLocaleString()}
- Cost: $${context.todaysSales.cost.toLocaleString()}
- Profit: $${context.todaysSales.profit.toLocaleString()} (${context.todaysSales.margin}% margin)
- Transactions: ${context.todaysSales.transactionCount} | Units Sold: ${context.todaysSales.unitsSold}

### 📆 SALES THIS MONTH (since ${context.thisMonthSales.monthStart}):
- Revenue: $${context.thisMonthSales.revenue.toLocaleString()}
- Cost: $${context.thisMonthSales.cost.toLocaleString()}
- Profit: $${context.thisMonthSales.profit.toLocaleString()} (${context.thisMonthSales.margin}% margin)
- Transactions: ${context.thisMonthSales.transactionCount} | Units Sold: ${context.thisMonthSales.unitsSold}

### 💰 ALL-TIME FINANCIAL OVERVIEW:
- Total Sales Revenue: $${parseFloat(context.profitAnalysis.totalSales).toLocaleString()}
- Total Cost of Goods: $${parseFloat(context.profitAnalysis.totalCost).toLocaleString()}
- Gross Profit: $${parseFloat(context.profitAnalysis.totalProfit).toLocaleString()}
- Profit Margin: ${profitMargin}%
- Items Sold: ${context.profitAnalysis.itemsSold}

### 🏦 ACCOUNTS SUMMARY:
- Total Payables (to suppliers): $${context.financialSummary.totalPayables.toLocaleString()}
- Total Receivables (from customers): $${context.financialSummary.totalReceivables.toLocaleString()}
- Open Purchase Orders: ${context.financialSummary.openPurchaseOrders}
- Pending Container Sales: ${context.financialSummary.pendingContainerSales}

### ⚠️ ALERTS & WARNINGS:
${context.lowStockAlerts.length > 0 ? `
LOW STOCK ITEMS (${context.lowStockAlerts.length} items need attention):
${context.lowStockAlerts.slice(0, 10).map(a => `- ${a.itemName} (${a.itemCode}): ${a.currentQty} units left (reorder at ${a.reorderLevel}) - ${a.status}`).join('\n')}
` : 'No low stock alerts at this time.'}

${context.supplierBalances.filter(s => s.balance > 1000).length > 0 ? `
SIGNIFICANT SUPPLIER BALANCES:
${context.supplierBalances.filter(s => s.balance > 1000).slice(0, 5).map(s => `- ${s.supplierName}: $${s.balance.toLocaleString()} ${s.status}`).join('\n')}
` : ''}

${context.slowMovingStock.length > 0 ? `
🐌 SLOW-MOVING STOCK (Not sold in 60+ days):
${context.slowMovingStock.slice(0, 10).map(item => `- ${item.itemName} (${item.itemCode}): ${item.quantity} units, Value: $${item.value.toLocaleString()} - ${item.recommendation}`).join('\n')}
` : ''}

${context.itemsToMarkdown.length > 0 ? `
💸 ITEMS TO CONSIDER FOR MARKDOWN (High-value slow movers):
${context.itemsToMarkdown.map(item => `- ${item.itemName}: $${item.value.toLocaleString()} stuck value`).join('\n')}
` : ''}

${context.overdueContainers.length > 0 ? `
🚨 OVERDUE CONTAINERS (In transit 90+ days):
${context.overdueContainers.map(c => `- ${c.poNumber} from ${c.supplierName}: $${c.amount.toLocaleString()} - ${c.daysInTransit} days in transit`).join('\n')}
` : ''}

${context.containersInTransit.length > 0 ? `
🚢 CONTAINERS IN TRANSIT:
${context.containersInTransit.map(c => `- ${c.poNumber} from ${c.supplierName}: $${c.amount.toLocaleString()} (${c.daysInTransit} days)${c.isOverdue ? ' ⚠️ OVERDUE' : ''}`).join('\n')}
` : 'No containers currently in transit.'}

${context.employeeBalances.length > 0 ? `
👷 EMPLOYEE BALANCES:
${context.employeeBalances.map(e => `- ${e.employeeName} (${e.employeeCode}): $${e.balance.toLocaleString()}`).join('\n')}
Total Employee Deposits: $${context.employeeBalances.reduce((sum, e) => sum + e.balance, 0).toLocaleString()}
` : ''}

### 📈 TOP SELLING ITEMS (by revenue, all-time):
${context.topSellingItems.length > 0 ? context.topSellingItems.slice(0, 5).map((item, i) => 
  `${i+1}. ${item.itemName} - Revenue: $${parseFloat(item.totalRevenue).toLocaleString()}, Profit: $${parseFloat(item.totalProfit).toLocaleString()} (${item.profitMargin} margin)`
).join('\n') : 'No sales data available yet.'}

### 🗂️ SALES BY STOCK GROUP — TODAY (${context.todaysSales.date}):
${context.salesByGroupToday.length > 0
  ? context.salesByGroupToday.map(g =>
      `${g.groupCode}|${g.groupName}|qty:${g.totalQty}|rev:$${g.totalRevenue}|profit:$${g.totalProfit}|${g.profitMargin}${g.isLosing ? "|LOSING" : ""}`
    ).join('\n')
  : 'No sales today yet.'}

### 🗂️ SALES BY STOCK GROUP — THIS MONTH (since ${context.thisMonthSales.monthStart}):
${context.salesByGroupThisMonth.length > 0
  ? context.salesByGroupThisMonth.map(g =>
      `${g.groupCode}|${g.groupName}|qty:${g.totalQty}|rev:$${g.totalRevenue}|profit:$${g.totalProfit}|${g.profitMargin}${g.isLosing ? "|LOSING" : ""}`
    ).join('\n')
  : 'No sales this month yet.'}

### 🗂️ SALES BY STOCK GROUP — ALL TIME (sorted most losing first):
${context.salesByGroup.length > 0
  ? context.salesByGroup.map(g =>
      `${g.groupCode}|${g.groupName}|qty:${g.totalQty}|rev:$${g.totalRevenue}|profit:$${g.totalProfit}|${g.profitMargin}${g.isLosing ? "|LOSING" : ""}`
    ).join('\n')
  : 'No group sales data yet.'}

### 📊 ITEM PROFITABILITY REPORT (all items ever sold, sorted MOST LOSING first):
Format: ITEM | QTY_SOLD | REVENUE | COST | PROFIT | MARGIN | AVG_CONFIG_PRICE | AVG_COST_PRICE | STATUS
${context.itemProfitabilityReport.length > 0
  ? context.itemProfitabilityReport.map(item =>
      `${item.itemCode}|${item.itemName}|${item.totalQty}|$${item.totalRevenue}|$${item.totalCost}|$${item.totalProfit}|${item.profitMargin}|cfg:$${item.avgConfiguredPrice}|cost:$${item.avgCostPrice}|${item.isLosing ? "LOSING" : "PROFITABLE"}`
    ).join('\n')
  : 'No sales history yet.'}

SUMMARY:
- Items making profit: ${context.itemProfitabilityReport.filter(i => !i.isLosing).length}
- Items losing money: ${context.itemProfitabilityReport.filter(i => i.isLosing).length}
- Biggest loser: ${context.itemProfitabilityReport.find(i => i.isLosing)?.itemName || 'None'} (${context.itemProfitabilityReport.find(i => i.isLosing) ? '$' + context.itemProfitabilityReport.find(i => i.isLosing)!.totalProfit : 'N/A'} profit)
- Biggest winner: ${[...context.itemProfitabilityReport].reverse().find(i => !i.isLosing)?.itemName || 'None'} (${[...context.itemProfitabilityReport].reverse().find(i => !i.isLosing) ? '$' + [...context.itemProfitabilityReport].reverse().find(i => !i.isLosing)!.totalProfit : 'N/A'} profit)

### 🏷️ PRICING HEALTH — CURRENT SELLING PRICE vs AVG COST (items where cost is known):
Format: CODE | NAME | SELL_PRICE | AVG_COST | GAP | QTY_IN_STOCK | STATUS | POTENTIAL_LOSS
${context.pricingHealthReport.slice(0, 100).map(item =>
  `${item.itemCode}|${item.itemName}|$${item.sellingPrice}|$${item.avgCostPrice}|$${item.priceGap}|${item.stockQty}|${item.status}${item.status === 'LOSING' ? '|loss:$' + item.potentialLoss : ''}`
).join('\n') || 'No pricing data available.'}

PRICING SUMMARY:
- Items priced ABOVE cost (profitable): ${context.pricingHealthReport.filter(i => i.status === 'PROFITABLE').length}
- Items priced BELOW cost (selling at loss): ${context.pricingHealthReport.filter(i => i.status === 'LOSING').length}
- Items at break-even: ${context.pricingHealthReport.filter(i => i.status === 'BREAK_EVEN').length}
${context.pricingHealthReport.filter(i => i.status === 'LOSING').length > 0 ? `- Top losing items by current price gap:\n${context.pricingHealthReport.filter(i => i.status === 'LOSING').slice(0, 5).map(i => `  * ${i.itemName}: selling $${i.sellingPrice} vs cost $${i.avgCostPrice} (losing $${Math.abs(parseFloat(i.priceGap)).toFixed(2)}/unit, $${i.potentialLoss} total at current stock)`).join('\n')}` : ''}

### 📍 INVENTORY BY LOCATION:
${context.inventoryValueByLocation.map(l => 
  `- ${l.locationName}: $${l.totalValue.toLocaleString()} (${l.itemCount} items)`
).join('\n')}

### 📋 RECENT TRANSACTIONS (Last 20):
${context.recentTransactions.slice(0, 10).map(t => 
  `- ${t.type} #${t.number}: $${t.amount} on ${t.date}${t.description ? ` - ${t.description}` : ''}`
).join('\n')}

### 📦 PURCHASE ORDERS:
- Total POs: ${context.purchaseOrders.length}
- Open POs: ${context.purchaseOrders.filter(po => po.status === 'Open').length}
- Recent POs: ${context.purchaseOrders.slice(0, 5).map(po => `${po.poNumber} ($${po.itemsTotal})`).join(', ') || 'None'}

### 🏷️ STOCK ITEMS WITH INVENTORY (${context.stockItemsWithInventory.length} items total, showing up to 300 with stock):
Format: CODE | NAME | GROUP | QTY | VALUE | LOCATIONS(name:qty:rate)
${context.stockItemsWithInventory
  .filter(i => i.totalQuantity > 0)
  .slice(0, 300)
  .map(i => `${i.code}|${i.name}|${i.groupName}|${i.totalQuantity.toFixed(0)}|$${i.totalValue.toFixed(0)}|${i.locations.map((l: any) => `${l.locationName}:${l.quantity.toFixed(0)}:$${l.averageRate.toFixed(2)}`).join(',')}`)
  .join('\n')}

### 💵 RECENT SALES HISTORY (last ${context.recentSalesHistory.length} transactions, newest first):
Format: DATE | VOUCHER | CODE | NAME | LOC | QTY | PRICE | PROFIT
${context.recentSalesHistory
  .slice(0, 300)
  .map(s => `${s.date}|${s.voucherNumber}|${s.itemCode}|${s.itemName}|${s.locationName}|${s.quantity}|$${s.sellingPrice}|$${s.profit}`)
  .join('\n')}

### 👥 ALL SUPPLIERS (${context.suppliers.length}):
${context.suppliers.map(s => `${s.code}|${s.legalName}|${s.phone || ''}|${s.email || ''}`).join('\n')}

### 👤 ALL CUSTOMERS (${context.customers.length}):
${context.customers.map(c => `${c.code}|${c.legalName}|${c.phone || ''}`).join('\n')}

## RESPONSE GUIDELINES:

1. **Be Conversational**: Respond naturally, not like a database report
2. **Use Tables**: For lists of items, use markdown tables for clarity
3. **Highlight Important Numbers**: Use bold for key figures
4. **Provide Context**: Explain what numbers mean for the business
5. **Suggest Actions**: When appropriate, suggest what the user could do
6. **Be Honest**: If data is missing or you can't answer, say so clearly

## QUICK ACTION SUGGESTIONS:
When relevant, you can suggest these actions:
- "Would you like me to list all low stock items?"
- "I can show you the full supplier balance breakdown"
- "Want me to calculate projected inventory for next month?"
- "I can identify your most and least profitable items"

## WHAT-IF ANALYSIS CAPABILITIES:
You can help with scenarios like:
- "What if we increase prices by X%?" - Calculate new profit margins
- "What if we order X units?" - Estimate cost and inventory levels
- "How long will current stock last?" - Based on sales velocity

## FORMATTING:
- Use **bold** for emphasis
- Use \`code\` for item codes and numbers
- Use tables for structured data:
  | Item | Quantity | Value |
  |------|----------|-------|
  | ... | ... | ... |
- Use bullet points for lists
- Keep responses concise but informative

Remember: You're talking to business owners who need actionable insights, not raw data dumps.`;
}

function generateQuickSuggestions(context: ERPContext): string[] {
  const suggestions: string[] = [];
  
  // Priority: Show alerts first
  if (context.overdueContainers.length > 0) {
    suggestions.push(`⚠️ ${context.overdueContainers.length} containers are overdue - show me details`);
  }
  
  if (context.lowStockAlerts.length > 0) {
    suggestions.push(`Show me the ${context.lowStockAlerts.length} items that are low on stock`);
  }
  
  if (context.slowMovingStock.length > 0) {
    suggestions.push(`What items haven't sold in 60+ days?`);
  }
  
  if (context.itemsToMarkdown.length > 0) {
    suggestions.push(`Which items should I consider marking down?`);
  }
  
  if (context.supplierBalances.filter(s => s.balance > 0).length > 0) {
    suggestions.push("What are my outstanding supplier payments?");
  }
  
  if (context.employeeBalances.length > 0) {
    suggestions.push("Show me employee deposit balances");
  }
  
  if (context.containersInTransit.length > 0) {
    suggestions.push(`What containers are currently in transit?`);
  }
  
  if (context.topSellingItems.length > 0) {
    suggestions.push("What are my top selling products?");
  }
  
  suggestions.push("Give me a summary of today's business");
  suggestions.push("Which items have the highest profit margin?");
  suggestions.push("How is my inventory distributed across locations?");
  
  return suggestions.slice(0, 6);
}

// ── Intent classifier (pure keyword/regex — no AI call) ───────────────────────
function classifyChatIntent(
  userMessage: string,
  _pageContext?: { currentRoute?: string; entityType?: string; entityId?: number; entityName?: string }
): ChatIntent {
  // Action intents — checked in priority order
  if (RE_STOCK_ADJ.test(userMessage)) return "create_stock_adjustment";
  if (RE_STOCK_ITEM_CREATE.test(userMessage)) return "create_stock_item";
  // Transfer before voucher — "transfer stock" should not match voucher keywords
  if (RE_STOCK_TRANSFER.test(userMessage) && !RE_VOUCHER.test(userMessage)) return "create_stock_transfer";
  if (RE_VOUCHER_SEARCH.test(userMessage)) return "search_voucher";
  if (RE_ACCOUNT_QUERY.test(userMessage)) return "account_query";
  if (RE_PRICE_UPDATE.test(userMessage)) return "price_update";
  if (RE_VOUCHER.test(userMessage)) return "create_voucher";

  // Query intents that need broad context
  if (/\b(excel|import|export|template|download.*excel)\b/i.test(userMessage)) return "excel_import";
  if (/\b(summary|overview|dashboard|today.{0,20}business|how.{0,15}doing|performance|monthly|this month|last month)\b/i.test(userMessage)) return "business_summary";
  if (/\b(sales|revenue|sold|profit|margin|top.{0,10}sell|best.{0,10}sell)\b/i.test(userMessage)) return "sales_query";
  if (/\b(inventory|stock|item|quantity|qty|warehouse|location.{0,20}stock|in stock|how much stock)\b/i.test(userMessage)) return "inventory_query";
  if (/\b(supplier|vendor|purchase order|po\b|container.{0,20}(arriv|transit|offload))\b/i.test(userMessage)) return "supplier_query";
  if (/\b(customer|client|receivable|owed by|owes|outstanding)\b/i.test(userMessage)) return "customer_query";

  return "general";
}

// Intents that skip getERPContext — only load the minimum data needed
const ACTION_INTENTS = new Set<ChatIntent>([
  "create_voucher",
  "create_stock_adjustment",
  "create_stock_transfer",
  "create_stock_item",
  "price_update",
  "search_voucher",
  "account_query",
  "excel_import",
]);

function buildActionSystemPrompt(intent: ChatIntent, pageContext?: { currentRoute?: string }): string {
  const today = new Date().toISOString().slice(0, 10);
  let base = `You are ERP Assistant, an AI for a business ERP/POS system. Today is ${today}.`;
  if (pageContext?.currentRoute) base += ` The user is on page: ${pageContext.currentRoute}.`;
  base += `\nThe user has made a specific request. Acknowledge it briefly and naturally (1-2 sentences). `;
  switch (intent) {
    case "create_voucher":
      base += "Let them know you've prepared a voucher draft for them to review and confirm."; break;
    case "create_stock_adjustment":
      base += "Let them know you've prepared a stock adjustment draft for them to review."; break;
    case "create_stock_transfer":
      base += "Let them know you've prepared a stock transfer draft for them to review."; break;
    case "create_stock_item":
      base += "Let them know you've prepared the new stock item details for them to confirm."; break;
    case "price_update":
      base += "Let them know you've prepared a price update for them to confirm."; break;
    case "search_voucher":
      base += "Let them know you've searched the voucher records and found the results below."; break;
    case "account_query":
      base += "Let them know you've retrieved the account information below."; break;
    case "excel_import":
      base += "Help the user with their Excel import/export question concisely."; break;
    default:
      base += "Answer the user's request as helpfully and concisely as possible.";
  }
  return base;
}

export async function chat(
  userMessage: string,
  companyId: number,
  conversationHistory: { role: string; content: string }[] = [],
  userPreferences?: UserPreferences,
  pageContext?: { currentRoute?: string; entityType?: string; entityId?: number; entityName?: string }
): Promise<{ response: string; suggestions: string[]; provider?: string; voucherDraft?: any; stockAdjustmentDraft?: any; stockTransferDraft?: any; voucherSearchResults?: any[]; stockItemDraft?: any; priceUpdateDraft?: any; accountQueryResult?: any; verifyContainerDraft?: any; dataQueryResult?: any }> {
  const available = getAvailableProviders();
  
  if (available.length === 0) {
    return {
      response: "AI chatbot is not configured. Please ask an administrator to add at least one AI API key (GEMINI_API_KEY, OPENAI_API_KEY, or XAI_API_KEY).",
      suggestions: [],
    };
  }

  try {
    const chatStart = Date.now();

    // ── Step 1: Classify intent (pure regex, no AI call) ─────────────────
    const intent = classifyChatIntent(userMessage, pageContext);
    const isActionIntent = ACTION_INTENTS.has(intent);
    console.log(`[ChatService] Intent: ${intent} (action=${isActionIntent})`);

    // ── Step 2: Load ERP context only when needed ─────────────────────────
    let context: ERPContext | null = null;
    let systemPrompt: string;
    let suggestions: string[];

    if (isActionIntent) {
      // Action intents: skip the expensive full-context load, use a light prompt
      systemPrompt = buildActionSystemPrompt(intent, pageContext);
      suggestions = [];
      console.log("[ChatService] Skipping getERPContext for action intent");
    } else {
      const ctxStart = Date.now();
      context = await getCachedERPContext(companyId);
      console.log(`[ChatService] Context ready in ${Date.now() - ctxStart}ms (company ${companyId})`);
      systemPrompt = buildSystemPrompt(context, userPreferences);
      suggestions = generateQuickSuggestions(context);

      // Inject page context into full-context prompt
      if (pageContext?.currentRoute) {
        const pageLines: string[] = [`\n## CURRENT PAGE CONTEXT:`];
        pageLines.push(`- User is currently on route: ${pageContext.currentRoute}`);
        if (pageContext.entityType) pageLines.push(`- Viewing entity type: ${pageContext.entityType}`);
        if (pageContext.entityName) pageLines.push(`- Entity name: ${pageContext.entityName}`);
        if (pageContext.entityId) pageLines.push(`- Entity ID: ${pageContext.entityId}`);
        pageLines.push(`Use this context to give more relevant and specific answers (e.g. if they are on the vouchers page, answers about vouchers should be especially specific).`);
        systemPrompt = systemPrompt + pageLines.join("\n");
      }
    }

    // Get selected provider and call with fallback
    const selectedProvider = await getSelectedAIProvider();
    console.log(`[ChatService] Selected provider: ${selectedProvider}, Available: ${available.join(", ")}`);
    
    const aiStart = Date.now();
    const { response, usedProvider } = await callAIWithFallback(
      selectedProvider,
      systemPrompt,
      conversationHistory,
      userMessage
    );
    console.log(`[ChatService] AI call (${usedProvider}) took ${Date.now() - aiStart}ms`);

    // ── Phase 5b: detect voucher creation intent ──────────────────────────
    // Ask the AI to extract a voucher draft if the message contains creation intent.
    // We do a lightweight structured extraction call only when keywords are found.
    let voucherDraft: any = undefined;

    if (RE_VOUCHER.test(userMessage)) {
      try {
        const accts = await db
          .select({ id: schema.ledgerAccounts.id, name: schema.ledgerAccounts.name, accountType: schema.ledgerAccounts.accountType })
          .from(schema.ledgerAccounts)
          .where(and(eq(schema.ledgerAccounts.companyId, companyId), isNull(schema.ledgerAccounts.deletedAt)))
          .limit(120);

        const today = new Date().toISOString().slice(0, 10);
        const extractionPrompt = `You are a voucher extraction assistant for an accounting system.
User message: "${userMessage}"
Today's date: ${today}
Available ledger accounts (id:name:type): ${accts.map(a => `${a.id}:${a.name}:${a.accountType}`).join(" | ")}

RULES:
1. If the user clearly intends to CREATE a payment, receipt, or journal entry, extract the details and respond with ONLY valid JSON (no markdown, no explanation).
2. Match account names FUZZILY — if the user types a partial name (e.g. "cash", "rent", "salary"), find the best matching account from the list above. Always resolve to a real accountId from the list.
3. Use the EXACT description/narration the user provided (any phrase after "for", "re:", "being", or at the end of the message). If none, write a short descriptive one.
4. Voucher type rules and FROM/TO direction:
   - "Payment" = money going OUT. The word "FROM" tells you the SOURCE account (→ CREDIT it, money leaves). The word "TO" tells you the DESTINATION/beneficiary (→ DEBIT it, expense/payable being settled). Example: "pay FROM cash TO Shamas" → Debit Shamas, Credit Cash.
   - "Receipt" = money coming IN. "FROM" = who paid you (→ CREDIT their account, reduces their balance). "TO" = where it lands (→ DEBIT it, e.g. cash/bank). Example: "received FROM customer TO bank" → Debit Bank, Credit Customer.
   - "Journal" = any other adjustment — determine debit/credit from context.
   - NEVER swap these directions. "FROM" is always the credit side for payments, debit side for receipts.
5. Both sides MUST balance: sum of all debits must equal sum of all credits.
6. Date resolution — always output a real YYYY-MM-DD date. Today is ${today} (${new Date().toLocaleDateString("en-US", { weekday: "long" })}). Resolve ALL relative references: "Monday" → the most recent or upcoming Monday, "yesterday" → ${new Date(Date.now()-86400000).toISOString().slice(0,10)}, "last week" → approx 7 days ago, "next Friday" → the coming Friday, specific dates like "May 10" → current year. Never leave the date field as a word or relative expression.
7. CALCULATE percentages automatically. If the user says "$20,000 with 2.5% transfer charges", compute: main amount = 20000, charges = 20000 * 0.025 = 500. Create separate entries for each — e.g. one line for the 20000 payment and one line for the 500 charges — each going to the account the user specifies. The credit side (source, e.g. bank) should equal the total (20500). Do the math yourself, never ask the user to calculate.
8. If the user says "optional", "mark as optional", "put as optional", or similar, set "optional": true in the JSON. Otherwise omit it or set false.

Respond with ONLY this JSON shape:
{"type":"Payment"|"Receipt"|"Journal","date":"YYYY-MM-DD","description":"<user's own wording or short description>","optional":false,"entries":[{"accountId":NUMBER,"accountName":"EXACT name from list","debit":NUMBER,"credit":NUMBER}]}

If the intent is unclear or amounts/accounts are too ambiguous to resolve, respond with exactly: null`;

        const extractionResult = await callAIWithFallback(selectedProvider, extractionPrompt, [], "Extract voucher or return null");
        const raw = extractionResult.response.trim().replace(/```json\n?|```/g, "").trim();
        if (raw !== "null" && raw.startsWith("{")) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.type && parsed.entries && parsed.entries.length >= 2) {
            // Enrich entries with balanceBefore by fetching current account balances
            try {
              for (const entry of parsed.entries) {
                if (entry.accountId) {
                  const balResult = await db.execute(sql`
                    SELECT
                      COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) -
                      COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS net
                    FROM voucher_entries ve
                    JOIN vouchers v ON v.id = ve.voucher_id
                      AND v.deleted_at IS NULL AND v.optional = false
                      AND v.company_id = ${companyId}
                    WHERE ve.ledger_account_id = ${entry.accountId}
                  `);
                  entry.balanceBefore = parseFloat((balResult.rows[0] as any)?.net || "0");
                }
              }
            } catch (_) {}
            voucherDraft = parsed;
          }
        }
      } catch (_) {
        // Extraction failed silently — no voucherDraft
      }
    }

    // ── Stock adjustment detection ─────────────────────────────────────
    let stockAdjustmentDraft: any = undefined;

    if (RE_STOCK_ADJ.test(userMessage)) {
      try {
        const [items, locs] = await Promise.all([
          db.select({ id: schema.stockItems.id, name: schema.stockItems.name, code: schema.stockItems.code })
            .from(schema.stockItems)
            .where(and(eq(schema.stockItems.companyId, companyId), eq(schema.stockItems.active, true)))
            .limit(120),
          db.select({ id: schema.locations.id, name: schema.locations.name })
            .from(schema.locations)
            .where(eq(schema.locations.companyId, companyId))
            .limit(30),
        ]);

        const adjPrompt = `You are a stock adjustment extraction assistant.
User message: "${userMessage}"
Today: ${today}
Stock items (id:name:code): ${items.map(i => `${i.id}:${i.name}:${i.code}`).join(" | ")}
Locations (id:name): ${locs.map(l => `${l.id}:${l.name}`).join(" | ")}

RULES:
1. Extract a stock adjustment only if the user clearly intends to produce or consume items.
2. Match item names and location names FUZZILY — partial names, abbreviations, and codes all work.
3. The user may mention ANY number of items (one or many). Extract ALL of them into the items array.
4. Each entry has type "PRODUCE" (adding stock) or "CONSUME" (removing stock).
5. Do NOT worry about rate — always set rate: 0. Rates are auto-filled from inventory.
6. Use the user's description/notes if provided.
7. If the user says "optional", set optional: true.
8. Date defaults to today (${today}) if not specified.
9. For each item, pick the best match as stockItemId/stockItemName. ALSO include a "candidates" array of up to 3 plausible matches (best first). Each candidate: {"id":NUMBER,"name":"...","code":"..."}.
10. For location, return up to 3 location candidates: {"id":NUMBER,"name":"..."}.

Respond with ONLY valid JSON (no markdown):
{"date":"YYYY-MM-DD","locationId":NUMBER,"locationName":"...","locationCandidates":[{"id":NUMBER,"name":"..."}],"notes":"...","optional":false,"items":[{"type":"PRODUCE"|"CONSUME","stockItemId":NUMBER,"stockItemName":"...","quantity":NUMBER,"rate":0,"candidates":[{"id":NUMBER,"name":"...","code":"..."}]}]}

If intent is unclear, respond with exactly: null`;

        const adjResult = await callAIWithFallback(selectedProvider, adjPrompt, [], "Extract stock adjustment or return null");
        const rawAdj = adjResult.response.trim().replace(/```json\n?|```/g, "").trim();
        if (rawAdj !== "null" && rawAdj.startsWith("{")) {
          const parsedAdj = JSON.parse(rawAdj);
          if (parsedAdj && parsedAdj.locationId && parsedAdj.items && parsedAdj.items.length > 0) {
            // Auto-fill rates from inventory averageRate
            const itemIds = parsedAdj.items.map((i: any) => i.stockItemId).filter(Boolean);
            if (itemIds.length > 0) {
              const invRows = await db
                .select({ stockItemId: schema.inventory.stockItemId, averageRate: schema.inventory.averageRate })
                .from(schema.inventory)
                .where(and(
                  eq(schema.inventory.locationId, parsedAdj.locationId),
                  eq(schema.inventory.companyId, companyId),
                ));
              const rateMap = new Map(invRows.map(r => [r.stockItemId, parseFloat(r.averageRate ?? "0")]));
              parsedAdj.items = parsedAdj.items.map((item: any) => ({
                ...item,
                rate: rateMap.get(item.stockItemId) ?? 0,
              }));
            }
            // Enrich items with currentStock and projectedStock
            try {
              if (parsedAdj.locationId) {
                for (const item of parsedAdj.items) {
                  if (item.stockItemId) {
                    const invResult = await db.execute(sql`
                      SELECT COALESCE(SUM(CAST(quantity AS numeric)), 0) AS qty
                      FROM inventory
                      WHERE stock_item_id = ${item.stockItemId}
                        AND location_id = ${parsedAdj.locationId}
                        AND company_id = ${companyId}
                    `);
                    const currentStock = parseFloat((invResult.rows[0] as any)?.qty || "0");
                    item.currentStock = parseFloat(currentStock.toFixed(3));
                    const delta = item.type === "PRODUCE" ? item.quantity : -item.quantity;
                    item.projectedStock = parseFloat((currentStock + delta).toFixed(3));
                  }
                }
              }
            } catch (_) {}
            stockAdjustmentDraft = parsedAdj;
          }
        }
      } catch (_) {
        // Extraction failed silently
      }
    }

    // ── Voucher search by description ─────────────────────────────────
    let voucherSearchResults: any[] | undefined = undefined;

    if (RE_VOUCHER_SEARCH.test(userMessage)) {
      try {
        const termPrompt = `Extract the description search term the user wants to search for in their voucher records.
User message: "${userMessage}"
Return ONLY the search term as plain text (e.g. "rent", "electricity bill", "client ABC"). If no clear term, return null.`;
        const termResult = await callAIWithFallback(selectedProvider, termPrompt, [], "Extract voucher search term");
        const searchTerm = termResult.response.trim().replace(/^["']|["']$/g, "").toLowerCase();
        if (searchTerm && searchTerm !== "null" && searchTerm.length > 0) {
          const results = await db
            .select({
              id: schema.vouchers.id,
              voucherNumber: schema.vouchers.voucherNumber,
              voucherType: schema.vouchers.voucherType,
              voucherDate: schema.vouchers.voucherDate,
              description: schema.vouchers.description,
              totalAmount: schema.vouchers.totalAmount,
              optional: schema.vouchers.optional,
            })
            .from(schema.vouchers)
            .where(and(
              eq(schema.vouchers.companyId, companyId),
              isNull(schema.vouchers.deletedAt),
              or(
                ilike(schema.vouchers.description, `%${searchTerm}%`),
                ilike(schema.vouchers.voucherNumber, `%${searchTerm}%`),
              ),
            ))
            .orderBy(desc(schema.vouchers.voucherDate))
            .limit(10);
          if (results.length > 0) {
            voucherSearchResults = results;
          }
        }
      } catch (_) {
        // Search failed silently
      }
    }

    // ── New stock item creation ────────────────────────────────────────
    let stockItemDraft: any = undefined;

    if (RE_STOCK_ITEM_CREATE.test(userMessage)) {
      try {
        const groups = await db
          .select({ id: schema.stockGroups.id, name: schema.stockGroups.name })
          .from(schema.stockGroups)
          .where(and(eq(schema.stockGroups.companyId, companyId), eq(schema.stockGroups.active, true)))
          .orderBy(schema.stockGroups.name)
          .limit(60);

        const itemPrompt = `You are a stock item creation assistant.
User message: "${userMessage}"
Available stock groups (id:name): ${groups.map(g => `${g.id}:${g.name}`).join(" | ")}

Extract the following fields from the user's message:
- name: full item name
- code: item code (short identifier, usually letters/numbers)
- uom: unit of measure (e.g. KG, PCS, MTR, LTR, BOX)
- stockGroupId: best matching group id from the list above (fuzzy match)
- stockGroupName: matching group name

RULES:
1. Match stock group name FUZZILY — abbreviations and partial names are fine.
2. If no group matches, set stockGroupId: null and stockGroupName: "".
3. If code is not mentioned, generate a sensible short code from the name (uppercase, max 8 chars).
4. UOM should be normalized to common abbreviations (KG, PCS, MTR, LTR, BOX, etc.).

Respond with ONLY valid JSON (no markdown):
{"name":"...","code":"...","uom":"...","stockGroupId":NUMBER_OR_NULL,"stockGroupName":"..."}

If the user is not clearly trying to create a stock item, respond with exactly: null`;

        const itemResult = await callAIWithFallback(selectedProvider, itemPrompt, [], "Extract stock item creation details");
        const rawItem = itemResult.response.trim().replace(/```json\n?|```/g, "").trim();
        if (rawItem !== "null" && rawItem.startsWith("{")) {
          const parsedItem = JSON.parse(rawItem);
          if (parsedItem && parsedItem.name && parsedItem.code && parsedItem.uom) {
            stockItemDraft = {
              name: parsedItem.name,
              code: parsedItem.code.toUpperCase(),
              uom: parsedItem.uom.toUpperCase(),
              stockGroupId: parsedItem.stockGroupId ?? null,
              stockGroupName: parsedItem.stockGroupName ?? "",
              groupCandidates: groups.slice(0, 20).map(g => ({ id: g.id, name: g.name })),
            };
          }
        }
      } catch (_) {
        // Extraction failed silently
      }
    }

    // ── Price list update ──────────────────────────────────────────────
    let priceUpdateDraft: any = undefined;

    if (RE_PRICE_UPDATE.test(userMessage)) {
      try {
        const [items, masterRows] = await Promise.all([
          db.select({ id: schema.stockItems.id, name: schema.stockItems.name, code: schema.stockItems.code })
            .from(schema.stockItems)
            .where(and(eq(schema.stockItems.companyId, companyId), eq(schema.stockItems.active, true), isNull(schema.stockItems.deletedAt)))
            .limit(120),
          db.select({ masterLocationId: schema.locationPriceGroups.masterLocationId })
            .from(schema.locationPriceGroups)
            .where(eq(schema.locationPriceGroups.companyId, companyId)),
        ]);

        const masterIds = [...new Set(masterRows.map(r => r.masterLocationId))];
        const masterLocations = masterIds.length > 0
          ? await db.select({ id: schema.locations.id, name: schema.locations.name })
              .from(schema.locations)
              .where(and(eq(schema.locations.companyId, companyId), inArray(schema.locations.id, masterIds)))
          : await db.select({ id: schema.locations.id, name: schema.locations.name })
              .from(schema.locations)
              .where(eq(schema.locations.companyId, companyId))
              .limit(20);

        // Fetch follower counts per master for display
        const followerCounts = new Map<number, number>();
        if (masterIds.length > 0) {
          const fRows = await db.select({
            masterLocationId: schema.locationPriceGroups.masterLocationId,
            followerLocationId: schema.locationPriceGroups.followerLocationId,
          }).from(schema.locationPriceGroups).where(eq(schema.locationPriceGroups.companyId, companyId));
          for (const r of fRows) {
            followerCounts.set(r.masterLocationId, (followerCounts.get(r.masterLocationId) ?? 0) + 1);
          }
        }

        const pricePrompt = `You are a price update extraction assistant.
User message: "${userMessage}"
Stock items (id:name:code): ${items.map(i => `${i.id}:${i.name}:${i.code}`).join(" | ")}
Price group / master locations (id:name): ${masterLocations.map(l => `${l.id}:${l.name}`).join(" | ")}

Extract:
- stockItemId: best matching stock item id (fuzzy match on name or code)
- stockItemName: matching item name
- stockItemCode: matching item code
- locationId: best matching master location id (fuzzy match)
- locationName: matching location name
- newPrice: the new selling price as a number

RULES:
1. Match item name/code and location name FUZZILY.
2. newPrice must be a positive number.
3. If the user says "all locations" or doesn't specify a location, pick locationId: null and locationName: "".
4. Also include candidates arrays for disambiguation:
   - itemCandidates: up to 3 item matches [{"id":N,"name":"...","code":"..."}]
   - locationCandidates: up to 3 location matches [{"id":N,"name":"..."}]

Respond with ONLY valid JSON (no markdown):
{"stockItemId":NUMBER,"stockItemName":"...","stockItemCode":"...","locationId":NUMBER_OR_NULL,"locationName":"...","newPrice":NUMBER,"itemCandidates":[...],"locationCandidates":[...]}

If intent is not a price update, respond with exactly: null`;

        const priceResult = await callAIWithFallback(selectedProvider, pricePrompt, [], "Extract price update details");
        const rawPrice = priceResult.response.trim().replace(/```json\n?|```/g, "").trim();
        if (rawPrice !== "null" && rawPrice.startsWith("{")) {
          const parsedPrice = JSON.parse(rawPrice);
          if (parsedPrice && parsedPrice.stockItemId && parsedPrice.newPrice > 0) {
            priceUpdateDraft = {
              ...parsedPrice,
              followerCount: parsedPrice.locationId ? (followerCounts.get(parsedPrice.locationId) ?? 0) : 0,
              allLocations: masterLocations.map(l => ({ id: l.id, name: l.name })),
            };
          }
        }
      } catch (_) {
        // Extraction failed silently
      }
    }

    // ── Account queries: balance / transaction search / balance history ──
    let accountQueryResult: any = undefined;

    if (RE_ACCOUNT_QUERY.test(userMessage)) {
      try {
        const accounts = await db
          .select({ id: schema.ledgerAccounts.id, name: schema.ledgerAccounts.name, code: schema.ledgerAccounts.code, accountType: schema.ledgerAccounts.accountType, openingBalance: schema.ledgerAccounts.openingBalance, openingBalanceSide: schema.ledgerAccounts.openingBalanceSide })
          .from(schema.ledgerAccounts)
          .where(and(eq(schema.ledgerAccounts.companyId, companyId), eq(schema.ledgerAccounts.active, true), isNull(schema.ledgerAccounts.deletedAt)))
          .orderBy(schema.ledgerAccounts.name)
          .limit(150);

        const acctPrompt = `You are an accounts query extraction assistant.
User message: "${userMessage}"
Ledger accounts (id:name:code:type): ${accounts.map(a => `${a.id}:${a.name}:${a.code}:${a.accountType}`).join(" | ")}

Determine the query type and extract fields:
- queryType: "balance" | "transactions" | "balance_history"
  - "balance": user wants current balance of an account
  - "transactions": user wants to find payments/transactions by description or amount for an account
  - "balance_history": user wants to know when an account had a specific balance amount
- accountId: best matching account id (fuzzy match on name or code)
- accountName: matching account name
- searchTerm: description keyword to search (for transactions queryType, if any)
- searchAmount: specific amount to find (number, for transactions or balance_history queryType, if any)
- targetBalance: the balance amount they are asking about (for balance_history queryType)

RULES:
1. Fuzzy match account names — partial names and abbreviations work.
2. searchTerm, searchAmount, targetBalance are optional — only include if clearly in the message.
3. For "balance" queries: just accountId and accountName are needed.
4. For "transactions": accountId + at least one of searchTerm or searchAmount.
5. For "balance_history": accountId + targetBalance.

Respond with ONLY valid JSON (no markdown):
{"queryType":"balance"|"transactions"|"balance_history","accountId":NUMBER,"accountName":"...","searchTerm":"...","searchAmount":NUMBER_OR_NULL,"targetBalance":NUMBER_OR_NULL}

If intent is not about an account query, respond with exactly: null`;

        const acctResult = await callAIWithFallback(selectedProvider, acctPrompt, [], "Extract account query");
        const rawAcct = acctResult.response.trim().replace(/```json\n?|```/g, "").trim();

        if (rawAcct !== "null" && rawAcct.startsWith("{")) {
          const parsed = JSON.parse(rawAcct);
          if (parsed && parsed.accountId && parsed.queryType) {
            const acct = accounts.find(a => a.id === parsed.accountId);
            if (!acct) throw new Error("Account not found");

            if (parsed.queryType === "balance") {
              // Compute current balance from voucher entries
              const rows = await db
                .select({
                  totalDebit: sql<string>`COALESCE(SUM(CAST(${schema.voucherEntries.debitAmount} AS numeric)), 0)`,
                  totalCredit: sql<string>`COALESCE(SUM(CAST(${schema.voucherEntries.creditAmount} AS numeric)), 0)`,
                })
                .from(schema.voucherEntries)
                .innerJoin(schema.vouchers, and(eq(schema.voucherEntries.voucherId, schema.vouchers.id), eq(schema.vouchers.optional, false), isNull(schema.vouchers.deletedAt)))
                .where(eq(schema.voucherEntries.ledgerAccountId, parsed.accountId));

              const dr = parseFloat(rows[0]?.totalDebit || "0");
              const cr = parseFloat(rows[0]?.totalCredit || "0");
              const ob = parseFloat(acct.openingBalance || "0");
              const obSide = acct.openingBalanceSide || "Dr";
              const balance = (obSide === "Cr" ? -ob : ob) + dr - cr;
              accountQueryResult = { queryType: "balance", accountId: parsed.accountId, accountName: acct.name, balance: parseFloat(balance.toFixed(2)) };

            } else if (parsed.queryType === "transactions") {
              // Search transactions by description and/or amount
              const conditions: any[] = [
                eq(schema.voucherEntries.ledgerAccountId, parsed.accountId),
                eq(schema.vouchers.optional, false),
                isNull(schema.vouchers.deletedAt),
              ];
              if (parsed.searchTerm) {
                conditions.push(or(
                  ilike(schema.vouchers.description, `%${parsed.searchTerm}%`),
                  ilike(schema.voucherEntries.narration, `%${parsed.searchTerm}%`),
                  ilike(schema.vouchers.voucherNumber, `%${parsed.searchTerm}%`),
                ));
              }
              if (parsed.searchAmount) {
                const amt = String(parseFloat(parsed.searchAmount).toFixed(2));
                conditions.push(or(
                  sql`CAST(${schema.voucherEntries.debitAmount} AS numeric) = ${parseFloat(amt)}`,
                  sql`CAST(${schema.voucherEntries.creditAmount} AS numeric) = ${parseFloat(amt)}`,
                  sql`CAST(${schema.vouchers.totalAmount} AS numeric) = ${parseFloat(amt)}`,
                ));
              }
              const txRows = await db
                .select({
                  voucherId: schema.voucherEntries.voucherId,
                  voucherNumber: schema.vouchers.voucherNumber,
                  voucherType: schema.vouchers.voucherType,
                  voucherDate: schema.vouchers.voucherDate,
                  description: schema.vouchers.description,
                  narration: schema.voucherEntries.narration,
                  debitAmount: schema.voucherEntries.debitAmount,
                  creditAmount: schema.voucherEntries.creditAmount,
                  totalAmount: schema.vouchers.totalAmount,
                })
                .from(schema.voucherEntries)
                .innerJoin(schema.vouchers, and(eq(schema.voucherEntries.voucherId, schema.vouchers.id)))
                .where(and(...conditions))
                .orderBy(desc(schema.vouchers.voucherDate))
                .limit(10);

              accountQueryResult = { queryType: "transactions", accountId: parsed.accountId, accountName: acct.name, searchTerm: parsed.searchTerm, searchAmount: parsed.searchAmount, transactions: txRows };

            } else if (parsed.queryType === "balance_history") {
              // Get all transactions sorted by date, compute running balance, find when it crossed target
              const allRows = await db
                .select({
                  voucherId: schema.voucherEntries.voucherId,
                  voucherNumber: schema.vouchers.voucherNumber,
                  voucherType: schema.vouchers.voucherType,
                  voucherDate: schema.vouchers.voucherDate,
                  description: schema.vouchers.description,
                  debitAmount: schema.voucherEntries.debitAmount,
                  creditAmount: schema.voucherEntries.creditAmount,
                })
                .from(schema.voucherEntries)
                .innerJoin(schema.vouchers, and(eq(schema.voucherEntries.voucherId, schema.vouchers.id), eq(schema.vouchers.optional, false), isNull(schema.vouchers.deletedAt)))
                .where(eq(schema.voucherEntries.ledgerAccountId, parsed.accountId))
                .orderBy(asc(schema.vouchers.voucherDate));

              const ob = parseFloat(acct.openingBalance || "0");
              const obSide = acct.openingBalanceSide || "Dr";
              let running = obSide === "Cr" ? -ob : ob;
              const target = parseFloat(parsed.targetBalance);
              const tolerance = Math.max(Math.abs(target) * 0.01, 1); // 1% or ±1

              const matches: any[] = [];
              for (const row of allRows) {
                running += parseFloat(row.debitAmount || "0") - parseFloat(row.creditAmount || "0");
                if (Math.abs(running - target) <= tolerance) {
                  matches.push({ ...row, balanceAfter: parseFloat(running.toFixed(2)) });
                  if (matches.length >= 5) break;
                }
              }
              accountQueryResult = { queryType: "balance_history", accountId: parsed.accountId, accountName: acct.name, targetBalance: target, matches };
            }
          }
        }
      } catch (_) {
        // Account query failed silently
      }
    }

    // ── Stock transfer detection ───────────────────────────────────────
    let stockTransferDraft: any = undefined;

    if (RE_STOCK_TRANSFER.test(userMessage) && !voucherDraft && !stockAdjustmentDraft) {
      try {
        const [items, locs] = await Promise.all([
          db.select({ id: schema.stockItems.id, name: schema.stockItems.name, code: schema.stockItems.code })
            .from(schema.stockItems)
            .where(and(eq(schema.stockItems.companyId, companyId), eq(schema.stockItems.active, true)))
            .limit(120),
          db.select({ id: schema.locations.id, name: schema.locations.name })
            .from(schema.locations)
            .where(eq(schema.locations.companyId, companyId))
            .limit(30),
        ]);

        const today = new Date().toISOString().slice(0, 10);
        const transferPrompt = `You are a stock transfer extraction assistant.
User message: "${userMessage}"
Today: ${today}
Stock items (id:name:code): ${items.map(i => `${i.id}:${i.name}:${i.code}`).join(" | ")}
Locations (id:name): ${locs.map(l => `${l.id}:${l.name}`).join(" | ")}

RULES:
1. Extract a stock transfer only if the user clearly wants to move/transfer stock between locations.
2. Match item names and location names FUZZILY.
3. Extract one source location, one destination location, and a list of items with quantities.
4. Date defaults to today (${today}) if not specified.
5. Also include candidates arrays for disambiguation.

Respond with ONLY valid JSON (no markdown):
{"date":"YYYY-MM-DD","sourceLocationId":NUMBER,"sourceLocationName":"...","destinationLocationId":NUMBER,"destinationLocationName":"...","notes":"...","items":[{"stockItemId":NUMBER,"stockItemName":"...","quantity":NUMBER,"candidates":[{"id":NUMBER,"name":"...","code":"..."}]}],"locationCandidates":[{"id":NUMBER,"name":"..."}]}

If intent is unclear or this is not a stock transfer request, respond with exactly: null`;

        const tfResult = await callAIWithFallback(selectedProvider, transferPrompt, [], "Extract stock transfer or return null");
        const rawTf = tfResult.response.trim().replace(/```json\n?|```/g, "").trim();
        if (rawTf !== "null" && rawTf.startsWith("{")) {
          const parsedTf = JSON.parse(rawTf);
          if (parsedTf && parsedTf.sourceLocationId && parsedTf.destinationLocationId && parsedTf.items?.length > 0) {
            // Enrich with currentStock
            for (const item of parsedTf.items) {
              if (item.stockItemId && parsedTf.sourceLocationId) {
                const invResult = await db.execute(sql`
                  SELECT COALESCE(SUM(CAST(quantity AS numeric)), 0) AS qty
                  FROM inventory
                  WHERE stock_item_id = ${item.stockItemId}
                    AND location_id = ${parsedTf.sourceLocationId}
                    AND company_id = ${companyId}
                `);
                item.currentStock = parseFloat((invResult.rows[0] as any)?.qty || "0");
              }
            }
            stockTransferDraft = parsedTf;
          }
        }
      } catch (_) {
        // Extraction failed silently
      }
    }

    // ── Verify Container Excel detection ──────────────────────────────
    const VERIFY_CONTAINER_KEYWORDS = /\b(verif(y|ication)|container\s+verif|verif.*container|verification\s+excel|excel.*verif|download.*verif|container.*excel)\b/i;
    let verifyContainerDraft: any = undefined;

    if (VERIFY_CONTAINER_KEYWORDS.test(userMessage)) {
      try {
        // Try to extract a container number from the message
        const containerNumMatch =
          userMessage.match(/container\s+(?:no\.?\s*|number\s+|#\s*)?["']?([A-Z0-9][A-Z0-9\-\/]{3,25})["']?/i) ||
          userMessage.match(/\b([A-Z]{4}\d{6,7})\b/) ||
          userMessage.match(/\bfor\s+["']?([A-Z0-9][A-Z0-9\-]{4,20})["']?\s*(?:$|\s)/i);

        const containerNumber = containerNumMatch ? containerNumMatch[1].toUpperCase() : null;

        if (containerNumber) {
          const [container] = await db
            .select({ id: schema.containers.id, containerNumber: schema.containers.containerNumber, supplierId: schema.containers.supplierId })
            .from(schema.containers)
            .where(and(eq(schema.containers.companyId, companyId), ilike(schema.containers.containerNumber, containerNumber)))
            .limit(1);

          if (container) {
            const [proformas, supplierRow] = await Promise.all([
              db.select({ id: schema.supplierProformas.id, reference: schema.supplierProformas.reference })
                .from(schema.supplierProformas)
                .where(and(eq(schema.supplierProformas.companyId, companyId), eq(schema.supplierProformas.supplierId, container.supplierId)))
                .orderBy(desc(schema.supplierProformas.createdAt)),
              db.select({ name: schema.suppliers.legalName })
                .from(schema.suppliers)
                .where(eq(schema.suppliers.id, container.supplierId))
                .limit(1),
            ]);

            verifyContainerDraft = {
              containerNumber: container.containerNumber,
              containerId: container.id,
              supplierId: container.supplierId,
              supplierName: supplierRow[0]?.name || "",
              proformas,
            };
          }
        }
      } catch (_) {
        // Failed silently
      }
    }

    // ── Phase 1: Data Query Handler ───────────────────────────────────────────
    // Handles read-only ERP data queries: P&L, cash position, statements, etc.
    const PHASE1_KEYWORDS = /profit.{0,15}loss|p&l\b|pl\b.{0,10}report|balance.{0,8}sheet|cash.{0,12}(balance|position|account)|who.{0,20}owe[ds]?|overdue|outstanding.{0,15}(balance|amount|supplier)|customer.{0,15}statement|supplier.{0,15}statement|top.{0,10}(customer|buyer)s?|worker.{0,12}attend|how many.{0,20}(absent|present|worker)|bale.{0,12}(produc|today|week|this|last)|produc.{0,12}bale|how many bale|container.{0,12}status|where.{0,12}(is.{0,5})?container|pending.{0,10}offload|not.{0,10}offload|how much.{0,20}(stock|do we have|in stock)|stock.{0,10}(level|balance|position)|inventory.{0,10}(level|check|status)|low.{0,10}stock|below.{0,10}reorder|reorder.{0,10}level|stock.{0,10}movement|stock.{0,10}histor|movement.{0,10}(for|of).{0,20}\w|open.{0,10}(purchase order|po\b|p\.o\.)|pending.{0,10}(po\b|purchase)|aging|age.{0,10}(report|analysis)|receivable|payable.{0,10}(aging|due)|container.{0,10}list|all container|month.{0,10}(comparison|vs|versus|compare)|last month vs|rental.{0,10}(summary|report|occupan)|occupan|tenant|rent.{0,10}(due|overdue|collect)|payroll.{0,10}(summary|total|report)|total.{0,10}payroll|salary.{0,10}(total|summary)|sales.{0,10}(analys|by item|report|revenue)|how much.{0,15}(did we sell|sold)|top.{0,10}(sell|item|product)|best.{0,10}(sell|item)|container.{0,10}profit|profit.{0,10}per container|how much.{0,15}profit.{0,15}container|stock.{0,10}valuat|inventory.{0,10}value|total.{0,10}inventory.{0,10}(value|worth)|expense.{0,10}(break|categ|by type)|top.{0,10}expense|where.{0,20}money.{0,10}(going|spent)|customer.{0,10}order.{0,10}status|order.{0,10}(pending|draft|verified|finalized|loading)|credit.{0,10}note|recent.{0,10}credit|bank.{0,10}(transaction|movement|histor)|cash.{0,10}(transaction|movement|histor)|recent.{0,10}(payment|receipt|bank)|fixed.{0,10}asset|asset.{0,10}(list|register|summar)|kpi|factory.{0,10}(kpi|performance|daily)|daily.{0,10}(production|output)|efficiency|pos.{0,10}(sale|revenue|summary)|point.{0,10}of.{0,10}sale|shop.{0,10}sale|intercompany|inter.{0,10}company.{0,10}transfer|money.{0,10}(moved|transferred).{0,15}between|offload.{0,10}detail|what.{0,15}(was|were).{0,10}offload|what.{0,10}(arrive|came).{0,15}(in|container)|worker.{0,10}(product|rank|top|best)|top.{0,10}worker|best.{0,10}worker|supplier.{0,10}(spend|history|bought|purchase.{0,10}from)|how much.{0,15}(bought|spend).{0,10}(from|supplier)|upcoming.{0,10}(arrival|container|shipment)|container.{0,10}(arriving|due|expected)|waste.{0,10}(analys|report|trend|summary)|factory.{0,10}waste|customer.{0,10}(payment.{0,10}histor|paid|receipt)|when.{0,10}did.{0,15}pay|voucher.{0,10}(summary|count|by type|breakdown)|how many.{0,10}voucher|stock.{0,10}by.{0,10}location|per.{0,10}location.{0,10}stock|location.{0,10}stock|trial.{0,5}balance|all.{0,10}account.{0,10}balance|balance.{0,10}(of all|per account)|po.{0,10}(detail|line|item)|purchase.{0,10}order.{0,10}(detail|items|break)|what.{0,10}(is|was).{0,10}in.{0,10}(the.{0,5})?po|container.{0,10}(cost|charge|break)|cost.{0,10}break.{0,10}(of|for).{0,10}container|document.{0,10}expir|visa.{0,10}expir|permit.{0,10}expir|worker.{0,10}(doc|expir)|stock.{0,10}transfer|transfer.{0,10}(between|from.{0,10}to).{0,10}(location|warehouse)|move.{0,10}stock|cash.{0,10}flow|money.{0,10}(in|out).{0,10}(this|last|for)|inflow.{0,10}outflow|account.{0,10}(movement|ledger|balance.{0,10}for)|ledger.{0,10}(balance|statement|for)|transaction.{0,10}(of|for).{0,10}account|day.{0,10}(summary|report|sales)|today.{0,10}(sales|voucher)|sale.{0,10}today|profit.{0,10}(by|per).{0,10}location|location.{0,10}profit|which.{0,10}location.{0,10}(most|best)|debit.{0,10}note|supplier.{0,10}debit|customer.{0,10}list|list.{0,10}(of.{0,5})?customer|all.{0,10}customer|supplier.{0,10}list|list.{0,10}(of.{0,5})?supplier|all.{0,10}supplier|stock.{0,10}item.{0,10}(detail|info|profile)|item.{0,10}(detail|info|profile).{0,10}(for|of)|what.{0,10}(is|are).{0,5}(the.{0,5})?details.{0,10}(of|for).{0,10}item|mix.{0,10}batch|batch.{0,10}(list|status|summary)|material.{0,10}batch|customer.{0,10}proforma|price.{0,10}list.{0,10}(for.{0,5})?customer|proforma.{0,10}(for|customer)|supplier.{0,10}proforma|price.{0,10}(list|sheet).{0,10}(from|supplier)|weekly.{0,10}(sale|revenue|breakdown)|sale.{0,10}(by week|per week|week.{0,5}by.{0,5}week)|container.{0,10}(items|content|loaded|what.{0,10}inside)|what.{0,10}(is|are|was).{0,10}(in|inside|loaded).{0,5}container|employee.{0,10}(list|roster|staff)|all.{0,10}(employee|staff)|staff.{0,10}list|journal.{0,10}(entry|entries|voucher)|recent.{0,10}journal|journal.{0,10}posting|audit.{0,10}(log|trail|history)|who.{0,10}(created|deleted|changed|modified|updated)|recent.{0,10}change|bank.{0,10}account.{0,10}(list|balance|all)|all.{0,10}bank|list.{0,10}(of.{0,5})?bank|stock.{0,10}adjust|production.{0,10}(stock|entry|voucher)|consumption.{0,10}(stock|entry)|tracking.{0,10}(event|update|histor)|container.{0,10}tracking|where.{0,10}(is|was).{0,15}container|shipment.{0,10}update|pending.{0,10}(container.{0,10}sale|payment.{0,10}container)|unpaid.{0,10}container|outstanding.{0,10}container|container.{0,10}(unpaid|pending.{0,10}payment)|supplier.{0,10}container|containers.{0,10}(from|by).{0,10}supplier|how many.{0,10}container.{0,10}(from|supplier)|income.{0,10}(break|categ|by type)|revenue.{0,10}(break|by account)|top.{0,10}income.{0,10}account|worker.{0,10}(profile|detail|info)|info.{0,10}(about|for|on).{0,15}worker|who.{0,10}is.{0,10}worker|location.{0,10}(list|all)|all.{0,10}(location|warehouse)|list.{0,10}(of.{0,5})?location|quarterly|quarter.{0,10}(comparison|breakdown|vs)|q[1-4].{0,10}(vs|comparison|revenue)/i;
    let dataQueryResult: any = undefined;

    if (PHASE1_KEYWORDS.test(userMessage) && !voucherDraft && !stockAdjustmentDraft) {
      try {
        const todayDate = new Date();
        const todayStr = todayDate.toISOString().slice(0, 10);
        const yesterdayStr = new Date(todayDate.getTime() - 86400000).toISOString().slice(0, 10);
        const thisMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).toISOString().slice(0, 10);
        const lastMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1).toISOString().slice(0, 10);
        const lastMonthEnd = new Date(todayDate.getFullYear(), todayDate.getMonth(), 0).toISOString().slice(0, 10);
        const last30Days = new Date(todayDate.getTime() - 30 * 86400000).toISOString().slice(0, 10);
        const dayOfWeek = todayDate.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const thisWeekStart = new Date(todayDate.getTime() + mondayOffset * 86400000).toISOString().slice(0, 10);
        const lastWeekStart = new Date(todayDate.getTime() + (mondayOffset - 7) * 86400000).toISOString().slice(0, 10);
        const lastWeekEnd = new Date(todayDate.getTime() + (mondayOffset - 1) * 86400000).toISOString().slice(0, 10);

        const phase1Prompt = `ERP data query classifier. Classify the user's intent and extract parameters. Output ONLY valid JSON, no markdown.
User message: "${userMessage}"
Today: ${todayStr} | Yesterday: ${yesterdayStr}
This week: ${thisWeekStart} to ${todayStr} | Last week: ${lastWeekStart} to ${lastWeekEnd}
This month: ${thisMonthStart} to ${todayStr} | Last month: ${lastMonthStart} to ${lastMonthEnd}
Last 30 days: ${last30Days} to ${todayStr}

Query types:
pl_summary = P&L / profit & loss / income statement for a period
cash_position = current cash and bank account balances
overdue_payments = customers/accounts that owe money (outstanding receivables)
customer_statement = recent transactions for a specific named customer
supplier_statement = recent transactions for a specific named supplier
top_customers = top customers by revenue/receipts for a period
outstanding_suppliers = suppliers with the largest balances owed to them
worker_attendance = worker attendance summary (present/absent) for a date range
bale_production = factory bale production stats for a date range
container_status = status of a specific container by its number
containers_pending_offload = containers that have arrived but not been offloaded yet
inventory_check = stock quantity/levels for a specific item name (or all items if none named)
low_stock_items = items whose current stock is below their reorder level
stock_movement = recent stock adjustments or transfers for a named item
open_purchase_orders = open/pending purchase orders, optionally filtered by supplier name
customer_aging = receivables aging analysis (buckets: 0-30, 31-60, 61-90, 90+ days)
supplier_aging = payables aging analysis (buckets: 0-30, 31-60, 61-90, 90+ days)
container_list = list containers filtered by status (e.g. "In Transit", "Arrived", "Offloaded") or date range
monthly_comparison = compare this month vs last month for revenue / expenses / net profit
rental_summary = rental occupancy, rent due and overdue amounts across all units
payroll_summary = factory payroll totals for a date range
sales_analysis = sales revenue and profit by stock item for a period
top_selling_items = top items ranked by sales quantity or revenue
container_profitability = profit analysis per container (cost vs sale price)
stock_valuation = total inventory value grouped by stock group/category
expense_breakdown = top expense accounts ranked by total spend for a period
customer_order_status = customer orders filtered by status (DRAFT/LOADING/VERIFIED/FINALIZED/CANCELLED)
credit_notes_summary = recent credit notes issued (returns/reversals)
bank_transactions = recent transactions on a specific bank or cash account
fixed_assets_summary = list of fixed assets with purchase amounts and categories
factory_kpi = factory daily KPI snapshots (kg input, kg pressed, bales produced, waste)
pos_sales_summary = POS register sales totals by product or overall for a period
intercompany_transfers = inter-company money transfer history between entities
container_offload_details = detailed breakdown of stock items offloaded from a specific container
worker_productivity = factory worker productivity ranking by bales produced or kg pressed
supplier_spend = total purchase spend per supplier ranked by amount
upcoming_arrivals = containers currently in transit with ETA in the next N days
factory_waste_analysis = factory waste entries analysis by type/date range
customer_payment_history = recent receipts and payments received from customers (named or all)
voucher_type_summary = count and total amounts grouped by voucher type for a period
location_stock_summary = inventory stock totals (items, qty, value) grouped per warehouse location
trial_balance = all ledger accounts with net debit/credit balances for a period
purchase_order_detail = line items and charges for a specific PO number (requires containerNumber or entityName as PO number)
container_cost_breakdown = full cost breakdown (items, freight, surcharge, charges) for a named container
worker_document_expiry = factory workers whose visa, work permit, or residential permit expires within 60 days
stock_transfers = recent stock transfer vouchers showing items moved between locations
cash_flow_summary = total cash/bank inflows vs outflows for a period
ledger_account_balance = all debit/credit transactions for a specific named ledger account
daily_report = all vouchers (every type) posted on a specific date — use dateFrom as the target date
profit_by_location = sales profit grouped by warehouse/location for a period
debit_note_summary = recent debit notes issued (supplier charge-backs or purchase corrections)
customer_list = all customers with their current outstanding balance and contact info
supplier_list = all suppliers with total PO amounts and contact info
stock_item_detail = detailed profile of a named stock item including qty per location
factory_mix_batches = list of factory material mix batches with status and usage
customer_proformas = customer price lists/proformas with item prices and quantities
supplier_proformas = supplier proformas/price sheets with item barcodes and prices
weekly_sales = sales revenue and profit broken down by calendar week for a period
container_items_list = stock items loaded in a specific container (from PO line items)
employee_list = ERP employee roster with salary, balance and department info
journal_entries = recent journal vouchers posted with their account debit/credit entries
audit_trail = recent audit log showing who created, updated, or deleted records
bank_account_list = all registered bank and cash accounts with current balances
stock_adjustments = recent production or consumption stock adjustment vouchers
container_tracking = tracking events and location history for a specific container
pending_container_sales = container sales that are unpaid or partially paid
supplier_container_history = all containers received from a specific named supplier
income_breakdown = top income/revenue accounts ranked by net amount earned
factory_worker_profile = full profile details for a specific named factory worker
location_list = all registered warehouse/location details with stock item counts
quarterly_comparison = revenue, cost, and profit broken down by quarter for the year

Output this JSON shape:
{"queryType":"<one of the above>","entityName":<string or null>,"containerNumber":<string or null>,"locationName":<string or null>,"containerStatus":<string or null>,"dateFrom":<YYYY-MM-DD or null>,"dateTo":"${todayStr}","limit":10}

Field notes:
- entityName: customer/supplier/item/worker name mentioned in the query
- locationName: warehouse or location name mentioned
- containerStatus: one of "In Transit" | "Arrived" | "Offloaded" | null
Date rules: use provided ranges above. Default to last 30 days for financial, today for attendance/production if no date given.
If the intent does not match any type, output: null`;

        const phase1Res = await callAIWithFallback(selectedProvider, phase1Prompt, [], "Classify Phase1 query");
        const rawP1 = phase1Res.response.trim().replace(/```json\n?|```/g, "").trim();

        if (rawP1 !== "null" && rawP1.startsWith("{")) {
          const params = JSON.parse(rawP1);
          if (params && params.queryType) {
            const dateFrom: string = params.dateFrom || last30Days;
            const dateTo: string = params.dateTo || todayStr;
            const rowLimit: number = Math.min(params.limit || 10, 50);
            const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
            const fmtDec = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

            switch (params.queryType) {

              case "pl_summary": {
                const rows = await db.execute(sql`
                  SELECT la.account_type,
                    COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) AS total_debit,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_credit
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id AND v.optional = false AND v.deleted_at IS NULL
                  JOIN ledger_accounts la ON la.id = ve.ledger_account_id AND la.company_id = ${companyId}
                  WHERE v.voucher_date BETWEEN ${dateFrom} AND ${dateTo}
                    AND la.account_type IN ('Income','Expense','Direct Expense','Indirect Expense','Profit')
                  GROUP BY la.account_type
                `);
                let revenue = 0, cogs = 0, opex = 0;
                for (const row of rows.rows as any[]) {
                  const dr = parseFloat(row.total_debit || "0");
                  const cr = parseFloat(row.total_credit || "0");
                  if (row.account_type === "Income") revenue += cr - dr;
                  else if (row.account_type === "Direct Expense") cogs += dr - cr;
                  else opex += dr - cr;
                }
                const gross = revenue - cogs;
                const net = gross - opex;
                dataQueryResult = {
                  queryType: "pl_summary",
                  title: "Profit & Loss Summary",
                  subtitle: `${dateFrom} to ${dateTo}`,
                  stats: [
                    { label: "Revenue", value: fmt(revenue), highlight: revenue >= 0 ? "positive" : "negative" },
                    { label: "Cost of Goods Sold", value: fmt(cogs), highlight: "muted" },
                    { label: "Gross Profit", value: fmt(gross), highlight: gross >= 0 ? "positive" : "negative" },
                    { label: "Operating Expenses", value: fmt(opex), highlight: "muted" },
                    { label: "Net Profit / (Loss)", value: fmt(net), highlight: net >= 0 ? "positive" : "negative" },
                  ],
                };
                break;
              }

              case "cash_position": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.account_type, la.opening_balance, la.opening_balance_side,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.account_type IN ('Cash','Bank') AND la.active = true AND la.deleted_at IS NULL
                  GROUP BY la.id, la.name, la.account_type, la.opening_balance, la.opening_balance_side
                  ORDER BY la.account_type, la.name
                `);
                let grandTotal = 0;
                const stats: any[] = (rows.rows as any[]).map(row => {
                  const ob = parseFloat(row.opening_balance || "0");
                  const obAdj = row.opening_balance_side === "Cr" ? -ob : ob;
                  const bal = obAdj + parseFloat(row.total_debit || "0") - parseFloat(row.total_credit || "0");
                  grandTotal += bal;
                  return { label: `${row.name} (${row.account_type})`, value: fmt(bal), highlight: bal >= 0 ? "positive" : "negative" };
                });
                stats.push({ label: "TOTAL CASH & BANK", value: fmt(grandTotal), highlight: grandTotal >= 0 ? "positive" : "negative" });
                dataQueryResult = { queryType: "cash_position", title: "Cash & Bank Positions", subtitle: `As of ${todayStr}`, stats };
                break;
              }

              case "overdue_payments": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.opening_balance, la.opening_balance_side,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit,
                    MAX(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN v.voucher_date END) AS last_tx
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.active = true AND la.deleted_at IS NULL
                    AND la.account_type NOT IN ('Cash','Bank','Income','Expense','Direct Expense','Indirect Expense','Equity','Profit','Government Taxes')
                  GROUP BY la.id, la.name, la.opening_balance, la.opening_balance_side
                  HAVING (
                    CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) > 100
                  ORDER BY (
                    CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows = (rows.rows as any[]).map(row => {
                  const ob = parseFloat(row.opening_balance || "0");
                  const obAdj = row.opening_balance_side === "Cr" ? -ob : ob;
                  const bal = obAdj + parseFloat(row.total_debit || "0") - parseFloat(row.total_credit || "0");
                  const lastTx = row.last_tx ? String(row.last_tx).slice(0, 10) : "—";
                  return [row.name, fmt(bal), lastTx];
                });
                dataQueryResult = {
                  queryType: "overdue_payments",
                  title: "Outstanding Receivables",
                  subtitle: "Accounts with debit balance (they owe you)",
                  table: { headers: ["Account", "Balance Owed", "Last Transaction"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "customer_statement": {
                const name = params.entityName;
                if (!name) {
                  dataQueryResult = { queryType: "customer_statement", title: "Customer Statement", summary: "Please specify a customer name." };
                  break;
                }
                const accts = await db.select({ id: schema.ledgerAccounts.id, name: schema.ledgerAccounts.name })
                  .from(schema.ledgerAccounts)
                  .where(and(eq(schema.ledgerAccounts.companyId, companyId), ilike(schema.ledgerAccounts.name, `%${name}%`), isNull(schema.ledgerAccounts.deletedAt)))
                  .limit(3);
                if (!accts.length) {
                  dataQueryResult = { queryType: "customer_statement", title: `Customer: ${name}`, summary: "No account found matching that name." };
                  break;
                }
                const acct = accts[0];
                const txRows = await db.select({
                  voucherDate: schema.vouchers.voucherDate,
                  voucherType: schema.vouchers.voucherType,
                  description: schema.vouchers.description,
                  debitAmount: schema.voucherEntries.debitAmount,
                  creditAmount: schema.voucherEntries.creditAmount,
                })
                  .from(schema.voucherEntries)
                  .innerJoin(schema.vouchers, and(eq(schema.voucherEntries.voucherId, schema.vouchers.id), eq(schema.vouchers.optional, false), isNull(schema.vouchers.deletedAt)))
                  .where(eq(schema.voucherEntries.ledgerAccountId, acct.id))
                  .orderBy(desc(schema.vouchers.voucherDate))
                  .limit(rowLimit);
                const tableRows = txRows.map(r => [
                  r.voucherDate || "—",
                  r.voucherType || "—",
                  (r.description || "").slice(0, 40),
                  parseFloat(r.debitAmount || "0") > 0 ? fmtDec(parseFloat(r.debitAmount!)) : "—",
                  parseFloat(r.creditAmount || "0") > 0 ? fmtDec(parseFloat(r.creditAmount!)) : "—",
                ]);
                dataQueryResult = {
                  queryType: "customer_statement",
                  title: `Statement: ${acct.name}`,
                  subtitle: `Last ${txRows.length} transaction(s)`,
                  table: { headers: ["Date", "Type", "Description", "Debit", "Credit"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "supplier_statement": {
                const name = params.entityName;
                if (!name) {
                  dataQueryResult = { queryType: "supplier_statement", title: "Supplier Statement", summary: "Please specify a supplier name." };
                  break;
                }
                const accts = await db.select({ id: schema.ledgerAccounts.id, name: schema.ledgerAccounts.name })
                  .from(schema.ledgerAccounts)
                  .where(and(eq(schema.ledgerAccounts.companyId, companyId), ilike(schema.ledgerAccounts.name, `%${name}%`), isNull(schema.ledgerAccounts.deletedAt)))
                  .limit(3);
                if (!accts.length) {
                  dataQueryResult = { queryType: "supplier_statement", title: `Supplier: ${name}`, summary: "No account found matching that name." };
                  break;
                }
                const acct = accts[0];
                const txRows = await db.select({
                  voucherDate: schema.vouchers.voucherDate,
                  voucherType: schema.vouchers.voucherType,
                  description: schema.vouchers.description,
                  debitAmount: schema.voucherEntries.debitAmount,
                  creditAmount: schema.voucherEntries.creditAmount,
                })
                  .from(schema.voucherEntries)
                  .innerJoin(schema.vouchers, and(eq(schema.voucherEntries.voucherId, schema.vouchers.id), eq(schema.vouchers.optional, false), isNull(schema.vouchers.deletedAt)))
                  .where(eq(schema.voucherEntries.ledgerAccountId, acct.id))
                  .orderBy(desc(schema.vouchers.voucherDate))
                  .limit(rowLimit);
                const tableRows = txRows.map(r => [
                  r.voucherDate || "—",
                  r.voucherType || "—",
                  (r.description || "").slice(0, 40),
                  parseFloat(r.debitAmount || "0") > 0 ? fmtDec(parseFloat(r.debitAmount!)) : "—",
                  parseFloat(r.creditAmount || "0") > 0 ? fmtDec(parseFloat(r.creditAmount!)) : "—",
                ]);
                dataQueryResult = {
                  queryType: "supplier_statement",
                  title: `Supplier: ${acct.name}`,
                  subtitle: `Last ${txRows.length} transaction(s)`,
                  table: { headers: ["Date", "Type", "Description", "Debit", "Credit"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "top_customers": {
                const rows = await db.execute(sql`
                  SELECT la.name,
                    COUNT(DISTINCT v.id) AS tx_count,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_received
                  FROM ledger_accounts la
                  JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  JOIN vouchers v ON v.id = ve.voucher_id AND v.optional = false AND v.deleted_at IS NULL AND v.voucher_type = 'Receipt'
                  WHERE la.company_id = ${companyId} AND la.active = true
                    AND v.voucher_date BETWEEN ${dateFrom} AND ${dateTo}
                    AND la.account_type NOT IN ('Cash','Bank','Income','Expense','Direct Expense','Indirect Expense','Equity','Government Taxes')
                    AND CAST(ve.credit_amount AS numeric) > 0
                  GROUP BY la.id, la.name
                  ORDER BY total_received DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows = (rows.rows as any[]).map((r, i) => [
                  String(i + 1),
                  r.name,
                  String(r.tx_count),
                  fmt(parseFloat(r.total_received || "0")),
                ]);
                dataQueryResult = {
                  queryType: "top_customers",
                  title: `Top ${tableRows.length} Customers by Revenue`,
                  subtitle: `${dateFrom} to ${dateTo}`,
                  table: { headers: ["#", "Customer", "Transactions", "Amount Received"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "outstanding_suppliers": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.opening_balance, la.opening_balance_side,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.active = true AND la.deleted_at IS NULL
                    AND la.account_type NOT IN ('Cash','Bank','Income','Expense','Direct Expense','Indirect Expense','Equity','Profit','Government Taxes')
                  GROUP BY la.id, la.name, la.opening_balance, la.opening_balance_side
                  HAVING (
                    CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) < -100
                  ORDER BY (
                    CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) ASC
                  LIMIT ${rowLimit}
                `);
                const tableRows = (rows.rows as any[]).map(row => {
                  const ob = parseFloat(row.opening_balance || "0");
                  const obAdj = row.opening_balance_side === "Cr" ? -ob : ob;
                  const bal = obAdj + parseFloat(row.total_debit || "0") - parseFloat(row.total_credit || "0");
                  return [row.name, fmt(Math.abs(bal))];
                });
                dataQueryResult = {
                  queryType: "outstanding_suppliers",
                  title: "Outstanding Supplier Balances",
                  subtitle: "Largest amounts owed to suppliers",
                  table: { headers: ["Supplier / Account", "Amount Owed"], rows: tableRows },
                  noData: tableRows.length === 0,
                };
                break;
              }

              case "worker_attendance": {
                const rows = await db.execute(sql`
                  SELECT fa.status, COUNT(*) AS count, COUNT(DISTINCT fa.worker_id) AS workers
                  FROM factory_attendance fa
                  WHERE fa.company_id = ${companyId}
                    AND fa.attendance_date BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY fa.status ORDER BY fa.status
                `);
                const totalRecords = (rows.rows as any[]).reduce((s: number, r: any) => s + parseInt(r.count || "0"), 0);
                const stats: any[] = (rows.rows as any[]).map(r => ({
                  label: r.status,
                  value: `${r.count} records · ${r.workers} worker(s)`,
                  highlight: r.status === "Present" ? "positive" : r.status === "Absent" ? "negative" : "muted",
                }));
                if (!stats.length) stats.push({ label: "No Data", value: "No attendance records for this period.", highlight: "muted" });
                dataQueryResult = {
                  queryType: "worker_attendance",
                  title: "Worker Attendance",
                  subtitle: `${dateFrom} to ${dateTo} — ${totalRecords} record(s)`,
                  stats,
                };
                break;
              }

              case "bale_production": {
                const rows = await db.execute(sql`
                  SELECT fb.status, COUNT(*) AS count,
                    COALESCE(SUM(CAST(fb.weight_kg AS numeric)), 0) AS total_weight
                  FROM factory_bales fb
                  WHERE fb.company_id = ${companyId} AND fb.deleted_at IS NULL
                    AND fb.created_at::date BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY fb.status ORDER BY count DESC
                `);
                const totalBales = (rows.rows as any[]).reduce((s: number, r: any) => s + parseInt(r.count || "0"), 0);
                const totalWeight = (rows.rows as any[]).reduce((s: number, r: any) => s + parseFloat(r.total_weight || "0"), 0);
                const tableRows = (rows.rows as any[]).map(r => [
                  String(r.status).replace(/_/g, " "),
                  String(r.count),
                  fmtDec(parseFloat(r.total_weight || "0")) + " kg",
                ]);
                dataQueryResult = {
                  queryType: "bale_production",
                  title: "Bale Production Summary",
                  subtitle: `${dateFrom} to ${dateTo}`,
                  stats: [
                    { label: "Total Bales", value: fmt(totalBales), highlight: "positive" },
                    { label: "Total Weight", value: fmtDec(totalWeight) + " kg", highlight: "positive" },
                  ],
                  table: tableRows.length > 0 ? { headers: ["Status", "Bales", "Weight"], rows: tableRows } : undefined,
                  noData: totalBales === 0,
                };
                break;
              }

              case "container_status": {
                const num = params.containerNumber || (userMessage.match(/\b([A-Z]{4}\d{6,7})\b/)?.[1]);
                if (!num) {
                  dataQueryResult = { queryType: "container_status", title: "Container Status", summary: "Please specify a container number (e.g. ABCU1234567)." };
                  break;
                }
                const [container] = await db.select({
                  containerNumber: schema.containers.containerNumber,
                  status: schema.containers.status,
                  importDate: schema.containers.importDate,
                  eta: schema.containers.eta,
                  offloadDate: schema.containers.offloadDate,
                  transporter: schema.containers.transporter,
                  trackingLocation: schema.containers.trackingLocation,
                  trackingLastStatus: schema.containers.trackingLastStatus,
                  trackingLastDescription: schema.containers.trackingLastDescription,
                  trackingLastLocation: schema.containers.trackingLastLocation,
                  borderDate: schema.containers.borderDate,
                  grandTotal: schema.containers.grandTotal,
                })
                  .from(schema.containers)
                  .where(and(eq(schema.containers.companyId, companyId), ilike(schema.containers.containerNumber, `%${num}%`)))
                  .limit(1);
                if (!container) {
                  dataQueryResult = { queryType: "container_status", title: `Container: ${num}`, summary: "Container not found." };
                  break;
                }
                const stats: any[] = [
                  { label: "Container #", value: container.containerNumber, highlight: "neutral" },
                  { label: "Status", value: container.status, highlight: container.status === "OFFLOADED" ? "positive" : "neutral" },
                  { label: "Import Date", value: container.importDate || "—", highlight: "muted" },
                  { label: "ETA", value: container.eta || "—", highlight: "muted" },
                  { label: "Offload Date", value: container.offloadDate || "Not yet offloaded", highlight: container.offloadDate ? "positive" : "muted" },
                  { label: "Transporter", value: container.transporter || "—", highlight: "muted" },
                ];
                if (container.trackingLastStatus) stats.push({ label: "Tracking Status", value: container.trackingLastStatus, highlight: "neutral" });
                if (container.trackingLastLocation) stats.push({ label: "Last Location", value: container.trackingLastLocation, highlight: "neutral" });
                if (container.trackingLastDescription) stats.push({ label: "Last Update", value: container.trackingLastDescription, highlight: "muted" });
                dataQueryResult = {
                  queryType: "container_status",
                  title: `Container: ${container.containerNumber}`,
                  subtitle: `Status: ${container.status}`,
                  stats,
                };
                break;
              }

              case "containers_pending_offload": {
                const pending = await db.select({
                  containerNumber: schema.containers.containerNumber,
                  status: schema.containers.status,
                  eta: schema.containers.eta,
                  transporter: schema.containers.transporter,
                })
                  .from(schema.containers)
                  .where(and(
                    eq(schema.containers.companyId, companyId),
                    isNull(schema.containers.offloadDate),
                  ))
                  .orderBy(asc(schema.containers.eta))
                  .limit(rowLimit);
                const tableRows = pending.map(c => [
                  c.containerNumber,
                  c.status,
                  c.eta || "—",
                  c.transporter || "—",
                ]);
                dataQueryResult = {
                  queryType: "containers_pending_offload",
                  title: "Containers Pending Offload",
                  subtitle: `${pending.length} container(s) not yet offloaded`,
                  table: { headers: ["Container #", "Status", "ETA", "Transporter"], rows: tableRows },
                  noData: pending.length === 0,
                };
                break;
              }

              // ── Phase 2 Cases ────────────────────────────────────────────────

              case "inventory_check": {
                const itemName = params.entityName;
                const locName = params.locationName;
                const rows = await db.execute(sql`
                  SELECT si.name AS item_name, si.code, si.uom,
                    l.name AS location_name,
                    CAST(inv.quantity AS numeric) AS qty,
                    CAST(inv.average_rate AS numeric) AS avg_rate,
                    CAST(inv.total_value AS numeric) AS total_value
                  FROM inventory inv
                  JOIN stock_items si ON si.id = inv.stock_item_id AND si.deleted_at IS NULL
                  JOIN locations l ON l.id = inv.location_id
                  WHERE inv.company_id = ${companyId}
                    AND inv.quantity > 0
                    ${itemName ? sql`AND si.name ILIKE ${'%' + itemName + '%'}` : sql``}
                    ${locName ? sql`AND l.name ILIKE ${'%' + locName + '%'}` : sql``}
                  ORDER BY total_value DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map(r => [
                  r.item_name,
                  r.code,
                  r.location_name,
                  `${fmtDec(parseFloat(r.qty))} ${r.uom}`,
                  fmtDec(parseFloat(r.avg_rate)),
                  fmt(parseFloat(r.total_value)),
                ]);
                dataQueryResult = {
                  queryType: "inventory_check",
                  title: itemName ? `Stock Levels: ${itemName}` : "Inventory Stock Levels",
                  subtitle: locName ? `Location: ${locName}` : "All locations",
                  table: { headers: ["Item", "Code", "Location", "Qty", "Avg Rate", "Total Value"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "low_stock_items": {
                const rows = await db.execute(sql`
                  SELECT si.name, si.code, si.uom,
                    CAST(si.reorder_level AS numeric) AS reorder_level,
                    COALESCE(SUM(CAST(inv.quantity AS numeric)), 0) AS total_qty
                  FROM stock_items si
                  LEFT JOIN inventory inv ON inv.stock_item_id = si.id AND inv.company_id = ${companyId}
                  WHERE si.company_id = ${companyId}
                    AND si.active = true AND si.deleted_at IS NULL
                    AND CAST(si.reorder_level AS numeric) > 0
                  GROUP BY si.id, si.name, si.code, si.uom, si.reorder_level
                  HAVING COALESCE(SUM(CAST(inv.quantity AS numeric)), 0) < CAST(si.reorder_level AS numeric)
                  ORDER BY (COALESCE(SUM(CAST(inv.quantity AS numeric)), 0) / NULLIF(CAST(si.reorder_level AS numeric), 0)) ASC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map(r => [
                  r.name,
                  r.code,
                  `${fmtDec(parseFloat(r.total_qty))} ${r.uom}`,
                  `${fmtDec(parseFloat(r.reorder_level))} ${r.uom}`,
                  `${Math.round((parseFloat(r.total_qty) / parseFloat(r.reorder_level)) * 100)}%`,
                ]);
                dataQueryResult = {
                  queryType: "low_stock_items",
                  title: "Items Below Reorder Level",
                  subtitle: `${tableRows2.length} item(s) need restocking`,
                  table: { headers: ["Item", "Code", "Current Stock", "Reorder Level", "Stock %"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "stock_movement": {
                const itemName = params.entityName;
                if (!itemName) {
                  dataQueryResult = { queryType: "stock_movement", title: "Stock Movement", summary: "Please specify an item name." };
                  break;
                }
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, sav.adjustment_type, l.name AS location,
                    si.name AS item_name, si.uom,
                    CAST(sai.quantity AS numeric) AS qty,
                    CAST(sai.rate AS numeric) AS rate
                  FROM stock_adjustment_items sai
                  JOIN stock_adjustment_vouchers sav ON sav.id = sai.adjustment_id
                  JOIN vouchers v ON v.id = sav.voucher_id AND v.deleted_at IS NULL
                  JOIN stock_items si ON si.id = sai.stock_item_id
                  JOIN locations l ON l.id = sav.location_id
                  WHERE si.company_id = ${companyId}
                    AND si.name ILIKE ${'%' + itemName + '%'}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map(r => [
                  String(r.voucher_date).slice(0, 10),
                  r.adjustment_type,
                  r.location,
                  `${fmtDec(Math.abs(parseFloat(r.qty)))} ${r.uom}`,
                  parseFloat(r.qty) >= 0 ? "IN" : "OUT",
                ]);
                dataQueryResult = {
                  queryType: "stock_movement",
                  title: `Stock Movement: ${itemName}`,
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: { headers: ["Date", "Type", "Location", "Qty", "Direction"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "open_purchase_orders": {
                const supplierName = params.entityName;
                const rows = await db.execute(sql`
                  SELECT po.po_number, s.legal_name AS supplier,
                    c.container_number, po.currency,
                    CAST(po.items_total AS numeric) AS items_total,
                    po.status, po.created_at
                  FROM purchase_orders po
                  JOIN suppliers s ON s.id = po.supplier_id
                  JOIN containers c ON c.id = po.container_id
                  WHERE po.company_id = ${companyId}
                    AND po.status = 'Open'
                    ${supplierName ? sql`AND s.legal_name ILIKE ${'%' + supplierName + '%'}` : sql``}
                  ORDER BY po.created_at DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map(r => [
                  r.po_number,
                  r.supplier,
                  r.container_number,
                  r.currency,
                  fmtDec(parseFloat(r.items_total || "0")),
                  r.status,
                ]);
                dataQueryResult = {
                  queryType: "open_purchase_orders",
                  title: supplierName ? `Open POs — ${supplierName}` : "Open Purchase Orders",
                  subtitle: `${tableRows2.length} open PO(s)`,
                  table: { headers: ["PO #", "Supplier", "Container", "Currency", "Items Total", "Status"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "customer_aging": {
                const rows = await db.execute(sql`
                  SELECT la.name,
                    COALESCE(CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0) AS ob,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 0 AND 30
                      THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS bucket_0_30,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 31 AND 60
                      THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS bucket_31_60,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 61 AND 90
                      THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS bucket_61_90,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) > 90
                      THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS bucket_over_90
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.active = true AND la.deleted_at IS NULL
                    AND la.account_type NOT IN ('Cash','Bank','Income','Expense','Direct Expense','Indirect Expense','Equity','Profit','Government Taxes','Accounts Payable','Loans')
                  GROUP BY la.id, la.name, la.opening_balance, la.opening_balance_side
                  HAVING (
                    COALESCE(CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0)
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) > 100
                  ORDER BY (
                    COALESCE(CASE WHEN la.opening_balance_side = 'Cr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0)
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                  ) DESC
                  LIMIT ${rowLimit}
                `);
                let grandTotal0_30 = 0, grandTotal31_60 = 0, grandTotal61_90 = 0, grandTotalOver90 = 0, grandTotalAll = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const balance = parseFloat(r.ob) + parseFloat(r.total_debit) - parseFloat(r.total_credit);
                  const b0 = parseFloat(r.bucket_0_30); const b1 = parseFloat(r.bucket_31_60);
                  const b2 = parseFloat(r.bucket_61_90); const b3 = parseFloat(r.bucket_over_90);
                  grandTotal0_30 += b0; grandTotal31_60 += b1; grandTotal61_90 += b2; grandTotalOver90 += b3; grandTotalAll += balance;
                  return [r.name, fmt(balance), fmt(b0 > 0 ? b0 : 0), fmt(b1 > 0 ? b1 : 0), fmt(b2 > 0 ? b2 : 0), fmt(b3 > 0 ? b3 : 0)];
                });
                tableRows2.push(["TOTAL", fmt(grandTotalAll), fmt(grandTotal0_30), fmt(grandTotal31_60), fmt(grandTotal61_90), fmt(grandTotalOver90)]);
                dataQueryResult = {
                  queryType: "customer_aging",
                  title: "Customer Receivables Aging",
                  subtitle: `As of ${todayStr}`,
                  table: { headers: ["Account", "Total", "0-30 days", "31-60 days", "61-90 days", "90+ days"], rows: tableRows2 },
                  noData: tableRows2.length <= 1,
                };
                break;
              }

              case "supplier_aging": {
                const rows = await db.execute(sql`
                  SELECT la.name,
                    COALESCE(CASE WHEN la.opening_balance_side = 'Dr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0) AS ob,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS total_credit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS total_debit,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 0 AND 30
                      THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS bucket_0_30,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 31 AND 60
                      THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS bucket_31_60,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) BETWEEN 61 AND 90
                      THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS bucket_61_90,
                    COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false AND CURRENT_DATE - CAST(v.voucher_date AS date) > 90
                      THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS bucket_over_90
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                  WHERE la.company_id = ${companyId} AND la.active = true AND la.deleted_at IS NULL
                    AND la.account_type IN ('Accounts Payable','Liability','Transporter Agent','Duty Agent')
                  GROUP BY la.id, la.name, la.opening_balance, la.opening_balance_side
                  HAVING (
                    COALESCE(CASE WHEN la.opening_balance_side = 'Dr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0)
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                  ) > 100
                  ORDER BY (
                    COALESCE(CASE WHEN la.opening_balance_side = 'Dr' THEN -CAST(la.opening_balance AS numeric) ELSE CAST(la.opening_balance AS numeric) END, 0)
                    + COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.credit_amount AS numeric) ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN v.deleted_at IS NULL AND v.optional = false THEN CAST(ve.debit_amount AS numeric) ELSE 0 END), 0)
                  ) DESC
                  LIMIT ${rowLimit}
                `);
                let sgTotal0_30 = 0, sgTotal31_60 = 0, sgTotal61_90 = 0, sgTotalOver90 = 0, sgTotalAll = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const balance = parseFloat(r.ob) + parseFloat(r.total_credit) - parseFloat(r.total_debit);
                  const b0 = parseFloat(r.bucket_0_30); const b1 = parseFloat(r.bucket_31_60);
                  const b2 = parseFloat(r.bucket_61_90); const b3 = parseFloat(r.bucket_over_90);
                  sgTotal0_30 += b0; sgTotal31_60 += b1; sgTotal61_90 += b2; sgTotalOver90 += b3; sgTotalAll += balance;
                  return [r.name, fmt(balance), fmt(b0 > 0 ? b0 : 0), fmt(b1 > 0 ? b1 : 0), fmt(b2 > 0 ? b2 : 0), fmt(b3 > 0 ? b3 : 0)];
                });
                tableRows2.push(["TOTAL", fmt(sgTotalAll), fmt(sgTotal0_30), fmt(sgTotal31_60), fmt(sgTotal61_90), fmt(sgTotalOver90)]);
                dataQueryResult = {
                  queryType: "supplier_aging",
                  title: "Supplier Payables Aging",
                  subtitle: `As of ${todayStr}`,
                  table: { headers: ["Supplier", "Total Owed", "0-30 days", "31-60 days", "61-90 days", "90+ days"], rows: tableRows2 },
                  noData: tableRows2.length <= 1,
                };
                break;
              }

              case "container_list": {
                const statusFilter = params.containerStatus;
                const rows = await db.execute(sql`
                  SELECT c.container_number, c.status, c.import_date, c.eta,
                    s.legal_name AS supplier,
                    CAST(c.grand_total AS numeric) AS grand_total,
                    c.currency, c.transporter
                  FROM containers c
                  JOIN suppliers s ON s.id = c.supplier_id
                  WHERE c.company_id = ${companyId}
                    ${statusFilter ? sql`AND c.status ILIKE ${'%' + statusFilter + '%'}` : sql``}
                    AND c.import_date BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY c.import_date DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map(r => [
                  r.container_number,
                  r.status,
                  String(r.import_date).slice(0, 10),
                  r.eta ? String(r.eta).slice(0, 10) : "—",
                  r.supplier,
                  r.transporter || "—",
                  fmtDec(parseFloat(r.grand_total || "0")),
                ]);
                dataQueryResult = {
                  queryType: "container_list",
                  title: statusFilter ? `Containers — ${statusFilter}` : "Container List",
                  subtitle: `${dateFrom} → ${dateTo} · ${tableRows2.length} container(s)`,
                  table: { headers: ["Container #", "Status", "Import Date", "ETA", "Supplier", "Transporter", "Grand Total"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "monthly_comparison": {
                const runPL = async (from: string, to: string) => {
                  const r = await db.execute(sql`
                    SELECT
                      COALESCE(SUM(CASE WHEN la.account_type IN ('Income') THEN CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric) ELSE 0 END), 0) AS revenue,
                      COALESCE(SUM(CASE WHEN la.account_type IN ('Expense','Direct Expense','Indirect Expense') THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric) ELSE 0 END), 0) AS expenses
                    FROM voucher_entries ve
                    JOIN vouchers v ON v.id = ve.voucher_id AND v.deleted_at IS NULL AND v.optional = false
                    JOIN ledger_accounts la ON la.id = ve.ledger_account_id
                    WHERE la.company_id = ${companyId}
                      AND CAST(v.voucher_date AS text) BETWEEN ${from} AND ${to}
                  `);
                  const row = r.rows[0] as any;
                  const rev = parseFloat(row?.revenue || "0");
                  const exp = parseFloat(row?.expenses || "0");
                  return { revenue: rev, expenses: exp, net: rev - exp };
                };
                const [thisM, lastM] = await Promise.all([
                  runPL(thisMonthStart, todayStr),
                  runPL(lastMonthStart, lastMonthEnd),
                ]);
                const diff = (a: number, b: number) => {
                  if (b === 0) return a > 0 ? "+100%" : "—";
                  const pct = ((a - b) / Math.abs(b)) * 100;
                  return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
                };
                const tableRows2 = [
                  ["Revenue", fmt(lastM.revenue), fmt(thisM.revenue), diff(thisM.revenue, lastM.revenue)],
                  ["Expenses", fmt(lastM.expenses), fmt(thisM.expenses), diff(thisM.expenses, lastM.expenses)],
                  ["Net Profit", fmt(lastM.net), fmt(thisM.net), diff(thisM.net, lastM.net)],
                ];
                dataQueryResult = {
                  queryType: "monthly_comparison",
                  title: "Month-over-Month Comparison",
                  subtitle: `Last month (${lastMonthStart.slice(0, 7)}) vs This month (${thisMonthStart.slice(0, 7)})`,
                  table: { headers: ["Metric", "Last Month", "This Month", "Change"], rows: tableRows2 },
                  noData: false,
                };
                break;
              }

              case "rental_summary": {
                const currentYear = todayDate.getFullYear();
                const currentMonth = todayDate.getMonth() + 1;
                const rows = await db.execute(sql`
                  SELECT pu.unit_number, pu.unit_type, pu.location_group,
                    pc.tenant_name, CAST(pc.rental_amount AS numeric) AS rental_amount, pc.status AS contract_status,
                    CAST(COALESCE(pml.expected_amount, 0) AS numeric) AS expected,
                    CAST(COALESCE(pml.paid_amount, 0) AS numeric) AS paid
                  FROM property_units pu
                  LEFT JOIN property_contracts pc ON pc.unit_id = pu.id AND pc.status = 'ACTIVE'
                  LEFT JOIN property_monthly_ledger pml ON pml.unit_id = pu.id
                    AND pml.year = ${currentYear} AND pml.month = ${currentMonth}
                  WHERE pu.company_id = ${companyId} AND pu.active = true
                  ORDER BY pu.unit_type, pu.location_group, pu.unit_number
                  LIMIT ${rowLimit}
                `);
                let totalExpected = 0, totalPaid = 0, occupied = 0, vacant = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const exp = parseFloat(r.expected || "0");
                  const paid = parseFloat(r.paid || "0");
                  totalExpected += exp; totalPaid += paid;
                  if (r.tenant_name) occupied++; else vacant++;
                  const balance = exp - paid;
                  return [r.unit_number, r.unit_type, r.location_group, r.tenant_name || "VACANT", fmt(exp), fmt(paid), fmt(balance), balance > 0 ? "OUTSTANDING" : "OK"];
                });
                const stats2 = [
                  { label: "Occupied", value: String(occupied) },
                  { label: "Vacant", value: String(vacant) },
                  { label: "Total Expected", value: fmt(totalExpected) },
                  { label: "Total Collected", value: fmt(totalPaid) },
                  { label: "Outstanding", value: fmt(totalExpected - totalPaid), highlight: (totalExpected - totalPaid) > 0 ? "negative" : "positive" },
                ];
                dataQueryResult = {
                  queryType: "rental_summary",
                  title: "Rental Summary",
                  subtitle: `${currentYear}-${String(currentMonth).padStart(2, "0")} · ${occupied} occupied, ${vacant} vacant`,
                  stats: stats2,
                  table: { headers: ["Unit", "Type", "Location", "Tenant", "Expected", "Paid", "Balance", "Status"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "payroll_summary": {
                const rows = await db.execute(sql`
                  SELECT fw.name AS worker_name,
                    fp.period_start, fp.period_end, fp.status,
                    CAST(fp.net_salary AS numeric) AS net_salary,
                    CAST(fp.base_salary AS numeric) AS base_salary,
                    CAST(fp.bale_earnings AS numeric) AS bale_earnings,
                    CAST(fp.deductions AS numeric) AS deductions,
                    fp.present_days, fp.absent_days
                  FROM factory_payrolls fp
                  JOIN factory_workers fw ON fw.id = fp.worker_id
                  WHERE fp.company_id = ${companyId}
                    AND fp.period_start >= ${dateFrom}
                    AND fp.period_end <= ${dateTo}
                  ORDER BY fp.period_start DESC, fw.name
                  LIMIT ${rowLimit}
                `);
                let totalNet = 0, totalBase = 0, totalBale = 0, totalDed = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const net = parseFloat(r.net_salary || "0");
                  totalNet += net; totalBase += parseFloat(r.base_salary || "0");
                  totalBale += parseFloat(r.bale_earnings || "0"); totalDed += parseFloat(r.deductions || "0");
                  return [r.worker_name, String(r.period_start).slice(0, 10), String(r.period_end).slice(0, 10), fmt(parseFloat(r.base_salary || "0")), fmt(parseFloat(r.bale_earnings || "0")), fmt(parseFloat(r.deductions || "0")), fmt(net), r.status];
                });
                const stats2 = [
                  { label: "Total Workers", value: String(tableRows2.length) },
                  { label: "Total Base Salary", value: fmt(totalBase) },
                  { label: "Total Bale Earnings", value: fmt(totalBale) },
                  { label: "Total Deductions", value: fmt(totalDed) },
                  { label: "Total Net Payroll", value: fmt(totalNet), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "payroll_summary",
                  title: "Factory Payroll Summary",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats2,
                  table: { headers: ["Worker", "Period From", "Period To", "Base", "Bale Earn.", "Deductions", "Net", "Status"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              // ── Phase 3 Cases ────────────────────────────────────────────────

              case "sales_analysis": {
                const itemNameFilter = params.entityName;
                const rows = await db.execute(sql`
                  SELECT si.name AS item_name, si.code, si.uom,
                    COUNT(sal.id) AS tx_count,
                    SUM(CAST(sal.quantity AS numeric)) AS total_qty,
                    SUM(CAST(sal.total_sales AS numeric)) AS total_revenue,
                    SUM(CAST(sal.total_cost AS numeric)) AS total_cost,
                    SUM(CAST(sal.profit AS numeric)) AS total_profit
                  FROM sales_items sal
                  JOIN stock_items si ON si.id = sal.stock_item_id
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  WHERE si.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${itemNameFilter ? sql`AND si.name ILIKE ${'%' + itemNameFilter + '%'}` : sql``}
                  GROUP BY si.id, si.name, si.code, si.uom
                  ORDER BY total_revenue DESC
                  LIMIT ${rowLimit}
                `);
                let totRev = 0, totCost = 0, totProfit = 0, totQty = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const rev = parseFloat(r.total_revenue || "0");
                  const cost = parseFloat(r.total_cost || "0");
                  const profit3 = parseFloat(r.total_profit || "0");
                  const qty = parseFloat(r.total_qty || "0");
                  const margin = rev > 0 ? ((profit3 / rev) * 100).toFixed(1) + "%" : "—";
                  totRev += rev; totCost += cost; totProfit += profit3; totQty += qty;
                  return [r.item_name, `${fmtDec(qty)} ${r.uom}`, fmt(rev), fmt(cost), fmt(profit3), margin];
                });
                if (tableRows2.length) {
                  const totMargin = totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) + "%" : "—";
                  tableRows2.push(["TOTAL", fmtDec(totQty), fmt(totRev), fmt(totCost), fmt(totProfit), totMargin]);
                }
                dataQueryResult = {
                  queryType: "sales_analysis",
                  title: itemNameFilter ? `Sales Analysis: ${itemNameFilter}` : "Sales Analysis by Item",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: { headers: ["Item", "Qty Sold", "Revenue", "Cost", "Profit", "Margin"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "top_selling_items": {
                const rows = await db.execute(sql`
                  SELECT si.name AS item_name, si.code, si.uom,
                    SUM(CAST(sal.quantity AS numeric)) AS total_qty,
                    SUM(CAST(sal.total_sales AS numeric)) AS total_revenue,
                    SUM(CAST(sal.profit AS numeric)) AS total_profit,
                    COUNT(DISTINCT v.id) AS num_transactions
                  FROM sales_items sal
                  JOIN stock_items si ON si.id = sal.stock_item_id
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  WHERE si.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY si.id, si.name, si.code, si.uom
                  ORDER BY total_revenue DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map((r, i) => [
                  String(i + 1),
                  r.item_name,
                  r.code,
                  `${fmtDec(parseFloat(r.total_qty || "0"))} ${r.uom}`,
                  fmt(parseFloat(r.total_revenue || "0")),
                  fmt(parseFloat(r.total_profit || "0")),
                  String(r.num_transactions),
                ]);
                dataQueryResult = {
                  queryType: "top_selling_items",
                  title: "Top Selling Items",
                  subtitle: `${dateFrom} → ${dateTo} · by revenue`,
                  table: { headers: ["#", "Item", "Code", "Qty Sold", "Revenue", "Profit", "Transactions"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "container_profitability": {
                const rows = await db.execute(sql`
                  SELECT c.container_number,
                    s.legal_name AS supplier,
                    cu.legal_name AS customer,
                    c.currency,
                    CAST(c.grand_total AS numeric) AS cost,
                    CAST(cs.total_amount AS numeric) AS sale_amount,
                    CAST(cs.commission AS numeric) AS commission,
                    cs.payment_status,
                    c.import_date
                  FROM container_sales cs
                  JOIN containers c ON c.id = cs.container_id
                  JOIN suppliers s ON s.id = c.supplier_id
                  JOIN customers cu ON cu.id = cs.customer_id
                  WHERE c.company_id = ${companyId}
                    AND CAST(cs.sale_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY cs.sale_date DESC
                  LIMIT ${rowLimit}
                `);
                let totCost = 0, totSale = 0, totProfit = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const cost = parseFloat(r.cost || "0");
                  const sale = parseFloat(r.sale_amount || "0");
                  const comm = parseFloat(r.commission || "0");
                  const profit3 = sale - cost - comm;
                  const margin = sale > 0 ? ((profit3 / sale) * 100).toFixed(1) + "%" : "—";
                  totCost += cost; totSale += sale; totProfit += profit3;
                  return [r.container_number, r.supplier, r.customer, r.currency, fmt(cost), fmt(sale), fmt(comm), fmt(profit3), margin, r.payment_status];
                });
                if (tableRows2.length) {
                  const totMargin = totSale > 0 ? ((totProfit / totSale) * 100).toFixed(1) + "%" : "—";
                  tableRows2.push(["TOTAL", "", "", "", fmt(totCost), fmt(totSale), "", fmt(totProfit), totMargin, ""]);
                }
                dataQueryResult = {
                  queryType: "container_profitability",
                  title: "Container Profitability",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: { headers: ["Container #", "Supplier", "Customer", "Curr.", "Cost", "Sale", "Comm.", "Profit", "Margin", "Payment"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "stock_valuation": {
                const rows = await db.execute(sql`
                  SELECT COALESCE(sg.name, 'Ungrouped') AS group_name,
                    COUNT(DISTINCT si.id) AS item_count,
                    SUM(CAST(inv.quantity AS numeric)) AS total_qty,
                    SUM(CAST(inv.total_value AS numeric)) AS total_value
                  FROM inventory inv
                  JOIN stock_items si ON si.id = inv.stock_item_id AND si.deleted_at IS NULL
                  LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
                  WHERE inv.company_id = ${companyId} AND inv.quantity > 0
                  GROUP BY sg.id, sg.name
                  ORDER BY total_value DESC
                  LIMIT ${rowLimit}
                `);
                let grandTotalValue = 0, grandTotalItems = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const val = parseFloat(r.total_value || "0");
                  grandTotalValue += val;
                  grandTotalItems += parseInt(r.item_count || "0");
                  return [r.group_name, String(r.item_count), fmtDec(parseFloat(r.total_qty || "0")), fmt(val)];
                });
                tableRows2.push(["GRAND TOTAL", String(grandTotalItems), "—", fmt(grandTotalValue)]);
                const stats3 = [
                  { label: "Total Stock Groups", value: String(tableRows2.length - 1) },
                  { label: "Total Distinct Items", value: String(grandTotalItems) },
                  { label: "Total Inventory Value", value: fmt(grandTotalValue), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "stock_valuation",
                  title: "Stock Valuation by Group",
                  subtitle: `As of ${todayStr}`,
                  stats: stats3,
                  table: { headers: ["Stock Group", "Items", "Total Qty", "Total Value"], rows: tableRows2 },
                  noData: tableRows2.length <= 1,
                };
                break;
              }

              case "expense_breakdown": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.account_type,
                    SUM(CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric)) AS net_spend
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id AND v.deleted_at IS NULL AND v.optional = false
                  JOIN ledger_accounts la ON la.id = ve.ledger_account_id
                  WHERE la.company_id = ${companyId}
                    AND la.account_type IN ('Expense', 'Direct Expense', 'Indirect Expense', 'Government Taxes')
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY la.id, la.name, la.account_type
                  HAVING SUM(CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric)) > 0
                  ORDER BY net_spend DESC
                  LIMIT ${rowLimit}
                `);
                let grandSpend = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const spend = parseFloat(r.net_spend || "0");
                  grandSpend += spend;
                  return [r.name, r.account_type, fmt(spend)];
                });
                if (tableRows2.length) tableRows2.push(["TOTAL", "", fmt(grandSpend)]);
                dataQueryResult = {
                  queryType: "expense_breakdown",
                  title: "Expense Breakdown",
                  subtitle: `${dateFrom} → ${dateTo} · top ${tableRows2.length - 1} accounts`,
                  table: { headers: ["Account", "Type", "Amount"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "customer_order_status": {
                const statusFilter = (params.entityName || "").toUpperCase() || null;
                const rows = await db.execute(sql`
                  SELECT co.invoice_number, cu.legal_name AS customer,
                    co.order_date, co.status,
                    CAST(co.grand_total AS numeric) AS grand_total,
                    co.total_qty_bales, co.destination, co.container_number
                  FROM customer_orders co
                  JOIN customers cu ON cu.id = co.customer_id
                  WHERE co.company_id = ${companyId}
                    AND co.deleted_at IS NULL
                    ${statusFilter ? sql`AND co.status = ${statusFilter}` : sql``}
                    AND co.order_date BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY co.order_date DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (rows.rows as any[]).map(r => [
                  r.invoice_number || "—",
                  r.customer,
                  String(r.order_date).slice(0, 10),
                  r.status,
                  fmt(parseFloat(r.grand_total || "0")),
                  String(r.total_qty_bales || 0),
                  r.destination || "—",
                ]);
                dataQueryResult = {
                  queryType: "customer_order_status",
                  title: statusFilter ? `Customer Orders — ${statusFilter}` : "Customer Orders",
                  subtitle: `${dateFrom} → ${dateTo} · ${tableRows2.length} order(s)`,
                  table: { headers: ["Invoice", "Customer", "Date", "Status", "Total", "Bales", "Destination"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "credit_notes_summary": {
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.description,
                    si.name AS item_name, si.uom,
                    l.name AS location,
                    CAST(cni.quantity AS numeric) AS qty,
                    CAST(cni.rate AS numeric) AS rate,
                    CAST(cni.total_value AS numeric) AS total_value
                  FROM credit_note_items cni
                  JOIN vouchers v ON v.id = cni.voucher_id AND v.deleted_at IS NULL
                  JOIN stock_items si ON si.id = cni.stock_item_id
                  JOIN locations l ON l.id = cni.location_id
                  WHERE si.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totValue = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const val = parseFloat(r.total_value || "0");
                  totValue += val;
                  return [String(r.voucher_date).slice(0, 10), r.item_name, r.location, `${fmtDec(parseFloat(r.qty))} ${r.uom}`, fmtDec(parseFloat(r.rate)), fmt(val), (r.description || "").slice(0, 35)];
                });
                dataQueryResult = {
                  queryType: "credit_notes_summary",
                  title: "Credit Notes",
                  subtitle: `${dateFrom} → ${dateTo} · Total returned: ${fmt(totValue)}`,
                  table: { headers: ["Date", "Item", "Location", "Qty", "Rate", "Value", "Description"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "bank_transactions": {
                const accountName = params.entityName || params.locationName;
                const acctTypes = ['Bank', 'Cash'];
                const acctRows = await db.execute(sql`
                  SELECT id, name, account_type FROM ledger_accounts
                  WHERE company_id = ${companyId} AND account_type IN ('Bank','Cash') AND deleted_at IS NULL
                    ${accountName ? sql`AND name ILIKE ${'%' + accountName + '%'}` : sql``}
                  ORDER BY account_type, name
                  LIMIT 1
                `);
                if (!acctRows.rows.length) {
                  dataQueryResult = { queryType: "bank_transactions", title: "Bank/Cash Transactions", summary: accountName ? `No account found matching "${accountName}".` : "Please specify an account name." };
                  break;
                }
                const acct3 = acctRows.rows[0] as any;
                const txRows3 = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_type, v.description,
                    CAST(ve.debit_amount AS numeric) AS debit,
                    CAST(ve.credit_amount AS numeric) AS credit
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id AND v.deleted_at IS NULL AND v.optional = false
                  WHERE ve.ledger_account_id = ${acct3.id}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY v.voucher_date DESC, v.id DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows2 = (txRows3.rows as any[]).map(r => [
                  String(r.voucher_date).slice(0, 10),
                  r.voucher_type || "—",
                  (r.description || "").slice(0, 40),
                  parseFloat(r.debit || "0") > 0 ? fmt(parseFloat(r.debit)) : "—",
                  parseFloat(r.credit || "0") > 0 ? fmt(parseFloat(r.credit)) : "—",
                ]);
                dataQueryResult = {
                  queryType: "bank_transactions",
                  title: `Transactions: ${acct3.name}`,
                  subtitle: `${dateFrom} → ${dateTo} · ${acct3.account_type} account`,
                  table: { headers: ["Date", "Type", "Description", "In (Dr)", "Out (Cr)"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "fixed_assets_summary": {
                const categoryFilter = params.entityName;
                const rows = await db.execute(sql`
                  SELECT fa.code, fa.name, fa.category,
                    fa.purchase_date,
                    CAST(fa.purchase_amount AS numeric) AS purchase_amount,
                    fa.depreciation_method, fa.useful_life, fa.active
                  FROM fixed_assets fa
                  WHERE fa.company_id = ${companyId}
                    ${categoryFilter ? sql`AND fa.category ILIKE ${'%' + categoryFilter + '%'}` : sql``}
                  ORDER BY fa.category, fa.purchase_date DESC
                  LIMIT ${rowLimit}
                `);
                let grandTotal = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const amt = parseFloat(r.purchase_amount || "0");
                  grandTotal += amt;
                  return [r.code, r.name, r.category, String(r.purchase_date).slice(0, 10), fmt(amt), r.depreciation_method, r.useful_life ? `${r.useful_life} yr` : "—", r.active ? "Active" : "Inactive"];
                });
                const stats3 = [
                  { label: "Total Assets", value: String(tableRows2.length) },
                  { label: "Total Purchase Value", value: fmt(grandTotal), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "fixed_assets_summary",
                  title: categoryFilter ? `Fixed Assets — ${categoryFilter}` : "Fixed Assets Register",
                  subtitle: `${tableRows2.length} asset(s)`,
                  stats: stats3,
                  table: { headers: ["Code", "Name", "Category", "Purchase Date", "Amount", "Depreciation", "Life", "Status"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              case "factory_kpi": {
                const rows = await db.execute(sql`
                  SELECT date,
                    CAST(total_kg_in AS numeric) AS kg_in,
                    CAST(total_kg_pressed AS numeric) AS kg_pressed,
                    total_bales_produced,
                    CAST(total_waste_kg AS numeric) AS waste_kg
                  FROM factory_daily_kpi_snapshots
                  WHERE company_id = ${companyId}
                    AND date BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY date DESC
                  LIMIT ${rowLimit}
                `);
                let totKgIn = 0, totKgPressed = 0, totBales = 0, totWaste = 0;
                const tableRows2 = (rows.rows as any[]).map(r => {
                  const kgIn = parseFloat(r.kg_in || "0");
                  const kgPressed = parseFloat(r.kg_pressed || "0");
                  const bales = parseInt(r.total_bales_produced || "0");
                  const waste = parseFloat(r.waste_kg || "0");
                  const efficiency = kgIn > 0 ? ((kgPressed / kgIn) * 100).toFixed(1) + "%" : "—";
                  totKgIn += kgIn; totKgPressed += kgPressed; totBales += bales; totWaste += waste;
                  return [String(r.date).slice(0, 10), fmtDec(kgIn), fmtDec(kgPressed), String(bales), fmtDec(waste), efficiency];
                });
                const avgEff = totKgIn > 0 ? ((totKgPressed / totKgIn) * 100).toFixed(1) + "%" : "—";
                if (tableRows2.length) tableRows2.push(["TOTAL", fmtDec(totKgIn), fmtDec(totKgPressed), String(totBales), fmtDec(totWaste), avgEff]);
                const stats3 = [
                  { label: "Total Kg In", value: fmtDec(totKgIn) },
                  { label: "Total Kg Pressed", value: fmtDec(totKgPressed) },
                  { label: "Total Bales", value: String(totBales) },
                  { label: "Total Waste Kg", value: fmtDec(totWaste) },
                  { label: "Avg Efficiency", value: avgEff, highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "factory_kpi",
                  title: "Factory Daily KPIs",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats3,
                  table: { headers: ["Date", "Kg In", "Kg Pressed", "Bales", "Waste Kg", "Efficiency"], rows: tableRows2 },
                  noData: tableRows2.length === 0,
                };
                break;
              }

              // ── Phase 4 Cases ────────────────────────────────────────────────

              case "pos_sales_summary": {
                const itemFilter = params.entityName;
                const rows = await db.execute(sql`
                  SELECT fpsi.product_name, fpsi.article_code,
                    SUM(fpsi.quantity) AS total_qty,
                    SUM(CAST(fpsi.total_amount AS numeric)) AS total_revenue,
                    COUNT(DISTINCT fps.id) AS num_sales,
                    fpsi.currency_code
                  FROM factory_pos_sale_items fpsi
                  JOIN factory_pos_sales fps ON fps.id = fpsi.sale_id AND fps.status = 'COMPLETED'
                  WHERE fps.company_id = ${companyId}
                    AND CAST(fps.tx_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${itemFilter ? sql`AND fpsi.product_name ILIKE ${'%' + itemFilter + '%'}` : sql``}
                  GROUP BY fpsi.product_name, fpsi.article_code, fpsi.currency_code
                  ORDER BY total_revenue DESC
                  LIMIT ${rowLimit}
                `);
                const totalsRow = await db.execute(sql`
                  SELECT COUNT(id) AS num_transactions,
                    SUM(CAST(total_amount AS numeric)) AS grand_total
                  FROM factory_pos_sales
                  WHERE company_id = ${companyId} AND status = 'COMPLETED'
                    AND CAST(tx_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                `);
                const t4 = totalsRow.rows[0] as any;
                let grandRev = 0;
                const tableRows4 = (rows.rows as any[]).map(r => {
                  const rev = parseFloat(r.total_revenue || "0");
                  grandRev += rev;
                  return [r.product_name, r.article_code || "—", String(r.total_qty), fmt(rev), r.currency_code, String(r.num_sales)];
                });
                const stats4 = [
                  { label: "Total Transactions", value: String(t4?.num_transactions || 0) },
                  { label: "Grand Total Revenue", value: fmt(parseFloat(t4?.grand_total || "0")), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "pos_sales_summary",
                  title: itemFilter ? `POS Sales: ${itemFilter}` : "POS Sales Summary",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats4,
                  table: { headers: ["Product", "Article Code", "Qty", "Revenue", "Currency", "Sales"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "intercompany_transfers": {
                const rows = await db.execute(sql`
                  SELECT ict.transfer_date, ict.transfer_type,
                    fc.name AS from_company, tc.name AS to_company,
                    CAST(ict.amount AS numeric) AS amount,
                    ict.description
                  FROM inter_company_transfers ict
                  JOIN companies fc ON fc.id = ict.from_company_id
                  JOIN companies tc ON tc.id = ict.to_company_id
                  WHERE (ict.from_company_id = ${companyId} OR ict.to_company_id = ${companyId})
                    AND CAST(ict.transfer_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY ict.transfer_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalOut = 0, totalIn = 0;
                const tableRows4 = (rows.rows as any[]).map(r => {
                  const amt = parseFloat(r.amount || "0");
                  const isOut = r.from_company === (rows.rows[0] as any)?.from_company;
                  totalOut += amt; // simplified — show all
                  return [String(r.transfer_date).slice(0, 10), r.transfer_type, r.from_company, r.to_company, fmt(amt), (r.description || "").slice(0, 40)];
                });
                dataQueryResult = {
                  queryType: "intercompany_transfers",
                  title: "Inter-Company Transfers",
                  subtitle: `${dateFrom} → ${dateTo} · ${tableRows4.length} transfer(s)`,
                  table: { headers: ["Date", "Type", "From", "To", "Amount", "Description"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "container_offload_details": {
                const cnFilter = params.containerNumber || params.entityName;
                if (!cnFilter) {
                  dataQueryResult = { queryType: "container_offload_details", title: "Container Offload Details", summary: "Please specify a container number." };
                  break;
                }
                const rows = await db.execute(sql`
                  SELECT c.container_number, l.name AS location,
                    si.name AS item_name, si.code, si.uom,
                    CAST(coi.quantity AS numeric) AS qty,
                    CAST(coi.rate AS numeric) AS rate,
                    CAST(coi.total_value AS numeric) AS total_value,
                    co.offloaded_at
                  FROM container_offload_items coi
                  JOIN container_offloads co ON co.id = coi.offload_id
                  JOIN containers c ON c.id = co.container_id
                  JOIN locations l ON l.id = co.location_id
                  JOIN stock_items si ON si.id = coi.stock_item_id
                  WHERE c.container_number ILIKE ${'%' + cnFilter + '%'}
                    AND c.company_id = ${companyId}
                  ORDER BY si.name
                  LIMIT ${rowLimit}
                `);
                let totalVal = 0;
                const tableRows4 = (rows.rows as any[]).map(r => {
                  const val = parseFloat(r.total_value || "0");
                  totalVal += val;
                  return [r.item_name, r.code, r.location, `${fmtDec(parseFloat(r.qty))} ${r.uom}`, fmtDec(parseFloat(r.rate)), fmt(val)];
                });
                const cn = (rows.rows[0] as any)?.container_number || cnFilter;
                dataQueryResult = {
                  queryType: "container_offload_details",
                  title: `Offload Details: ${cn}`,
                  subtitle: `${tableRows4.length} line(s) · Total value: ${fmt(totalVal)}`,
                  table: { headers: ["Item", "Code", "Location", "Qty", "Rate", "Total Value"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "worker_productivity": {
                const rows = await db.execute(sql`
                  SELECT fw.full_name,
                    COUNT(fb.id) AS total_bales,
                    COALESCE(SUM(CAST(fb.weight_kg AS numeric)), 0) AS total_kg,
                    COALESCE(AVG(CAST(fb.weight_kg AS numeric)), 0) AS avg_kg_per_bale
                  FROM factory_bales fb
                  JOIN factory_workers fw ON fw.id = fb.worker_id
                  WHERE fb.company_id = ${companyId}
                    AND fb.status = 'Pressed'
                    AND CAST(fb.pressed_at AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY fw.id, fw.full_name
                  ORDER BY total_bales DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows4 = (rows.rows as any[]).map((r, i) => [
                  String(i + 1),
                  r.full_name,
                  String(r.total_bales),
                  fmtDec(parseFloat(r.total_kg || "0")),
                  fmtDec(parseFloat(r.avg_kg_per_bale || "0")),
                ]);
                dataQueryResult = {
                  queryType: "worker_productivity",
                  title: "Worker Productivity Ranking",
                  subtitle: `${dateFrom} → ${dateTo} · by bales pressed`,
                  table: { headers: ["Rank", "Worker", "Bales", "Total Kg", "Avg Kg/Bale"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "supplier_spend": {
                const supplierFilter = params.entityName;
                const rows = await db.execute(sql`
                  SELECT s.legal_name AS supplier,
                    COUNT(po.id) AS po_count,
                    SUM(CAST(po.items_total AS numeric)) AS total_items,
                    SUM(CAST(po.freight AS numeric) + CAST(po.surcharge AS numeric) + CAST(po.fumigation AS numeric)
                        + CAST(po.document_charges AS numeric) + CAST(po.other_charges AS numeric)
                        - CAST(po.discount AS numeric)) AS total_charges,
                    po.currency
                  FROM purchase_orders po
                  JOIN suppliers s ON s.id = po.supplier_id
                  WHERE po.company_id = ${companyId}
                    AND po.created_at >= ${dateFrom}
                    ${supplierFilter ? sql`AND s.legal_name ILIKE ${'%' + supplierFilter + '%'}` : sql``}
                  GROUP BY s.id, s.legal_name, po.currency
                  ORDER BY total_items DESC
                  LIMIT ${rowLimit}
                `);
                let grandItems = 0;
                const tableRows4 = (rows.rows as any[]).map(r => {
                  const items = parseFloat(r.total_items || "0");
                  const charges = parseFloat(r.total_charges || "0");
                  grandItems += items;
                  return [r.supplier, String(r.po_count), fmt(items), fmt(charges), fmt(items + charges), r.currency];
                });
                dataQueryResult = {
                  queryType: "supplier_spend",
                  title: supplierFilter ? `Supplier Spend: ${supplierFilter}` : "Supplier Purchase Spend",
                  subtitle: `Since ${dateFrom} · ${tableRows4.length} supplier(s)`,
                  table: { headers: ["Supplier", "POs", "Items Total", "Charges", "Grand Total", "Currency"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "upcoming_arrivals": {
                const daysAhead = 30;
                const futureDate = new Date(todayDate.getTime() + daysAhead * 86400000).toISOString().slice(0, 10);
                const rows = await db.execute(sql`
                  SELECT c.container_number, c.status, c.eta,
                    s.legal_name AS supplier,
                    c.transporter, c.tracking_location,
                    c.import_date,
                    CAST(c.grand_total AS numeric) AS grand_total,
                    c.currency,
                    CAST(c.eta AS date) - CURRENT_DATE AS days_until_eta
                  FROM containers c
                  JOIN suppliers s ON s.id = c.supplier_id
                  WHERE c.company_id = ${companyId}
                    AND c.status NOT IN ('Offloaded', 'Arrived')
                    AND c.eta IS NOT NULL
                    AND CAST(c.eta AS date) <= ${futureDate}
                  ORDER BY c.eta ASC
                  LIMIT ${rowLimit}
                `);
                const tableRows4 = (rows.rows as any[]).map(r => {
                  const days = parseInt(r.days_until_eta || "0");
                  const daysLabel = days <= 0 ? "TODAY/OVERDUE" : `${days}d`;
                  return [r.container_number, r.status, String(r.eta).slice(0, 10), daysLabel, r.supplier, r.transporter || "—", r.tracking_location || "—"];
                });
                dataQueryResult = {
                  queryType: "upcoming_arrivals",
                  title: "Upcoming Container Arrivals",
                  subtitle: `Next ${daysAhead} days · ${tableRows4.length} container(s) expected`,
                  table: { headers: ["Container #", "Status", "ETA", "Days Away", "Supplier", "Transporter", "Last Location"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "factory_waste_analysis": {
                const rows = await db.execute(sql`
                  SELECT fwe.date, fwe.waste_type,
                    CAST(fwe.kg_waste AS numeric) AS kg_waste,
                    fwe.reason
                  FROM factory_waste_entries fwe
                  WHERE fwe.company_id = ${companyId}
                    AND fwe.date BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY fwe.date DESC
                  LIMIT ${rowLimit}
                `);
                let totalWaste = 0;
                const typeMap: Record<string, number> = {};
                const tableRows4 = (rows.rows as any[]).map(r => {
                  const kg = parseFloat(r.kg_waste || "0");
                  totalWaste += kg;
                  const wt = r.waste_type || "Unknown";
                  typeMap[wt] = (typeMap[wt] || 0) + kg;
                  return [String(r.date).slice(0, 10), wt, fmtDec(kg), (r.reason || "—").slice(0, 40)];
                });
                const byType = Object.entries(typeMap).sort((a, b) => b[1] - a[1]).map(([t, kg]) => `${t}: ${fmtDec(kg)} kg`).join(" | ");
                const stats4 = [
                  { label: "Total Waste Entries", value: String(tableRows4.length) },
                  { label: "Total Waste Kg", value: fmtDec(totalWaste), highlight: "negative" },
                  { label: "By Type", value: byType || "—" },
                ];
                dataQueryResult = {
                  queryType: "factory_waste_analysis",
                  title: "Factory Waste Analysis",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats4,
                  table: { headers: ["Date", "Waste Type", "Kg", "Reason"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "customer_payment_history": {
                const custName = params.entityName;
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_type, v.description, v.voucher_number,
                    CAST(v.total_amount AS numeric) AS amount, v.currency
                  FROM vouchers v
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.voucher_type IN ('Receipt', 'Payment')
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${custName ? sql`AND v.description ILIKE ${'%' + custName + '%'}` : sql``}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalReceipts = 0, totalPayments = 0;
                const tableRows4 = (rows.rows as any[]).map(r => {
                  const amt = parseFloat(r.amount || "0");
                  if (r.voucher_type === "Receipt") totalReceipts += amt;
                  else totalPayments += amt;
                  return [String(r.voucher_date).slice(0, 10), r.voucher_number, r.voucher_type, (r.description || "").slice(0, 40), fmt(amt), r.currency];
                });
                const stats4 = [
                  { label: "Total Receipts", value: fmt(totalReceipts), highlight: "positive" },
                  { label: "Total Payments", value: fmt(totalPayments) },
                ];
                dataQueryResult = {
                  queryType: "customer_payment_history",
                  title: custName ? `Payment History: ${custName}` : "Customer Payment History",
                  subtitle: `${dateFrom} → ${dateTo} · ${tableRows4.length} transaction(s)`,
                  stats: stats4,
                  table: { headers: ["Date", "Voucher #", "Type", "Description", "Amount", "Currency"], rows: tableRows4 },
                  noData: tableRows4.length === 0,
                };
                break;
              }

              case "voucher_type_summary": {
                const rows = await db.execute(sql`
                  SELECT v.voucher_type,
                    COUNT(v.id) AS count,
                    SUM(CAST(v.total_amount AS numeric)) AS total_amount,
                    MIN(CAST(v.voucher_date AS text)) AS first_date,
                    MAX(CAST(v.voucher_date AS text)) AS last_date
                  FROM vouchers v
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY v.voucher_type
                  ORDER BY count DESC
                `);
                let grandCount = 0, grandTotal = 0;
                const tableRows4 = (rows.rows as any[]).map(r => {
                  const cnt = parseInt(r.count || "0");
                  const amt = parseFloat(r.total_amount || "0");
                  grandCount += cnt; grandTotal += amt;
                  return [r.voucher_type, String(cnt), fmt(amt), r.first_date?.slice(0, 10) || "—", r.last_date?.slice(0, 10) || "—"];
                });
                tableRows4.push(["TOTAL", String(grandCount), fmt(grandTotal), "", ""]);
                dataQueryResult = {
                  queryType: "voucher_type_summary",
                  title: "Voucher Summary by Type",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: { headers: ["Voucher Type", "Count", "Total Amount", "First", "Last"], rows: tableRows4 },
                  noData: tableRows4.length <= 1,
                };
                break;
              }

              case "location_stock_summary": {
                const locFilter = params.entityName || params.locationName;
                const rows = await db.execute(sql`
                  SELECT l.name AS location,
                    COUNT(DISTINCT inv.stock_item_id) AS item_count,
                    SUM(CAST(inv.quantity AS numeric)) AS total_qty,
                    SUM(CAST(inv.total_value AS numeric)) AS total_value
                  FROM inventory inv
                  JOIN locations l ON l.id = inv.location_id
                  WHERE inv.company_id = ${companyId}
                    AND inv.quantity > 0
                    ${locFilter ? sql`AND l.name ILIKE ${'%' + locFilter + '%'}` : sql``}
                  GROUP BY l.id, l.name
                  ORDER BY total_value DESC
                  LIMIT ${rowLimit}
                `);
                let grandItems = 0, grandValue = 0;
                const tableRows4 = (rows.rows as any[]).map(r => {
                  const items = parseInt(r.item_count || "0");
                  const val = parseFloat(r.total_value || "0");
                  grandItems += items; grandValue += val;
                  return [r.location, String(items), fmtDec(parseFloat(r.total_qty || "0")), fmt(val)];
                });
                tableRows4.push(["GRAND TOTAL", String(grandItems), "—", fmt(grandValue)]);
                const stats4 = [
                  { label: "Locations", value: String(tableRows4.length - 1) },
                  { label: "Total Stock Items", value: String(grandItems) },
                  { label: "Total Value", value: fmt(grandValue), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "location_stock_summary",
                  title: locFilter ? `Stock Summary: ${locFilter}` : "Stock by Location",
                  subtitle: `As of ${todayStr}`,
                  stats: stats4,
                  table: { headers: ["Location", "Items", "Total Qty", "Total Value"], rows: tableRows4 },
                  noData: tableRows4.length <= 1,
                };
                break;
              }

              // ── Phase 5 Cases ────────────────────────────────────────────────

              case "trial_balance": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.account_type, la.code,
                    COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) AS total_dr,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_cr
                  FROM ledger_accounts la
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  WHERE la.company_id = ${companyId}
                    AND la.deleted_at IS NULL
                    AND la.is_hidden = false
                  GROUP BY la.id, la.name, la.account_type, la.code
                  HAVING COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) > 0
                    OR COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) > 0
                  ORDER BY la.account_type, la.name
                `);
                let grandDr = 0, grandCr = 0;
                const tableRows5 = (rows.rows as any[]).map(r => {
                  const dr = parseFloat(r.total_dr || "0");
                  const cr = parseFloat(r.total_cr || "0");
                  const net = dr - cr;
                  grandDr += dr; grandCr += cr;
                  return [r.code || "—", r.name, r.account_type, fmt(dr), fmt(cr), net >= 0 ? fmt(net) : "—", net < 0 ? fmt(Math.abs(net)) : "—"];
                });
                tableRows5.push(["", "GRAND TOTAL", "", fmt(grandDr), fmt(grandCr), grandDr >= grandCr ? fmt(grandDr - grandCr) : "—", grandCr > grandDr ? fmt(grandCr - grandDr) : "—"]);
                const stats5 = [
                  { label: "Total Accounts", value: String(tableRows5.length - 1) },
                  { label: "Total Debits", value: fmt(grandDr) },
                  { label: "Total Credits", value: fmt(grandCr) },
                  { label: "Net", value: fmt(Math.abs(grandDr - grandCr)), highlight: Math.abs(grandDr - grandCr) < 0.01 ? "positive" : "negative" },
                ];
                dataQueryResult = {
                  queryType: "trial_balance",
                  title: "Trial Balance",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats5,
                  table: { headers: ["Code", "Account", "Type", "Debit", "Credit", "Dr Balance", "Cr Balance"], rows: tableRows5 },
                  noData: tableRows5.length <= 1,
                };
                break;
              }

              case "purchase_order_detail": {
                const poNum = params.containerNumber || params.entityName;
                if (!poNum) {
                  dataQueryResult = { queryType: "purchase_order_detail", title: "Purchase Order Detail", summary: "Please specify a PO number." };
                  break;
                }
                const poRow = await db.execute(sql`
                  SELECT po.id, po.po_number, po.currency, po.status,
                    s.legal_name AS supplier, c.container_number,
                    CAST(po.items_total AS numeric) AS items_total,
                    CAST(po.freight AS numeric) AS freight,
                    CAST(po.surcharge AS numeric) AS surcharge,
                    CAST(po.fumigation AS numeric) AS fumigation,
                    CAST(po.document_charges AS numeric) AS doc_charges,
                    CAST(po.other_charges AS numeric) AS other_charges,
                    CAST(po.discount AS numeric) AS discount
                  FROM purchase_orders po
                  JOIN suppliers s ON s.id = po.supplier_id
                  JOIN containers c ON c.id = po.container_id
                  WHERE po.company_id = ${companyId}
                    AND po.po_number ILIKE ${'%' + poNum + '%'}
                  ORDER BY po.created_at DESC LIMIT 1
                `);
                if (!poRow.rows.length) {
                  dataQueryResult = { queryType: "purchase_order_detail", title: "Purchase Order Detail", summary: `No PO found matching "${poNum}".` };
                  break;
                }
                const po5 = poRow.rows[0] as any;
                const lineRows = await db.execute(sql`
                  SELECT pli.item_name, si.code, si.uom,
                    CAST(pli.quantity AS numeric) AS qty,
                    CAST(pli.rate AS numeric) AS rate,
                    CAST(pli.line_total AS numeric) AS line_total
                  FROM po_line_items pli
                  JOIN stock_items si ON si.id = pli.stock_item_id
                  WHERE pli.po_id = ${po5.id}
                  ORDER BY pli.id
                `);
                let lineTotal = 0;
                const tableRows5 = (lineRows.rows as any[]).map(r => {
                  const lt = parseFloat(r.line_total || "0");
                  lineTotal += lt;
                  return [r.item_name, r.code, `${fmtDec(parseFloat(r.qty))} ${r.uom}`, fmtDec(parseFloat(r.rate)), fmt(lt)];
                });
                const charges = [
                  ["Freight", fmt(parseFloat(po5.freight || "0"))],
                  ["Surcharge", fmt(parseFloat(po5.surcharge || "0"))],
                  ["Fumigation", fmt(parseFloat(po5.fumigation || "0"))],
                  ["Document Charges", fmt(parseFloat(po5.doc_charges || "0"))],
                  ["Other Charges", fmt(parseFloat(po5.other_charges || "0"))],
                  ["Discount", `(${fmt(parseFloat(po5.discount || "0"))})`],
                ].filter(([, v]) => v !== fmt(0) && v !== `(${fmt(0)})`);
                const grandPO = parseFloat(po5.items_total || "0") + parseFloat(po5.freight || "0") + parseFloat(po5.surcharge || "0") + parseFloat(po5.fumigation || "0") + parseFloat(po5.doc_charges || "0") + parseFloat(po5.other_charges || "0") - parseFloat(po5.discount || "0");
                const stats5 = [
                  { label: "Supplier", value: po5.supplier },
                  { label: "Container", value: po5.container_number },
                  { label: "Currency", value: po5.currency },
                  { label: "Items Total", value: fmt(parseFloat(po5.items_total || "0")) },
                  { label: "Grand Total", value: fmt(grandPO), highlight: "positive" },
                  { label: "Status", value: po5.status },
                ];
                const chargeRows = charges.map(([label, val]) => [label, "", "", "", val]);
                chargeRows.push(["GRAND TOTAL", "", "", "", fmt(grandPO)]);
                dataQueryResult = {
                  queryType: "purchase_order_detail",
                  title: `PO Detail: ${po5.po_number}`,
                  subtitle: `${tableRows5.length} line item(s)`,
                  stats: stats5,
                  table: { headers: ["Item", "Code", "Qty", "Rate", "Total"], rows: [...tableRows5, ...chargeRows] },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "container_cost_breakdown": {
                const cnFilter5 = params.containerNumber || params.entityName;
                if (!cnFilter5) {
                  dataQueryResult = { queryType: "container_cost_breakdown", title: "Container Cost Breakdown", summary: "Please specify a container number." };
                  break;
                }
                const cRow = await db.execute(sql`
                  SELECT c.container_number, c.status, c.import_date, c.currency,
                    s.legal_name AS supplier,
                    CAST(c.items_total AS numeric) AS items_total,
                    CAST(c.charges_total AS numeric) AS charges_total,
                    CAST(c.grand_total AS numeric) AS grand_total,
                    CAST(c.total_kg AS numeric) AS total_kg,
                    CAST(c.rate_per_kg AS numeric) AS rate_per_kg,
                    CAST(c.transport_fee AS numeric) AS transport_fee,
                    CAST(c.duty_fee AS numeric) AS duty_fee,
                    c.transporter, c.agent
                  FROM containers c
                  JOIN suppliers s ON s.id = c.supplier_id
                  WHERE c.company_id = ${companyId}
                    AND c.container_number ILIKE ${'%' + cnFilter5 + '%'}
                  ORDER BY c.import_date DESC LIMIT 1
                `);
                if (!cRow.rows.length) {
                  dataQueryResult = { queryType: "container_cost_breakdown", title: "Container Cost Breakdown", summary: `No container found matching "${cnFilter5}".` };
                  break;
                }
                const cc = cRow.rows[0] as any;
                const poRows5 = await db.execute(sql`
                  SELECT po.po_number, po.currency,
                    CAST(po.items_total AS numeric) AS items_total,
                    CAST(po.freight AS numeric) AS freight,
                    CAST(po.surcharge AS numeric) AS surcharge,
                    CAST(po.fumigation AS numeric) AS fumigation,
                    CAST(po.document_charges AS numeric) AS doc_charges,
                    CAST(po.other_charges AS numeric) AS other_charges,
                    CAST(po.discount AS numeric) AS discount
                  FROM purchase_orders po
                  JOIN containers c ON c.id = po.container_id
                  WHERE c.container_number ILIKE ${'%' + cnFilter5 + '%'}
                  LIMIT 10
                `);
                const stats5 = [
                  { label: "Supplier", value: cc.supplier },
                  { label: "Status", value: cc.status },
                  { label: "Import Date", value: String(cc.import_date).slice(0, 10) },
                  { label: "Total Kg", value: fmtDec(parseFloat(cc.total_kg || "0")) },
                  { label: "Rate/Kg", value: fmtDec(parseFloat(cc.rate_per_kg || "0")) },
                  { label: "Grand Total", value: fmt(parseFloat(cc.grand_total || "0")), highlight: "positive" },
                ];
                const breakdownRows: string[][] = [
                  ["Items Total", cc.currency, fmt(parseFloat(cc.items_total || "0"))],
                  ["Charges Total", cc.currency, fmt(parseFloat(cc.charges_total || "0"))],
                ];
                if (parseFloat(cc.transport_fee || "0") > 0) breakdownRows.push(["Transport Fee", cc.currency, fmt(parseFloat(cc.transport_fee))]);
                if (parseFloat(cc.duty_fee || "0") > 0) breakdownRows.push(["Duty Fee", cc.currency, fmt(parseFloat(cc.duty_fee))]);
                for (const po of poRows5.rows as any[]) {
                  if (parseFloat(po.freight || "0") > 0) breakdownRows.push([`Freight (${po.po_number})`, po.currency, fmt(parseFloat(po.freight))]);
                  if (parseFloat(po.fumigation || "0") > 0) breakdownRows.push([`Fumigation (${po.po_number})`, po.currency, fmt(parseFloat(po.fumigation))]);
                  if (parseFloat(po.surcharge || "0") > 0) breakdownRows.push([`Surcharge (${po.po_number})`, po.currency, fmt(parseFloat(po.surcharge))]);
                  if (parseFloat(po.doc_charges || "0") > 0) breakdownRows.push([`Doc Charges (${po.po_number})`, po.currency, fmt(parseFloat(po.doc_charges))]);
                  if (parseFloat(po.discount || "0") > 0) breakdownRows.push([`Discount (${po.po_number})`, po.currency, `(${fmt(parseFloat(po.discount))})`]);
                }
                breakdownRows.push(["GRAND TOTAL", cc.currency, fmt(parseFloat(cc.grand_total || "0"))]);
                dataQueryResult = {
                  queryType: "container_cost_breakdown",
                  title: `Cost Breakdown: ${cc.container_number}`,
                  subtitle: cc.transporter ? `Transporter: ${cc.transporter}${cc.agent ? ` · Agent: ${cc.agent}` : ""}` : "",
                  stats: stats5,
                  table: { headers: ["Component", "Currency", "Amount"], rows: breakdownRows },
                  noData: false,
                };
                break;
              }

              case "worker_document_expiry": {
                const daysWindow = 60;
                const futureDoc = new Date(todayDate.getTime() + daysWindow * 86400000).toISOString().slice(0, 10);
                const rows = await db.execute(sql`
                  SELECT fw.full_name, fw.employee_code, fw.nationality,
                    fw.visa_expiry, fw.work_permit_expiry, fw.residential_permit_expiry,
                    fw.visa_number, fw.work_permit_number
                  FROM factory_workers fw
                  WHERE fw.company_id = ${companyId} AND fw.active = true
                    AND (
                      (fw.visa_expiry IS NOT NULL AND fw.visa_expiry <= ${futureDoc})
                      OR (fw.work_permit_expiry IS NOT NULL AND fw.work_permit_expiry <= ${futureDoc})
                      OR (fw.residential_permit_expiry IS NOT NULL AND fw.residential_permit_expiry <= ${futureDoc})
                    )
                  ORDER BY LEAST(
                    COALESCE(fw.visa_expiry, '9999-01-01'),
                    COALESCE(fw.work_permit_expiry, '9999-01-01'),
                    COALESCE(fw.residential_permit_expiry, '9999-01-01')
                  ) ASC
                  LIMIT ${rowLimit}
                `);
                const expired: string[] = [], expiringSoon: string[] = [];
                const tableRows5 = (rows.rows as any[]).map(r => {
                  const visaExp = r.visa_expiry ? String(r.visa_expiry).slice(0, 10) : "—";
                  const wpExp = r.work_permit_expiry ? String(r.work_permit_expiry).slice(0, 10) : "—";
                  const rpExp = r.residential_permit_expiry ? String(r.residential_permit_expiry).slice(0, 10) : "—";
                  const isExpired = (d: string) => d !== "—" && d < todayStr;
                  const label = (d: string) => isExpired(d) ? `${d} ⚠ EXPIRED` : d;
                  if (isExpired(visaExp) || isExpired(wpExp) || isExpired(rpExp)) expired.push(r.full_name);
                  return [r.full_name, r.employee_code || "—", r.nationality || "—", label(visaExp), label(wpExp), label(rpExp)];
                });
                const stats5 = [
                  { label: "Workers With Expiring Docs", value: String(tableRows5.length) },
                  { label: "Already Expired", value: String(expired.length), highlight: expired.length > 0 ? "negative" : undefined },
                  { label: "Window", value: `Next ${daysWindow} days` },
                ];
                dataQueryResult = {
                  queryType: "worker_document_expiry",
                  title: "Worker Document Expiry Alert",
                  subtitle: `Expiring within ${daysWindow} days (as of ${todayStr})`,
                  stats: stats5,
                  table: { headers: ["Worker", "Code", "Nationality", "Visa Expiry", "Work Permit", "Residential Permit"], rows: tableRows5 },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "stock_transfers": {
                const locFilter5 = params.locationName || params.entityName;
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_number,
                    sl.name AS from_location, dl.name AS to_location,
                    si.name AS item_name, si.code,
                    CAST(sti.quantity AS numeric) AS qty, si.uom,
                    CAST(sti.rate AS numeric) AS rate,
                    CAST(sti.total_amount AS numeric) AS total_amount,
                    stv.notes
                  FROM stock_transfer_items sti
                  JOIN stock_transfer_vouchers stv ON stv.id = sti.transfer_id
                  JOIN vouchers v ON v.id = stv.voucher_id AND v.deleted_at IS NULL
                  JOIN stock_items si ON si.id = sti.stock_item_id
                  LEFT JOIN locations sl ON sl.id = sti.source_location_id
                  JOIN locations dl ON dl.id = stv.destination_location_id
                  WHERE si.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${locFilter5 ? sql`AND (sl.name ILIKE ${'%' + locFilter5 + '%'} OR dl.name ILIKE ${'%' + locFilter5 + '%'})` : sql``}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalTransferred = 0;
                const tableRows5 = (rows.rows as any[]).map(r => {
                  const amt = parseFloat(r.total_amount || "0");
                  totalTransferred += amt;
                  return [String(r.voucher_date).slice(0, 10), r.voucher_number, r.item_name, `${fmtDec(parseFloat(r.qty))} ${r.uom}`, r.from_location || "—", r.to_location, fmt(amt)];
                });
                dataQueryResult = {
                  queryType: "stock_transfers",
                  title: locFilter5 ? `Stock Transfers: ${locFilter5}` : "Stock Transfers",
                  subtitle: `${dateFrom} → ${dateTo} · Total value transferred: ${fmt(totalTransferred)}`,
                  table: { headers: ["Date", "Voucher #", "Item", "Qty", "From", "To", "Value"], rows: tableRows5 },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "cash_flow_summary": {
                const rows = await db.execute(sql`
                  SELECT la.name AS account_name, la.account_type,
                    COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) AS total_in,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_out,
                    COUNT(DISTINCT v.id) AS tx_count
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  JOIN ledger_accounts la ON la.id = ve.ledger_account_id
                    AND la.account_type IN ('Bank', 'Cash')
                  WHERE la.company_id = ${companyId}
                  GROUP BY la.id, la.name, la.account_type
                  ORDER BY total_in DESC
                `);
                let grandIn = 0, grandOut = 0;
                const tableRows5 = (rows.rows as any[]).map(r => {
                  const inflow = parseFloat(r.total_in || "0");
                  const outflow = parseFloat(r.total_out || "0");
                  const net = inflow - outflow;
                  grandIn += inflow; grandOut += outflow;
                  return [r.account_name, r.account_type, fmt(inflow), fmt(outflow), net >= 0 ? fmt(net) : `(${fmt(Math.abs(net))})`, String(r.tx_count)];
                });
                tableRows5.push(["TOTAL", "", fmt(grandIn), fmt(grandOut), grandIn >= grandOut ? fmt(grandIn - grandOut) : `(${fmt(grandOut - grandIn)})`, ""]);
                const stats5 = [
                  { label: "Total Cash In", value: fmt(grandIn), highlight: "positive" },
                  { label: "Total Cash Out", value: fmt(grandOut) },
                  { label: "Net Position", value: grandIn >= grandOut ? fmt(grandIn - grandOut) : `(${fmt(grandOut - grandIn)})`, highlight: grandIn >= grandOut ? "positive" : "negative" },
                ];
                dataQueryResult = {
                  queryType: "cash_flow_summary",
                  title: "Cash Flow Summary",
                  subtitle: `${dateFrom} → ${dateTo} · Bank & Cash accounts`,
                  stats: stats5,
                  table: { headers: ["Account", "Type", "Inflow (Dr)", "Outflow (Cr)", "Net", "Transactions"], rows: tableRows5 },
                  noData: tableRows5.length <= 1,
                };
                break;
              }

              case "ledger_account_balance": {
                const acctName5 = params.entityName || params.locationName;
                if (!acctName5) {
                  dataQueryResult = { queryType: "ledger_account_balance", title: "Ledger Account Balance", summary: "Please specify an account name." };
                  break;
                }
                const acctRow5 = await db.execute(sql`
                  SELECT id, name, account_type, code,
                    CAST(opening_balance AS numeric) AS opening_balance, opening_balance_side
                  FROM ledger_accounts
                  WHERE company_id = ${companyId} AND deleted_at IS NULL
                    AND name ILIKE ${'%' + acctName5 + '%'}
                  ORDER BY name LIMIT 1
                `);
                if (!acctRow5.rows.length) {
                  dataQueryResult = { queryType: "ledger_account_balance", title: "Ledger Account Balance", summary: `No account found matching "${acctName5}".` };
                  break;
                }
                const la5 = acctRow5.rows[0] as any;
                const txRows5 = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_type, v.voucher_number, v.description,
                    CAST(ve.debit_amount AS numeric) AS dr,
                    CAST(ve.credit_amount AS numeric) AS cr
                  FROM voucher_entries ve
                  JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  WHERE ve.ledger_account_id = ${la5.id}
                  ORDER BY v.voucher_date, v.id
                  LIMIT ${rowLimit}
                `);
                const ob = parseFloat(la5.opening_balance || "0") * (la5.opening_balance_side === "Cr" ? -1 : 1);
                let runningBal = ob;
                let totalDr = 0, totalCr = 0;
                const tableRows5 = (txRows5.rows as any[]).map(r => {
                  const dr = parseFloat(r.dr || "0");
                  const cr = parseFloat(r.cr || "0");
                  runningBal += dr - cr;
                  totalDr += dr; totalCr += cr;
                  return [String(r.voucher_date).slice(0, 10), r.voucher_number, r.voucher_type, (r.description || "").slice(0, 35), dr > 0 ? fmt(dr) : "—", cr > 0 ? fmt(cr) : "—", fmt(Math.abs(runningBal)) + (runningBal >= 0 ? " Dr" : " Cr")];
                });
                const stats5 = [
                  { label: "Account", value: `${la5.code ? la5.code + " — " : ""}${la5.name}` },
                  { label: "Type", value: la5.account_type },
                  { label: "Total Debit", value: fmt(totalDr) },
                  { label: "Total Credit", value: fmt(totalCr) },
                  { label: "Closing Balance", value: fmt(Math.abs(runningBal)) + (runningBal >= 0 ? " Dr" : " Cr"), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "ledger_account_balance",
                  title: `Ledger: ${la5.name}`,
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats5,
                  table: { headers: ["Date", "Voucher #", "Type", "Description", "Dr", "Cr", "Balance"], rows: tableRows5 },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "daily_report": {
                const reportDate = params.dateFrom || todayStr;
                const rows = await db.execute(sql`
                  SELECT v.voucher_number, v.voucher_type, v.description,
                    CAST(v.total_amount AS numeric) AS amount,
                    v.currency, l.name AS location
                  FROM vouchers v
                  LEFT JOIN locations l ON l.id = v.location_id
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.optional = false
                    AND CAST(v.voucher_date AS text) = ${reportDate}
                  ORDER BY v.voucher_type, v.voucher_number
                  LIMIT ${rowLimit}
                `);
                const typeMap5: Record<string, number> = {};
                let grandAmt = 0;
                const tableRows5 = (rows.rows as any[]).map(r => {
                  const amt = parseFloat(r.amount || "0");
                  typeMap5[r.voucher_type] = (typeMap5[r.voucher_type] || 0) + amt;
                  grandAmt += amt;
                  return [r.voucher_number, r.voucher_type, (r.description || "").slice(0, 40), r.location || "—", fmt(amt), r.currency];
                });
                const stats5 = [
                  { label: "Date", value: reportDate },
                  { label: "Total Vouchers", value: String(tableRows5.length) },
                  { label: "Grand Total", value: fmt(grandAmt), highlight: "positive" },
                  ...Object.entries(typeMap5).map(([t, a]) => ({ label: t, value: fmt(a) })),
                ];
                dataQueryResult = {
                  queryType: "daily_report",
                  title: `Daily Report: ${reportDate}`,
                  subtitle: `${tableRows5.length} voucher(s) · Total: ${fmt(grandAmt)}`,
                  stats: stats5,
                  table: { headers: ["Voucher #", "Type", "Description", "Location", "Amount", "Currency"], rows: tableRows5 },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "profit_by_location": {
                const rows = await db.execute(sql`
                  SELECT COALESCE(l.name, v.location_name, 'Unassigned') AS location,
                    COUNT(DISTINCT v.id) AS sales_count,
                    SUM(CAST(sal.total_sales AS numeric)) AS total_revenue,
                    SUM(CAST(sal.total_cost AS numeric)) AS total_cost,
                    SUM(CAST(sal.profit AS numeric)) AS total_profit
                  FROM sales_items sal
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  LEFT JOIN locations l ON l.id = v.location_id
                  WHERE v.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY l.id, l.name, v.location_name
                  ORDER BY total_profit DESC
                  LIMIT ${rowLimit}
                `);
                let grandRev = 0, grandCost = 0, grandProfit = 0;
                const tableRows5 = (rows.rows as any[]).map(r => {
                  const rev = parseFloat(r.total_revenue || "0");
                  const cost = parseFloat(r.total_cost || "0");
                  const profit5 = parseFloat(r.total_profit || "0");
                  const margin = rev > 0 ? ((profit5 / rev) * 100).toFixed(1) + "%" : "—";
                  grandRev += rev; grandCost += cost; grandProfit += profit5;
                  return [r.location, String(r.sales_count), fmt(rev), fmt(cost), fmt(profit5), margin];
                });
                if (tableRows5.length) {
                  const totMargin = grandRev > 0 ? ((grandProfit / grandRev) * 100).toFixed(1) + "%" : "—";
                  tableRows5.push(["TOTAL", "", fmt(grandRev), fmt(grandCost), fmt(grandProfit), totMargin]);
                }
                const best = tableRows5.length > 1 ? tableRows5[0] : null;
                const stats5 = [
                  { label: "Total Revenue", value: fmt(grandRev) },
                  { label: "Total Cost", value: fmt(grandCost) },
                  { label: "Total Profit", value: fmt(grandProfit), highlight: "positive" },
                  ...(best ? [{ label: "Best Location", value: best[0] as string }] : []),
                ];
                dataQueryResult = {
                  queryType: "profit_by_location",
                  title: "Profit by Location",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats5,
                  table: { headers: ["Location", "Sales", "Revenue", "Cost", "Profit", "Margin"], rows: tableRows5 },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              case "debit_note_summary": {
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_number, v.description,
                    CAST(v.total_amount AS numeric) AS amount, v.currency
                  FROM vouchers v
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.voucher_type = 'Debit Note'
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalDN = 0;
                const tableRows5 = (rows.rows as any[]).map(r => {
                  const amt = parseFloat(r.amount || "0");
                  totalDN += amt;
                  return [String(r.voucher_date).slice(0, 10), r.voucher_number, (r.description || "").slice(0, 50), fmt(amt), r.currency];
                });
                const stats5 = [
                  { label: "Debit Notes Issued", value: String(tableRows5.length) },
                  { label: "Total Amount", value: fmt(totalDN), highlight: "negative" },
                ];
                dataQueryResult = {
                  queryType: "debit_note_summary",
                  title: "Debit Notes",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats5,
                  table: { headers: ["Date", "Voucher #", "Description", "Amount", "Currency"], rows: tableRows5 },
                  noData: tableRows5.length === 0,
                };
                break;
              }

              // ── Phase 6 Cases ────────────────────────────────────────────────

              case "customer_list": {
                const nameFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT c.code, c.legal_name, c.phone, c.payment_terms_days, c.active,
                    COALESCE(
                      CAST(c.opening_balance AS numeric) * CASE WHEN c.opening_balance_side = 'Dr' THEN 1 ELSE -1 END
                      + COALESCE(SUM(CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric)), 0),
                      CAST(c.opening_balance AS numeric) * CASE WHEN c.opening_balance_side = 'Dr' THEN 1 ELSE -1 END
                    ) AS net_balance
                  FROM customers c
                  LEFT JOIN ledger_accounts la ON la.id = c.ledger_account_id AND la.deleted_at IS NULL
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id AND v.deleted_at IS NULL AND v.optional = false
                  WHERE c.company_id = ${companyId}
                    AND c.deleted_at IS NULL
                    ${nameFilter6 ? sql`AND c.legal_name ILIKE ${'%' + nameFilter6 + '%'}` : sql``}
                  GROUP BY c.id, c.code, c.legal_name, c.phone, c.payment_terms_days, c.active, c.opening_balance, c.opening_balance_side
                  ORDER BY c.legal_name
                  LIMIT ${rowLimit}
                `);
                let totalBalance = 0;
                const tableRows6 = (rows.rows as any[]).map(r => {
                  const bal = parseFloat(r.net_balance || "0");
                  totalBalance += Math.max(bal, 0);
                  const balLabel = bal >= 0 ? fmt(bal) + " Dr" : fmt(Math.abs(bal)) + " Cr";
                  return [r.code, r.legal_name, r.phone || "—", r.payment_terms_days ? `${r.payment_terms_days}d` : "—", balLabel, r.active ? "Active" : "Inactive"];
                });
                const stats6 = [
                  { label: "Total Customers", value: String(tableRows6.length) },
                  { label: "Total Outstanding (Dr)", value: fmt(totalBalance), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "customer_list",
                  title: nameFilter6 ? `Customers: ${nameFilter6}` : "Customer List",
                  subtitle: `${tableRows6.length} customer(s)`,
                  stats: stats6,
                  table: { headers: ["Code", "Name", "Phone", "Terms", "Balance", "Status"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "supplier_list": {
                const nameFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT s.code, s.legal_name, s.email, s.phone, s.payment_terms, s.active,
                    COUNT(DISTINCT po.id) AS po_count,
                    COALESCE(SUM(CAST(po.items_total AS numeric)), 0) AS total_ordered
                  FROM suppliers s
                  JOIN purchase_orders po ON po.supplier_id = s.id AND po.company_id = ${companyId}
                  WHERE s.deleted_at IS NULL
                    ${nameFilter6 ? sql`AND s.legal_name ILIKE ${'%' + nameFilter6 + '%'}` : sql``}
                  GROUP BY s.id, s.code, s.legal_name, s.email, s.phone, s.payment_terms, s.active
                  ORDER BY total_ordered DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows6 = (rows.rows as any[]).map(r => [
                  r.code || "—",
                  r.legal_name,
                  r.email || "—",
                  r.phone || "—",
                  r.payment_terms || "—",
                  String(r.po_count),
                  fmt(parseFloat(r.total_ordered || "0")),
                  r.active ? "Active" : "Inactive",
                ]);
                const stats6 = [
                  { label: "Suppliers", value: String(tableRows6.length) },
                  { label: "Total POs", value: String(tableRows6.reduce((s, r) => s + parseInt(r[5]), 0)) },
                ];
                dataQueryResult = {
                  queryType: "supplier_list",
                  title: nameFilter6 ? `Suppliers: ${nameFilter6}` : "Supplier List",
                  subtitle: `${tableRows6.length} supplier(s) · ranked by total ordered`,
                  stats: stats6,
                  table: { headers: ["Code", "Name", "Email", "Phone", "Terms", "POs", "Total Ordered", "Status"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "stock_item_detail": {
                const itemName6 = params.entityName;
                if (!itemName6) {
                  dataQueryResult = { queryType: "stock_item_detail", title: "Stock Item Detail", summary: "Please specify an item name." };
                  break;
                }
                const itemRow = await db.execute(sql`
                  SELECT si.id, si.code, si.name, si.uom, si.selling_price, si.reorder_level,
                    si.opening_qty, si.opening_rate, si.opening_value, si.active,
                    sg.name AS group_name
                  FROM stock_items si
                  LEFT JOIN stock_groups sg ON sg.id = si.stock_group_id
                  WHERE si.company_id = ${companyId}
                    AND si.deleted_at IS NULL
                    AND si.name ILIKE ${'%' + itemName6 + '%'}
                  ORDER BY si.name LIMIT 1
                `);
                if (!itemRow.rows.length) {
                  dataQueryResult = { queryType: "stock_item_detail", title: "Stock Item Detail", summary: `No item found matching "${itemName6}".` };
                  break;
                }
                const si6 = itemRow.rows[0] as any;
                const invRows = await db.execute(sql`
                  SELECT l.name AS location,
                    CAST(inv.quantity AS numeric) AS qty,
                    CAST(inv.avg_rate AS numeric) AS avg_rate,
                    CAST(inv.total_value AS numeric) AS total_value
                  FROM inventory inv
                  JOIN locations l ON l.id = inv.location_id
                  WHERE inv.stock_item_id = ${si6.id}
                    AND inv.company_id = ${companyId}
                    AND inv.quantity > 0
                  ORDER BY inv.quantity DESC
                `);
                let totalQty = 0, totalVal = 0;
                const tableRows6 = (invRows.rows as any[]).map(r => {
                  const qty = parseFloat(r.qty || "0");
                  const val = parseFloat(r.total_value || "0");
                  totalQty += qty; totalVal += val;
                  return [r.location, fmtDec(qty), fmtDec(parseFloat(r.avg_rate || "0")), fmt(val)];
                });
                const stats6 = [
                  { label: "Code", value: si6.code },
                  { label: "Group", value: si6.group_name || "—" },
                  { label: "UOM", value: si6.uom },
                  { label: "Selling Price", value: fmtDec(parseFloat(si6.selling_price || "0")) },
                  { label: "Reorder Level", value: `${fmtDec(parseFloat(si6.reorder_level || "0"))} ${si6.uom}` },
                  { label: "Total Stock", value: `${fmtDec(totalQty)} ${si6.uom}`, highlight: totalQty > 0 ? "positive" : "negative" },
                  { label: "Total Value", value: fmt(totalVal), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "stock_item_detail",
                  title: `Item: ${si6.name}`,
                  subtitle: `${tableRows6.length} location(s) with stock`,
                  stats: stats6,
                  table: { headers: ["Location", "Qty", "Avg Rate", "Value"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "factory_mix_batches": {
                const statusFilter6 = params.entityName?.toUpperCase() || null;
                const rows = await db.execute(sql`
                  SELECT fmb.batch_code, fmb.name, fmb.batch_date, fmb.status,
                    CAST(fmb.total_weight_kg AS numeric) AS total_kg,
                    CAST(fmb.used_kg AS numeric) AS used_kg,
                    CAST(fmb.cost_per_kg AS numeric) AS cost_per_kg,
                    CAST(fmb.total_cost AS numeric) AS total_cost,
                    fmb.operator_user
                  FROM factory_mix_batches fmb
                  WHERE fmb.company_id = ${companyId}
                    AND fmb.deleted_at IS NULL
                    ${statusFilter6 ? sql`AND fmb.status = ${statusFilter6}` : sql``}
                    ${params.dateFrom ? sql`AND fmb.batch_date >= ${params.dateFrom}` : sql``}
                  ORDER BY fmb.batch_date DESC, fmb.id DESC
                  LIMIT ${rowLimit}
                `);
                let totWeight = 0, totUsed = 0, totCost = 0;
                const tableRows6 = (rows.rows as any[]).map(r => {
                  const totalKg = parseFloat(r.total_kg || "0");
                  const usedKg = parseFloat(r.used_kg || "0");
                  const remainKg = totalKg - usedKg;
                  const pct = totalKg > 0 ? ((usedKg / totalKg) * 100).toFixed(1) + "%" : "—";
                  totWeight += totalKg; totUsed += usedKg; totCost += parseFloat(r.total_cost || "0");
                  return [r.batch_code, r.name || "—", r.batch_date ? String(r.batch_date).slice(0, 10) : "—", r.status, fmtDec(totalKg), fmtDec(usedKg), fmtDec(remainKg), pct, fmtDec(parseFloat(r.cost_per_kg || "0")), r.operator_user || "—"];
                });
                const stats6 = [
                  { label: "Batches", value: String(tableRows6.length) },
                  { label: "Total Weight Kg", value: fmtDec(totWeight) },
                  { label: "Used Kg", value: fmtDec(totUsed) },
                  { label: "Remaining Kg", value: fmtDec(totWeight - totUsed), highlight: "positive" },
                  { label: "Total Cost", value: fmt(totCost) },
                ];
                dataQueryResult = {
                  queryType: "factory_mix_batches",
                  title: statusFilter6 ? `Mix Batches — ${statusFilter6}` : "Factory Mix Batches",
                  subtitle: `${tableRows6.length} batch(es)`,
                  stats: stats6,
                  table: { headers: ["Code", "Name", "Date", "Status", "Total Kg", "Used Kg", "Remaining", "Usage%", "Cost/Kg", "Operator"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "customer_proformas": {
                const custFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT cp.id, cp.name AS proforma_name, cu.legal_name AS customer,
                    cp.is_active, cp.created_at,
                    COUNT(cpl.id) AS line_count,
                    COALESCE(SUM(cpl.quantity), 0) AS total_qty,
                    COALESCE(SUM(CAST(cpl.price_per_bale AS numeric) * cpl.quantity), 0) AS total_value
                  FROM customer_proformas cp
                  JOIN customers cu ON cu.id = cp.customer_id
                  LEFT JOIN customer_proforma_lines cpl ON cpl.proforma_id = cp.id
                  WHERE cp.company_id = ${companyId}
                    AND cp.deleted_at IS NULL
                    ${custFilter6 ? sql`AND cu.legal_name ILIKE ${'%' + custFilter6 + '%'}` : sql``}
                  GROUP BY cp.id, cp.name, cu.legal_name, cp.is_active, cp.created_at
                  ORDER BY cp.is_active DESC, cu.legal_name
                  LIMIT ${rowLimit}
                `);
                const tableRows6 = (rows.rows as any[]).map(r => [
                  r.proforma_name,
                  r.customer,
                  String(r.line_count),
                  String(r.total_qty),
                  fmt(parseFloat(r.total_value || "0")),
                  r.is_active ? "Active" : "Inactive",
                  String(r.created_at).slice(0, 10),
                ]);
                dataQueryResult = {
                  queryType: "customer_proformas",
                  title: custFilter6 ? `Customer Proformas: ${custFilter6}` : "Customer Proformas",
                  subtitle: `${tableRows6.length} proforma(s)`,
                  table: { headers: ["Proforma", "Customer", "Items", "Total Qty", "Total Value", "Status", "Created"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "supplier_proformas": {
                const suppFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT sp.id, sp.reference, s.legal_name AS supplier, sp.notes, sp.created_at,
                    COUNT(spl.id) AS line_count,
                    COALESCE(SUM(spl.qty), 0) AS total_qty,
                    COALESCE(SUM(CAST(spl.price_per_bale AS numeric) * spl.qty), 0) AS total_value
                  FROM supplier_proformas sp
                  JOIN suppliers s ON s.id = sp.supplier_id
                  LEFT JOIN supplier_proforma_lines spl ON spl.proforma_id = sp.id
                  WHERE sp.company_id = ${companyId}
                    ${suppFilter6 ? sql`AND s.legal_name ILIKE ${'%' + suppFilter6 + '%'}` : sql``}
                  GROUP BY sp.id, sp.reference, s.legal_name, sp.notes, sp.created_at
                  ORDER BY sp.created_at DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows6 = (rows.rows as any[]).map(r => [
                  r.reference,
                  r.supplier,
                  String(r.line_count),
                  String(r.total_qty),
                  fmt(parseFloat(r.total_value || "0")),
                  String(r.created_at).slice(0, 10),
                  (r.notes || "").slice(0, 40),
                ]);
                dataQueryResult = {
                  queryType: "supplier_proformas",
                  title: suppFilter6 ? `Supplier Proformas: ${suppFilter6}` : "Supplier Proformas",
                  subtitle: `${tableRows6.length} proforma(s)`,
                  table: { headers: ["Reference", "Supplier", "Items", "Total Qty", "Total Value", "Date", "Notes"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "weekly_sales": {
                const rows = await db.execute(sql`
                  SELECT DATE_TRUNC('week', CAST(v.voucher_date AS date)) AS week_start,
                    COUNT(DISTINCT v.id) AS sales_count,
                    SUM(CAST(sal.total_sales AS numeric)) AS revenue,
                    SUM(CAST(sal.total_cost AS numeric)) AS cost,
                    SUM(CAST(sal.profit AS numeric)) AS profit
                  FROM sales_items sal
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  WHERE v.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY week_start
                  ORDER BY week_start DESC
                  LIMIT ${rowLimit}
                `);
                let totRev = 0, totCost = 0, totProfit = 0;
                const tableRows6 = (rows.rows as any[]).map(r => {
                  const rev = parseFloat(r.revenue || "0");
                  const cost = parseFloat(r.cost || "0");
                  const profit6 = parseFloat(r.profit || "0");
                  const margin = rev > 0 ? ((profit6 / rev) * 100).toFixed(1) + "%" : "—";
                  totRev += rev; totCost += cost; totProfit += profit6;
                  const ws = String(r.week_start).slice(0, 10);
                  return [ws, String(r.sales_count), fmt(rev), fmt(cost), fmt(profit6), margin];
                });
                if (tableRows6.length) {
                  const totMargin = totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) + "%" : "—";
                  tableRows6.push(["TOTAL", "", fmt(totRev), fmt(totCost), fmt(totProfit), totMargin]);
                }
                dataQueryResult = {
                  queryType: "weekly_sales",
                  title: "Weekly Sales Breakdown",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  table: { headers: ["Week Starting", "Invoices", "Revenue", "Cost", "Profit", "Margin"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "container_items_list": {
                const cn6 = params.containerNumber || params.entityName;
                if (!cn6) {
                  dataQueryResult = { queryType: "container_items_list", title: "Container Items", summary: "Please specify a container number." };
                  break;
                }
                const rows = await db.execute(sql`
                  SELECT c.container_number, s.legal_name AS supplier, c.import_date,
                    pli.item_name, si.code, si.uom,
                    CAST(pli.quantity AS numeric) AS qty,
                    CAST(pli.rate AS numeric) AS rate,
                    CAST(pli.line_total AS numeric) AS line_total,
                    po.po_number, po.currency
                  FROM po_line_items pli
                  JOIN purchase_orders po ON po.id = pli.po_id
                  JOIN containers c ON c.id = po.container_id
                  JOIN suppliers s ON s.id = c.supplier_id
                  JOIN stock_items si ON si.id = pli.stock_item_id
                  WHERE c.container_number ILIKE ${'%' + cn6 + '%'}
                    AND po.company_id = ${companyId}
                  ORDER BY pli.item_name
                  LIMIT ${rowLimit}
                `);
                let grandItems = 0;
                const tableRows6 = (rows.rows as any[]).map(r => {
                  const lt = parseFloat(r.line_total || "0");
                  grandItems += lt;
                  return [r.item_name, r.code, `${fmtDec(parseFloat(r.qty))} ${r.uom}`, fmtDec(parseFloat(r.rate)), fmt(lt), r.po_number, r.currency];
                });
                const hdr = rows.rows[0] as any;
                tableRows6.push(["TOTAL", "", "", "", fmt(grandItems), "", ""]);
                dataQueryResult = {
                  queryType: "container_items_list",
                  title: `Items in Container: ${hdr?.container_number || cn6}`,
                  subtitle: hdr ? `Supplier: ${hdr.supplier} · Import: ${String(hdr.import_date).slice(0, 10)}` : "",
                  table: { headers: ["Item", "Code", "Qty", "Rate", "Total", "PO #", "Currency"], rows: tableRows6 },
                  noData: tableRows6.length <= 1,
                };
                break;
              }

              case "employee_list": {
                const deptFilter6 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT e.code, e.first_name, e.last_name, e.department, e.employee_type,
                    CAST(e.monthly_salary AS numeric) AS monthly_salary,
                    CAST(e.current_balance AS numeric) AS current_balance,
                    e.join_date, e.active
                  FROM employees e
                  WHERE e.company_id = ${companyId}
                    AND e.active = true
                    AND e.deleted_at IS NULL
                    ${deptFilter6 ? sql`AND e.department ILIKE ${'%' + deptFilter6 + '%'}` : sql``}
                  ORDER BY e.department, e.first_name, e.last_name
                  LIMIT ${rowLimit}
                `);
                let totalSalary = 0, totalBalance = 0;
                const tableRows6 = (rows.rows as any[]).map(r => {
                  const sal = parseFloat(r.monthly_salary || "0");
                  const bal = parseFloat(r.current_balance || "0");
                  totalSalary += sal; totalBalance += bal;
                  return [r.code || "—", `${r.first_name} ${r.last_name}`, r.department || "—", r.employee_type, fmt(sal), fmt(bal), r.join_date ? String(r.join_date).slice(0, 10) : "—"];
                });
                const stats6 = [
                  { label: "Total Employees", value: String(tableRows6.length) },
                  { label: "Total Monthly Salary", value: fmt(totalSalary), highlight: "positive" },
                  { label: "Total Outstanding Balance", value: fmt(totalBalance) },
                ];
                dataQueryResult = {
                  queryType: "employee_list",
                  title: deptFilter6 ? `Employees — ${deptFilter6}` : "Employee Roster",
                  subtitle: `${tableRows6.length} active employee(s)`,
                  stats: stats6,
                  table: { headers: ["Code", "Name", "Dept", "Type", "Monthly Salary", "Balance", "Join Date"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              case "journal_entries": {
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_number, v.description,
                    CAST(v.total_amount AS numeric) AS total_amount,
                    v.currency,
                    json_agg(json_build_object(
                      'account', la.name,
                      'dr', CAST(ve.debit_amount AS numeric),
                      'cr', CAST(ve.credit_amount AS numeric)
                    ) ORDER BY ve.id) AS entries
                  FROM vouchers v
                  JOIN voucher_entries ve ON ve.voucher_id = v.id
                  JOIN ledger_accounts la ON la.id = ve.ledger_account_id
                  WHERE v.company_id = ${companyId}
                    AND v.deleted_at IS NULL
                    AND v.voucher_type = 'Journal'
                    AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  GROUP BY v.id, v.voucher_date, v.voucher_number, v.description, v.total_amount, v.currency
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows6: string[][] = [];
                for (const r of rows.rows as any[]) {
                  const entries = typeof r.entries === "string" ? JSON.parse(r.entries) : r.entries;
                  const firstEntry = entries?.[0];
                  tableRows6.push([String(r.voucher_date).slice(0, 10), r.voucher_number, (r.description || "").slice(0, 35), firstEntry?.account || "—", firstEntry?.dr > 0 ? fmt(firstEntry.dr) : "—", firstEntry?.cr > 0 ? fmt(firstEntry.cr) : "—", r.currency]);
                  for (let i = 1; i < (entries || []).length && i < 4; i++) {
                    const e = entries[i];
                    tableRows6.push(["", "", "", e.account, e.dr > 0 ? fmt(e.dr) : "—", e.cr > 0 ? fmt(e.cr) : "—", ""]);
                  }
                }
                dataQueryResult = {
                  queryType: "journal_entries",
                  title: "Journal Entries",
                  subtitle: `${dateFrom} → ${dateTo} · ${rows.rows.length} journal(s)`,
                  table: { headers: ["Date", "Voucher #", "Description", "Account", "Dr", "Cr", "Currency"], rows: tableRows6 },
                  noData: tableRows6.length === 0,
                };
                break;
              }

              // ── Phase 7 Cases ────────────────────────────────────────────────

              case "audit_trail": {
                const tableFilter7 = params.entityName;
                const rows = await db.execute(sql`
                  SELECT al.username, al.action, al.table_name, al.record_identifier,
                    al.created_at
                  FROM audit_log al
                  WHERE al.company_id = ${companyId}
                    AND al.created_at >= ${dateFrom}
                    ${tableFilter7 ? sql`AND (al.table_name ILIKE ${'%' + tableFilter7 + '%'} OR al.record_identifier ILIKE ${'%' + tableFilter7 + '%'})` : sql``}
                  ORDER BY al.created_at DESC
                  LIMIT ${rowLimit}
                `);
                const actionMap: Record<string, number> = {};
                const tableRows7 = (rows.rows as any[]).map(r => {
                  actionMap[r.action] = (actionMap[r.action] || 0) + 1;
                  return [String(r.created_at).slice(0, 16), r.username, r.action, r.table_name, r.record_identifier || "—"];
                });
                const stats7 = [
                  { label: "Total Events", value: String(tableRows7.length) },
                  ...Object.entries(actionMap).map(([a, c]) => ({ label: a.charAt(0).toUpperCase() + a.slice(1) + "s", value: String(c) })),
                ];
                dataQueryResult = {
                  queryType: "audit_trail",
                  title: tableFilter7 ? `Audit Trail: ${tableFilter7}` : "Audit Trail",
                  subtitle: `Since ${dateFrom} · most recent first`,
                  stats: stats7,
                  table: { headers: ["Timestamp", "User", "Action", "Table", "Record"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "bank_account_list": {
                const rows = await db.execute(sql`
                  SELECT ba.code, ba.name, ba.bank_name, ba.account_number,
                    CAST(ba.opening_balance AS numeric) AS opening_balance,
                    ba.opening_balance_side, ba.active,
                    COALESCE(SUM(CAST(ve.debit_amount AS numeric)), 0) AS total_dr,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_cr
                  FROM bank_accounts ba
                  LEFT JOIN voucher_entries ve ON ve.ledger_account_id = ba.linked_ledger_id
                  LEFT JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                  WHERE ba.company_id = ${companyId}
                    AND ba.deleted_at IS NULL
                  GROUP BY ba.id, ba.code, ba.name, ba.bank_name, ba.account_number,
                    ba.opening_balance, ba.opening_balance_side, ba.active
                  ORDER BY ba.name
                `);
                let grandBalance = 0;
                const tableRows7 = (rows.rows as any[]).map(r => {
                  const ob = parseFloat(r.opening_balance || "0") * (r.opening_balance_side === "Cr" ? -1 : 1);
                  const dr = parseFloat(r.total_dr || "0");
                  const cr = parseFloat(r.total_cr || "0");
                  const balance = ob + dr - cr;
                  grandBalance += balance;
                  const balLabel = balance >= 0 ? fmt(balance) + " Dr" : fmt(Math.abs(balance)) + " Cr";
                  return [r.code, r.name, r.bank_name, r.account_number, balLabel];
                });
                tableRows7.push(["", "TOTAL BALANCE", "", "", grandBalance >= 0 ? fmt(grandBalance) + " Dr" : fmt(Math.abs(grandBalance)) + " Cr"]);
                const stats7 = [
                  { label: "Bank Accounts", value: String(tableRows7.length - 1) },
                  { label: "Net Balance", value: grandBalance >= 0 ? fmt(grandBalance) + " Dr" : fmt(Math.abs(grandBalance)) + " Cr", highlight: grandBalance >= 0 ? "positive" : "negative" },
                ];
                dataQueryResult = {
                  queryType: "bank_account_list",
                  title: "Bank Account Balances",
                  subtitle: `As of ${todayStr}`,
                  stats: stats7,
                  table: { headers: ["Code", "Account Name", "Bank", "Account No.", "Balance"], rows: tableRows7 },
                  noData: tableRows7.length <= 1,
                };
                break;
              }

              case "stock_adjustments": {
                const adjTypeFilter = params.entityName?.toLowerCase().includes("consum") ? "Consumption" : params.entityName?.toLowerCase().includes("prod") ? "Production" : null;
                const rows = await db.execute(sql`
                  SELECT v.voucher_date, v.voucher_number, sav.adjustment_type,
                    l.name AS location, si.name AS item_name, si.code, si.uom,
                    CAST(sai.quantity AS numeric) AS qty,
                    CAST(sai.rate AS numeric) AS rate,
                    CAST(sai.total_amount AS numeric) AS total_amount
                  FROM stock_adjustment_items sai
                  JOIN stock_adjustment_vouchers sav ON sav.id = sai.adjustment_id
                  JOIN vouchers v ON v.id = sav.voucher_id AND v.deleted_at IS NULL
                  JOIN stock_items si ON si.id = sai.stock_item_id
                  JOIN locations l ON l.id = sav.location_id
                  WHERE v.company_id = ${companyId}
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    ${adjTypeFilter ? sql`AND sav.adjustment_type = ${adjTypeFilter}` : sql``}
                  ORDER BY v.voucher_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalProd = 0, totalCons = 0;
                const tableRows7 = (rows.rows as any[]).map(r => {
                  const qty = parseFloat(r.qty || "0");
                  const amt = parseFloat(r.total_amount || "0");
                  if (r.adjustment_type === "Production") totalProd += amt;
                  else totalCons += amt;
                  return [String(r.voucher_date).slice(0, 10), r.voucher_number, r.adjustment_type, r.location, r.item_name, `${fmtDec(Math.abs(qty))} ${r.uom}`, fmt(Math.abs(amt))];
                });
                const stats7 = [
                  { label: "Total Entries", value: String(tableRows7.length) },
                  { label: "Production Value", value: fmt(totalProd), highlight: "positive" },
                  { label: "Consumption Value", value: fmt(totalCons) },
                ];
                dataQueryResult = {
                  queryType: "stock_adjustments",
                  title: adjTypeFilter ? `Stock Adjustments — ${adjTypeFilter}` : "Stock Adjustments",
                  subtitle: `${dateFrom} → ${dateTo}`,
                  stats: stats7,
                  table: { headers: ["Date", "Voucher #", "Type", "Location", "Item", "Qty", "Amount"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "container_tracking": {
                const cn7 = params.containerNumber || params.entityName;
                if (!cn7) {
                  dataQueryResult = { queryType: "container_tracking", title: "Container Tracking", summary: "Please specify a container number." };
                  break;
                }
                const containerRow7 = await db.execute(sql`
                  SELECT c.id, c.container_number, c.status, c.eta, c.transporter,
                    c.tracking_last_location, c.tracking_last_description, c.tracking_changed_at
                  FROM containers c
                  WHERE c.company_id = ${companyId}
                    AND c.container_number ILIKE ${'%' + cn7 + '%'}
                  LIMIT 1
                `);
                if (!containerRow7.rows.length) {
                  dataQueryResult = { queryType: "container_tracking", title: "Container Tracking", summary: `No container found matching "${cn7}".` };
                  break;
                }
                const ctr7 = containerRow7.rows[0] as any;
                const evtRows = await db.execute(sql`
                  SELECT cte.event_time, cte.event_status, cte.event_location, cte.event_description, cte.provider
                  FROM container_tracking_events cte
                  WHERE cte.container_id = ${ctr7.id}
                  ORDER BY cte.event_time DESC
                  LIMIT ${rowLimit}
                `);
                const tableRows7 = (evtRows.rows as any[]).map(r => [
                  r.event_time ? String(r.event_time).slice(0, 16) : "—",
                  r.event_status || "—",
                  r.event_location || "—",
                  (r.event_description || "").slice(0, 50),
                  r.provider,
                ]);
                const stats7 = [
                  { label: "Container #", value: ctr7.container_number },
                  { label: "Status", value: ctr7.status },
                  { label: "ETA", value: ctr7.eta ? String(ctr7.eta).slice(0, 10) : "—" },
                  { label: "Transporter", value: ctr7.transporter || "—" },
                  { label: "Last Location", value: ctr7.tracking_last_location || "—" },
                ];
                dataQueryResult = {
                  queryType: "container_tracking",
                  title: `Tracking: ${ctr7.container_number}`,
                  subtitle: ctr7.tracking_last_description ? `Latest: ${(ctr7.tracking_last_description as string).slice(0, 60)}` : `${tableRows7.length} event(s)`,
                  stats: stats7,
                  table: { headers: ["Time", "Status", "Location", "Description", "Provider"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "pending_container_sales": {
                const rows = await db.execute(sql`
                  SELECT cs.sale_date, cs.invoice_number, c.container_number,
                    cu.legal_name AS customer, cs.currency,
                    CAST(cs.total_amount AS numeric) AS total_amount,
                    CAST(cs.paid_amount AS numeric) AS paid_amount,
                    CAST(cs.total_amount AS numeric) - CAST(cs.paid_amount AS numeric) AS outstanding,
                    cs.payment_status
                  FROM container_sales cs
                  JOIN containers c ON c.id = cs.container_id
                  JOIN customers cu ON cu.id = cs.customer_id
                  WHERE cs.company_id = ${companyId}
                    AND cs.payment_status != 'PAID'
                  ORDER BY cs.sale_date ASC
                  LIMIT ${rowLimit}
                `);
                let totalOutstanding = 0;
                const tableRows7 = (rows.rows as any[]).map(r => {
                  const outstanding = parseFloat(r.outstanding || "0");
                  totalOutstanding += outstanding;
                  return [String(r.sale_date).slice(0, 10), r.invoice_number || "—", r.container_number, r.customer, fmt(parseFloat(r.total_amount)), fmt(parseFloat(r.paid_amount)), fmt(outstanding), r.payment_status, r.currency];
                });
                const stats7 = [
                  { label: "Pending Sales", value: String(tableRows7.length) },
                  { label: "Total Outstanding", value: fmt(totalOutstanding), highlight: "negative" },
                ];
                dataQueryResult = {
                  queryType: "pending_container_sales",
                  title: "Pending Container Sales",
                  subtitle: `${tableRows7.length} unpaid/partial container sale(s)`,
                  stats: stats7,
                  table: { headers: ["Sale Date", "Invoice #", "Container", "Customer", "Total", "Paid", "Outstanding", "Status", "Currency"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "supplier_container_history": {
                const suppName7 = params.entityName;
                if (!suppName7) {
                  dataQueryResult = { queryType: "supplier_container_history", title: "Supplier Container History", summary: "Please specify a supplier name." };
                  break;
                }
                const rows = await db.execute(sql`
                  SELECT c.container_number, c.status, c.import_date, c.eta,
                    CAST(c.grand_total AS numeric) AS grand_total, c.currency,
                    c.total_kg, c.rate_per_kg, c.item_name, s.legal_name AS supplier
                  FROM containers c
                  JOIN suppliers s ON s.id = c.supplier_id
                  WHERE c.company_id = ${companyId}
                    AND s.legal_name ILIKE ${'%' + suppName7 + '%'}
                  ORDER BY c.import_date DESC
                  LIMIT ${rowLimit}
                `);
                let totalValue = 0, totalKg = 0;
                const statusCounts: Record<string, number> = {};
                const tableRows7 = (rows.rows as any[]).map(r => {
                  const val = parseFloat(r.grand_total || "0");
                  const kg = parseFloat(r.total_kg || "0");
                  totalValue += val; totalKg += kg;
                  statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
                  return [r.container_number, r.status, String(r.import_date).slice(0, 10), r.eta ? String(r.eta).slice(0, 10) : "—", fmtDec(kg), fmt(val), r.currency, (r.item_name || "—").slice(0, 25)];
                });
                const supplier7 = (rows.rows[0] as any)?.supplier || suppName7;
                const stats7 = [
                  { label: "Supplier", value: supplier7 },
                  { label: "Total Containers", value: String(tableRows7.length) },
                  { label: "Total Kg", value: fmtDec(totalKg) },
                  { label: "Total Value", value: fmt(totalValue), highlight: "positive" },
                  ...Object.entries(statusCounts).map(([s, c]) => ({ label: s, value: String(c) })),
                ];
                dataQueryResult = {
                  queryType: "supplier_container_history",
                  title: `Containers from: ${supplier7}`,
                  subtitle: `${tableRows7.length} container(s) · most recent first`,
                  stats: stats7,
                  table: { headers: ["Container #", "Status", "Import Date", "ETA", "Total Kg", "Value", "Currency", "Item"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "income_breakdown": {
                const rows = await db.execute(sql`
                  SELECT la.name, la.account_type,
                    COALESCE(SUM(CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric)), 0) AS net_income
                  FROM ledger_accounts la
                  JOIN voucher_entries ve ON ve.ledger_account_id = la.id
                  JOIN vouchers v ON v.id = ve.voucher_id
                    AND v.deleted_at IS NULL AND v.optional = false
                    AND CAST(v.voucher_date AS text) BETWEEN ${dateFrom} AND ${dateTo}
                  WHERE la.company_id = ${companyId}
                    AND la.account_type IN ('Income')
                    AND la.deleted_at IS NULL
                  GROUP BY la.id, la.name, la.account_type
                  HAVING COALESCE(SUM(CAST(ve.credit_amount AS numeric) - CAST(ve.debit_amount AS numeric)), 0) > 0
                  ORDER BY net_income DESC
                  LIMIT ${rowLimit}
                `);
                let grandIncome = 0;
                const tableRows7 = (rows.rows as any[]).map(r => {
                  const income = parseFloat(r.net_income || "0");
                  grandIncome += income;
                  return [r.name, r.account_type, fmt(income)];
                });
                if (tableRows7.length) tableRows7.push(["TOTAL", "", fmt(grandIncome)]);
                dataQueryResult = {
                  queryType: "income_breakdown",
                  title: "Income Breakdown by Account",
                  subtitle: `${dateFrom} → ${dateTo} · Total: ${fmt(grandIncome)}`,
                  table: { headers: ["Account", "Type", "Net Income"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "factory_worker_profile": {
                const workerName7 = params.entityName;
                if (!workerName7) {
                  dataQueryResult = { queryType: "factory_worker_profile", title: "Factory Worker Profile", summary: "Please specify a worker name." };
                  break;
                }
                const wRow = await db.execute(sql`
                  SELECT fw.full_name, fw.employee_code, fw.position, fw.department,
                    fw.gender, fw.nationality, fw.date_of_birth, fw.date_joined,
                    fw.salary_type, fw.base_salary, fw.per_bale_rate, fw.per_kg_rate,
                    fw.phone1, fw.phone2, fw.active, fw.bank_name, fw.payment_method,
                    fw.visa_expiry, fw.work_permit_expiry, fw.shift_type,
                    fw.transport_allowance
                  FROM factory_workers fw
                  WHERE fw.company_id = ${companyId}
                    AND fw.full_name ILIKE ${'%' + workerName7 + '%'}
                  ORDER BY fw.full_name LIMIT 1
                `);
                if (!wRow.rows.length) {
                  dataQueryResult = { queryType: "factory_worker_profile", title: "Factory Worker Profile", summary: `No worker found matching "${workerName7}".` };
                  break;
                }
                const w7 = wRow.rows[0] as any;
                const baleStats7 = await db.execute(sql`
                  SELECT COUNT(id) AS total_bales,
                    COALESCE(SUM(CAST(weight_kg AS numeric)), 0) AS total_kg
                  FROM factory_bales
                  WHERE company_id = ${companyId}
                    AND pressed_at IS NOT NULL
                    AND CAST(pressed_at AS text) BETWEEN ${dateFrom} AND ${dateTo}
                    AND worker_name ILIKE ${'%' + workerName7 + '%'}
                `);
                const bs7 = baleStats7.rows[0] as any;
                const stats7 = [
                  { label: "Name", value: w7.full_name },
                  { label: "Code", value: w7.employee_code || "—" },
                  { label: "Position", value: w7.position || "—" },
                  { label: "Department", value: w7.department || "—" },
                  { label: "Status", value: w7.active ? "Active" : "Inactive" },
                  { label: "Salary Type", value: w7.salary_type },
                  { label: "Base Salary", value: fmt(parseFloat(w7.base_salary || "0")) },
                  { label: "Per Bale Rate", value: fmtDec(parseFloat(w7.per_bale_rate || "0")) },
                  { label: "Bales This Period", value: String(bs7?.total_bales || 0) },
                  { label: "Kg This Period", value: fmtDec(parseFloat(bs7?.total_kg || "0")) },
                ];
                const profileRows = [
                  ["Phone", w7.phone1 || "—"],
                  ["Nationality", w7.nationality || "—"],
                  ["Gender", w7.gender || "—"],
                  ["Date of Birth", w7.date_of_birth ? String(w7.date_of_birth).slice(0, 10) : "—"],
                  ["Date Joined", w7.date_joined ? String(w7.date_joined).slice(0, 10) : "—"],
                  ["Shift Type", w7.shift_type || "—"],
                  ["Bank", w7.bank_name || "—"],
                  ["Payment Method", w7.payment_method || "—"],
                  ["Visa Expiry", w7.visa_expiry ? String(w7.visa_expiry).slice(0, 10) : "—"],
                  ["Work Permit Expiry", w7.work_permit_expiry ? String(w7.work_permit_expiry).slice(0, 10) : "—"],
                  ["Transport Allowance", fmt(parseFloat(w7.transport_allowance || "0"))],
                ];
                dataQueryResult = {
                  queryType: "factory_worker_profile",
                  title: `Worker Profile: ${w7.full_name}`,
                  subtitle: `${dateFrom} → ${dateTo} performance`,
                  stats: stats7,
                  table: { headers: ["Field", "Value"], rows: profileRows },
                  noData: false,
                };
                break;
              }

              case "location_list": {
                const rows = await db.execute(sql`
                  SELECT l.code, l.name, l.city, l.country, l.active,
                    COUNT(DISTINCT inv.stock_item_id) AS item_count,
                    COALESCE(SUM(CAST(inv.total_value AS numeric)), 0) AS total_value
                  FROM locations l
                  LEFT JOIN inventory inv ON inv.location_id = l.id AND inv.quantity > 0
                  WHERE l.company_id = ${companyId}
                    AND l.deleted_at IS NULL
                  GROUP BY l.id, l.code, l.name, l.city, l.country, l.active
                  ORDER BY l.name
                `);
                let grandValue = 0, grandItems = 0;
                const tableRows7 = (rows.rows as any[]).map(r => {
                  const val = parseFloat(r.total_value || "0");
                  const items = parseInt(r.item_count || "0");
                  grandValue += val; grandItems += items;
                  return [r.code || "—", r.name, r.city || "—", r.country || "—", String(items), fmt(val), r.active ? "Active" : "Inactive"];
                });
                const stats7 = [
                  { label: "Total Locations", value: String(tableRows7.length) },
                  { label: "Total Stock Items", value: String(grandItems) },
                  { label: "Total Inventory Value", value: fmt(grandValue), highlight: "positive" },
                ];
                dataQueryResult = {
                  queryType: "location_list",
                  title: "Warehouse / Location List",
                  subtitle: `${tableRows7.length} location(s)`,
                  stats: stats7,
                  table: { headers: ["Code", "Name", "City", "Country", "Items", "Inv. Value", "Status"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

              case "quarterly_comparison": {
                const yearStr = params.dateFrom ? params.dateFrom.slice(0, 4) : todayStr.slice(0, 4);
                const rows = await db.execute(sql`
                  SELECT EXTRACT(QUARTER FROM CAST(v.voucher_date AS date)) AS quarter,
                    SUM(CAST(sal.total_sales AS numeric)) AS revenue,
                    SUM(CAST(sal.total_cost AS numeric)) AS cost,
                    SUM(CAST(sal.profit AS numeric)) AS profit,
                    COUNT(DISTINCT v.id) AS sales_count
                  FROM sales_items sal
                  JOIN vouchers v ON v.id = sal.voucher_id AND v.deleted_at IS NULL
                  WHERE v.company_id = ${companyId}
                    AND EXTRACT(YEAR FROM CAST(v.voucher_date AS date)) = ${parseInt(yearStr)}
                  GROUP BY quarter
                  ORDER BY quarter
                `);
                let totRev = 0, totCost = 0, totProfit = 0;
                const qLabels = ["Q1 (Jan-Mar)", "Q2 (Apr-Jun)", "Q3 (Jul-Sep)", "Q4 (Oct-Dec)"];
                const tableRows7 = (rows.rows as any[]).map(r => {
                  const q = parseInt(r.quarter || "1");
                  const rev = parseFloat(r.revenue || "0");
                  const cost = parseFloat(r.cost || "0");
                  const profit7 = parseFloat(r.profit || "0");
                  const margin = rev > 0 ? ((profit7 / rev) * 100).toFixed(1) + "%" : "—";
                  totRev += rev; totCost += cost; totProfit += profit7;
                  return [qLabels[q - 1] || `Q${q}`, String(r.sales_count), fmt(rev), fmt(cost), fmt(profit7), margin];
                });
                if (tableRows7.length) {
                  const totMargin = totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) + "%" : "—";
                  tableRows7.push(["FULL YEAR", "", fmt(totRev), fmt(totCost), fmt(totProfit), totMargin]);
                }
                const stats7 = [
                  { label: "Year", value: yearStr },
                  { label: "Total Revenue", value: fmt(totRev) },
                  { label: "Total Cost", value: fmt(totCost) },
                  { label: "Total Profit", value: fmt(totProfit), highlight: "positive" },
                  { label: "Overall Margin", value: totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) + "%" : "—" },
                ];
                dataQueryResult = {
                  queryType: "quarterly_comparison",
                  title: `Quarterly Comparison — ${yearStr}`,
                  subtitle: `Sales revenue and profit by quarter`,
                  stats: stats7,
                  table: { headers: ["Quarter", "Invoices", "Revenue", "Cost", "Profit", "Margin"], rows: tableRows7 },
                  noData: tableRows7.length === 0,
                };
                break;
              }

            }
          }
        }
      } catch (_p1err) {
        // Phase 1 query failed silently — chat text response still returned
      }
    }

    console.log(`[ChatService] Total chat time: ${Date.now() - chatStart}ms`);
    return {
      response,
      suggestions,
      provider: usedProvider,
      voucherDraft,
      stockAdjustmentDraft,
      stockTransferDraft,
      voucherSearchResults,
      stockItemDraft,
      priceUpdateDraft,
      accountQueryResult,
      verifyContainerDraft,
      dataQueryResult,
    };
  } catch (error: any) {
    console.error("[ChatService] ERROR:", error.message);
    console.error("[ChatService] Stack:", error.stack);
    if (error.message?.includes("API_KEY") || error.message?.includes("API key") || error.message?.includes("not configured")) {
      return {
        response: "Invalid or missing API key. Please check your AI provider configuration in Settings.",
        suggestions: [],
      };
    }
    if (error.message?.includes("quota") || error.message?.includes("rate limit") || error.message?.includes("429")) {
      const available = getAvailableProviders();
      return {
        response: `API quota exceeded. ${available.length > 1 ? "Trying fallback providers also failed. " : ""}Please try again later or add additional AI provider keys in your environment.`,
        suggestions: [],
      };
    }
    // Catch-all: return a friendly inline error so the route always returns 200
    return {
      response: `Sorry, something went wrong while processing your request. (${error.message || "Unknown error"})`,
      suggestions: [],
    };
  }
}

// Export function to get available providers for the settings UI
export function getConfiguredProviders(): { provider: AIProvider; available: boolean }[] {
  return [
    { provider: "gemini", available: !!process.env.GEMINI_API_KEY },
    { provider: "chatgpt", available: !!process.env.OPENAI_API_KEY },
    { provider: "grok", available: !!process.env.XAI_API_KEY },
  ];
}

export async function saveMessage(
  companyId: number,
  userId: string,
  role: "user" | "assistant",
  content: string,
  sessionId: string
): Promise<void> {
  await db.insert(schema.chatMessages).values({
    companyId,
    userId,
    role,
    content,
    sessionId,
  });
}

export async function getConversationHistory(
  sessionId: string,
  userId?: string,
  limit: number = 10
): Promise<{ id: number; role: string; message: string; createdAt: Date }[]> {
  // Filter by sessionId AND userId for security (if userId provided)
  const whereClause = userId 
    ? and(eq(schema.chatMessages.sessionId, sessionId), eq(schema.chatMessages.userId, userId))
    : eq(schema.chatMessages.sessionId, sessionId);
    
  const messages = await db
    .select({
      id: schema.chatMessages.id,
      role: schema.chatMessages.role,
      message: schema.chatMessages.content,
      createdAt: schema.chatMessages.createdAt,
    })
    .from(schema.chatMessages)
    .where(whereClause)
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(limit);

  return messages
    .map((m) => ({ id: m.id, role: m.role ?? "", message: m.message ?? "", createdAt: m.createdAt }))
    .reverse();
}

export async function getConversationHistoryForAI(
  sessionId: string,
  limit: number = 10
): Promise<{ role: string; content: string }[]> {
  const messages = await db
    .select({
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionId, sessionId))
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(limit);

  return messages.reverse();
}

export async function getAllChatHistory(
  companyId: number,
  limit: number = 100
): Promise<any[]> {
  const messages = await db
    .select({
      id: schema.chatMessages.id,
      userId: schema.chatMessages.userId,
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
      sessionId: schema.chatMessages.sessionId,
      createdAt: schema.chatMessages.createdAt,
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.companyId, companyId))
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(limit);

  return messages;
}

export async function saveFeedback(
  messageId: number,
  feedback: 'positive' | 'negative',
  userId: string
): Promise<void> {
  console.log(`Feedback saved: Message ${messageId} - ${feedback} by user ${userId}`);
}

// ── AI-powered PO text extraction ────────────────────────────────────
// Used by the PO file import feature to parse any text content (PDF, CSV, Excel raw text)
// into a structured PO object regardless of layout or column names.
export async function extractPOFromText(rawText: string): Promise<{
  poNumber: string;
  containerNumber: string;
  supplierName: string;
  supplierCode: string;
  importDate: string;
  currency: string;
  items: { name: string; code: string; quantity: number; rate: number }[];
  freight: number;
  surcharge: number;
  fumigation: number;
  documentCharges: number;
  discount: number;
  otherCharges: number;
} | null> {
  const available = getAvailableProviders();
  if (!available.length) return null;

  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = `You are a data extraction assistant. Extract purchase order data from the provided text and return ONLY valid JSON with no markdown, no explanation.

Required JSON structure:
{
  "poNumber": "string (PO/invoice number, or empty if not found)",
  "containerNumber": "string (container/shipment number, or empty if not found)",
  "supplierName": "string (supplier/vendor name, or empty)",
  "supplierCode": "string (supplier code, or empty)",
  "importDate": "string (YYYY-MM-DD format, use ${today} if not found)",
  "currency": "string (USD, EUR, etc. Default USD)",
  "items": [
    { "name": "string", "code": "string (barcode/SKU/item code or empty)", "quantity": number, "rate": number }
  ],
  "freight": number,
  "surcharge": number,
  "fumigation": number,
  "documentCharges": number,
  "discount": number,
  "otherCharges": number
}

Rules:
- items array must include every product/item line with quantity > 0 and rate > 0
- All numeric fields default to 0 if not found
- Return ONLY the JSON object, nothing else`;

  const selectedProvider = await getSelectedAIProvider();
  try {
    const { response } = await callAIWithFallback(
      selectedProvider,
      systemPrompt,
      [],
      `Extract PO data from this text:\n\n${rawText.slice(0, 8000)}`
    );
    const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch (err) {
    console.error("[ChatService] extractPOFromText AI error:", err);
    return null;
  }
}
