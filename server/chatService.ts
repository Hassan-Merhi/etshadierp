import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface ERPContext {
  inventory: any[];
  stockItems: any[];
  stockGroups: any[];
  ledgerAccounts: any[];
  suppliers: any[];
  customers: any[];
  locations: any[];
  recentVouchers: any[];
  salesSummary: any;
}

export async function getERPContext(companyId: number): Promise<ERPContext> {
  const [
    inventory,
    stockItems,
    stockGroups,
    ledgerAccounts,
    suppliers,
    customers,
    locations,
    recentVouchers,
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
      .where(eq(schema.vouchers.companyId, companyId))
      .orderBy(desc(schema.vouchers.createdAt))
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
      eq(schema.vouchers.voucherType, "Receipt")
    ));

  return {
    inventory,
    stockItems,
    stockGroups,
    ledgerAccounts,
    suppliers,
    customers,
    locations,
    recentVouchers,
    salesSummary: salesSummary[0] || { totalSales: "0", count: 0 },
  };
}

function buildSystemPrompt(context: ERPContext): string {
  return `You are an AI assistant for an ERP/POS system. You help users understand their business data.
You have access to the following company data:

INVENTORY SUMMARY:
- Total inventory items: ${context.inventory.length}
- Stock items: ${context.stockItems.length}
- Stock groups: ${context.stockGroups.length}

STOCK ITEMS (sample):
${JSON.stringify(context.stockItems.slice(0, 20), null, 2)}

INVENTORY LEVELS (sample):
${JSON.stringify(context.inventory.slice(0, 30), null, 2)}

LEDGER ACCOUNTS:
${JSON.stringify(context.ledgerAccounts.slice(0, 30), null, 2)}

SUPPLIERS:
${JSON.stringify(context.suppliers.slice(0, 20), null, 2)}

CUSTOMERS:
${JSON.stringify(context.customers.slice(0, 20), null, 2)}

LOCATIONS:
${JSON.stringify(context.locations, null, 2)}

RECENT VOUCHERS/TRANSACTIONS:
${JSON.stringify(context.recentVouchers.slice(0, 20), null, 2)}

SALES SUMMARY:
- Total sales (Receipts): $${context.salesSummary.totalSales}
- Number of sales: ${context.salesSummary.count}

INSTRUCTIONS:
1. Answer questions about inventory, sales, accounts, suppliers, customers, and transactions.
2. Respond in the same language as the user's question (English, Arabic, French, etc.).
3. Be helpful, concise, and accurate.
4. If you don't have enough data to answer, say so honestly.
5. Format numbers nicely with proper currency symbols when relevant.
6. When discussing quantities, use appropriate units.`;
}

export async function chat(
  userMessage: string,
  companyId: number,
  conversationHistory: { role: string; content: string }[] = []
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    return "AI chatbot is not configured. Please ask an administrator to set up the GEMINI_API_KEY.";
  }

  try {
    const context = await getERPContext(companyId);
    const systemPrompt = buildSystemPrompt(context);

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "I understand. I'm ready to help answer questions about your ERP data in any language." }] },
      ...conversationHistory.map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      })),
      { role: "user", parts: [{ text: userMessage }] }
    ];

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents,
    });

    return response.text || "I couldn't generate a response. Please try again.";
  } catch (error: any) {
    console.error("Chat error:", error);
    if (error.message?.includes("API_KEY")) {
      return "Invalid API key. Please check your GEMINI_API_KEY configuration.";
    }
    return `An error occurred: ${error.message || "Unknown error"}`;
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
