import { eq } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";

export async function getStockTransferByVoucherId(voucherId: number) {
  const [transfer] = await db
    .select()
    .from(schema.stockTransferVouchers)
    .where(eq(schema.stockTransferVouchers.voucherId, voucherId));
  if (!transfer) return null;
  const items = await db
    .select()
    .from(schema.stockTransferItems)
    .where(eq(schema.stockTransferItems.transferId, transfer.id));
  return { ...transfer, items };
}

export async function getStockAdjustmentByVoucherId(voucherId: number) {
  const [adjustment] = await db
    .select()
    .from(schema.stockAdjustmentVouchers)
    .where(eq(schema.stockAdjustmentVouchers.voucherId, voucherId));
  if (!adjustment) return null;
  const items = await db
    .select()
    .from(schema.stockAdjustmentItems)
    .where(eq(schema.stockAdjustmentItems.adjustmentId, adjustment.id));
  return { ...adjustment, items };
}

// ---------------------------------------------------------------------------
// Update Stock Transfer
// ---------------------------------------------------------------------------
