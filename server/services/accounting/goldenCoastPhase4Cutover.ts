import Decimal from "decimal.js";

export const GOLDEN_COAST_PHASE4_CUTOVER_DATE = "2026-09-01";
export const GOLDEN_COAST_PHASE4_OPENING_SOURCE = "opening_cutover";
export const GOLDEN_COAST_PHASE4_CONFIRMATION = "BUILD GC OPENING FIFO";

export class GoldenCoastPhase4Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenCoastPhase4Error";
  }
}

export interface GoldenCoastOpeningInventoryRow {
  stockItemId: number;
  locationId: number;
  articleCode: string;
  quantity: string | number;
  averageRate: string | number;
}

export function goldenCoastPhase4CutoverNotOpenMessage(): string {
  return `Opening FIFO cannot be built before ${GOLDEN_COAST_PHASE4_CUTOVER_DATE}`;
}

export function goldenCoastPhase4OpeningLotDescription(): string {
  return `Golden Coast ${GOLDEN_COAST_PHASE4_CUTOVER_DATE} opening FIFO bridge`;
}

function decimal(value: string | number, label: string): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new GoldenCoastPhase4Error(`${label} must be numeric`);
  }
  if (!parsed.isFinite()) throw new GoldenCoastPhase4Error(`${label} must be finite`);
  return parsed;
}

export function summarizeGoldenCoastOpeningInventory(rows: readonly GoldenCoastOpeningInventoryRow[]) {
  let totalQuantity = new Decimal(0);
  let totalValue = new Decimal(0);

  for (const [index, row] of rows.entries()) {
    if (!Number.isInteger(row.stockItemId) || row.stockItemId <= 0) {
      throw new GoldenCoastPhase4Error(`rows[${index}].stockItemId must be a positive integer`);
    }
    if (!Number.isInteger(row.locationId) || row.locationId <= 0) {
      throw new GoldenCoastPhase4Error(`rows[${index}].locationId must be a positive integer`);
    }
    if (!row.articleCode.trim()) throw new GoldenCoastPhase4Error(`rows[${index}].articleCode is required`);

    const quantity = decimal(row.quantity, `rows[${index}].quantity`);
    const rate = decimal(row.averageRate, `rows[${index}].averageRate`);
    if (quantity.lte(0)) throw new GoldenCoastPhase4Error(`rows[${index}].quantity must be > 0`);
    if (rate.lt(0)) throw new GoldenCoastPhase4Error(`rows[${index}].averageRate must be >= 0`);

    totalQuantity = totalQuantity.plus(quantity);
    totalValue = totalValue.plus(quantity.times(rate));
  }

  return {
    rowCount: rows.length,
    totalQuantity: totalQuantity.toFixed(4),
    totalValueUsd: totalValue.toFixed(2),
  };
}

export function reconcileGoldenCoastOpeningInventory(input: {
  stockInHandOpeningUsd: string | number;
  rows: readonly GoldenCoastOpeningInventoryRow[];
}) {
  const stockInHandOpening = decimal(input.stockInHandOpeningUsd, "stockInHandOpeningUsd");
  if (stockInHandOpening.lt(0)) throw new GoldenCoastPhase4Error("stockInHandOpeningUsd must be >= 0");
  const snapshot = summarizeGoldenCoastOpeningInventory(input.rows);
  const difference = new Decimal(snapshot.totalValueUsd).minus(stockInHandOpening);

  return {
    ...snapshot,
    stockInHandOpeningUsd: stockInHandOpening.toFixed(2),
    differenceUsd: difference.toFixed(2),
    reconciled: difference.abs().lte("0.01"),
  };
}

const DATE_FIELDS = ["voucherDate", "saleDate", "offloadDate", "paymentDate", "chargeDate", "date"] as const;

export function assertGoldenCoastPostCutoverMutationDates(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  const input = body as Record<string, unknown>;
  for (const field of DATE_FIELDS) {
    const value = input[field];
    if (value == null || value === "") continue;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new GoldenCoastPhase4Error(`${field} must be YYYY-MM-DD`);
    }
    if (value < GOLDEN_COAST_PHASE4_CUTOVER_DATE) {
      throw new GoldenCoastPhase4Error(
        `Pre-cutover Golden Coast records are read-only; ${field} cannot be before ${GOLDEN_COAST_PHASE4_CUTOVER_DATE}`
      );
    }
  }
}
