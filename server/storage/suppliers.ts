import { and, asc, eq, ilike, isNull } from "drizzle-orm";
import { db } from "../db";
import { companyScopedSuppliers } from "@shared/schema/supplierCompanyScope";
import type { CompanyScopedSupplier, InsertCompanyScopedSupplier } from "@shared/schema/supplierCompanyScope";

export async function getAllSuppliers(
  search?: string,
  limit?: number,
  companyId?: number
): Promise<CompanyScopedSupplier[]> {
  const conditions = [isNull(companyScopedSuppliers.deletedAt)];
  if (companyId) {
    conditions.push(eq(companyScopedSuppliers.companyId, companyId));
  }
  if (search) {
    conditions.push(ilike(companyScopedSuppliers.legalName, `%${search}%`));
  }
  let query = db
    .select()
    .from(companyScopedSuppliers)
    .where(and(...conditions))
    .orderBy(asc(companyScopedSuppliers.legalName)) as unknown;
  if (limit) {
    query = query.limit(limit);
  }
  return await query;
}

export async function getSupplierByCode(code: string, companyId?: number): Promise<CompanyScopedSupplier | undefined> {
  const conditions = [eq(companyScopedSuppliers.code, code), isNull(companyScopedSuppliers.deletedAt)];
  if (companyId) conditions.push(eq(companyScopedSuppliers.companyId, companyId));
  const [supplier] = await db
    .select()
    .from(companyScopedSuppliers)
    .where(and(...conditions));
  return supplier;
}

export async function getSupplierById(id: number, companyId?: number): Promise<CompanyScopedSupplier | undefined> {
  const conditions = [eq(companyScopedSuppliers.id, id), isNull(companyScopedSuppliers.deletedAt)];
  if (companyId) conditions.push(eq(companyScopedSuppliers.companyId, companyId));
  const [supplier] = await db
    .select()
    .from(companyScopedSuppliers)
    .where(and(...conditions));
  return supplier;
}

export async function createSupplier(supplier: InsertCompanyScopedSupplier): Promise<CompanyScopedSupplier> {
  const [created] = await db
    .insert(companyScopedSuppliers)
    .values(supplier as unknown)
    .returning();
  return created;
}

export async function updateSupplier(
  id: number,
  updates: Partial<InsertCompanyScopedSupplier>,
  companyId?: number
): Promise<CompanyScopedSupplier> {
  const conditions = [eq(companyScopedSuppliers.id, id)];
  if (companyId) conditions.push(eq(companyScopedSuppliers.companyId, companyId));
  const [updated] = await db
    .update(companyScopedSuppliers)
    .set(updates)
    .where(and(...conditions))
    .returning();
  if (!updated) throw new Error("Supplier not found");
  return updated;
}

export async function deleteSupplier(id: number, companyId?: number): Promise<void> {
  const conditions = [eq(companyScopedSuppliers.id, id)];
  if (companyId) conditions.push(eq(companyScopedSuppliers.companyId, companyId));
  const [deleted] = await db
    .update(companyScopedSuppliers)
    .set({ deletedAt: new Date(), active: false })
    .where(and(...conditions))
    .returning({ id: companyScopedSuppliers.id });
  if (!deleted) throw new Error("Supplier not found");
}
