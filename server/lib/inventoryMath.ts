import Decimal from "decimal.js";

export type InventoryNumericInput = Decimal.Value | null | undefined;

export const INVENTORY_QUANTITY_DECIMAL_PLACES = 3;
export const INVENTORY_COST_DECIMAL_PLACES = 6;
export const INVENTORY_MONEY_DECIMAL_PLACES = 2;

/**
 * Convert database, request, or calculated numeric input into a finite Decimal.
 * Invalid, empty, or non-finite values use the supplied fallback instead of
 * allowing Decimal constructor errors or NaN/Infinity to enter costing writes.
 */
export function toInventoryDecimal(value: InventoryNumericInput, fallback: InventoryNumericInput = 0): Decimal {
  const parse = (candidate: InventoryNumericInput): Decimal | null => {
    if (candidate === null || candidate === undefined || candidate === "") {
      return null;
    }

    try {
      const decimal = new Decimal(candidate);
      return decimal.isFinite() ? decimal : null;
    } catch {
      return null;
    }
  };

  return parse(value) ?? parse(fallback) ?? new Decimal(0);
}

export function addInventoryValues(...values: InventoryNumericInput[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.plus(toInventoryDecimal(value)), new Decimal(0));
}

export function subtractInventoryValues(minuend: InventoryNumericInput, subtrahend: InventoryNumericInput): Decimal {
  return toInventoryDecimal(minuend).minus(toInventoryDecimal(subtrahend));
}

export function multiplyInventoryValues(...values: InventoryNumericInput[]): Decimal {
  if (values.length === 0) {
    return new Decimal(0);
  }

  return values.reduce<Decimal>((product, value) => product.times(toInventoryDecimal(value)), new Decimal(1));
}

export function divideInventoryValues(
  dividend: InventoryNumericInput,
  divisor: InventoryNumericInput,
  fallback: InventoryNumericInput = 0
): Decimal {
  const safeDivisor = toInventoryDecimal(divisor);
  if (safeDivisor.isZero()) {
    return toInventoryDecimal(fallback);
  }

  return toInventoryDecimal(dividend).dividedBy(safeDivisor);
}

/**
 * Calculate a moving weighted-average unit cost without binary floating-point
 * arithmetic. Negative quantities are preserved so reversal flows can use the
 * same helper. A zero combined quantity returns the supplied fallback.
 */
export function weightedAverageInventoryCost(
  existingQuantity: InventoryNumericInput,
  existingUnitCost: InventoryNumericInput,
  incomingQuantity: InventoryNumericInput,
  incomingUnitCost: InventoryNumericInput,
  fallback: InventoryNumericInput = 0
): Decimal {
  const existingQty = toInventoryDecimal(existingQuantity);
  const incomingQty = toInventoryDecimal(incomingQuantity);
  const combinedQty = existingQty.plus(incomingQty);

  if (combinedQty.isZero()) {
    return toInventoryDecimal(fallback);
  }

  const existingValue = existingQty.times(toInventoryDecimal(existingUnitCost));
  const incomingValue = incomingQty.times(toInventoryDecimal(incomingUnitCost));

  return existingValue.plus(incomingValue).dividedBy(combinedQty);
}

export function roundInventoryValue(value: InventoryNumericInput, decimalPlaces: number): Decimal {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0) {
    throw new RangeError("decimalPlaces must be a non-negative integer");
  }

  return toInventoryDecimal(value).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
}

export function inventoryQuantity(value: InventoryNumericInput): string {
  return roundInventoryValue(value, INVENTORY_QUANTITY_DECIMAL_PLACES).toFixed(INVENTORY_QUANTITY_DECIMAL_PLACES);
}

export function inventoryUnitCost(value: InventoryNumericInput): string {
  return roundInventoryValue(value, INVENTORY_COST_DECIMAL_PLACES).toFixed(INVENTORY_COST_DECIMAL_PLACES);
}

export function inventoryMoney(value: InventoryNumericInput): string {
  return roundInventoryValue(value, INVENTORY_MONEY_DECIMAL_PLACES).toFixed(INVENTORY_MONEY_DECIMAL_PLACES);
}
