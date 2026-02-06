import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";

type TxOrDb = {
  select: Function;
  insert: Function;
  update: Function;
  delete: Function;
};

export interface AdjustInventoryResult {
  previousQuantity: number;
  newQuantity: number;
  previousTotalValue: number;
  newTotalValue: number;
  averageRate: number;
  created: boolean;
}

export async function adjustInventory(
  tx: TxOrDb,
  locationId: number,
  stockItemId: number,
  deltaQty: number,
  companyId: number,
  incomingRate?: number,
): Promise<AdjustInventoryResult> {
  const [existing] = await (tx as any)
    .select()
    .from(schema.inventory)
    .where(
      and(
        eq(schema.inventory.locationId, locationId),
        eq(schema.inventory.stockItemId, stockItemId),
      ),
    )
    .limit(1);

  if (existing) {
    const prevQty = parseFloat(existing.quantity || "0");
    const prevRate = parseFloat(existing.averageRate || "0");
    const prevTotalValue = parseFloat(existing.totalValue || "0");
    const newQty = prevQty + deltaQty;

    let newTotalValue: number;
    let newRate: number;

    if (deltaQty > 0 && incomingRate !== undefined) {
      newTotalValue = prevTotalValue + deltaQty * incomingRate;
      newRate = newQty > 0 ? newTotalValue / newQty : incomingRate;
    } else if (deltaQty < 0) {
      const deductionValue = Math.abs(deltaQty) * prevRate;
      newTotalValue = prevTotalValue - deductionValue;
      newRate = newQty > 0 ? newTotalValue / newQty : prevRate;
    } else {
      newTotalValue = prevTotalValue;
      newRate = prevRate;
    }

    await (tx as any)
      .update(schema.inventory)
      .set({
        quantity: newQty.toFixed(3),
        averageRate: newRate.toFixed(2),
        totalValue: newTotalValue.toFixed(2),
        lastUpdated: new Date(),
      })
      .where(eq(schema.inventory.id, existing.id));

    return {
      previousQuantity: prevQty,
      newQuantity: newQty,
      previousTotalValue: prevTotalValue,
      newTotalValue,
      averageRate: newRate,
      created: false,
    };
  } else {
    const rate = incomingRate ?? 0;
    const totalValue = deltaQty * rate;

    await (tx as any).insert(schema.inventory).values({
      companyId,
      locationId,
      stockItemId,
      quantity: deltaQty.toFixed(3),
      averageRate: rate.toFixed(2),
      totalValue: totalValue.toFixed(2),
      lastUpdated: new Date(),
    });

    return {
      previousQuantity: 0,
      newQuantity: deltaQty,
      previousTotalValue: 0,
      newTotalValue: totalValue,
      averageRate: rate,
      created: true,
    };
  }
}
