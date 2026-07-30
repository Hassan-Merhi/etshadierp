import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";

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
  const [shift] = await db.select().from(schema.posShifts).where(eq(schema.posShifts.id, id));
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
  const [created] = await db.insert(schema.posShifts).values(shift).returning();
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
      and(eq(schema.vouchers.shiftId, id), eq(schema.vouchers.voucherType, "Sales"), isNull(schema.vouchers.deletedAt))
    );

  const salesCount = salesVouchers.length;
  const salesTotal = salesVouchers.reduce((sum, voucher) => sum + parseFloat(voucher.totalAmount || "0"), 0);
  const openingCash = parseFloat(shift.openingCash || "0");
  const expectedCash = openingCash + salesTotal;
  const actualClosing = parseFloat(closingCash);
  const variance = actualClosing - expectedCash;

  const [updated] = await db
    .update(schema.posShifts)
    .set({
      status: "closed",
      closedAt: sql`now()`,
      closingCash,
      expectedCash: expectedCash.toFixed(2),
      variance: variance.toFixed(2),
      salesCount,
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
    .set({ salesCount, salesTotal })
    .where(eq(schema.posShifts.id, id));
}
