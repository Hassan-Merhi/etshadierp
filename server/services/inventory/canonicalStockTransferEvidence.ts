import Decimal from "decimal.js";
import { ConvergenceReconciliationError } from "../accounting/convergenceReconciliation";
import type { StockTransferMovementEvidence } from "./databaseStockTransferConvergenceAdapter";

export interface CanonicalStockTransferMovementRow {
  companyId: number;
  sourceType: string;
  sourceId: string;
  locationId: number;
  stockItemId: number;
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
 *
 * The journal is append-only: a transfer that is edited, reopened or revised
 * does not rewrite the rows the original posting wrote, it appends a reversal
 * and then the new issue. Summing the positive legs across those rows therefore
 * answers "how much stock has this document ever moved", when reconciliation
 * asks "how much does this document currently account for" — a transfer edited
 * from ten units down to two would report twenty-two against a document of two,
 * and every edited transfer would surface as a false discrepancy.
 *
 * So the rows are netted per location and stock item first, and only the
 * surviving balances are summed. A reversal cancels the leg it reverses, and
 * what remains is the transfer's current effect. Netting across the whole
 * document instead would collapse to zero, because a transfer's two legs are
 * equal and opposite by construction; netting per location is what separates
 * "the receipt cancels the issue" from "the reversal cancels the issue".
 *
 * The issue and receipt sides are still required to balance exactly. That check
 * now runs on the netted balances, so it continues to catch a half-written
 * transfer while no longer objecting to a legitimately amended one.
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
      balances: Map<string, { quantity: Decimal; value: Decimal }>;
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
      group = { sourceId: String(row.sourceId).trim(), balances: new Map(), rowCount: 0 };
      grouped.set(key, group);
    }

    // Per location *and* stock item: two items resting at one location are two
    // independent balances, and merging them would let a shortfall in one be
    // paid for by a surplus in the other.
    const balanceKey = `${positiveInteger(row.locationId, "movement.locationId")}:${positiveInteger(
      row.stockItemId,
      "movement.stockItemId"
    )}`;
    const balance = group.balances.get(balanceKey) ?? { quantity: new Decimal(0), value: new Decimal(0) };
    balance.quantity = balance.quantity.plus(quantity);
    balance.value = balance.value.plus(quantity.mul(unitCost));
    group.balances.set(balanceKey, balance);
    group.rowCount += 1;
  }

  return Array.from(grouped.entries()).map(([key, group]) => {
    let positiveQuantity = new Decimal(0);
    let negativeQuantity = new Decimal(0);
    let positiveValue = new Decimal(0);
    let negativeValue = new Decimal(0);

    for (const balance of group.balances.values()) {
      if (balance.quantity.isPositive()) positiveQuantity = positiveQuantity.plus(balance.quantity);
      else if (balance.quantity.isNegative()) negativeQuantity = negativeQuantity.plus(balance.quantity.abs());

      // Value is accumulated on its own sign rather than the quantity's. Unit
      // cost cannot be negative, so the two normally agree; where they do not
      // is the case worth catching - a balance whose quantity nets to zero
      // while its value does not was reversed at a different price than it was
      // issued at, and folding its value in behind a zero quantity would hide
      // exactly that.
      if (balance.value.isPositive()) positiveValue = positiveValue.plus(balance.value);
      else if (balance.value.isNegative()) negativeValue = negativeValue.plus(balance.value.abs());
    }

    if (
      group.rowCount < 2 ||
      positiveQuantity.isZero() ||
      negativeQuantity.isZero() ||
      !positiveQuantity.eq(negativeQuantity) ||
      !positiveValue.eq(negativeValue)
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
      movementQuantity: positiveQuantity.toFixed(),
      movementValue: positiveValue.toFixed(),
    };
  });
}
