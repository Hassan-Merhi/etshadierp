/**
 * server/services/pos/edit/reverseOriginalSaleInventory.ts
 *
 * PHASE 20 structural split — moved (unchanged) from
 * server/routes/pos/posEditSaleRoutes.ts:
 *   - reversal of the original sale's inventory movements
 *   - deletion of the old sales_items / voucher_entries rows
 *
 * Every message, status code, and query is byte-identical to the original —
 * only the code location changed.
 */
import { salesItems, voucherEntries } from "@shared/schema";
import { eq } from "drizzle-orm";
import { adjustInventory } from "../../../inventoryHelper";

/**
 * Reverses old inventory movements — adds back the old quantities to
 * inventory (reversal of sale). Does NOT pass a rate — cost price must never
 * change due to POS activity.
 */
export async function reverseOriginalSaleInventory(tx: any, existingVoucher: any, oldSalesItems: any[]): Promise<void> {
  for (const oldItem of oldSalesItems) {
    const oldQty = parseFloat(oldItem.quantity);

    await adjustInventory(tx, existingVoucher.locationId!, oldItem.stockItemId, oldQty, existingVoucher.companyId);
  }
}

/** Deletes the old sales items and voucher entries for the voucher being edited. */
export async function clearOldSaleRecords(tx: any, voucherId: number): Promise<void> {
  await tx.delete(salesItems).where(eq(salesItems.voucherId, voucherId));
  await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));
}
