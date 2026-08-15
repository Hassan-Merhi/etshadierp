import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";
import type {} from "@shared/schema";

export async function getStockItemTransactions(
  stockItemId: number,
  companyId: number,
  startDate?: string,
  endDate?: string
): Promise<unknown[]> {
  const conditions = [eq(schema.vouchers.companyId, companyId), eq(schema.vouchers.optional, false)];
  if (startDate) conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
  if (endDate) conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);

  const salesItems = await db
    .select({
      id: schema.salesItems.id,
      type: sql<string>`'sales'`.as("type"),
      voucherId: schema.salesItems.voucherId,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherDate: schema.vouchers.voucherDate,
      quantity: schema.salesItems.quantity,
      rate: schema.salesItems.sellingPrice,
      totalAmount: schema.salesItems.totalSales,
      stockItemId: schema.salesItems.stockItemId,
      notes: schema.vouchers.description,
    })
    .from(schema.salesItems)
    .leftJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
    .where(and(eq(schema.salesItems.stockItemId, stockItemId), ...conditions));

  const transferItems = await db
    .select({
      id: schema.stockTransferItems.id,
      type: sql<string>`'transfer'`.as("type"),
      voucherId: schema.stockTransferVouchers.voucherId,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherDate: schema.vouchers.voucherDate,
      quantity: schema.stockTransferItems.quantity,
      rate: schema.stockTransferItems.rate,
      totalAmount: schema.stockTransferItems.totalAmount,
      stockItemId: schema.stockTransferItems.stockItemId,
      notes: schema.stockTransferVouchers.notes,
    })
    .from(schema.stockTransferItems)
    .leftJoin(schema.stockTransferVouchers, eq(schema.stockTransferItems.transferId, schema.stockTransferVouchers.id))
    .leftJoin(schema.vouchers, eq(schema.stockTransferVouchers.voucherId, schema.vouchers.id))
    .where(and(eq(schema.stockTransferItems.stockItemId, stockItemId), ...conditions));

  const adjustmentItems = await db
    .select({
      id: schema.stockAdjustmentItems.id,
      type: sql<string>`'adjustment'`.as("type"),
      voucherId: schema.stockAdjustmentVouchers.voucherId,
      voucherNumber: schema.vouchers.voucherNumber,
      voucherDate: schema.vouchers.voucherDate,
      quantity: schema.stockAdjustmentItems.quantity,
      rate: schema.stockAdjustmentItems.rate,
      totalAmount: schema.stockAdjustmentItems.totalAmount,
      stockItemId: schema.stockAdjustmentItems.stockItemId,
      notes: schema.stockAdjustmentVouchers.notes,
    })
    .from(schema.stockAdjustmentItems)
    .leftJoin(
      schema.stockAdjustmentVouchers,
      eq(schema.stockAdjustmentItems.adjustmentId, schema.stockAdjustmentVouchers.id)
    )
    .leftJoin(schema.vouchers, eq(schema.stockAdjustmentVouchers.voucherId, schema.vouchers.id))
    .where(and(eq(schema.stockAdjustmentItems.stockItemId, stockItemId), ...conditions));

  const allTransactions = [...salesItems, ...transferItems, ...adjustmentItems].sort((a, b) => {
    if (!a.voucherDate || !b.voucherDate) return 0;
    return new Date(b.voucherDate).getTime() - new Date(a.voucherDate).getTime();
  });

  return allTransactions;
}

// ---------------------------------------------------------------------------
// VoucherEntry CRUD
// ---------------------------------------------------------------------------
