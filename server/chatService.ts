import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, lt, gt, isNull, asc } from "drizzle-orm";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
      .where(eq(schema.inventory.companyId, companyId))
      .limit(500),

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
      ))
      .limit(200),

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
      ))
      .limit(200),

    db.select({
      id: schema.suppliers.id,
      code: schema.suppliers.code,
      legalName: schema.suppliers.legalName,
      phone: schema.suppliers.phone,
      email: schema.suppliers.email,
    })
      .from(schema.suppliers)
      .where(eq(schema.suppliers.active, true))
      .limit(100),

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
      ))
      .limit(100),

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
      .limit(100),

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
      .orderBy(desc(schema.purchaseOrders.createdAt))
      .limit(50),

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
      .orderBy(desc(schema.containerSales.saleDate))
      .limit(50),
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
          eq(schema.vouchers.optional, false),
          isNull(schema.vouchers.deletedAt)
        ));

      // Calculate balance same as supplier page: Opening Balance + Credits - Debits
      const openingBalance = parseFloat(supplier.openingBalance || "0");
      const balance = entries.reduce((sum, entry) => {
        const credit = parseFloat(entry.creditAmount || "0");
        const debit = parseFloat(entry.debitAmount || "0");
        // Only count pure credit or pure debit entries (same as supplier page)
        if (credit > 0 && debit === 0) {
          return sum + credit;
        } else if (debit > 0 && credit === 0) {
          return sum - debit;
        }
        return sum;
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
2. **Business Insights**: Provide actionable recommendations based on data patterns
3. **What-If Analysis**: Help users simulate scenarios (pricing changes, stock projections)
4. **Alerts & Monitoring**: Highlight critical issues that need attention
5. **Multi-language**: Respond in the same language as the user's question

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

### 🏷️ STOCK ITEMS (Sample):
${JSON.stringify(context.stockItems.slice(0, 15).map(s => ({
  code: s.code,
  name: s.name,
  sellingPrice: s.sellingPrice,
})), null, 2)}

### 👥 SUPPLIERS:
${JSON.stringify(context.suppliers.slice(0, 10).map(s => ({
  code: s.code,
  name: s.legalName,
  phone: s.phone,
})), null, 2)}

### 👤 CUSTOMERS:
${JSON.stringify(context.customers.slice(0, 10).map(c => ({
  code: c.code,
  name: c.legalName,
  phone: c.phone,
})), null, 2)}

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
  
  if (context.lowStockAlerts.length > 0) {
    suggestions.push(`Show me the ${context.lowStockAlerts.length} items that are low on stock`);
  }
  
  if (context.supplierBalances.filter(s => s.balance > 0).length > 0) {
    suggestions.push("What are my outstanding supplier payments?");
  }
  
  if (context.topSellingItems.length > 0) {
    suggestions.push("What are my top selling products?");
  }
  
  suggestions.push("Give me a summary of today's business");
  suggestions.push("Which items have the highest profit margin?");
  suggestions.push("How is my inventory distributed across locations?");
  
  return suggestions.slice(0, 4);
}

export async function chat(
  userMessage: string,
  companyId: number,
  conversationHistory: { role: string; content: string }[] = [],
  userPreferences?: UserPreferences
): Promise<{ response: string; suggestions: string[] }> {
  if (!process.env.GEMINI_API_KEY) {
    return {
      response: "AI chatbot is not configured. Please ask an administrator to set up the GEMINI_API_KEY.",
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

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "I understand. I'm your ERP Assistant, ready to help you understand your business data, provide insights, and answer questions in any language. How can I help you today?" }] },
      ...conversationHistory.map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      })),
      { role: "user", parts: [{ text: userMessage }] }
    ];

    console.log("[ChatService] Calling Gemini API...");
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: contents,
    });
    console.log("[ChatService] Gemini API response received");

    return {
      response: response.text || "I couldn't generate a response. Please try again.",
      suggestions,
    };
  } catch (error: any) {
    console.error("[ChatService] ERROR:", error.message);
    console.error("[ChatService] Stack:", error.stack);
    if (error.message?.includes("API_KEY") || error.message?.includes("API key")) {
      return {
        response: "Invalid API key. Please check your GEMINI_API_KEY configuration.",
        suggestions: [],
      };
    }
    if (error.message?.includes("quota") || error.message?.includes("rate limit")) {
      return {
        response: "API quota exceeded. Please try again later or check your Gemini API usage limits.",
        suggestions: [],
      };
    }
    throw error; // Re-throw to show in route logs
  }
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

  return messages.reverse();
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
