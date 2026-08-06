/**
 * server/services/pos/edit/reverseOriginalSaleInventory.ts
 *
 * Reversal of the original sale's inventory movements and removal of the old
 * sale rows before an edited sale is rebuilt.
 */
import { salesItems, voucherEntries } from "@shared/schema";
import { eq } from "drizzle-orm";
import { adjustInventory } from "../../../inventoryHelper";
import { toInventoryDecimal } from "../../../lib/inventoryMath";

/**
 * Add back the old quantities without passing a rate. POS activity must not
 * change the inventory cost basis during a reversal.
 */
export async function reverseOriginalSaleInventory(
  tx: any,
  existingVoucher: any,
  oldSalesItems: any[]
): Promise<void> {
  for (const oldItem of oldSalesItems) {
    const oldQuantity = toInventoryDecimal(oldItem.quantity);
    await adjustInventory(
      tx,
      existingVoucher.locationId!,
      oldItem.stockItemId,
      oldQuantity.toNumber(),
      existingVoucher.companyId
    );
  }
}

export async function clearOldSaleRecords(tx: any, voucherId: number): Promise<void> {
  await tx.delete(salesItems).where(eq(salesItems.voucherId, voucherId));
  await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));
}
