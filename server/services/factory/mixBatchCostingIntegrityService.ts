import Decimal from "decimal.js";

export interface MixBatchSourceIdentity {
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
}

export interface MixBatchActor {
  userId?: string | number | null;
  username?: string | null;
  reason?: string | null;
}

export interface MixBatchComponentRequest {
  supplierId: number;
  quantityKg: string;
  expectedUnitCostPerKg: string;
  expectedRawStockVersion?: number | null;
}

export interface MixBatchCostingRequest {
  companyId: number;
  batchId: string;
  currency: string;
  occurredAt: string;
  components: MixBatchComponentRequest[];
  source: MixBatchSourceIdentity;
  actor?: MixBatchActor;
}

export interface LockedSupplierCostState {
  supplierId: number;
  currency: string;
  quantityKg: string;
  totalCost: string;
  unitCostPerKg: string;
  version: number;
}

export interface MixBatchComponentResult {
  supplierId: number;
  quantityKg: string;
  unitCostPerKg: string;
  value: string;
  beforeQuantityKg: string;
  afterQuantityKg: string;
  beforeTotalCost: string;
  afterTotalCost: string;
  rawStockVersion: number;
}

export interface MixBatchCostingResult {
  companyId: number;
  batchId: string;
  currency: string;
  totalQuantityKg: string;
  totalValue: string;
  weightedUnitCostPerKg: string;
  components: MixBatchComponentResult[];
  idempotent: boolean;
}

export interface MixBatchCostingAdapter {
  findExisting(input: {
    tx: any;
    companyId: number;
    batchId: string;
    source: MixBatchSourceIdentity;
  }): Promise<MixBatchCostingResult | null>;
  validateOwnership(input: {
    tx: any;
    companyId: number;
    batchId: string;
    supplierIds: number[];
  }): Promise<void>;
  lockSupplierStates(input: {
    tx: any;
    companyId: number;
    supplierIds: number[];
  }): Promise<LockedSupplierCostState[]>;
  appendSupplierDeductions(input: {
    tx: any;
    request: MixBatchCostingRequest;
    components: MixBatchComponentResult[];
  }): Promise<void>;
  persistSupplierStates(input: {
    tx: any;
    companyId: number;
    states: Array<{
      supplierId: number;
      expectedVersion: number;
      quantityKg: string;
      totalCost: string;
      unitCostPerKg: string;
      nextVersion: number;
    }>;
  }): Promise<void>;
  persistMixBatchCost(input: {
    tx: any;
    request: MixBatchCostingRequest;
    result: MixBatchCostingResult;
  }): Promise<void>;
  recordIdempotency(input: {
    tx: any;
    request: MixBatchCostingRequest;
    result: MixBatchCostingResult;
  }): Promise<void>;
  recordAudit(input: {
    tx: any;
    request: MixBatchCostingRequest;
    result: MixBatchCostingResult;
  }): Promise<void>;
}

export class MixBatchCostingValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MixBatchCostingValidationError";
    this.code = code;
  }
}

function positiveId(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new MixBatchCostingValidationError("MIX_BATCH_ID_INVALID", `${field} must be a positive integer`);
  }
  return Number(value);
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new MixBatchCostingValidationError("MIX_BATCH_FIELD_REQUIRED", `${field} is required`);
  }
  return normalized;
}

function normalizeCurrency(value: unknown): string {
  const currency = requiredText(value, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new MixBatchCostingValidationError("MIX_BATCH_CURRENCY_INVALID", "currency must be a 3-letter code");
  }
  return currency;
}

function decimal(value: unknown, field: string, options: { allowZero?: boolean } = {}): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(String(value));
  } catch {
    throw new MixBatchCostingValidationError("MIX_BATCH_AMOUNT_INVALID", `${field} is invalid`);
  }
  if (!parsed.isFinite() || parsed.isNegative() || (!options.allowZero && parsed.isZero())) {
    throw new MixBatchCostingValidationError(
      "MIX_BATCH_AMOUNT_INVALID",
      `${field} must be ${options.allowZero ? "non-negative" : "positive"}`
    );
  }
  return parsed;
}

export function validateMixBatchCostingRequest(request: MixBatchCostingRequest): {
  currency: string;
  supplierIds: number[];
} {
  positiveId(request.companyId, "companyId");
  requiredText(request.batchId, "batchId");
  requiredText(request.occurredAt, "occurredAt");
  requiredText(request.source.sourceType, "source.sourceType");
  requiredText(request.source.sourceId, "source.sourceId");
  requiredText(request.source.idempotencyKey, "source.idempotencyKey");
  const currency = normalizeCurrency(request.currency);

  if (!Array.isArray(request.components) || request.components.length === 0) {
    throw new MixBatchCostingValidationError("MIX_BATCH_COMPONENTS_REQUIRED", "At least one mix-batch component is required");
  }

  const seen = new Set<number>();
  const supplierIds = request.components.map((component, index) => {
    const supplierId = positiveId(component.supplierId, `components[${index}].supplierId`);
    if (seen.has(supplierId)) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_DUPLICATE_SUPPLIER",
        `Supplier ${supplierId} appears more than once in the same mix batch`
      );
    }
    seen.add(supplierId);
    decimal(component.quantityKg, `components[${index}].quantityKg`);
    decimal(component.expectedUnitCostPerKg, `components[${index}].expectedUnitCostPerKg`, { allowZero: true });
    if (
      component.expectedRawStockVersion != null &&
      (!Number.isInteger(component.expectedRawStockVersion) || component.expectedRawStockVersion < 0)
    ) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_VERSION_INVALID",
        `components[${index}].expectedRawStockVersion is invalid`
      );
    }
    return supplierId;
  });

  return { currency, supplierIds: supplierIds.sort((a, b) => a - b) };
}

/**
 * Canonical transaction-owned mix-batch costing boundary.
 *
 * Every supplier state is locked in deterministic order. Component value is
 * derived from the supplier's locked unit cost; callers cannot inject a new
 * rate. Deductions reduce quantity and total cost proportionally, preserving
 * each supplier's cost/kg exactly. The resulting batch cost is the sum of those
 * historical component values and does not re-average any supplier balance.
 */
export async function createMixBatchCostTx(
  tx: any,
  request: MixBatchCostingRequest,
  adapter: MixBatchCostingAdapter
): Promise<MixBatchCostingResult> {
  const validated = validateMixBatchCostingRequest(request);

  const existing = await adapter.findExisting({
    tx,
    companyId: request.companyId,
    batchId: request.batchId,
    source: request.source,
  });
  if (existing) return { ...existing, idempotent: true };

  await adapter.validateOwnership({
    tx,
    companyId: request.companyId,
    batchId: request.batchId,
    supplierIds: validated.supplierIds,
  });

  const lockedStates = await adapter.lockSupplierStates({
    tx,
    companyId: request.companyId,
    supplierIds: validated.supplierIds,
  });
  if (lockedStates.length !== validated.supplierIds.length) {
    throw new MixBatchCostingValidationError(
      "MIX_BATCH_SUPPLIER_STATE_MISSING",
      "One or more supplier raw-stock states could not be locked"
    );
  }

  const statesBySupplier = new Map(lockedStates.map((state) => [state.supplierId, state]));
  let totalQuantity = new Decimal(0);
  let totalValue = new Decimal(0);

  const components = request.components.map((component): MixBatchComponentResult => {
    const state = statesBySupplier.get(component.supplierId);
    if (!state) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_SUPPLIER_STATE_MISSING",
        `Missing locked state for supplier ${component.supplierId}`
      );
    }
    if (normalizeCurrency(state.currency) !== validated.currency) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_CURRENCY_MISMATCH",
        `Supplier ${component.supplierId} currency ${state.currency} does not match ${validated.currency}`
      );
    }
    if (!Number.isInteger(state.version) || state.version < 0) {
      throw new MixBatchCostingValidationError("MIX_BATCH_VERSION_INVALID", "Locked supplier state version is invalid");
    }
    if (component.expectedRawStockVersion != null && component.expectedRawStockVersion !== state.version) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_VERSION_CONFLICT",
        `Supplier ${component.supplierId} expected version ${component.expectedRawStockVersion} but locked version is ${state.version}`
      );
    }

    const quantity = decimal(component.quantityKg, "component.quantityKg");
    const availableQuantity = decimal(state.quantityKg, "state.quantityKg", { allowZero: true });
    const totalCost = decimal(state.totalCost, "state.totalCost", { allowZero: true });
    const unitCost = decimal(state.unitCostPerKg, "state.unitCostPerKg", { allowZero: true });
    const expectedUnitCost = decimal(component.expectedUnitCostPerKg, "component.expectedUnitCostPerKg", {
      allowZero: true,
    });

    if (!availableQuantity.isZero() && !totalCost.div(availableQuantity).eq(unitCost)) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_SUPPLIER_STATE_INCONSISTENT",
        `Supplier ${component.supplierId} quantity, total cost, and unit cost are inconsistent`
      );
    }
    if (availableQuantity.isZero() && (!totalCost.isZero() || !unitCost.isZero())) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_SUPPLIER_STATE_INCONSISTENT",
        `Supplier ${component.supplierId} has cost without quantity`
      );
    }
    if (!expectedUnitCost.eq(unitCost)) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_RATE_CONFLICT",
        `Supplier ${component.supplierId} cost/kg changed from ${expectedUnitCost.toFixed()} to ${unitCost.toFixed()}`
      );
    }
    if (quantity.gt(availableQuantity)) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_INSUFFICIENT_STOCK",
        `Supplier ${component.supplierId} has ${availableQuantity.toFixed()} kg but ${quantity.toFixed()} kg was requested`
      );
    }

    const value = quantity.mul(unitCost);
    const afterQuantity = availableQuantity.minus(quantity);
    const afterTotalCost = totalCost.minus(value);
    if (afterQuantity.isZero() && !afterTotalCost.isZero()) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_DEPLETION_COST_REMAINDER",
        `Supplier ${component.supplierId} would retain cost after full depletion`
      );
    }
    if (!afterQuantity.isZero() && !afterTotalCost.div(afterQuantity).eq(unitCost)) {
      throw new MixBatchCostingValidationError(
        "MIX_BATCH_SUPPLIER_RATE_DRIFT",
        `Supplier ${component.supplierId} cost/kg would change during mix-batch deduction`
      );
    }

    totalQuantity = totalQuantity.plus(quantity);
    totalValue = totalValue.plus(value);

    return {
      supplierId: component.supplierId,
      quantityKg: quantity.toFixed(),
      unitCostPerKg: unitCost.toFixed(),
      value: value.toFixed(),
      beforeQuantityKg: availableQuantity.toFixed(),
      afterQuantityKg: afterQuantity.toFixed(),
      beforeTotalCost: totalCost.toFixed(),
      afterTotalCost: afterTotalCost.toFixed(),
      rawStockVersion: state.version,
    };
  });

  const result: MixBatchCostingResult = {
    companyId: request.companyId,
    batchId: request.batchId,
    currency: validated.currency,
    totalQuantityKg: totalQuantity.toFixed(),
    totalValue: totalValue.toFixed(),
    weightedUnitCostPerKg: totalValue.div(totalQuantity).toFixed(),
    components,
    idempotent: false,
  };

  await adapter.appendSupplierDeductions({ tx, request, components });
  await adapter.persistSupplierStates({
    tx,
    companyId: request.companyId,
    states: components.map((component) => ({
      supplierId: component.supplierId,
      expectedVersion: component.rawStockVersion,
      quantityKg: component.afterQuantityKg,
      totalCost: component.afterTotalCost,
      unitCostPerKg: component.unitCostPerKg,
      nextVersion: component.rawStockVersion + 1,
    })),
  });
  await adapter.persistMixBatchCost({ tx, request, result });
  await adapter.recordIdempotency({ tx, request, result });
  await adapter.recordAudit({ tx, request, result });

  return result;
}
