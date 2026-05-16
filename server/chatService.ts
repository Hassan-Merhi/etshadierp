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

export async function chat(
  userMessage: string,
  companyId: number,
  conversationHistory: { role: string; content: string }[] = [],
  userPreferences?: UserPreferences
): Promise<{ response: string; suggestions: string[]; provider?: string; voucherDraft?: any; stockAdjustmentDraft?: any; voucherSearchResults?: any[]; stockItemDraft?: any; priceUpdateDraft?: any; accountQueryResult?: any; verifyContainerDraft?: any; dataQueryResult?: any }> {
  const available = getAvailableProviders();
  
  if (available.length === 0) {
    return {
      response: "AI chatbot is not configured. Please ask an administrator to add at least one AI API key (GEMINI_API_KEY, OPENAI_API_KEY, or XAI_API_KEY).",
      suggestions: [],
    };
  }

  try {
    console.log("[ChatService] Getting ERP context for company:", companyId);
    const context = await getERPContext(companyId);
    console.log("[ChatService] ERP context retrieved successfully");
    
    const systemPrompt = buildSystemPrompt(context, userPreferences);
    const suggestions = generateQuickSuggestions(context);
    console.log("[ChatService] System prompt built, suggestions generated");

    // Get selected provider and call with fallback
    const selectedProvider = await getSelectedAIProvider();
    console.log(`[ChatService] Selected provider: ${selectedProvider}, Available: ${available.join(", ")}`);
    
    const { response, usedProvider } = await callAIWithFallback(
      selectedProvider,
      systemPrompt,
      conversationHistory,
      userMessage
    );
    
    console.log(`[ChatService] Response received from ${usedProvider}`);

    // ── Phase 5b: detect voucher creation intent ──────────────────────────
    // Ask the AI to extract a voucher draft if the message contains creation intent.
    // We do a lightweight structured extraction call only when keywords are found.
    const VOUCHER_KEYWORDS = /\b(create|make|record|add|post|enter|book)\b.{0,80}\b(payment|receipt|journal|voucher|entry|invoice|transaction)\b|\b(pay|paid|receive[d]?|collect[ed]?|transfer[red]?|deposit[ed]?)\b.{0,60}\$?\d|\b(journal|receipt|payment)\b.{0,40}\$?\d/i;
    let voucherDraft: any = undefined;

    if (VOUCHER_KEYWORDS.test(userMessage)) {
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
            voucherDraft = parsed;
          }
        }
      } catch (_) {
        // Extraction failed silently — no voucherDraft
      }
    }

    // ── Stock adjustment detection ─────────────────────────────────────
    const STOCK_ADJ_KEYWORDS = /\b(produce|producing|production|consume|consuming|consumption|stock\s+adjust|adjust\s+stock|record\s+production|record\s+consumption|produced|consumed)\b/i;
    let stockAdjustmentDraft: any = undefined;

    if (STOCK_ADJ_KEYWORDS.test(userMessage)) {
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
            stockAdjustmentDraft = parsedAdj;
          }
        }
      } catch (_) {
        // Extraction failed silently
      }
    }

    // ── Voucher search by description ─────────────────────────────────
    const VOUCHER_SEARCH_KEYWORDS = /\b(when did (i|we) pay|find (the )?(payment|receipt|voucher|transaction)|search (for )?(voucher|payment|receipt)|show (me )?(the )?(voucher|payment|receipt)|paid for|receipt for|voucher for|payment (for|of)|what voucher|which voucher|show.*payment.*for|show.*receipt.*for)\b/i;
    let voucherSearchResults: any[] | undefined = undefined;

    if (VOUCHER_SEARCH_KEYWORDS.test(userMessage)) {
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
    const STOCK_ITEM_CREATE_KEYWORDS = /\b(create\s+(a\s+)?stock\s+item|add\s+(a\s+)?stock\s+item|new\s+stock\s+item|create\s+(a\s+)?new\s+item|add\s+(a\s+)?new\s+item|new\s+item)\b/i;
    let stockItemDraft: any = undefined;

    if (STOCK_ITEM_CREATE_KEYWORDS.test(userMessage)) {
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
    const PRICE_UPDATE_KEYWORDS = /\b(update.*price|change.*price|set.*price|price.*to|price.*for|update.*selling|change.*selling|new price|price list)\b/i;
    let priceUpdateDraft: any = undefined;

    if (PRICE_UPDATE_KEYWORDS.test(userMessage)) {
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
    const ACCOUNT_QUERY_KEYWORDS = /\b(balance of|account.*balance|how much.*account|account.*how much|what.*balance|balance.*account|when did.*account|account.*transactions|transactions.*account|paid.*from account|received.*account|when.*balance.*was|balance.*was.*when|ledger.*balance|account.*paid|account.*received)\b/i;
    let accountQueryResult: any = undefined;

    if (ACCOUNT_QUERY_KEYWORDS.test(userMessage)) {
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
    const PHASE1_KEYWORDS = /profit.{0,15}loss|p&l\b|pl\b.{0,10}report|balance.{0,8}sheet|cash.{0,12}(balance|position|account)|who.{0,20}owe[ds]?|overdue|outstanding.{0,15}(balance|amount|supplier)|customer.{0,15}statement|supplier.{0,15}statement|top.{0,10}(customer|buyer)s?|worker.{0,12}attend|how many.{0,20}(absent|present|worker)|bale.{0,12}(produc|today|week|this|last)|produc.{0,12}bale|how many bale|container.{0,12}status|where.{0,12}(is.{0,5})?container|pending.{0,10}offload|not.{0,10}offload/i;
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

Output this JSON shape:
{"queryType":"<one of the above>","entityName":<string or null>,"containerNumber":<string or null>,"dateFrom":<YYYY-MM-DD or null>,"dateTo":"${todayStr}","limit":10}

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
            }
          }
        }
      } catch (_p1err) {
        // Phase 1 query failed silently — chat text response still returned
      }
    }

    return {
      response,
      suggestions,
      provider: usedProvider,
      voucherDraft,
      stockAdjustmentDraft,
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
    throw error;
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
