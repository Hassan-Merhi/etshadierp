/**
 * Shared, authoritative landed-cost computation for a factory container.
 *
 * This is the single canonical implementation of the landed-cost formula.
 * Every code path that needs to compute or validate a container's cost/kg
 * must import from here — rawStockOffloadRoutes, rawStockContainerRoutes,
 * and rawStockRecalc all delegate to this module so the formula is never
 * duplicated.
 *
 * Business rules:
 *   valuationKg = container.totalKg || container.declaredKg || container.actualReceivedKg
 *   fixedLandedCostPerKg = fullLandedValue / valuationKg
 *
 * Fixed charges (freight, commission, duty, additional charges) are spread
 * over the full declared quantity, not just the kilograms received in one
 * partial receipt. This keeps the per-kg rate stable across all partial
 * receipts of the same container.
 */
import Decimal from "decimal.js";
import {
  factoryContainers,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factoryContainerOtherCharges,
} from "@shared/schema";
import { resolveStoredFxRate } from "./currencyConversion";

/** All per-KG cost comparisons are normalised to 6 decimal places. */
export const COST_SCALE = 6;

export interface ContainerLandedCostResult {
  /** The denominator used for rate calculations (totalKg → declaredKg → actualReceivedKg). */
  valuationKg: number;
  /** Full container landed value in native container currency. */
  fullCost: number;
  /** Full container landed value in USD. */
  fullCostUsd: number;
  /** fullCost / valuationKg, rounded to COST_SCALE decimal places. */
  costPerKg: number;
  /** fullCostUsd / valuationKg, rounded to COST_SCALE decimal places. */
  costPerKgUsd: number;
  /** True when a non-USD currency has no confirmed FX rate — do NOT store or cascade. */
  fxUnresolved: boolean;
}

/**
 * Pure, Decimal.js computation of a container's full landed cost.
 *
 * @param container          - Factory container row (post-offload fields must be set).
 * @param additionalCharges  - factoryOffloadAdditionalCharges rows for this container.
 * @param commissionRecord   - Latest factoryContainerCommissions row (or null).
 * @param otherChargesRows   - Optional: per-line factoryContainerOtherCharges rows.
 *   When present and non-empty, they replace the aggregate container.otherCharges
 *   field so multi-currency other-charges are converted correctly.
 */
export function computeContainerLandedCost(
  container: typeof factoryContainers.$inferSelect,
  additionalCharges: (typeof factoryOffloadAdditionalCharges.$inferSelect)[],
  commissionRecord: typeof factoryContainerCommissions.$inferSelect | null,
  otherChargesRows?: (typeof factoryContainerOtherCharges.$inferSelect)[]
): ContainerLandedCostResult {
  const containerCcy = container.currencyCode || "USD";
  const { fxRate, looksSet: fxLooksSet } = resolveStoredFxRate(
    containerCcy,
    container.fxRateToUsdOffload || container.fxRateToUsd,
    (container as any).fxRateConfirmed
  );
  if (!fxLooksSet) {
    return { valuationKg: 0, fullCost: 0, fullCostUsd: 0, costPerKg: 0, costPerKgUsd: 0, fxUnresolved: true };
  }

  // valuationKg: totalKg first, declaredKg second, actualReceivedKg only for legacy records
  // with neither field set. This denominator is FIXED at first offload — partial receipts
  // do not change it — so the cost/kg is stable across all receipts of the same container.
  const canonicalKg = new Decimal(
    (container as any).totalKg || container.declaredKg || container.actualReceivedKg || "0"
  );
  if (canonicalKg.lte(0)) {
    return { valuationKg: 0, fullCost: 0, fullCostUsd: 0, costPerKg: 0, costPerKgUsd: 0, fxUnresolved: false };
  }

  const dFxRate = new Decimal(fxRate);
  const baseRate = new Decimal(container.ratePerKg || "0");
  const basePayable = canonicalKg.times(baseRate);
  const baseMaterialUsd = containerCcy === "USD" ? basePayable : basePayable.times(dFxRate);

  // ── Freight ──────────────────────────────────────────────────────────────
  const freightVal = new Decimal(container.freight || "0");
  const freightCcy = container.freightCurrencyCode || containerCcy;
  const rawFreightFx = parseFloat((container as any).freightFxRateToUsd || "");
  const freightFxConfirmed = !!(container as any).freightFxRateConfirmed;
  let dFreightFx: Decimal;
  if (freightCcy === "USD") {
    dFreightFx = new Decimal(1);
  } else if (Number.isFinite(rawFreightFx) && rawFreightFx > 0 && freightFxConfirmed) {
    dFreightFx = new Decimal(rawFreightFx);
  } else {
    dFreightFx = dFxRate;
  }
  const freightUsd = freightCcy === "USD" ? freightVal : freightVal.times(dFreightFx);
  const freightInContainerCcy =
    freightCcy === containerCcy ? freightVal : dFxRate.gt(0) ? freightUsd.div(dFxRate) : freightVal;

  // ── Other charges ─────────────────────────────────────────────────────────
  let ocInContainerCcy: Decimal;
  let ocUsd: Decimal;
  if (otherChargesRows && otherChargesRows.length > 0) {
    ocInContainerCcy = new Decimal(0);
    ocUsd = new Decimal(0);
    for (const oc of otherChargesRows) {
      const ocAmt = new Decimal(oc.amount || "0");
      const ocCcy = oc.currencyCode || containerCcy;
      const rawOcFx = parseFloat((oc as any).fxRateToUsd || "");
      const ocFxConfirmed = !!(oc as any).fxRateConfirmed;
      let dOcFx: Decimal;
      if (ocCcy === "USD") {
        dOcFx = new Decimal(1);
      } else if (Number.isFinite(rawOcFx) && rawOcFx > 0 && ocFxConfirmed) {
        dOcFx = new Decimal(rawOcFx);
      } else {
        dOcFx = dFxRate;
      }
      const ocAmtUsd = ocCcy === "USD" ? ocAmt : ocAmt.times(dOcFx);
      const ocAmtInContainerCcy =
        ocCcy === containerCcy ? ocAmt : dFxRate.gt(0) ? ocAmtUsd.div(dFxRate) : ocAmt;
      ocInContainerCcy = ocInContainerCcy.plus(ocAmtInContainerCcy);
      ocUsd = ocUsd.plus(ocAmtUsd);
    }
  } else {
    const ocVal = new Decimal(container.otherCharges || "0");
    const ocCcy = (container as any).otherChargesCurrencyCode || containerCcy;
    ocUsd = ocCcy === "USD" ? ocVal : ocVal.times(dFxRate);
    ocInContainerCcy = ocCcy === containerCcy ? ocVal : dFxRate.gt(0) ? ocUsd.div(dFxRate) : ocVal;
  }

  // ── Commission ────────────────────────────────────────────────────────────
  let commUsd: Decimal = new Decimal(0);
  let commInContainerCcy: Decimal = new Decimal(0);
  let commFxUnresolved = false;

  function applyCommFx(commVal: Decimal, commCcy: string, commFx: Decimal): void {
    if (commCcy === "USD") {
      commUsd = commVal;
      commInContainerCcy =
        containerCcy === "USD" ? commVal : dFxRate.gt(0) ? commVal.div(dFxRate) : commVal;
    } else if (commCcy === containerCcy) {
      commInContainerCcy = commVal;
      commUsd = dFxRate.gt(0) ? commVal.times(dFxRate) : commVal;
    } else {
      commUsd = commVal.times(commFx);
      commInContainerCcy = dFxRate.gt(0) ? commUsd.div(dFxRate) : commVal;
    }
  }

  if (commissionRecord) {
    const commVal = new Decimal(commissionRecord.commissionTotal || "0");
    const commCcy = commissionRecord.currencyCode || containerCcy;
    const rawCommFx = parseFloat(commissionRecord.fxRateToUsd || "");
    const commConfirmed = (commissionRecord as any).fxRateConfirmed === true;
    if (commCcy === "USD") {
      applyCommFx(commVal, "USD", new Decimal(1));
    } else if (commCcy === containerCcy) {
      applyCommFx(commVal, commCcy, dFxRate);
    } else {
      if (Number.isFinite(rawCommFx) && rawCommFx > 0 && commConfirmed) {
        applyCommFx(commVal, commCcy, new Decimal(rawCommFx));
      } else {
        const snapFx = parseFloat((container as any).commissionFxRateToUsd || "");
        const snapConfirmed = (container as any).commissionFxRateConfirmed === true;
        if (Number.isFinite(snapFx) && snapFx > 0 && snapConfirmed) {
          applyCommFx(commVal, commCcy, new Decimal(snapFx));
        } else {
          commFxUnresolved = true;
          commUsd = new Decimal(0);
          commInContainerCcy = new Decimal(0);
        }
      }
    }
  } else {
    const commVal = new Decimal(container.commissionAmount || "0");
    const commCcy = (container as any).commissionCurrencyCode || containerCcy;
    if (commCcy === "USD") {
      applyCommFx(commVal, "USD", new Decimal(1));
    } else if (commCcy === containerCcy) {
      applyCommFx(commVal, commCcy, dFxRate);
    } else {
      const snapFx = parseFloat((container as any).commissionFxRateToUsd || "");
      const snapConfirmed = (container as any).commissionFxRateConfirmed === true;
      if (Number.isFinite(snapFx) && snapFx > 0 && snapConfirmed) {
        applyCommFx(commVal, commCcy, new Decimal(snapFx));
      } else if (commVal.gt(0)) {
        commFxUnresolved = true;
        commUsd = new Decimal(0);
        commInContainerCcy = new Decimal(0);
      }
    }
  }

  // ── Duty (always in container currency) ──────────────────────────────────
  const dutyVal =
    container.dutyStatus === "CONFIRMED"
      ? new Decimal(container.dutyAmount || "0")
      : new Decimal(0);
  const dutyUsd = containerCcy === "USD" ? dutyVal : dutyVal.times(dFxRate);

  // ── Additional charges (each row stores its own currency + fx rate) ───────
  let addlInContainerCcy = new Decimal(0);
  let addlUsd = new Decimal(0);
  for (const c of additionalCharges) {
    const amt = new Decimal(c.amount || "0");
    const ccy = c.currencyCode || containerCcy;
    const rawCfx = parseFloat(c.fxRateToUsd || "");
    const cfx = Number.isFinite(rawCfx) && rawCfx > 0 ? new Decimal(rawCfx) : dFxRate;
    const amtUsd = ccy === "USD" ? amt : amt.times(cfx);
    const amtInContainerCcy = ccy === containerCcy ? amt : dFxRate.gt(0) ? amtUsd.div(dFxRate) : amt;
    addlInContainerCcy = addlInContainerCcy.plus(amtInContainerCcy);
    addlUsd = addlUsd.plus(amtUsd);
  }

  const totalCost = basePayable
    .plus(freightInContainerCcy)
    .plus(ocInContainerCcy)
    .plus(commInContainerCcy)
    .plus(dutyVal)
    .plus(addlInContainerCcy);
  const totalUsd = baseMaterialUsd
    .plus(freightUsd)
    .plus(ocUsd)
    .plus(commUsd)
    .plus(dutyUsd)
    .plus(addlUsd);

  return {
    valuationKg: canonicalKg.toNumber(),
    fullCost: totalCost.toNumber(),
    fullCostUsd: totalUsd.toNumber(),
    costPerKg: totalCost.div(canonicalKg).toDecimalPlaces(COST_SCALE).toNumber(),
    costPerKgUsd: totalUsd.div(canonicalKg).toDecimalPlaces(COST_SCALE).toNumber(),
    fxUnresolved: commFxUnresolved,
  };
}
