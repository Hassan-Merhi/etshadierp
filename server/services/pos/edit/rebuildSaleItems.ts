/**
 * server/services/pos/edit/rebuildSaleItems.ts
 *
 * PHASE 20 structural split — moved (unchanged) from
 * server/routes/pos/posEditSaleRoutes.ts:
 *   - recreation of sales_items rows for the edited sale
 *   - new inventory deduction for the edited quantities
 *
 * Every message, status code, and query is byte-identical to the original —
 * only the code location changed.
 */
import { salesItems, inventory, stockItemLocationPrices } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { adjustInventory } from "../../../inventoryHelper";

export interface RebuildSaleItemsResult {
  grandTotal: number;
  totalSupplierCostEdit: number;
  totalQtySoldEdit: number;
}

/**
 * Creates new sales items and applies new inventory movements for the edited
 * sale. Sorted by stockItemId for consistent lock ordering (same reason as
 * the reversal loop) — prevents deadlocks with concurrent sale transactions.
 */
export async function rebuildSaleItems(
  tx: any,
  params: {
    voucherId: number;
    targetLocationId: number;
    items: any[];
    oldItemsMap: Map<number, any>;
    canSellNegativeStock: boolean;
    companyId: number;
  }
): Promise<RebuildSaleItemsResult> {
  const { voucherId, targetLocationId, items, oldItemsMap, canSellNegativeStock, companyId } = params;

  const sortedNewItems = [...items].sort((a: any, b: any) => a.stockItemId - b.stockItemId);
  let grandTotal = 0;
  let totalSupplierCostEdit = 0;
  let totalQtySoldEdit = 0;

  for (const item of sortedNewItems) {
    const { id, stockItemId, quantity, sellingPrice } = item;

    // Get inventory record for validation and deduction
    const [inventoryRecord] = await tx
      .select()
      .from(inventory)
      .where(and(eq(inventory.locationId, targetLocationId), eq(inventory.stockItemId, stockItemId)))
      .limit(1);

    const currentQty = inventoryRecord ? parseFloat(inventoryRecord.quantity) : 0;
    const sellQty = parseFloat(quantity);

    // Only check stock if user cannot sell negative stock
    if (currentQty < sellQty && !canSellNegativeStock) {
      throw new Error(`Insufficient stock for item ${stockItemId}. Available: ${currentQty}, Requested: ${sellQty}`);
    }

    // Preserve historical cost from old sale line if it exists (by line ID), otherwise use current cost
    // Items with id field are existing items, items without id are new items
    const oldItem = id !== undefined && id > 0 ? oldItemsMap.get(id) : null;
    const costPrice = oldItem ? parseFloat(oldItem.costPrice || "0") : parseFloat(inventoryRecord?.averageRate || "0");

    // Use the entered selling price directly - don't override with configured price during edits
    // This preserves the original sale price and prevents unintended cash balance changes
    const effectiveSellingPrice = parseFloat(sellingPrice);

    const totalSales = sellQty * effectiveSellingPrice;
    const totalCost = sellQty * costPrice;
    const profit = totalSales - totalCost;

    // Look up configured price for this item at this location
    const [editLocPrice] = await tx
      .select()
      .from(stockItemLocationPrices)
      .where(
        and(eq(stockItemLocationPrices.stockItemId, stockItemId), eq(stockItemLocationPrices.locationId, targetLocationId))
      )
      .limit(1);
    const editConfiguredPriceNum = parseFloat(editLocPrice?.sellingPrice || "0");

    // Create new sales item
    await tx.insert(salesItems).values({
      voucherId,
      stockItemId,
      quantity: quantity,
      sellingPrice: effectiveSellingPrice.toFixed(2),
      costPrice: costPrice.toString(),
      totalSales: totalSales.toFixed(2),
      totalCost: totalCost.toFixed(2),
      profit: profit.toFixed(2),
      configuredPrice: editConfiguredPriceNum > 0 ? editConfiguredPriceNum.toFixed(6) : null,
    });

    // Deduct from inventory using adjustInventory (sale = negative delta)
    await adjustInventory(tx, targetLocationId, stockItemId, -sellQty, companyId);

    grandTotal += totalSales;
    totalSupplierCostEdit += totalCost;
    totalQtySoldEdit += sellQty;
  }

  return { grandTotal, totalSupplierCostEdit, totalQtySoldEdit };
}
