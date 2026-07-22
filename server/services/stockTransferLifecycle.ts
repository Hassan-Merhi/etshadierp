import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { adjustInventory } from "../inventoryHelper";
import {
  inventory,
  locations,
  stockItems,
  stockTransferItems,
  stockTransferVouchers,
  vouchers,
} from "@shared/schema";

export interface StockTransferLifecycleItem {
  stockItemId: number;
  sourceLocationId: number;
  quantity: number;
  rate: number;
}

export interface SaveStockTransferLifecycleInput {
  companyId: number;
  transferId: number;
  destinationLocationId: number;
  notes: string;
  items: StockTransferLifecycleItem[];
  voucherDate?: string;
  description?: string;
}

export interface StockTransferLifecycleResult {
  voucherId: number;
  transferId: number;
  optional: boolean;
  inventoryApplied: boolean;
  transition: "draft-edit" | "post" | "unpost" | "posted-edit" | "no-op";
  items: Array<typeof stockTransferItems.$inferSelect>;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function normalizeItems(items: StockTransferLifecycleItem[], destinationLocationId: number): StockTransferLifecycleItem[] {
  if (!Array.isArray(items) || items.length === 0) throw new Error("At least one stock transfer item is required");

  const merged = new Map<string, StockTransferLifecycleItem>();
  for (const raw of items) {
    const stockItemId = positiveInteger(raw.stockItemId, "Stock item ID");
    const sourceLocationId = positiveInteger(raw.sourceLocationId, "Source location ID");
    if (sourceLocationId === destinationLocationId) throw new Error("Source and destination locations must be different");

    const quantity = Number(raw.quantity);
    const rate = Number(raw.rate);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Transfer quantity must be greater than zero");
    if (!Number.isFinite(rate) || rate < 0) throw new Error("Transfer rate cannot be negative");

    const key = `${stockItemId}:${sourceLocationId}`;
    const existing = merged.get(key);
    if (existing) {
      const totalQuantity = existing.quantity + quantity;
      const weightedRate = totalQuantity > 0 ? (existing.quantity * existing.rate + quantity * rate) / totalQuantity : rate;
      merged.set(key, { stockItemId, sourceLocationId, quantity: totalQuantity, rate: weightedRate });
    } else {
      merged.set(key, { stockItemId, sourceLocationId, quantity, rate });
    }
  }
  return Array.from(merged.values()).sort(
    (a, b) => a.stockItemId - b.stockItemId || a.sourceLocationId - b.sourceLocationId
  );
}

async function lockTransfer(tx: any, transferId: number) {
  const result = await tx.execute(sql`
    SELECT stv.*, v.company_id, v.optional, v.voucher_type, v.deleted_at
    FROM stock_transfer_vouchers stv
    JOIN vouchers v ON v.id = stv.voucher_id
    WHERE stv.id = ${transferId}
    FOR UPDATE OF stv, v
  `);
  return result.rows?.[0] ?? result[0];
}

async function loadTransferItems(tx: any, transferId: number) {
  return tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));
}

async function reverseAppliedItems(
  tx: any,
  companyId: number,
  destinationLocationId: number,
  items: Array<typeof stockTransferItems.$inferSelect>
) {
  for (const item of [...items].sort((a, b) => a.stockItemId - b.stockItemId || (a.sourceLocationId ?? 0) - (b.sourceLocationId ?? 0))) {
    const sourceLocationId = item.sourceLocationId;
    if (!sourceLocationId) throw new Error(`Transfer item ${item.id} is missing its source location`);
    const quantity = Number(item.quantity);
    const rate = Number(item.rate ?? 0);
    await adjustInventory(tx, sourceLocationId, item.stockItemId, quantity, companyId, rate);
    await adjustInventory(tx, destinationLocationId, item.stockItemId, -quantity, companyId);
  }
}

async function validateAndApplyItems(
  tx: any,
  companyId: number,
  destinationLocationId: number,
  items: StockTransferLifecycleItem[]
) {
  const sourceLocationIds = Array.from(new Set(items.map((item) => item.sourceLocationId)));
  const locationIds = [...sourceLocationIds, destinationLocationId];
  const companyLocations = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.companyId, companyId), inArray(locations.id, locationIds)));
  if (companyLocations.length !== locationIds.length) {
    throw new Error("One or more transfer locations do not belong to the current company");
  }

  const itemIds = Array.from(new Set(items.map((item) => item.stockItemId)));
  const companyItems = await tx
    .select({ id: stockItems.id })
    .from(stockItems)
    .where(and(eq(stockItems.companyId, companyId), inArray(stockItems.id, itemIds)));
  if (companyItems.length !== itemIds.length) throw new Error("One or more stock items do not belong to the current company");

  const requiredBySourceItem = new Map<string, number>();
  for (const item of items) {
    const key = `${item.sourceLocationId}:${item.stockItemId}`;
    requiredBySourceItem.set(key, (requiredBySourceItem.get(key) ?? 0) + item.quantity);
  }

  for (const item of items) {
    const key = `${item.sourceLocationId}:${item.stockItemId}`;
    if (!requiredBySourceItem.has(key)) continue;
    const required = requiredBySourceItem.get(key)!;
    requiredBySourceItem.delete(key);
    const locked = await tx.execute(sql`
      SELECT quantity
      FROM inventory
      WHERE company_id = ${companyId}
        AND location_id = ${item.sourceLocationId}
        AND stock_item_id = ${item.stockItemId}
      FOR UPDATE
    `);
    const row = locked.rows?.[0] ?? locked[0];
    const available = Number(row?.quantity ?? 0);
    if (available + 1e-9 < required) {
      throw new Error(
        `Insufficient stock for item ${item.stockItemId} at source ${item.sourceLocationId}: required ${required}, available ${available}`
      );
    }
  }

  for (const item of items) {
    await adjustInventory(tx, item.sourceLocationId, item.stockItemId, -item.quantity, companyId);
    await adjustInventory(tx, destinationLocationId, item.stockItemId, item.quantity, companyId, item.rate);
  }
}

async function replaceTransferItems(tx: any, transferId: number, items: StockTransferLifecycleItem[]) {
  await tx.delete(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));
  return tx
    .insert(stockTransferItems)
    .values(
      items.map((item) => ({
        transferId,
        stockItemId: item.stockItemId,
        sourceLocationId: item.sourceLocationId,
        quantity: item.quantity.toFixed(3),
        rate: item.rate.toFixed(2),
        totalAmount: (item.quantity * item.rate).toFixed(2),
      }))
    )
    .returning();
}

/**
 * Saves a transfer according to its two persisted lifecycle flags.
 *
 * optional=true, inventoryApplied=false  -> draft edit, records only
 * optional=false, inventoryApplied=false -> post once
 * optional=true, inventoryApplied=true   -> unpost once, then records only
 * optional=false, inventoryApplied=true  -> reverse old + apply new posted edit
 */
export async function saveStockTransferLifecycle(input: SaveStockTransferLifecycleInput): Promise<StockTransferLifecycleResult> {
  const companyId = positiveInteger(input.companyId, "Company ID");
  const transferId = positiveInteger(input.transferId, "Transfer ID");
  const destinationLocationId = positiveInteger(input.destinationLocationId, "Destination location ID");
  const normalizedItems = normalizeItems(input.items, destinationLocationId);

  return db.transaction(async (tx) => {
    const locked = await lockTransfer(tx, transferId);
    if (!locked) throw new Error("Stock transfer not found");
    if (Number(locked.company_id) !== companyId) throw new Error("Stock transfer belongs to a different company");
    if (locked.voucher_type !== "Stock Transfer") throw new Error("Voucher is not a stock transfer");
    if (locked.deleted_at) throw new Error("Deleted stock transfers cannot be changed");

    const voucherId = Number(locked.voucher_id);
    const wasApplied = Boolean(locked.inventory_applied);
    const willBeOptional = Boolean(locked.optional);
    const oldDestinationLocationId = Number(locked.destination_location_id);
    const oldItems = await loadTransferItems(tx, transferId);

    let transition: StockTransferLifecycleResult["transition"];
    if (wasApplied && willBeOptional) transition = "unpost";
    else if (wasApplied && !willBeOptional) transition = "posted-edit";
    else if (!wasApplied && !willBeOptional) transition = "post";
    else transition = "draft-edit";

    if (wasApplied) await reverseAppliedItems(tx, companyId, oldDestinationLocationId, oldItems);

    const savedItems = await replaceTransferItems(tx, transferId, normalizedItems);
    const shouldApply = !willBeOptional;
    if (shouldApply) await validateAndApplyItems(tx, companyId, destinationLocationId, normalizedItems);

    const totalAmount = normalizedItems.reduce((sum, item) => sum + item.quantity * item.rate, 0);
    await tx
      .update(stockTransferVouchers)
      .set({
        sourceLocationId: normalizedItems[0].sourceLocationId,
        destinationLocationId,
        notes: input.notes,
        inventoryApplied: shouldApply,
      })
      .where(eq(stockTransferVouchers.id, transferId));

    const voucherUpdates: Record<string, unknown> = {
      totalAmount: totalAmount.toFixed(2),
      locationId: normalizedItems[0].sourceLocationId,
    };
    if (input.voucherDate !== undefined) voucherUpdates.voucherDate = input.voucherDate;
    if (input.description !== undefined) voucherUpdates.description = input.description;
    await tx.update(vouchers).set(voucherUpdates).where(eq(vouchers.id, voucherId));

    return {
      voucherId,
      transferId,
      optional: willBeOptional,
      inventoryApplied: shouldApply,
      transition,
      items: savedItems,
    };
  });
}

export async function finalizeOptionalStockTransfer(companyIdInput: number, voucherIdInput: number) {
  const companyId = positiveInteger(companyIdInput, "Company ID");
  const voucherId = positiveInteger(voucherIdInput, "Voucher ID");

  return db.transaction(async (tx) => {
    const lockedResult = await tx.execute(sql`
      SELECT stv.*, v.company_id, v.optional, v.voucher_type, v.deleted_at
      FROM stock_transfer_vouchers stv
      JOIN vouchers v ON v.id = stv.voucher_id
      WHERE stv.voucher_id = ${voucherId}
      FOR UPDATE OF stv, v
    `);
    const locked = lockedResult.rows?.[0] ?? lockedResult[0];
    if (!locked) throw new Error("Stock transfer not found");
    if (Number(locked.company_id) !== companyId) throw new Error("Stock transfer belongs to a different company");
    if (locked.voucher_type !== "Stock Transfer") throw new Error("Voucher is not a stock transfer");
    if (locked.deleted_at) throw new Error("Deleted stock transfers cannot be finalized");

    if (Boolean(locked.inventory_applied) && !Boolean(locked.optional)) {
      return { voucherId, transferId: Number(locked.id), inventoryApplied: true, alreadyFinalized: true };
    }
    if (Boolean(locked.inventory_applied)) {
      throw new Error("Draft lifecycle is inconsistent: optional transfer already has inventory applied");
    }

    const transferId = Number(locked.id);
    const destinationLocationId = Number(locked.destination_location_id);
    const persistedItems = await loadTransferItems(tx, transferId);
    if (persistedItems.length === 0) throw new Error("Stock transfer has no items");
    const items = normalizeItems(
      persistedItems.map((item) => ({
        stockItemId: item.stockItemId,
        sourceLocationId: item.sourceLocationId ?? Number(locked.source_location_id),
        quantity: Number(item.quantity),
        rate: Number(item.rate ?? 0),
      })),
      destinationLocationId
    );

    await validateAndApplyItems(tx, companyId, destinationLocationId, items);
    await tx.update(stockTransferVouchers).set({ inventoryApplied: true }).where(eq(stockTransferVouchers.id, transferId));
    await tx.update(vouchers).set({ optional: false }).where(eq(vouchers.id, voucherId));

    return { voucherId, transferId, inventoryApplied: true, alreadyFinalized: false };
  });
}
