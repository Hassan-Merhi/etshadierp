/**
 * server/services/pos/edit/reverseOriginalSaleInventory.ts
 *
 * Reversal of the original sale's inventory movements and removal of the old
 * sale rows before an edited sale is rebuilt.
 */
import { salesItems, voucherEntries } from "@shared/schema";
import { eq } from "drizzle-orm";
import { adjustInventory } from "../../../inventoryHelper";
import { inventoryQuantity, inventoryUnitCost, toInventoryDecimal } from "../../../lib/inventoryMath";
import { createDatabaseStockMovementAdapter } from "../../inventory/databaseStockMovementAdapter";
import { postStockMovementTx } from "../../inventory/stockMovementIntegrityService";

const canonicalStockMovementAdapter = createDatabaseStockMovementAdapter();

/**
 * Add back the old quantities without passing a rate. POS activity must not
 * change the inventory cost basis during a reversal.
 */
export async function reverseOriginalSaleInventory(
  tx: any,
  existingVoucher: any,
  oldSalesItems: any[],
  canonicalRevision?: number
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

    // The stock came back at the cost it left at — the reversal must not
    // restate the cost basis, which is why no rate is passed above either.
    if (canonicalRevision !== undefined && !oldQuantity.isZero()) {
      await postStockMovementTx(
        tx,
        {
          companyId: existingVoucher.companyId,
          stockItemId: oldItem.stockItemId,
          kind: "receipt",
          quantity: inventoryQuantity(oldQuantity),
          unitCost: inventoryUnitCost(toInventoryDecimal(oldItem.costPrice)),
          toLocationId: existingVoucher.locationId,
          occurredAt: new Date().toISOString(),
          source: {
            sourceType: "pos-sale",
            sourceId: String(existingVoucher.id),
            idempotencyKey: `pos-sale:${existingVoucher.id}:rev${canonicalRevision}:reverse:${oldItem.stockItemId}`,
          },
          allowNegativeStock: true,
        },
        canonicalStockMovementAdapter
      );
    }
  }
}

export async function clearOldSaleRecords(tx: any, voucherId: number): Promise<void> {
  await tx.delete(salesItems).where(eq(salesItems.voucherId, voucherId));
  await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));
}
