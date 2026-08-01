import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";
import type {} from "@shared/schema";
import { addCustomerBalanceEntry } from "../accounting";

export async function createContainerSale(sale: schema.InsertContainerSale): Promise<schema.ContainerSale> {
  const [created] = await db.insert(schema.containerSales).values(sale).returning();

  await addCustomerBalanceEntry({
    companyId: sale.companyId,
    customerId: sale.customerId,
    transactionDate: sale.saleDate,
    transactionType: "SALE",
    referenceId: created.id,
    referenceType: "CONTAINER_SALE",
    debitAmount: sale.totalAmount,
    creditAmount: "0",
    balance: sale.totalAmount,
    currency: sale.currency || "USD",
    description: `Container sale - Invoice ${sale.invoiceNumber || created.id}`,
  });

  return created;
}

export async function getContainerSales(companyId: number): Promise<schema.ContainerSale[]> {
  return await db
    .select()
    .from(schema.containerSales)
    .where(eq(schema.containerSales.companyId, companyId))
    .orderBy(desc(schema.containerSales.saleDate));
}

export async function getContainerSaleById(id: number, companyId: number): Promise<schema.ContainerSale | undefined> {
  const [sale] = await db
    .select()
    .from(schema.containerSales)
    .where(and(eq(schema.containerSales.id, id), eq(schema.containerSales.companyId, companyId)));
  return sale;
}

export async function updateContainerSalePayment(
  id: number,
  companyId: number,
  paidAmount: string,
  paymentStatus: "PENDING" | "PARTIAL" | "PAID"
): Promise<schema.ContainerSale> {
  const [updated] = await db
    .update(schema.containerSales)
    .set({ paidAmount, paymentStatus, updatedAt: sql`now()` })
    .where(and(eq(schema.containerSales.id, id), eq(schema.containerSales.companyId, companyId)))
    .returning();
  return updated;
}

export async function getContainerSaleByContainerId(
  containerId: number,
  companyId: number
): Promise<schema.ContainerSale | undefined> {
  const [sale] = await db
    .select()
    .from(schema.containerSales)
    .where(and(eq(schema.containerSales.containerId, containerId), eq(schema.containerSales.companyId, companyId)));
  return sale;
}

export async function getContainerSalesByCustomer(
  customerId: number,
  companyId: number
): Promise<schema.ContainerSale[]> {
  return await db
    .select()
    .from(schema.containerSales)
    .where(and(eq(schema.containerSales.customerId, customerId), eq(schema.containerSales.companyId, companyId)))
    .orderBy(desc(schema.containerSales.saleDate));
}

export async function getContainerCountBySupplier(supplierId: number, companyId?: number): Promise<number> {
  const conditions = [eq(schema.containers.supplierId, supplierId)];
  if (companyId) conditions.push(eq(schema.containers.companyId, companyId));
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.containers)
    .where(and(...conditions));
  return Number(result[0]?.count || 0);
}
