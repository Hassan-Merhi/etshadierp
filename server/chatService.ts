import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { db } from "./db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, lt, gt, isNull, asc } from "drizzle-orm";

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

  const lowStockAlerts: any[] = [];
  const inventoryMap = new Map(inventory.map(i => [i.stockItemId, parseFloat(i.quantity || '0')]));
  
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

### 💰 FINANCIAL OVERVIEW:
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

### 📈 TOP SELLING ITEMS:
${context.topSellingItems.length > 0 ? context.topSellingItems.slice(0, 5).map((item, i) => 
  `${i+1}. ${item.itemName} - Revenue: $${parseFloat(item.totalRevenue).toLocaleString()}, Profit: $${parseFloat(item.totalProfit).toLocaleString()} (${item.profitMargin} margin)`
).join('\n') : 'No sales data available yet.'}

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
): Promise<{ response: string; suggestions: string[]; provider?: string; voucherDraft?: any }> {
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
4. Voucher type rules: "Payment" = money going out (debit expense/asset, credit cash/bank), "Receipt" = money coming in (debit cash/bank, credit income/liability), "Journal" = any other adjustment.
5. Both sides MUST balance: sum of all debits must equal sum of all credits.
6. Date defaults to today (${today}) if not specified by the user.
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

    return {
      response,
      suggestions,
      provider: usedProvider,
      voucherDraft,
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
