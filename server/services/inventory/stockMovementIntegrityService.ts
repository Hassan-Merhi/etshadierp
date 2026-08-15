import Decimal from "decimal.js";

export type StockMovementKind = "receipt" | "issue" | "transfer" | "adjustment" | "reversal";

export interface StockMovementSourceIdentity {
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
}

export interface StockMovementActor {
  userId?: string | number | null;
  username?: string | null;
  reason?: string | null;
}

export interface StockMovementRequest {
  companyId: number;
  stockItemId: number;
  kind: StockMovementKind;
  quantity: string;
  unitCost: string;
  fromLocationId?: number | null;
  toLocationId?: number | null;
  occurredAt: string;
  source: StockMovementSourceIdentity;
  actor?: StockMovementActor;
  allowNegativeStock?: boolean;
  reversalOfMovementId?: number | null;
}

export interface StockMovementRecord {
  id: number;
  companyId: number;
  stockItemId: number;
  locationId: number;
  quantityDelta: string;
  unitCost: string;
  movementKind: StockMovementKind;
  sourceType: string;
  sourceId: string;
  reversalOfMovementId?: number | null;
}

export interface StockMovementResult {
  movements: StockMovementRecord[];
  quantity: string;
  value: string;
  idempotent: boolean;
}

export interface StockMovementAdapter {
  findExisting(input: {
    tx: any;
    companyId: number;
    source: StockMovementSourceIdentity;
  }): Promise<StockMovementResult | null>;
  validateOwnership(input: {
    tx: any;
    companyId: number;
    stockItemId: number;
    locationIds: number[];
  }): Promise<void>;
  lockBalances(input: {
    tx: any;
    companyId: number;
    stockItemId: number;
    locationIds: number[];
  }): Promise<Record<number, string>>;
  appendMovements(input: {
    tx: any;
    request: StockMovementRequest;
    rows: Array<{
      locationId: number;
      quantityDelta: string;
      unitCost: string;
    }>;
  }): Promise<StockMovementRecord[]>;
  recordIdempotency(input: {
    tx: any;
    companyId: number;
    source: StockMovementSourceIdentity;
    movementIds: number[];
  }): Promise<void>;
  recordAudit(input: {
    tx: any;
    request: StockMovementRequest;
    movementIds: number[];
    quantity: string;
    value: string;
  }): Promise<void>;
}

export class StockMovementValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StockMovementValidationError";
    this.code = code;
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new StockMovementValidationError("STOCK_MOVEMENT_FIELD_REQUIRED", `${field} is required`);
  }
  return normalized;
}

function positiveId(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new StockMovementValidationError("STOCK_MOVEMENT_ID_INVALID", `${field} must be a positive integer`);
  }
  return Number(value);
}

function decimal(value: unknown, field: string, allowZero: boolean): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(String(value));
  } catch {
    throw new StockMovementValidationError("STOCK_MOVEMENT_AMOUNT_INVALID", `${field} is invalid`);
  }
  if (!parsed.isFinite() || parsed.isNegative() || (!allowZero && parsed.isZero())) {
    throw new StockMovementValidationError(
      "STOCK_MOVEMENT_AMOUNT_INVALID",
      `${field} must be a finite ${allowZero ? "non-negative" : "positive"} amount`
    );
  }
  return parsed;
}

export interface ValidatedStockMovement {
  quantity: string;
  unitCost: string;
  value: string;
  locationIds: number[];
  rows: Array<{ locationId: number; quantityDelta: string; unitCost: string }>;
}

export function validateStockMovementRequest(request: StockMovementRequest): ValidatedStockMovement {
  positiveId(request.companyId, "companyId");
  positiveId(request.stockItemId, "stockItemId");
  requiredText(request.occurredAt, "occurredAt");
  requiredText(request.source.sourceType, "sourceType");
  requiredText(request.source.sourceId, "sourceId");
  requiredText(request.source.idempotencyKey, "idempotencyKey");

  const quantity = decimal(request.quantity, "quantity", false);
  const unitCost = decimal(request.unitCost, "unitCost", true);
  const rows: ValidatedStockMovement["rows"] = [];

  const from = request.fromLocationId == null ? null : positiveId(request.fromLocationId, "fromLocationId");
  const to = request.toLocationId == null ? null : positiveId(request.toLocationId, "toLocationId");

  if (request.kind === "receipt") {
    if (!to || from) throw new StockMovementValidationError("STOCK_MOVEMENT_LOCATIONS_INVALID", "Receipt requires only toLocationId");
    rows.push({ locationId: to, quantityDelta: quantity.toFixed(), unitCost: unitCost.toFixed() });
  } else if (request.kind === "issue") {
    if (!from || to) throw new StockMovementValidationError("STOCK_MOVEMENT_LOCATIONS_INVALID", "Issue requires only fromLocationId");
    rows.push({ locationId: from, quantityDelta: quantity.negated().toFixed(), unitCost: unitCost.toFixed() });
  } else if (request.kind === "transfer") {
    if (!from || !to || from === to) {
      throw new StockMovementValidationError("STOCK_MOVEMENT_LOCATIONS_INVALID", "Transfer requires distinct from and to locations");
    }
    rows.push(
      { locationId: from, quantityDelta: quantity.negated().toFixed(), unitCost: unitCost.toFixed() },
      { locationId: to, quantityDelta: quantity.toFixed(), unitCost: unitCost.toFixed() }
    );
  } else if (request.kind === "adjustment") {
    if ((from == null) === (to == null)) {
      throw new StockMovementValidationError("STOCK_MOVEMENT_LOCATIONS_INVALID", "Adjustment requires exactly one location side");
    }
    const locationId = from ?? to!;
    rows.push({
      locationId,
      quantityDelta: from ? quantity.negated().toFixed() : quantity.toFixed(),
      unitCost: unitCost.toFixed(),
    });
  } else {
    if (!request.reversalOfMovementId) {
      throw new StockMovementValidationError("STOCK_MOVEMENT_REVERSAL_REQUIRED", "Reversal requires reversalOfMovementId");
    }
    if ((from == null) === (to == null)) {
      throw new StockMovementValidationError("STOCK_MOVEMENT_LOCATIONS_INVALID", "Reversal requires exactly one location side");
    }
    const locationId = from ?? to!;
    rows.push({
      locationId,
      quantityDelta: from ? quantity.negated().toFixed() : quantity.toFixed(),
      unitCost: unitCost.toFixed(),
    });
  }

  return {
    quantity: quantity.toFixed(),
    unitCost: unitCost.toFixed(),
    value: quantity.mul(unitCost).toFixed(),
    locationIds: [...new Set(rows.map((row) => row.locationId))].sort((a, b) => a - b),
    rows,
  };
}

/**
 * Canonical append-only stock movement boundary.
 *
 * The caller owns the surrounding transaction so source documents, accounting,
 * stock movements, and audit records commit or roll back together. Existing
 * movements are never edited or deleted; corrections are represented by new,
 * explicitly linked reversal movements.
 */
export async function postStockMovementTx(
  tx: any,
  request: StockMovementRequest,
  adapter: StockMovementAdapter
): Promise<StockMovementResult> {
  const validated = validateStockMovementRequest(request);

  const existing = await adapter.findExisting({
    tx,
    companyId: request.companyId,
    source: request.source,
  });
  if (existing) return { ...existing, idempotent: true };

  await adapter.validateOwnership({
    tx,
    companyId: request.companyId,
    stockItemId: request.stockItemId,
    locationIds: validated.locationIds,
  });

  const balances = await adapter.lockBalances({
    tx,
    companyId: request.companyId,
    stockItemId: request.stockItemId,
    locationIds: validated.locationIds,
  });

  if (!request.allowNegativeStock) {
    for (const row of validated.rows) {
      const delta = new Decimal(row.quantityDelta);
      if (delta.isNegative()) {
        const current = new Decimal(balances[row.locationId] ?? "0");
        if (current.plus(delta).isNegative()) {
          throw new StockMovementValidationError(
            "STOCK_MOVEMENT_INSUFFICIENT_QUANTITY",
            `Location ${row.locationId} has ${current.toFixed()} available but requires ${delta.abs().toFixed()}`
          );
        }
      }
    }
  }

  const movements = await adapter.appendMovements({ tx, request, rows: validated.rows });
  if (movements.length !== validated.rows.length) {
    throw new StockMovementValidationError(
      "STOCK_MOVEMENT_APPEND_INCOMPLETE",
      `Expected ${validated.rows.length} movement rows but received ${movements.length}`
    );
  }

  await adapter.recordIdempotency({
    tx,
    companyId: request.companyId,
    source: request.source,
    movementIds: movements.map((movement) => movement.id),
  });
  await adapter.recordAudit({
    tx,
    request,
    movementIds: movements.map((movement) => movement.id),
    quantity: validated.quantity,
    value: validated.value,
  });

  return {
    movements,
    quantity: validated.quantity,
    value: validated.value,
    idempotent: false,
  };
}
