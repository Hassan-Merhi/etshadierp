import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";

// Draft POS Sales

export async function getAllDraftPosSales(userId: string, locationId?: number): Promise<schema.DraftPosSale[]> {
  if (locationId) {
    return await db.select().from(schema.draftPosSales)
      .where(and(
        eq(schema.draftPosSales.userId, userId),
        eq(schema.draftPosSales.locationId, locationId)
      ))
      .orderBy(sql`${schema.draftPosSales.updatedAt} DESC`);
  }
  return await db.select().from(schema.draftPosSales)
    .where(eq(schema.draftPosSales.userId, userId))
    .orderBy(sql`${schema.draftPosSales.updatedAt} DESC`);
}

export async function getDraftPosSaleById(id: number): Promise<any | undefined> {
  const [draft] = await db.select().from(schema.draftPosSales)
    .where(eq(schema.draftPosSales.id, id));

  if (!draft) return undefined;

  const items = await db.select({
    id: schema.draftPosSaleItems.id,
    stockItemId: schema.draftPosSaleItems.stockItemId,
    stockItemName: schema.stockItems.name,
    stockItemCode: schema.stockItems.code,
    quantity: schema.draftPosSaleItems.quantity,
    rate: schema.draftPosSaleItems.rate,
    amount: schema.draftPosSaleItems.amount,
  })
    .from(schema.draftPosSaleItems)
    .leftJoin(schema.stockItems, eq(schema.draftPosSaleItems.stockItemId, schema.stockItems.id))
    .where(eq(schema.draftPosSaleItems.draftId, id));

  return { ...draft, items };
}

export async function createDraftPosSale(
  draft: schema.InsertDraftPosSale,
  items: Array<{ stockItemId: number; quantity: string; rate: string; amount: string }>
): Promise<schema.DraftPosSale> {
  const [newDraft] = await db.insert(schema.draftPosSales).values(draft).returning();

  if (items && items.length > 0) {
    const draftItems = items.map(item => ({
      draftId: newDraft.id,
      stockItemId: item.stockItemId,
      quantity: item.quantity,
      rate: item.rate,
      amount: item.amount,
    }));
    await db.insert(schema.draftPosSaleItems).values(draftItems);
  }

  return newDraft;
}

export async function updateDraftPosSale(
  id: number,
  draft: Partial<schema.InsertDraftPosSale>,
  items?: Array<{ stockItemId: number; quantity: string; rate: string; amount: string }>
): Promise<schema.DraftPosSale> {
  const updateData = { ...draft, updatedAt: sql`now()` };
  const [updatedDraft] = await db.update(schema.draftPosSales)
    .set(updateData)
    .where(eq(schema.draftPosSales.id, id))
    .returning();

  if (items) {
    await db.delete(schema.draftPosSaleItems)
      .where(eq(schema.draftPosSaleItems.draftId, id));

    if (items.length > 0) {
      const draftItems = items.map(item => ({
        draftId: id,
        stockItemId: item.stockItemId,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
      }));
      await db.insert(schema.draftPosSaleItems).values(draftItems);
    }
  }

  return updatedDraft;
}

export async function deleteDraftPosSale(id: number): Promise<void> {
  await db.delete(schema.draftPosSaleItems)
    .where(eq(schema.draftPosSaleItems.draftId, id));
  await db.delete(schema.draftPosSales)
    .where(eq(schema.draftPosSales.id, id));
}

// POS Shifts

export async function getCurrentShift(userId: string, locationId: number): Promise<schema.PosShift | undefined> {
  const [shift] = await db
    .select()
    .from(schema.posShifts)
    .where(
      and(
        eq(schema.posShifts.userId, userId),
        eq(schema.posShifts.locationId, locationId),
        eq(schema.posShifts.status, "open")
      )
    )
    .orderBy(desc(schema.posShifts.openedAt))
    .limit(1);
  return shift;
}

export async function getShiftById(id: number): Promise<schema.PosShift | undefined> {
  const [shift] = await db
    .select()
    .from(schema.posShifts)
    .where(eq(schema.posShifts.id, id));
  return shift;
}

export async function getShiftsByLocation(locationId: number, limit: number = 50): Promise<schema.PosShift[]> {
  return await db
    .select()
    .from(schema.posShifts)
    .where(eq(schema.posShifts.locationId, locationId))
    .orderBy(desc(schema.posShifts.openedAt))
    .limit(limit);
}

export async function openShift(shift: schema.InsertPosShift): Promise<schema.PosShift> {
  const [created] = await db
    .insert(schema.posShifts)
    .values(shift)
    .returning();
  return created;
}

export async function closeShift(id: number, closingCash: string, notes?: string): Promise<schema.PosShift> {
  const shift = await getShiftById(id);
  if (!shift) {
    throw new Error("Shift not found");
  }

  const salesVouchers = await db
    .select()
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.shiftId, id),
        eq(schema.vouchers.voucherType, "Sales"),
        isNull(schema.vouchers.deletedAt)
      )
    );

  const salesCount = salesVouchers.length;
  const salesTotal = salesVouchers.reduce((sum, v) => sum + parseFloat(v.totalAmount || "0"), 0);

  const openingCash = parseFloat(shift.openingCash || "0");
  const expectedCash = openingCash + salesTotal;
  const actualClosing = parseFloat(closingCash);
  const variance = actualClosing - expectedCash;

  const [updated] = await db
    .update(schema.posShifts)
    .set({
      status: "closed",
      closedAt: sql`now()`,
      closingCash: closingCash,
      expectedCash: expectedCash.toFixed(2),
      variance: variance.toFixed(2),
      salesCount: salesCount,
      salesTotal: salesTotal.toFixed(2),
      notes: notes || null,
    })
    .where(eq(schema.posShifts.id, id))
    .returning();
  return updated;
}

export async function updateShiftStats(id: number, salesCount: number, salesTotal: string): Promise<void> {
  await db
    .update(schema.posShifts)
    .set({
      salesCount: salesCount,
      salesTotal: salesTotal,
    })
    .where(eq(schema.posShifts.id, id));
}
