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
      const effectiveRate = Math.max(prevRate, 0);
      const deductionValue = Math.abs(deltaQty) * effectiveRate;
      newTotalValue = prevTotalValue - deductionValue;

      if (newQty > 0) {
        if (newTotalValue < 0) {
          console.warn(`[adjustInventory] Clamping negative total_value to 0: loc=${locationId} item=${stockItemId} newTotalValue=${newTotalValue} newQty=${newQty}`);
          newTotalValue = 0;
        }
        newRate = newTotalValue / newQty;
      } else {
        if (newTotalValue !== 0) {
          console.warn(`[adjustInventory] Zeroing total_value for non-positive qty: loc=${locationId} item=${stockItemId} newTotalValue=${newTotalValue} newQty=${newQty}`);
        }
        newTotalValue = 0;
        newRate = 0;
      }
    } else {
      newTotalValue = prevTotalValue;
      newRate = prevRate;
    }

    if (newQty > 0 && newTotalValue < 0) {
      console.warn(`[adjustInventory] Post-branch invariant clamp: loc=${locationId} item=${stockItemId} newTotalValue=${newTotalValue} clamped to 0`);
      newTotalValue = 0;
      newRate = 0;
    } else if (newQty <= 0) {
      if (newTotalValue > 0) {
        console.warn(`[adjustInventory] Post-branch invariant clamp: loc=${locationId} item=${stockItemId} positive total_value=${newTotalValue} with non-positive qty=${newQty}, zeroing`);
      }
      newTotalValue = 0;
      newRate = 0;
    }

    if (newRate < 0) {
      console.warn(`[adjustInventory] Clamping negative rate to 0: loc=${locationId} item=${stockItemId} newRate=${newRate}`);
      newRate = 0;
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
    let totalValue = deltaQty * rate;

    let safeRate = Math.max(rate, 0);
    if (totalValue < 0 && deltaQty > 0) {
      console.warn(`[adjustInventory] INSERT path: clamping negative totalValue to 0 for positive qty: loc=${locationId} item=${stockItemId}`);
      totalValue = 0;
      safeRate = 0;
    } else if (deltaQty <= 0) {
      totalValue = 0;
      safeRate = 0;
    }

    await (tx as any).execute(
      sql`INSERT INTO inventory (company_id, location_id, stock_item_id, quantity, average_rate, total_value, last_updated)
          VALUES (${companyId}, ${locationId}, ${stockItemId}, ${deltaQty.toFixed(3)}, ${safeRate.toFixed(2)}, ${totalValue.toFixed(2)}, NOW())
          ON CONFLICT (location_id, stock_item_id) DO UPDATE
          SET quantity = inventory.quantity + ${deltaQty},
              total_value = CASE
                WHEN inventory.quantity + ${deltaQty} > 0
                THEN GREATEST(inventory.total_value + ${totalValue}, 0)
                ELSE 0
              END,
              average_rate = CASE
                WHEN inventory.quantity + ${deltaQty} > 0
                THEN GREATEST(inventory.total_value + ${totalValue}, 0) / (inventory.quantity + ${deltaQty})
                ELSE 0
              END,
              last_updated = NOW()`
    );

    return {
      previousQuantity: 0,
      newQuantity: deltaQty,
      previousTotalValue: 0,
      newTotalValue: totalValue,
      averageRate: safeRate,
      created: true,
    };
  }
}

export async function reverseInventoryByExactValue(
  tx: TxOrDb,
  locationId: number,
  stockItemId: number,
  qtyToReverse: number,
  valueToReverse: number,
): Promise<void> {
  const lockResult = await (tx as any).execute(
    sql`SELECT id, quantity, average_rate, total_value
        FROM inventory
        WHERE location_id = ${locationId} AND stock_item_id = ${stockItemId}
        FOR UPDATE`
  );
  const existing = lockResult.rows?.[0] || lockResult[0];
  if (!existing) return;

  const currentQty   = parseFloat(existing.quantity || "0");
  const currentValue = parseFloat(existing.total_value || "0");

  const newQty   = currentQty - qtyToReverse;
  let   newValue = currentValue - valueToReverse;

  let newRate: number;
  if (newQty > 0) {
    if (newValue < 0) {
      console.warn(`[ReverseInventory] Normalization: loc=${locationId} item=${stockItemId} `
        + `post-subtract newValue=${newValue} clamped to 0 (newQty=${newQty})`);
      newValue = 0;
    }
    newRate = newValue / newQty;
  } else {
    if (newValue !== 0) {
      console.warn(`[ReverseInventory] Normalization: loc=${locationId} item=${stockItemId} `
        + `post-subtract newValue=${newValue} clamped to 0 (newQty=${newQty} ≤ 0)`);
    }
    newValue = 0;
    newRate  = 0;
  }

  await (tx as any).execute(
    sql`UPDATE inventory
        SET quantity     = ${newQty.toFixed(3)},
            average_rate = ${newRate.toFixed(2)},
            total_value  = ${newValue.toFixed(2)},
            last_updated = NOW()
        WHERE id = ${existing.id}`
  );
}
