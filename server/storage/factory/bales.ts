import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";

export async function getAllBales(companyId: number): Promise<schema.Bale[]> {
  return await db
    .select()
    .from(schema.bales)
    .where(eq(schema.bales.companyId, companyId))
    .orderBy(desc(schema.bales.createdAt));
}

export async function getBaleById(id: number): Promise<schema.Bale | undefined> {
  const [bale] = await db.select().from(schema.bales).where(eq(schema.bales.id, id));
  return bale;
}

export async function getBaleByBarcode(barcode: string, companyId: number): Promise<schema.Bale | undefined> {
  const [bale] = await db
    .select()
    .from(schema.bales)
    .where(and(eq(schema.bales.barcode, barcode), eq(schema.bales.companyId, companyId)));
  return bale;
}

export async function createBale(bale: schema.InsertBale): Promise<schema.Bale> {
  const [created] = await db.insert(schema.bales).values(bale).returning();
  return created;
}

export async function updateBale(id: number, updates: Partial<schema.InsertBale>): Promise<schema.Bale> {
  const [updated] = await db
    .update(schema.bales)
    .set({ ...updates })
    .where(eq(schema.bales.id, id))
    .returning();
  return updated;
}

export async function deleteBale(id: number): Promise<void> {
  await db.delete(schema.bales).where(eq(schema.bales.id, id));
}

export async function bulkCreateBales(bales: schema.InsertBale[]): Promise<schema.Bale[]> {
  if (bales.length === 0) return [];
  return await db.insert(schema.bales).values(bales).returning();
}
