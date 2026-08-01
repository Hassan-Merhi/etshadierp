import Decimal from "decimal.js";
import crypto from "crypto";
import {
  factoryContainers,
  factoryRawStock,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factoryContainerOtherCharges,
} from "@shared/schema";
import { computeContainerLandedCost } from "../containerLandedCost";

// ─────────────────────────────────────────────────────────────────────────────
// Precision helpers
// ─────────────────────────────────────────────────────────────────────────────

/** All per-KG cost comparisons are normalised to 6 decimal places. */
export const COST_SCALE = 6;

/** True when two cost/kg values are equal at six-decimal precision. */
export function costEquals(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  return new Decimal(a ?? 0).toDecimalPlaces(COST_SCALE).equals(new Decimal(b ?? 0).toDecimalPlaces(COST_SCALE));
}

/** Round a cost/kg to exactly COST_SCALE decimals; returns a string for DB writes. */
export function costRound(v: string | number | null | undefined): string {
  return new Decimal(v ?? 0).toDecimalPlaces(COST_SCALE).toFixed(COST_SCALE);
}

// ─────────────────────────────────────────────────────────────────────────────
// computeCorrectContainerCost — compatibility wrapper around shared helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compatibility wrapper: delegates to computeContainerLandedCost (the single
 * authoritative implementation in containerLandedCost.ts) and re-shapes the
 * return value to the legacy { costPerKg, costPerKgUsd, totalCost, totalUsd,
 * fxUnresolved } interface so existing callers need no changes.
 *
 * @param otherChargesRows  Optional: detailed factoryContainerOtherCharges rows.
 *   When present (and non-empty), they are used INSTEAD of the aggregate
 *   container.otherCharges field — avoids double-counting.
 */
export function computeCorrectContainerCost(
  container: typeof factoryContainers.$inferSelect,
  additionalCharges: (typeof factoryOffloadAdditionalCharges.$inferSelect)[],
  commissionRecord: typeof factoryContainerCommissions.$inferSelect | null,
  otherChargesRows?: (typeof factoryContainerOtherCharges.$inferSelect)[]
): { costPerKg: number; costPerKgUsd: number; totalCost: number; totalUsd: number; fxUnresolved: boolean } {
  const r = computeContainerLandedCost(container, additionalCharges, commissionRecord, otherChargesRows);
  return {
    costPerKg: r.costPerKg,
    costPerKgUsd: r.costPerKgUsd,
    totalCost: r.fullCost,
    totalUsd: r.fullCostUsd,
    fxUnresolved: r.fxUnresolved,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface RecalcFingerprintInputs {
  container: typeof factoryContainers.$inferSelect;
  additionalCharges: (typeof factoryOffloadAdditionalCharges.$inferSelect)[];
  commissionRecord: typeof factoryContainerCommissions.$inferSelect | null;
  rawStock: typeof factoryRawStock.$inferSelect | null;
  /** Detailed per-line other-charges — required for correct fingerprinting. */
  otherChargesRows: (typeof factoryContainerOtherCharges.$inferSelect)[];
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Deterministic fingerprint of every input that feeds a container's corrected
 * landed cost. Used to bind a recalc confirmation token to the EXACT approved
 * calculation so ANY field change between dry-run and apply invalidates the token.
 */
export function computeRecalcFingerprint(inputs: RecalcFingerprintInputs): string {
  const c = inputs.container;
  const next = computeCorrectContainerCost(
    c,
    inputs.additionalCharges,
    inputs.commissionRecord,
    inputs.otherChargesRows
  );
  const canonical = {
    containerId: c.id,
    status: c.status,
    updatedAt: toIso((c as any).updatedAt),
    totalKg: (c as any).totalKg,
    declaredKg: c.declaredKg,
    actualReceivedKg: c.actualReceivedKg,
    ratePerKg: c.ratePerKg,
    currencyCode: c.currencyCode,
    fxRateToUsd: c.fxRateToUsd,
    fxRateToUsdOffload: c.fxRateToUsdOffload,
    fxRateConfirmed: c.fxRateConfirmed,
    freight: c.freight,
    freightCurrencyCode: c.freightCurrencyCode,
    dutyAmount: c.dutyAmount,
    dutyStatus: c.dutyStatus,
    commissionAmount: c.commissionAmount,
    commissionCurrencyCode: c.commissionCurrencyCode,
    commissionFxRateToUsd: (c as any).commissionFxRateToUsd,
    commissionFxRateConfirmed: (c as any).commissionFxRateConfirmed,
    commissionFxRateDate: (c as any).commissionFxRateDate,
    otherCharges: c.otherCharges,
    otherChargesCurrencyCode: (c as any).otherChargesCurrencyCode,
    additionalCharges: [...inputs.additionalCharges]
      .map((a) => ({
        id: a.id,
        amount: a.amount,
        currencyCode: a.currencyCode,
        fxRateToUsd: a.fxRateToUsd,
        version: toIso((a as any).updatedAt) ?? toIso(a.createdAt),
      }))
      .sort((a, b) => a.id - b.id),
    otherChargesRows: [...inputs.otherChargesRows]
      .map((oc) => ({
        id: oc.id,
        amount: oc.amount,
        currencyCode: oc.currencyCode,
        fxRateToUsd: oc.fxRateToUsd,
        fxRateConfirmed: oc.fxRateConfirmed,
        version: toIso((oc as any).updatedAt) ?? toIso(oc.createdAt),
      }))
      .sort((a, b) => a.id - b.id),
    commissionRecord: inputs.commissionRecord
      ? {
          id: inputs.commissionRecord.id,
          commissionTotal: inputs.commissionRecord.commissionTotal,
          currencyCode: inputs.commissionRecord.currencyCode,
          fxRateToUsd: inputs.commissionRecord.fxRateToUsd,
          fxRateConfirmed: (inputs.commissionRecord as any).fxRateConfirmed,
          version: toIso((inputs.commissionRecord as any).updatedAt) ?? toIso(inputs.commissionRecord.createdAt),
        }
      : null,
    currentCostPerKg: inputs.rawStock?.costPerKg ?? null,
    currentCostPerKgUsd: inputs.rawStock?.costPerKgUsd ?? null,
    expectedCostPerKg: next.costPerKg,
    expectedCostPerKgUsd: next.costPerKgUsd,
    expectedFxUnresolved: next.fxUnresolved,
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Loads all inputs needed to fingerprint one container. Returns null if the
 *  container doesn't exist in this company. */
