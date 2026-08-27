import Decimal from "decimal.js";
import { GOLDEN_COAST_PHASE3_CUTOVER_DATE } from "./goldenCoastPhase3Cutover";

export const GOLDEN_COAST_CUTOVER_STOCK_SOURCE = "golden_coast_cutover_opening";

export interface GoldenCoastLegacyInventoryRow {
  locationId: number;
  stockItemId: number;
  stockItemCode: string;
  stockItemName?: string | null;
  quantity: string | number;
  averageRate: string | number;
  totalValue?: string | number | null;
}

export interface GoldenCoastOpeningLot {
  locationId: number;
  stockItemId: number;
  articleCode: string;
  description: string | null;
  qtyIn: string;
  qtyRemaining: string;
  baseUnitCostUsd: string;
  landedUnitCostUsd: string;
  finalUnitCostUsd: string;
}

export interface GoldenCoastCutoverStockPlan {
  cutoverDate: string;
  sourceType: typeof GOLDEN_COAST_CUTOVER_STOCK_SOURCE;
  lots: GoldenCoastOpeningLot[];
  totalQuantity: string;
  totalValueUsd: string;
}

export class GoldenCoastCutoverStockBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenCoastCutoverStockBridgeError";
  }
}

function decimal(value: string | number | null | undefined, field: string): Decimal {
  try {
    const parsed = new Decimal(value == null || value === "" ? 0 : value);
    if (!parsed.isFinite()) throw new Error("not finite");
    return parsed;
  } catch {
    throw new GoldenCoastCutoverStockBridgeError(`${field} must be a finite number`);
  }
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function quantity(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function unitCost(value: Decimal): string {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

export function planGoldenCoastCutoverStockBridge(
  rows: readonly GoldenCoastLegacyInventoryRow[]
): GoldenCoastCutoverStockPlan {
  const seen = new Set<string>();
  const lots: GoldenCoastOpeningLot[] = [];
  let totalQuantity = new Decimal(0);
  let totalValue = new Decimal(0);

  for (const [index, row] of rows.entries()) {
    if (!Number.isInteger(row.locationId) || row.locationId <= 0) {
      throw new GoldenCoastCutoverStockBridgeError(`rows[${index}].locationId must be a positive integer`);
    }
    if (!Number.isInteger(row.stockItemId) || row.stockItemId <= 0) {
      throw new GoldenCoastCutoverStockBridgeError(`rows[${index}].stockItemId must be a positive integer`);
    }
    const articleCode = String(row.stockItemCode ?? "").trim();
    if (!articleCode) {
      throw new GoldenCoastCutoverStockBridgeError(`rows[${index}].stockItemCode is required`);
    }

    const key = `${row.locationId}:${row.stockItemId}`;
    if (seen.has(key)) {
      throw new GoldenCoastCutoverStockBridgeError(
        `Duplicate legacy inventory row for location ${row.locationId}, stock item ${row.stockItemId}`
      );
    }
    seen.add(key);

    const qty = decimal(row.quantity, `rows[${index}].quantity`);
    const avgRate = decimal(row.averageRate, `rows[${index}].averageRate`);
    if (qty.lt(0)) throw new GoldenCoastCutoverStockBridgeError(`rows[${index}].quantity cannot be negative`);
    if (avgRate.lt(0)) throw new GoldenCoastCutoverStockBridgeError(`rows[${index}].averageRate cannot be negative`);
    if (qty.eq(0)) continue;
    if (avgRate.eq(0)) {
      throw new GoldenCoastCutoverStockBridgeError(
        `Positive legacy stock ${articleCode} at location ${row.locationId} must have a positive average rate`
      );
    }

    const expectedValue = qty.times(avgRate);
    if (row.totalValue != null && row.totalValue !== "") {
      const storedValue = decimal(row.totalValue, `rows[${index}].totalValue`);
      if (storedValue.lt(0)) {
        throw new GoldenCoastCutoverStockBridgeError(`rows[${index}].totalValue cannot be negative`);
      }
      if (storedValue.minus(expectedValue).abs().gt("0.02")) {
        throw new GoldenCoastCutoverStockBridgeError(
          `Legacy inventory value mismatch for ${articleCode} at location ${row.locationId}: quantity × average rate is ${money(expectedValue)} but total value is ${money(storedValue)}`
        );
      }
    }

    totalQuantity = totalQuantity.plus(qty);
    totalValue = totalValue.plus(expectedValue);
    lots.push({
      locationId: row.locationId,
      stockItemId: row.stockItemId,
      articleCode,
      description: row.stockItemName ? String(row.stockItemName) : null,
      qtyIn: quantity(qty),
      qtyRemaining: quantity(qty),
      baseUnitCostUsd: unitCost(avgRate),
      landedUnitCostUsd: "0.000000",
      finalUnitCostUsd: unitCost(avgRate),
    });
  }

  lots.sort((a, b) => a.locationId - b.locationId || a.stockItemId - b.stockItemId);
  return {
    cutoverDate: GOLDEN_COAST_PHASE3_CUTOVER_DATE,
    sourceType: GOLDEN_COAST_CUTOVER_STOCK_SOURCE,
    lots,
    totalQuantity: quantity(totalQuantity),
    totalValueUsd: money(totalValue),
  };
}

export function assertGoldenCoastStockValueReconciles(planValueUsd: string, stockInHandOpeningUsd: string): void {
  const plan = decimal(planValueUsd, "planValueUsd");
  const ledger = decimal(stockInHandOpeningUsd, "stockInHandOpeningUsd");
  if (plan.minus(ledger).abs().gt("0.02")) {
    throw new GoldenCoastCutoverStockBridgeError(
      `Opening FIFO value ${money(plan)} does not reconcile to Phase 3 Stock in Hand ${money(ledger)}`
    );
  }
}
