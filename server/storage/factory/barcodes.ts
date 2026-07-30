import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";

export async function getAllPendingBarcodes(companyId: number): Promise<schema.PendingBarcode[]> {
  return await db
    .select()
    .from(schema.pendingBarcodes)
    .where(eq(schema.pendingBarcodes.companyId, companyId))
    .orderBy(desc(schema.pendingBarcodes.createdAt));
}

export async function getPendingBarcodeByCode(
  barcode: string,
  companyId: number
): Promise<schema.PendingBarcode | undefined> {
  const results = await db
    .select()
    .from(schema.pendingBarcodes)
    .where(and(eq(schema.pendingBarcodes.barcode, barcode), eq(schema.pendingBarcodes.companyId, companyId)));
  return results[0];
}

export async function createPendingBarcode(data: schema.InsertPendingBarcode): Promise<schema.PendingBarcode> {
  const [result] = await db.insert(schema.pendingBarcodes).values(data).returning();
  return result;
}

export async function updatePendingBarcode(
  id: number,
  updates: Partial<schema.InsertPendingBarcode>
): Promise<schema.PendingBarcode> {
  const [result] = await db
    .update(schema.pendingBarcodes)
    .set(updates)
    .where(eq(schema.pendingBarcodes.id, id))
    .returning();
  return result;
}

export async function deletePendingBarcode(id: number): Promise<void> {
  await db.delete(schema.pendingBarcodes).where(eq(schema.pendingBarcodes.id, id));
}

export async function bulkCreatePendingBarcodes(
  barcodes: schema.InsertPendingBarcode[]
): Promise<schema.PendingBarcode[]> {
  if (barcodes.length === 0) return [];
  return await db.insert(schema.pendingBarcodes).values(barcodes).returning();
}

export async function markBarcodesAsPrinted(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(schema.pendingBarcodes).set({ printed: true }).where(inArray(schema.pendingBarcodes.id, ids));
}
