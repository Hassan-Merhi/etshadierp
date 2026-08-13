import Decimal from "decimal.js";
import { ConvergenceReconciliationError } from "../accounting/convergenceReconciliation";
import type { StockTransferMovementEvidence } from "./databaseStockTransferConvergenceAdapter";

export interface CanonicalStockTransferMovementRow {
  companyId: number;
  sourceType: string;
  sourceId: string;
  quantityDelta: string;
  unitCost: string;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConvergenceReconciliationError("CONVERGENCE_DATABASE_ROW_INVALID", `${field} must be a positive integer`);
  }
  return parsed;
}

function decimal(value: unknown, field: string): Decimal {
  const normalized = String(value ?? "").trim();
  try {
    const parsed = new Decimal(normalized);
    if (!normalized || !parsed.isFinite()) throw new Error("invalid");
    return parsed;
  } catch {
    throw new ConvergenceReconciliationError("CONVERGENCE_DATABASE_ROW_INVALID", `${field} must be a finite decimal`);
  }
}

function identity(sourceType: unknown, sourceId: unknown): string {
  const type = String(sourceType ?? "").trim();
  const id = String(sourceId ?? "").trim();
  if (!type || !id) {
    throw new ConvergenceReconciliationError(
      "CONVERGENCE_IDENTITY_INVALID",
      "Canonical stock transfer movement requires sourceType and sourceId"
    );
  }
  return `${type}:${id}`;
}

/**
 * Converts canonical stock movement rows into logical stock-transfer evidence.
 * Because a transfer has equal-and-opposite location legs, net aggregation would
 * incorrectly produce zero. We compare the positive receipt leg while requiring
 * the issue and receipt quantities and values to balance exactly.
 */
export function summarizeCanonicalStockTransferEvidence(input: {
  companyId: number;
  rows: CanonicalStockTransferMovementRow[];
}): StockTransferMovementEvidence[] {
  const companyId = positiveInteger(input.companyId, "companyId");
  const grouped = new Map<
    string,
    {
      sourceId: string;
      positiveQuantity: Decimal;
      negativeQuantity: Decimal;
      positiveValue: Decimal;
      negativeValue: Decimal;
      rowCount: number;
    }
  >();

  for (const row of input.rows) {
    if (positiveInteger(row.companyId, "movement.companyId") !== companyId) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_COMPANY_MISMATCH",
        `Canonical movement ${row.sourceId} crossed the requested company boundary`
      );
    }

    const key = identity(row.sourceType, row.sourceId);
    if (String(row.sourceType).trim() !== "stock-transfer") {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_UNEXPECTED_STOCK_EVIDENCE",
        `Canonical movement ${key} is not stock-transfer evidence`
      );
    }

    const quantity = decimal(row.quantityDelta, "movement.quantityDelta");
    const unitCost = decimal(row.unitCost, "movement.unitCost");
    if (quantity.isZero() || unitCost.isNegative()) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_STOCK_EVIDENCE_INVALID",
        `Canonical movement ${key} has an invalid transfer quantity or unit cost`
      );
    }

    let group = grouped.get(key);
    if (!group) {
      group = {
        sourceId: String(row.sourceId).trim(),
        positiveQuantity: new Decimal(0),
        negativeQuantity: new Decimal(0),
        positiveValue: new Decimal(0),
        negativeValue: new Decimal(0),
        rowCount: 0,
      };
      grouped.set(key, group);
    }

    const quantityAbs = quantity.abs();
    const valueAbs = quantityAbs.mul(unitCost);
    if (quantity.isPositive()) {
      group.positiveQuantity = group.positiveQuantity.plus(quantityAbs);
      group.positiveValue = group.positiveValue.plus(valueAbs);
    } else {
      group.negativeQuantity = group.negativeQuantity.plus(quantityAbs);
      group.negativeValue = group.negativeValue.plus(valueAbs);
    }
    group.rowCount += 1;
  }

  return Array.from(grouped.entries()).map(([key, group]) => {
    if (
      group.rowCount < 2 ||
      group.positiveQuantity.isZero() ||
      group.negativeQuantity.isZero() ||
      !group.positiveQuantity.eq(group.negativeQuantity) ||
      !group.positiveValue.eq(group.negativeValue)
    ) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_STOCK_EVIDENCE_UNBALANCED",
        `Canonical transfer ${key} does not have exactly balanced issue/receipt evidence`
      );
    }

    return {
      sourceType: "stock-transfer",
      sourceId: group.sourceId,
      companyId,
      movementQuantity: group.positiveQuantity.toFixed(),
      movementValue: group.positiveValue.toFixed(),
    };
  });
}
