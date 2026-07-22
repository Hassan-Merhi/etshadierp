import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
  transition: "draft-edit" | "post" | "unpost" | "posted-edit" | "no-op" | "recover";
  totalAmount: string;
  items: Array<typeof stockTransferItems.$inferSelect>;
}

export interface SourceStockRequirement {
  sourceLocationId: number;
  stockItemId: number;
  quantity: number;
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
    (a, b) => a.sourceLocationId - b.sourceLocationId || a.stockItemId - b.stockItemId
  );
}

export function aggregateSourceStockRequirements(
  items: Array<Pick<StockTransferLifecycleItem, "sourceLocationId" | "stockItemId" | "quantity">>
): SourceStockRequirement[] {
  const requirements = new Map<string, SourceStockRequirement>();
  for (const item of items) {
    const key = `${item.sourceLocationId}:${item.stockItemId}`;
    const existing = requirements.get(key);
    if (existing) existing.quantity += item.quantity;
    else requirements.set(key, { ...item });
  }
  return Array.from(requirements.values()).sort(
    (a, b) => a.sourceLocationId - b.sourceLocationId || a.stockItemId - b.stockItemId
  );
}

async function lockTransfer(tx: any, transferId: number) {
  const result = await tx.execute(sql`
    SELECT stv.*, v.company_id, v.optional, v.voucher_type, v.deleted_at, v.total_amount
    FROM stock_transfer_vouchers stv
    JOIN vouchers v ON v.id = stv.voucher_id
    WHERE stv.id = ${transferId}
    FOR UPDATE OF stv, v
  `);
  return result.rows?.[0] ?? result[0];
}

async function lockTransferByVoucher(tx: any, voucherId: number) {
  const result = await tx.execute(sql`
    SELECT stv.*, v.company_id, v.optional, v.voucher_type, v.deleted_at, v.total_amount
    FROM stock_transfer_vouchers stv
    JOIN vouchers v ON v.id = stv.voucher_id
    WHERE stv.voucher_id = ${voucherId}
    FOR UPDATE OF stv, v
  `);
  return result.rows?.[0] ?? result[0];
}

async function loadTransferItems(tx: any, transferId: number) {
  return tx.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));
}

function persistedRowsToItems(
  rows: Array<typeof stockTransferItems.$inferSelect>,
  fallbackSourceLocationId: number | null | undefined,
  destinationLocationId: number
): StockTransferLifecycleItem[] {
  return normalizeItems(
    rows.map((item) => {
      const sourceLocationId = item.sourceLocationId ?? fallbackSourceLocationId;
      if (!sourceLocationId) throw new Error(`Transfer item ${item.id} is missing its source location`);
      return {
        stockItemId: item.stockItemId,
        sourceLocationId,
        quantity: Number(item.quantity),
        rate: Number(item.rate ?? 0),
      };
    }),
    destinationLocationId
  );
}

async function assertCompanyScope(
  tx: any,
  companyId: number,
  destinationLocationId: number,
  items: StockTransferLifecycleItem[]
) {
  const locationIds = Array.from(
    new Set([destinationLocationId, ...items.map((item) => item.sourceLocationId)])
  );
  const companyLocations = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.companyId, companyId),
        inArray(locations.id, locationIds),
        isNull(locations.deletedAt)
      )
    );
  if (companyLocations.length !== locationIds.length) {
    throw new Error("One or more transfer locations do not belong to the current company");
  }

  const itemIds = Array.from(new Set(items.map((item) => item.stockItemId)));
  const companyItems = await tx
    .select({ id: stockItems.id })
    .from(stockItems)
    .where(
      and(
        eq(stockItems.companyId, companyId),
        inArray(stockItems.id, itemIds),
        eq(stockItems.active, true),
        isNull(stockItems.deletedAt)
      )
    );
  if (companyItems.length !== itemIds.length) {
    throw new Error("One or more stock items do not belong to the current company or are inactive");
  }
}

async function reverseAppliedItems(
  tx: any,
  companyId: number,
  destinationLocationId: number,
  items: StockTransferLifecycleItem[]
) {
  for (const item of items) {
    await adjustInventory(tx, item.sourceLocationId, item.stockItemId, item.quantity, companyId, item.rate);
    await adjustInventory(tx, destinationLocationId, item.stockItemId, -item.quantity, companyId);
  }
}

async function validateAndApplyItems(
  tx: any,
  companyId: number,
  destinationLocationId: number,
  items: StockTransferLifecycleItem[]
) {
  await assertCompanyScope(tx, companyId, destinationLocationId, items);
  const requirements = aggregateSourceStockRequirements(items);

  // Lock in deterministic source/item order. This serializes concurrent approvals
  // touching the same stock and prevents two transfers from consuming one balance.
  for (const requirement of requirements) {
    const locked = await tx.execute(sql`
      SELECT quantity
      FROM inventory
      WHERE company_id = ${companyId}
        AND location_id = ${requirement.sourceLocationId}
        AND stock_item_id = ${requirement.stockItemId}
      FOR UPDATE
    `);
    const row = locked.rows?.[0] ?? locked[0];
    const available = Number(row?.quantity ?? 0);
    if (available + 1e-9 < requirement.quantity) {
      const error: any = new Error(
        `Insufficient stock for item ${requirement.stockItemId} at source ${requirement.sourceLocationId}: ` +
          `required ${requirement.quantity}, available ${available}`
      );
      error.code = "STOCK_TRANSFER_INSUFFICIENT_STOCK";
      error.stockItemId = requirement.stockItemId;
      error.sourceLocationId = requirement.sourceLocationId;
      error.requiredQuantity = requirement.quantity;
      error.availableQuantity = available;
      throw error;
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

function headerSourceLocationId(items: StockTransferLifecycleItem[]): number | null {
  const unique = Array.from(new Set(items.map((item) => item.sourceLocationId)));
  return unique.length === 1 ? unique[0] : null;
}

/**
 * Saves a transfer according to its two persisted lifecycle flags.
 *
 * optional=true, inventoryApplied=false  -> draft edit, records only
 * optional=false, inventoryApplied=false -> post once (legacy recovery)
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
    if (locked.voucher_type !== "Stock Transfer" && locked.voucher_type !== "StockTransfer") {
      throw new Error("Voucher is not a stock transfer");
    }
    if (locked.deleted_at) throw new Error("Deleted stock transfers cannot be changed");

    const voucherId = Number(locked.voucher_id);
    const wasApplied = Boolean(locked.inventory_applied);
    const willBeOptional = Boolean(locked.optional);
    const oldDestinationLocationId = Number(locked.destination_location_id);
    const oldRows = await loadTransferItems(tx, transferId);
    const oldItems = oldRows.length
      ? persistedRowsToItems(oldRows, locked.source_location_id ? Number(locked.source_location_id) : null, oldDestinationLocationId)
      : [];

    let transition: StockTransferLifecycleResult["transition"];
    if (wasApplied && willBeOptional) transition = "unpost";
    else if (wasApplied && !willBeOptional) transition = "posted-edit";
    else if (!wasApplied && !willBeOptional) transition = "post";
    else transition = "draft-edit";

    if (wasApplied && oldItems.length > 0) {
      await reverseAppliedItems(tx, companyId, oldDestinationLocationId, oldItems);
    }

    await assertCompanyScope(tx, companyId, destinationLocationId, normalizedItems);
    const savedItems = await replaceTransferItems(tx, transferId, normalizedItems);
    const shouldApply = !willBeOptional;
    if (shouldApply) await validateAndApplyItems(tx, companyId, destinationLocationId, normalizedItems);

    const totalAmount = normalizedItems.reduce((sum, item) => sum + item.quantity * item.rate, 0);
    await tx
      .update(stockTransferVouchers)
      .set({
        sourceLocationId: headerSourceLocationId(normalizedItems),
        destinationLocationId,
        notes: input.notes,
        inventoryApplied: shouldApply,
      })
      .where(eq(stockTransferVouchers.id, transferId));

    const voucherUpdates: Record<string, unknown> = { totalAmount: totalAmount.toFixed(2) };
    if (headerSourceLocationId(normalizedItems)) voucherUpdates.locationId = headerSourceLocationId(normalizedItems);
    if (input.voucherDate !== undefined) voucherUpdates.voucherDate = input.voucherDate;
    if (input.description !== undefined) voucherUpdates.description = input.description;
    await tx.update(vouchers).set(voucherUpdates).where(eq(vouchers.id, voucherId));

    return {
      voucherId,
      transferId,
      optional: willBeOptional,
      inventoryApplied: shouldApply,
      transition,
      totalAmount: totalAmount.toFixed(2),
      items: savedItems,
    };
  });
}

/**
 * Finalizes a base optional stock transfer. Voucher, transfer and source stock
 * are locked in one transaction, then stock is validated and applied exactly once.
 */
export async function finalizeOptionalStockTransfer(
  companyIdInput: number,
  voucherIdInput: number
): Promise<StockTransferLifecycleResult> {
  const companyId = positiveInteger(companyIdInput, "Company ID");
  const voucherId = positiveInteger(voucherIdInput, "Voucher ID");

  return db.transaction(async (tx) => {
    const locked = await lockTransferByVoucher(tx, voucherId);
    if (!locked) throw new Error("Stock transfer not found");
    if (Number(locked.company_id) !== companyId) throw new Error("Stock transfer belongs to a different company");
    if (locked.voucher_type !== "Stock Transfer" && locked.voucher_type !== "StockTransfer") {
      throw new Error("Voucher is not a stock transfer");
    }
    if (locked.deleted_at) throw new Error("Deleted stock transfers cannot be finalized");

    const transferId = Number(locked.id);
    const destinationLocationId = Number(locked.destination_location_id);
    const persistedRows = await loadTransferItems(tx, transferId);
    if (persistedRows.length === 0) throw new Error("Stock transfer has no items");
    const items = persistedRowsToItems(
      persistedRows,
      locked.source_location_id ? Number(locked.source_location_id) : null,
      destinationLocationId
    );
    await assertCompanyScope(tx, companyId, destinationLocationId, items);
    const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.rate, 0).toFixed(2);

    const inventoryApplied = Boolean(locked.inventory_applied);
    const optional = Boolean(locked.optional);

    if (inventoryApplied && !optional) {
      return {
        voucherId,
        transferId,
        optional: false,
        inventoryApplied: true,
        transition: "no-op",
        totalAmount,
        items: persistedRows,
      };
    }

    let transition: StockTransferLifecycleResult["transition"] = "post";
    if (!inventoryApplied) {
      await validateAndApplyItems(tx, companyId, destinationLocationId, items);
    } else {
      // Legacy mismatch: stock already moved while header remained optional.
      // Repair only the flags; never move stock a second time.
      transition = "recover";
    }

    await tx
      .update(stockTransferVouchers)
      .set({ inventoryApplied: true })
      .where(eq(stockTransferVouchers.id, transferId));
    await tx
      .update(vouchers)
      .set({ optional: false, totalAmount })
      .where(eq(vouchers.id, voucherId));

    return {
      voucherId,
      transferId,
      optional: false,
      inventoryApplied: true,
      transition,
      totalAmount,
      items: persistedRows,
    };
  });
}

export async function finalizeStockTransferByTransferId(companyIdInput: number, transferIdInput: number) {
  const companyId = positiveInteger(companyIdInput, "Company ID");
  const transferId = positiveInteger(transferIdInput, "Transfer ID");
  const [transfer] = await db
    .select({ voucherId: stockTransferVouchers.voucherId })
    .from(stockTransferVouchers)
    .where(eq(stockTransferVouchers.id, transferId))
    .limit(1);
  if (!transfer) throw new Error("Stock transfer not found");
  return finalizeOptionalStockTransfer(companyId, transfer.voucherId);
}

/** Reopens a posted stock transfer as a draft, reversing stock at most once. */
export async function reopenStockTransferAsDraft(
  companyIdInput: number,
  voucherIdInput: number,
  headerUpdates: { voucherDate?: string; description?: string } = {}
): Promise<StockTransferLifecycleResult> {
  const companyId = positiveInteger(companyIdInput, "Company ID");
  const voucherId = positiveInteger(voucherIdInput, "Voucher ID");

  return db.transaction(async (tx) => {
    const locked = await lockTransferByVoucher(tx, voucherId);
    if (!locked) throw new Error("Stock transfer not found");
    if (Number(locked.company_id) !== companyId) throw new Error("Stock transfer belongs to a different company");
    if (locked.voucher_type !== "Stock Transfer" && locked.voucher_type !== "StockTransfer") {
      throw new Error("Voucher is not a stock transfer");
    }
    if (locked.deleted_at) throw new Error("Deleted stock transfers cannot be changed");

    const transferId = Number(locked.id);
    const destinationLocationId = Number(locked.destination_location_id);
    const persistedRows = await loadTransferItems(tx, transferId);
    const items = persistedRowsToItems(
      persistedRows,
      locked.source_location_id ? Number(locked.source_location_id) : null,
      destinationLocationId
    );

    if (Boolean(locked.inventory_applied)) {
      await reverseAppliedItems(tx, companyId, destinationLocationId, items);
    }

    await tx
      .update(stockTransferVouchers)
      .set({ inventoryApplied: false })
      .where(eq(stockTransferVouchers.id, transferId));
    await tx
      .update(vouchers)
      .set({
        optional: true,
        ...(headerUpdates.voucherDate !== undefined ? { voucherDate: headerUpdates.voucherDate } : {}),
        ...(headerUpdates.description !== undefined ? { description: headerUpdates.description } : {}),
      })
      .where(eq(vouchers.id, voucherId));

    return {
      voucherId,
      transferId,
      optional: true,
      inventoryApplied: false,
      transition: Boolean(locked.inventory_applied) ? "unpost" : "no-op",
      totalAmount: String(locked.total_amount ?? "0"),
      items: persistedRows,
    };
  });
}
