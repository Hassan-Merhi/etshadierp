import { sql } from "drizzle-orm";

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

// ─────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────

async function createNegativeLayer(
  tx: TxOrDb,
  companyId: number,
  locationId: number,
  stockItemId: number,
  qty: number,
  provisionalRate: number,
  sourceVoucherType?: string,
  sourceVoucherId?: number
): Promise<void> {
  await (tx as any).execute(sql`
    INSERT INTO inventory_negative_layers
      (company_id, location_id, stock_item_id, qty, provisional_rate, source_voucher_type, source_voucher_id)
    VALUES
      (${companyId}, ${locationId}, ${stockItemId}, ${qty.toFixed(3)},
       ${provisionalRate.toFixed(4)}, ${sourceVoucherType ?? null}, ${sourceVoucherId ?? null})
  `);
}

/**
 * Settle oldest negative layers FIFO using the actual incoming rate.
 * Returns { settled: qty consumed from layers, remaining: qty left for positive inventory }.
 */
async function settleNegativeLayers(
  tx: TxOrDb,
  locationId: number,
  stockItemId: number,
  incomingQty: number,
  incomingRate: number
): Promise<{ settled: number; remaining: number }> {
  const result = await (tx as any).execute(sql`
    SELECT id, qty, provisional_rate
    FROM inventory_negative_layers
    WHERE location_id = ${locationId} AND stock_item_id = ${stockItemId}
    ORDER BY id ASC
    FOR UPDATE
  `);
  const rows: any[] = result.rows ?? result;

  let remaining = incomingQty;
  let settled = 0;

  for (const layer of rows) {
    if (remaining <= 0.0005) break;
    const layerQty = parseFloat(layer.qty ?? "0");
    const consume = Math.min(layerQty, remaining);
    settled += consume;
    remaining -= consume;

    const variance = (incomingRate - parseFloat(layer.provisional_rate ?? "0")) * consume;
    if (Math.abs(variance) > 0.01) {
      console.log(
        `[settleNegativeLayers] Cost variance: loc=${locationId} item=${stockItemId} ` +
          `qty=${consume.toFixed(3)} provisional=${layer.provisional_rate} actual=${incomingRate} variance=${variance.toFixed(2)}`
      );
    }

    if (layerQty - consume < 0.0005) {
      await (tx as any).execute(sql`DELETE FROM inventory_negative_layers WHERE id = ${layer.id}`);
    } else {
      await (tx as any).execute(sql`
        UPDATE inventory_negative_layers
        SET qty = ${(layerQty - consume).toFixed(3)}, updated_at = NOW()
        WHERE id = ${layer.id}
      `);
    }
  }

  return { settled, remaining: Math.max(remaining, 0) };
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Core inventory costing function — Tally-like negative-stock model.
 *
 * Rules:
 *  - inventory.totalValue  always ≥ 0  (only positive on-hand stock is valued)
 *  - inventory.averageRate preserved even when qty ≤ 0  (cost memory)
 *  - outgoing beyond zero  → negative layer created with provisional rate
 *  - incoming             → settles oldest layers FIFO, then adds to positive stock
 *  - averageRate is recalculated only from positive on-hand qty
 */
export async function adjustInventory(
  tx: TxOrDb,
  locationId: number,
  stockItemId: number,
  deltaQty: number,
  companyId: number,
  incomingRate?: number,
  sourceVoucherType?: string,
  sourceVoucherId?: number
): Promise<AdjustInventoryResult> {
  const lockResult = await (tx as any).execute(sql`
    SELECT id, quantity, average_rate, total_value
    FROM inventory
    WHERE location_id = ${locationId} AND stock_item_id = ${stockItemId}
    FOR UPDATE
  `);
  const existing = lockResult.rows?.[0] ?? lockResult[0];

  if (existing) {
    const prevQty = parseFloat(existing.quantity ?? "0");
    const prevRate = parseFloat(existing.average_rate ?? "0");
    const prevTotalValue = parseFloat(existing.total_value ?? "0");
    const newQty = prevQty + deltaQty;

    let newTotalValue: number;
    let newRate: number;

    if (deltaQty > 0) {
      // ── INCOMING: settle negative layers first, then add to positive stock ──
      const effectiveRate = incomingRate ?? prevRate;
      const { remaining } = await settleNegativeLayers(tx, locationId, stockItemId, deltaQty, effectiveRate);

      const addValue = remaining * effectiveRate;
      newTotalValue = Math.max(prevTotalValue + addValue, 0);

      if (newQty > 0) {
        newRate = newTotalValue / newQty;
      } else {
        // All incoming absorbed by negative layers; net qty still ≤ 0
        newTotalValue = 0;
        newRate = effectiveRate; // preserve for cost memory
      }
    } else if (deltaQty < 0) {
      // ── OUTGOING ─────────────────────────────────────────────────────────────
      const effectiveRate = Math.max(prevRate, 0);

      if (newQty > 0) {
        // Normal deduction from positive stock
        const deductionValue = Math.abs(deltaQty) * effectiveRate;
        newTotalValue = Math.max(prevTotalValue - deductionValue, 0);
        newRate = newTotalValue / newQty;
      } else if (newQty === 0) {
        newTotalValue = 0;
        newRate = effectiveRate; // keep for cost memory
      } else {
        // ── Goes short: consume all positive stock, create negative layer ──
        const shortageQty = Math.abs(newQty);
        const provisionalRate = effectiveRate > 0 ? effectiveRate : prevRate;

        newTotalValue = 0;
        newRate = provisionalRate > 0 ? provisionalRate : 0; // cost memory

        await createNegativeLayer(
          tx,
          companyId,
          locationId,
          stockItemId,
          shortageQty,
          provisionalRate,
          sourceVoucherType,
          sourceVoucherId
        );
      }
    } else {
      // deltaQty === 0: no-op
      newTotalValue = prevTotalValue;
      newRate = prevRate;
    }

    // Safety clamps
    if (newRate < 0) newRate = 0;
    if (newQty > 0 && newTotalValue < 0) {
      newTotalValue = 0;
      newRate = 0;
    }
    if (newQty <= 0) newTotalValue = 0;

    await (tx as any).execute(sql`
      UPDATE inventory
      SET quantity     = ${newQty.toFixed(3)},
          average_rate = ${newRate.toFixed(2)},
          total_value  = ${newTotalValue.toFixed(2)},
          last_updated = NOW()
      WHERE id = ${existing.id}
    `);

    return {
      previousQuantity: prevQty,
      newQuantity: newQty,
      previousTotalValue: prevTotalValue,
      newTotalValue,
      averageRate: newRate,
      created: false,
    };
  } else {
    // ── No existing row: INSERT ───────────────────────────────────────────────
    const rate = Math.max(incomingRate ?? 0, 0);
    let qty = deltaQty;
    let totalValue = 0;
    let safeRate = rate;

    if (deltaQty > 0) {
      const { remaining } = await settleNegativeLayers(tx, locationId, stockItemId, deltaQty, rate);
      totalValue = remaining * rate;
      safeRate = qty > 0 && totalValue > 0 ? totalValue / qty : rate;
    } else if (deltaQty < 0) {
      // Negative stock from the very first touch
      totalValue = 0;
      safeRate = 0;
      await createNegativeLayer(
        tx,
        companyId,
        locationId,
        stockItemId,
        Math.abs(deltaQty),
        rate,
        sourceVoucherType,
        sourceVoucherId
      );
    }

    await (tx as any).execute(sql`
      INSERT INTO inventory (company_id, location_id, stock_item_id, quantity, average_rate, total_value, last_updated)
      VALUES (${companyId}, ${locationId}, ${stockItemId}, ${qty.toFixed(3)}, ${safeRate.toFixed(2)}, ${totalValue.toFixed(2)}, NOW())
      ON CONFLICT (location_id, stock_item_id) DO UPDATE
      SET quantity     = inventory.quantity + ${qty},
          total_value  = CASE
            WHEN inventory.quantity + ${qty} > 0
            THEN GREATEST(inventory.total_value + ${totalValue}, 0)
            ELSE 0
          END,
          average_rate = CASE
            WHEN inventory.quantity + ${qty} > 0
            THEN GREATEST(inventory.total_value + ${totalValue}, 0) / (inventory.quantity + ${qty})
            ELSE EXCLUDED.average_rate
          END,
          last_updated = NOW()
    `);

    return {
      previousQuantity: 0,
      newQuantity: qty,
      previousTotalValue: 0,
      newTotalValue: totalValue,
      averageRate: safeRate,
      created: true,
    };
  }
}

/**
 * Reverse an exact qty + value previously written to inventory.
 * Used for voucher reversals — does not recalculate moving average.
 *
 * Design:
 *  - Subtracts qtyToReverse and valueToReverse exactly.
 *  - averageRate is preserved when qty ≤ 0 (cost memory, never lost).
 *  - If reversal pushes qty below zero, a negative layer is created for the shortage
 *    so that a subsequent re-receipt settles it correctly (idempotent).
 */
export async function reverseInventoryByExactValue(
  tx: TxOrDb,
  locationId: number,
  stockItemId: number,
  qtyToReverse: number,
  valueToReverse: number,
  companyId?: number,
  sourceVoucherType?: string,
  sourceVoucherId?: number
): Promise<void> {
  const lockResult = await (tx as any).execute(sql`
    SELECT id, quantity, average_rate, total_value
    FROM inventory
    WHERE location_id = ${locationId} AND stock_item_id = ${stockItemId}
    FOR UPDATE
  `);
  const existing = lockResult.rows?.[0] ?? lockResult[0];
  if (!existing) return;

  const currentQty = parseFloat(existing.quantity ?? "0");
  const currentValue = parseFloat(existing.total_value ?? "0");
  const currentRate = parseFloat(existing.average_rate ?? "0");

  const newQty = currentQty - qtyToReverse;
  let newValue = currentValue - valueToReverse;

  let newRate: number;

  if (newQty > 0) {
    newValue = Math.max(newValue, 0);
    newRate = newValue / newQty;
  } else {
    if (newValue !== 0) {
      console.warn(
        `[reverseInventoryByExactValue] Normalising: loc=${locationId} item=${stockItemId} ` +
          `newValue=${newValue} → 0 (newQty=${newQty})`
      );
    }
    newValue = 0;
    newRate = currentRate; // preserve last positive rate for cost memory

    if (newQty < 0 && companyId) {
      const shortageQty = Math.abs(newQty);
      const provisionalRate =
        currentRate > 0 ? currentRate : Math.abs(qtyToReverse > 0 ? valueToReverse / qtyToReverse : 0);
      await createNegativeLayer(
        tx,
        companyId,
        locationId,
        stockItemId,
        shortageQty,
        provisionalRate,
        sourceVoucherType,
        sourceVoucherId
      );
    }
  }

  if (newRate < 0) newRate = 0;

  await (tx as any).execute(sql`
    UPDATE inventory
    SET quantity     = ${newQty.toFixed(3)},
        average_rate = ${newRate.toFixed(2)},
        total_value  = ${newValue.toFixed(2)},
        last_updated = NOW()
    WHERE id = ${existing.id}
  `);
}
