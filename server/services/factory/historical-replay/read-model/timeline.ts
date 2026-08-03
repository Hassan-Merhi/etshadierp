import Decimal from "decimal.js";
import { type SupplierEvent } from "../types";

export function sortEvents(events: SupplierEvent[]): { sorted: SupplierEvent[]; ambiguous: boolean } {
  const withDate = events.filter((event) => event.effectiveDate !== "");
  const withoutDate = events.filter((event) => event.effectiveDate === "");
  withDate.sort((left, right) => {
    const dateOrder = left.effectiveDate.localeCompare(right.effectiveDate);
    if (dateOrder !== 0) return dateOrder;
    const timestampOrder = left.createdAt - right.createdAt;
    return timestampOrder !== 0 ? timestampOrder : left.stableId - right.stableId;
  });

  let ambiguous = false;
  const groups = new Map<string, SupplierEvent[]>();
  for (const event of withDate) {
    const values = groups.get(event.effectiveDate) ?? [];
    values.push(event);
    groups.set(event.effectiveDate, values);
  }
  for (const group of groups.values()) {
    const receipts = group.filter((event) => event.kind === "RECEIPT");
    const consumptions = group.filter((event) => event.kind === "BATCH_CONSUMPTION");
    for (const receipt of receipts) {
      for (const consumption of consumptions) {
        const resolved =
          receipt.createdAt > 0 && consumption.createdAt > 0 && receipt.createdAt !== consumption.createdAt;
        if (!resolved) ambiguous = true;
      }
    }
  }
  return { sorted: [...withDate, ...withoutDate], ambiguous };
}

export interface SupplierTimelineResult {
  supplierId: number;
  supplierName: string;
  currentStoredRate: number;
  startingRate: number;
  endingRate: number;
  replayRemainingKg: number;
  authoritativeRemainingKg: number;
  quantityMismatch: boolean;
  missingDates: number;
  ambiguous: boolean;
  safeToRepair: boolean;
  reasons: string[];
  eventCount: number;
  expectedRateAtBatch: Map<number, number>;
  affectedContainerCount: number;
}

/** Pure timeline calculation. It performs no database reads. */
export async function replaySupplierTimeline(
  _companyId: number,
  supplierId: number,
  supplierName: string,
  storedRate: number,
  events: SupplierEvent[],
  authoritativeRemainingKg: number
): Promise<SupplierTimelineResult> {
  const { sorted, ambiguous } = sortEvents(events);
  let remaining = new Decimal(0);
  let rate = new Decimal(0);
  let missingDates = 0;
  const expectedRateAtBatch = new Map<number, number>();
  const affectedContainers = new Set<number>();

  for (const event of sorted) {
    if (!event.effectiveDate) missingDates += 1;
    if (event.kind === "RECEIPT") {
      const receiptKg = new Decimal(event.receiptKg ?? 0);
      const receiptRate = new Decimal(event.canonicalRateUsd ?? 0);
      if (receiptKg.lte(0)) continue;
      const oldPositiveRemaining = Decimal.max(0, remaining);
      const denominator = oldPositiveRemaining.plus(receiptKg);
      rate = denominator.gt(0)
        ? oldPositiveRemaining.times(rate).plus(receiptKg.times(receiptRate)).div(denominator)
        : receiptRate;
      remaining = remaining.plus(receiptKg);
      if (event.containerId) affectedContainers.add(event.containerId);
      continue;
    }
    if (event.kind === "ADD_ADJUSTMENT") {
      const quantity = new Decimal(event.adjustKg ?? 0);
      if (quantity.gt(0)) {
        const valuationBasis = (event as any).valuationBasis as string | undefined;
        if (valuationBasis === "VALUED_TRANSFER") {
          // Add both kg and USD value to moving average.
          const adjRate = new Decimal(event.costPerKgUsd ?? 0);
          const oldPositiveRemaining = Decimal.max(0, remaining);
          const denominator = oldPositiveRemaining.plus(quantity);
          rate = denominator.gt(0)
            ? oldPositiveRemaining.times(rate).plus(quantity.times(adjRate)).div(denominator)
            : adjRate;
          remaining = remaining.plus(quantity);
        } else if (valuationBasis === "OPENING_BALANCE") {
          // Establish opening quantity and value (replaces current state).
          const adjRate = new Decimal(event.costPerKgUsd ?? 0);
          if (remaining.lte(0)) {
            remaining = quantity;
            rate = adjRate;
          } else {
            // If opening balance is applied on top of existing stock, treat as VALUED_TRANSFER.
            const oldPositiveRemaining = Decimal.max(0, remaining);
            const denominator = oldPositiveRemaining.plus(quantity);
            rate = denominator.gt(0)
              ? oldPositiveRemaining.times(rate).plus(quantity.times(adjRate)).div(denominator)
              : adjRate;
            remaining = remaining.plus(quantity);
          }
        } else {
          // QUANTITY_ONLY (or unclassified — still applies quantity without shifting rate).
          remaining = remaining.plus(quantity);
        }
      }
      continue;
    }
    if (event.kind === "REMOVE_ADJUSTMENT" || event.kind === "DEDUCT_ADJUSTMENT") {
      remaining = remaining.minus(new Decimal(event.removeKg ?? event.adjustKg ?? 0));
      // Clamp tiny rounding residuals.
      if (remaining.abs().lte(0.001)) remaining = new Decimal(0);
      continue;
    }
    if (event.kind === "BATCH_CONSUMPTION") {
      if (event.batchId != null) expectedRateAtBatch.set(event.batchId, rate.toDecimalPlaces(8).toNumber());
      remaining = remaining.minus(new Decimal(event.consumptionKg ?? 0));
      // Clamp tiny rounding residuals to zero after consumption.
      if (remaining.abs().lte(0.001)) remaining = new Decimal(0);
    }
  }

  const replayRemainingKg = remaining.toDecimalPlaces(3).toNumber();
  const endingRate = rate.toDecimalPlaces(8).toNumber();
  const quantityMismatch = Math.abs(replayRemainingKg - authoritativeRemainingKg) > 0.001;
  const reasons: string[] = [];
  if (quantityMismatch) reasons.push("TIMELINE_QUANTITY_MISMATCH");
  if (missingDates > 0) reasons.push("MISSING_EVENT_DATES");
  if (ambiguous) reasons.push("TIMELINE_ORDER_AMBIGUOUS");

  return {
    supplierId,
    supplierName,
    currentStoredRate: storedRate,
    startingRate: 0,
    endingRate,
    replayRemainingKg,
    authoritativeRemainingKg,
    quantityMismatch,
    missingDates,
    ambiguous,
    safeToRepair: reasons.length === 0,
    reasons,
    eventCount: sorted.length,
    expectedRateAtBatch,
    affectedContainerCount: affectedContainers.size,
  };
}
