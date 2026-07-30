import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";

export async function getAllBaleTransfers(companyId: number): Promise<schema.BaleTransfer[]> {
  return await db
    .select()
    .from(schema.baleTransfers)
    .where(eq(schema.baleTransfers.companyId, companyId))
    .orderBy(desc(schema.baleTransfers.createdAt));
}

export async function getBaleTransferById(id: number): Promise<schema.BaleTransfer | undefined> {
  const [transfer] = await db.select().from(schema.baleTransfers).where(eq(schema.baleTransfers.id, id));
  return transfer;
}

export async function createBaleTransfer(transfer: schema.InsertBaleTransfer): Promise<schema.BaleTransfer> {
  const [created] = await db.insert(schema.baleTransfers).values(transfer).returning();
  return created;
}

export async function updateBaleTransfer(
  id: number,
  updates: Partial<schema.InsertBaleTransfer>
): Promise<schema.BaleTransfer> {
  const [updated] = await db
    .update(schema.baleTransfers)
    .set({ ...updates, updatedAt: sql`now()` })
    .where(eq(schema.baleTransfers.id, id))
    .returning();
  return updated;
}

export async function deleteBaleTransfer(id: number): Promise<void> {
  await db.delete(schema.baleTransfers).where(eq(schema.baleTransfers.id, id));
}

export async function getBaleTransferItems(transferId: number): Promise<schema.BaleTransferItem[]> {
  return await db.select().from(schema.baleTransferItems).where(eq(schema.baleTransferItems.transferId, transferId));
}

export async function createBaleTransferItem(item: schema.InsertBaleTransferItem): Promise<schema.BaleTransferItem> {
  const [created] = await db.insert(schema.baleTransferItems).values(item).returning();
  return created;
}

export async function updateBaleTransferItem(
  id: number,
  updates: Partial<schema.InsertBaleTransferItem>
): Promise<schema.BaleTransferItem> {
  const [updated] = await db
    .update(schema.baleTransferItems)
    .set(updates)
    .where(eq(schema.baleTransferItems.id, id))
    .returning();
  return updated;
}

export async function deleteBaleTransferItem(id: number): Promise<void> {
  await db.delete(schema.baleTransferItems).where(eq(schema.baleTransferItems.id, id));
}
