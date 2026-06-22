import { eq, and, asc, ilike, isNull } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import type { Supplier, InsertSupplier } from "@shared/schema";

export async function getAllSuppliers(search?: string, limit?: number): Promise<Supplier[]> {
  const conditions: any[] = [isNull(schema.suppliers.deletedAt)];
  if (search) {
    conditions.push(ilike(schema.suppliers.legalName, `%${search}%`));
  }
  let query = db.select().from(schema.suppliers)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(asc(schema.suppliers.legalName)) as any;
  if (limit) {
    query = query.limit(limit);
  }
  return await query;
}

export async function getSupplierByCode(code: string): Promise<Supplier | undefined> {
  const [supplier] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.code, code));
  return supplier;
}

export async function getSupplierById(id: number): Promise<Supplier | undefined> {
  const [supplier] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
  return supplier;
}

export async function createSupplier(supplier: InsertSupplier): Promise<Supplier> {
  const [created] = await db.insert(schema.suppliers).values(supplier as any).returning();
  return created;
}

export async function updateSupplier(id: number, updates: Partial<InsertSupplier>): Promise<Supplier> {
  const [updated] = await db
    .update(schema.suppliers)
    .set(updates)
    .where(eq(schema.suppliers.id, id))
    .returning();
  return updated;
}

export async function deleteSupplier(id: number): Promise<void> {
  await db.update(schema.suppliers)
    .set({ deletedAt: new Date(), active: false })
    .where(eq(schema.suppliers.id, id));
}
