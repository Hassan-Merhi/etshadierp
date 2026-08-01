import { eq, and, isNull, ilike } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";

export async function getAllCustomers(companyId: number, search?: string, limit?: number): Promise<schema.Customer[]> {
  const conditions: any[] = [eq(schema.customers.companyId, companyId), isNull(schema.customers.deletedAt)];
  if (search) conditions.push(ilike(schema.customers.legalName, `%${search}%`));
  let query = db
    .select()
    .from(schema.customers)
    .where(and(...conditions))
    .orderBy(schema.customers.legalName) as any;
  if (limit) query = query.limit(limit);
  return await query;
}

export async function getCustomerById(id: number): Promise<schema.Customer | undefined> {
  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
  return customer;
}

export async function getCustomerByCode(code: string, companyId: number): Promise<schema.Customer | undefined> {
  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.code, code), eq(schema.customers.companyId, companyId)));
  return customer;
}

export async function createCustomer(customer: schema.InsertCustomer): Promise<schema.Customer> {
  const [newCustomer] = await db
    .insert(schema.customers)
    .values(customer as any)
    .returning();
  return newCustomer;
}

export async function updateCustomer(id: number, updates: Partial<schema.InsertCustomer>): Promise<schema.Customer> {
  const [customer] = await db.update(schema.customers).set(updates).where(eq(schema.customers.id, id)).returning();
  return customer;
}

export async function deleteCustomer(id: number): Promise<void> {
  await db.update(schema.customers).set({ deletedAt: new Date(), active: false }).where(eq(schema.customers.id, id));
}

// ---------------------------------------------------------------------------
// Inter-Company Transfers
// ---------------------------------------------------------------------------
