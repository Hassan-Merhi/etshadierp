import Decimal from "decimal.js";
import { assertTransactionCompanyScope } from "../security/transactionCompanyScope";
import {
  postStockMovementTx,
  StockMovementValidationError,
  type StockMovementActor,
  type StockMovementAdapter,
  type StockMovementRecord,
  type StockMovementRequest,
  type StockMovementResult,
  type StockMovementSourceIdentity,
} from "./stockMovementIntegrityService";

export interface ExactStockMovementReversalInput {
  original: StockMovementRecord;
  occurredAt: string;
  source: StockMovementSourceIdentity;
  actor?: StockMovementActor;
}

export interface ExactStockMovementReversalRequest {
  companyId: number;
  movementId: number;
  occurredAt: string;
  source: StockMovementSourceIdentity;
  actor?: StockMovementActor;
}

export interface ExactStockMovementReversalAdapter extends StockMovementAdapter {
  lockOriginalMovement(input: { tx: any; companyId: number; movementId: number }): Promise<StockMovementRecord | null>;
}

function positiveId(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new StockMovementValidationError("STOCK_REVERSAL_ORIGINAL_INVALID", `${field} must be a positive integer`);
  }
  return Number(value);
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new StockMovementValidationError("STOCK_REVERSAL_INPUT_REQUIRED", `${field} is required`);
  }
  return normalized;
}

function finiteDecimal(value: unknown, field: string): Decimal {
  try {
    const parsed = new Decimal(String(value));
    if (!parsed.isFinite()) throw new Error("not finite");
    return parsed;
  } catch {
    throw new StockMovementValidationError("STOCK_REVERSAL_ORIGINAL_INVALID", `${field} is invalid`);
  }
}

export function buildExactStockMovementReversal(input: ExactStockMovementReversalInput): StockMovementRequest {
  const { original } = input;
  const companyId = positiveId(original.companyId, "original.companyId");
  const stockItemId = positiveId(original.stockItemId, "original.stockItemId");
  const locationId = positiveId(original.locationId, "original.locationId");
  const movementId = positiveId(original.id, "original.id");

  requiredText(input.occurredAt, "occurredAt");
  requiredText(input.source.sourceType, "source.sourceType");
  requiredText(input.source.sourceId, "source.sourceId");
  requiredText(input.source.idempotencyKey, "source.idempotencyKey");

  const originalDelta = finiteDecimal(original.quantityDelta, "original.quantityDelta");
  const unitCost = finiteDecimal(original.unitCost, "original.unitCost");
  if (originalDelta.isZero()) {
    throw new StockMovementValidationError(
      "STOCK_REVERSAL_ORIGINAL_INVALID",
      "original.quantityDelta must be non-zero"
    );
  }
  if (unitCost.isNegative()) {
    throw new StockMovementValidationError("STOCK_REVERSAL_ORIGINAL_INVALID", "original.unitCost must be non-negative");
  }
  if (original.movementKind === "reversal" || original.reversalOfMovementId) {
    throw new StockMovementValidationError(
      "STOCK_REVERSAL_CHAIN_INVALID",
      "A reversal movement cannot be reversed again; reverse the source correction explicitly"
    );
  }

  return {
    companyId,
    stockItemId,
    kind: "reversal",
    quantity: originalDelta.abs().toFixed(),
    unitCost: unitCost.toFixed(),
    fromLocationId: originalDelta.isPositive() ? locationId : null,
    toLocationId: originalDelta.isNegative() ? locationId : null,
    occurredAt: input.occurredAt,
    source: {
      sourceType: input.source.sourceType.trim(),
      sourceId: input.source.sourceId.trim(),
      idempotencyKey: input.source.idempotencyKey.trim(),
    },
    actor: input.actor,
    allowNegativeStock: false,
    reversalOfMovementId: movementId,
  };
}

export async function postExactStockMovementReversalTx(
  tx: any,
  request: ExactStockMovementReversalRequest,
  adapter: ExactStockMovementReversalAdapter
): Promise<StockMovementResult> {
  const companyId = positiveId(request.companyId, "companyId");
  const movementId = positiveId(request.movementId, "movementId");
  requiredText(request.occurredAt, "occurredAt");
  requiredText(request.source.sourceType, "source.sourceType");
  requiredText(request.source.sourceId, "source.sourceId");
  requiredText(request.source.idempotencyKey, "source.idempotencyKey");

  // The original movement is itself tenant data. Assert the PostgreSQL tenant
  // context before loading/locking it so compatible RLS protects this first read.
  await assertTransactionCompanyScope(tx, companyId);

  const original = await adapter.lockOriginalMovement({ tx, companyId, movementId });
  if (!original) {
    throw new StockMovementValidationError(
      "STOCK_REVERSAL_ORIGINAL_NOT_FOUND",
      "Original stock movement was not found in the requested company"
    );
  }
  if (original.companyId !== companyId || original.id !== movementId) {
    throw new StockMovementValidationError(
      "STOCK_REVERSAL_COMPANY_MISMATCH",
      "Locked stock movement does not match the requested company and movement"
    );
  }

  const reversal = buildExactStockMovementReversal({
    original,
    occurredAt: request.occurredAt,
    source: request.source,
    actor: request.actor,
  });
  return postStockMovementTx(tx, reversal, adapter);
}
