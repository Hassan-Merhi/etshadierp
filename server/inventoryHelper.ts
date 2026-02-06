import { eq, and, sql } from "drizzle-orm";
import * as schema from "@shared/schema";

type TxOrDb = {
  select: Function;
  insert: Function;
  update: Function;
  delete: Function;
  execute: Function;
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
  const lockResult = await (tx as any).execute(
    sql`SELECT id, quantity, average_rate, total_value
        FROM inventory
        WHERE location_id = ${locationId} AND stock_item_id = ${stockItemId}
        FOR UPDATE`
  );

  const existing = lockResult.rows?.[0] || lockResult[0];

  if (existing) {
    const prevQty = parseFloat(existing.quantity || "0");
    const prevRate = parseFloat(existing.average_rate || "0");
    const prevTotalValue = parseFloat(existing.total_value || "0");
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

    await (tx as any).execute(
      sql`UPDATE inventory
          SET quantity = ${newQty.toFixed(3)},
              average_rate = ${newRate.toFixed(2)},
              total_value = ${newTotalValue.toFixed(2)},
              last_updated = NOW()
          WHERE id = ${existing.id}`
    );

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

    await (tx as any).execute(
      sql`INSERT INTO inventory (company_id, location_id, stock_item_id, quantity, average_rate, total_value, last_updated)
          VALUES (${companyId}, ${locationId}, ${stockItemId}, ${deltaQty.toFixed(3)}, ${rate.toFixed(2)}, ${totalValue.toFixed(2)}, NOW())
          ON CONFLICT (location_id, stock_item_id) DO UPDATE
          SET quantity = inventory.quantity + ${deltaQty},
              total_value = inventory.total_value + ${totalValue},
              average_rate = CASE
                WHEN inventory.quantity + ${deltaQty} > 0
                THEN (inventory.total_value + ${totalValue}) / (inventory.quantity + ${deltaQty})
                ELSE ${rate}
              END,
              last_updated = NOW()`
    );

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
