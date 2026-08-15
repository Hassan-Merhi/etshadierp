import { sql } from "drizzle-orm";
import { adjustInventory, type AdjustInventoryResult } from "../../inventoryHelper";
import { getErrorMessage } from "../../lib/httpHandlers";

type SpInventoryExecutor = Parameters<typeof adjustInventory>[0];

export class SpInventoryIntegrityError extends Error {
  readonly code: "SP_INVENTORY_LINK_REQUIRED" | "SP_INVENTORY_POST_FAILED";
  readonly statusCode: 409 | 500;

  constructor(
    message: string,
    code: "SP_INVENTORY_LINK_REQUIRED" | "SP_INVENTORY_POST_FAILED",
    statusCode: 409 | 500,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "SpInventoryIntegrityError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function firstRow(result: any): any | null {
  return result?.rows?.[0] ?? result?.[0] ?? null;
}

export async function requireSpInventoryMapping(
  tx: SpInventoryExecutor,
  params: {
    companyId: number;
    locationId: unknown;
    stockItemId: unknown;
    context: string;
  }
): Promise<{ locationId: number; stockItemId: number }> {
  const locationId = positiveInteger(params.locationId);
  const stockItemId = positiveInteger(params.stockItemId);

  if (!locationId || !stockItemId) {
    throw new SpInventoryIntegrityError(
      `${params.context} requires both a mapped stock item and an active company location.`,
      "SP_INVENTORY_LINK_REQUIRED",
      409
    );
  }

  const stockItemResult = await tx.execute(sql`
    SELECT id
    FROM stock_items
    WHERE id = ${stockItemId}
      AND company_id = ${params.companyId}
    LIMIT 1
    FOR SHARE
  `);
  if (!firstRow(stockItemResult)) {
    throw new SpInventoryIntegrityError(
      `${params.context} references stock item #${stockItemId}, which is not available in this Supplier Partner company.`,
      "SP_INVENTORY_LINK_REQUIRED",
      409
    );
  }

  const locationResult = await tx.execute(sql`
    SELECT id
    FROM locations
    WHERE id = ${locationId}
      AND company_id = ${params.companyId}
      AND deleted_at IS NULL
    LIMIT 1
    FOR SHARE
  `);
  if (!firstRow(locationResult)) {
    throw new SpInventoryIntegrityError(
      `${params.context} references location #${locationId}, which is not active in this Supplier Partner company.`,
      "SP_INVENTORY_LINK_REQUIRED",
      409
    );
  }

  return { locationId, stockItemId };
}

export async function adjustSpInventoryAtomic(
  tx: SpInventoryExecutor,
  params: {
    companyId: number;
    locationId: unknown;
    stockItemId: unknown;
    deltaQty: number;
    context: string;
    incomingRate?: number;
    sourceVoucherType?: string;
    sourceVoucherId?: number;
  }
): Promise<AdjustInventoryResult> {
  const mapping = await requireSpInventoryMapping(tx, params);

  try {
    return await adjustInventory(
      tx,
      mapping.locationId,
      mapping.stockItemId,
      params.deltaQty,
      params.companyId,
      params.incomingRate,
      params.sourceVoucherType,
      params.sourceVoucherId
    );
  } catch (error: unknown) {
    if (error instanceof SpInventoryIntegrityError) throw error;
    throw new SpInventoryIntegrityError(
      `${params.context} inventory posting failed. The complete Supplier Partner transaction was rolled back: ${getErrorMessage(error)}`,
      "SP_INVENTORY_POST_FAILED",
      500,
      { cause: error }
    );
  }
}

export function respondToSpInventoryIntegrityError(res: import("express").Response, error: unknown): boolean {
  if (!(error instanceof SpInventoryIntegrityError)) return false;
  res.status(error.statusCode).json({ code: error.code, message: error.message });
  return true;
}
