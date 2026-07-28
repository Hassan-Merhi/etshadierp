/**
 * Shared, authoritative landed-cost computation for a factory container.
 *
 * Business rule: the full material value and every fixed landed charge are
 * allocated across the original agreed quantity
 * (`totalKg || declaredKg || actualReceivedKg`). A partial receipt therefore
 * receives only its proportional value, while the rate/kg remains fixed across
 * the first receipt, later receipts, and final offload.
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
  /** Original agreed quantity used for material value and fixed-rate allocation. */
  valuationKg: number;
  /** Stable per-kg allocation denominator; currently equal to valuationKg. */
  allocationKg: number;
  /** Full container landed value in native container currency. */
  fullCost: number;
  /** Full container landed value in USD. */
  fullCostUsd: number;
  /** fullCost / allocationKg, rounded to COST_SCALE decimal places. */
  costPerKg: number;
  /** fullCostUsd / allocationKg, rounded to COST_SCALE decimal places. */
  costPerKgUsd: number;
  /** True when a non-USD currency has no confirmed FX rate. */
  fxUnresolved: boolean;
}

export function computeContainerLandedCost(
  container: typeof factoryContainers.$inferSelect,
  additionalCharges: (typeof factoryOffloadAdditionalCharges.$inferSelect)[],
  commissionRecord: typeof factoryContainerCommissions.$inferSelect | null,
  otherChargesRows?: (typeof factoryContainerOtherCharges.$inferSelect)[],
): ContainerLandedCostResult {
  const containerCcy = container.currencyCode || "USD";
  const { fxRate, looksSet: fxLooksSet } = resolveStoredFxRate(
    containerCcy,
    container.fxRateToUsdOffload || container.fxRateToUsd,
    (container as any).fxRateConfirmed,
  );
  if (!fxLooksSet) {
    return {
      valuationKg: 0,
      allocationKg: 0,
      fullCost: 0,
      fullCostUsd: 0,
      costPerKg: 0,
      costPerKgUsd: 0,
      fxUnresolved: true,
    };
  }

  const originalCostBasisKg = new Decimal(
    (container as any).totalKg || container.declaredKg || container.actualReceivedKg || "0",
  );
  if (originalCostBasisKg.lte(0)) {
    return {
      valuationKg: 0,
      allocationKg: 0,
      fullCost: 0,
      fullCostUsd: 0,
      costPerKg: 0,
      costPerKgUsd: 0,
      fxUnresolved: false,
    };
  }

  // The agreed quantity is deliberately also the allocation denominator. Using
  // actualReceivedKg here would inflate the rate on the first partial receipt and
  // change it again on every later receipt.
  const allocationKg = originalCostBasisKg;
  const dFxRate = new Decimal(fxRate);
  const baseRate = new Decimal(container.ratePerKg || "0");
  const basePayable = originalCostBasisKg.times(baseRate);
  const baseMaterialUsd = containerCcy === "USD" ? basePayable : basePayable.times(dFxRate);

  const freightVal = new Decimal(container.freight || "0");
  const freightCcy = container.freightCurrencyCode || containerCcy;
  const rawFreightFx = parseFloat((container as any).freightFxRateToUsd || "");
  const freightFxConfirmed = !!(container as any).freightFxRateConfirmed;
  let dFreightFx: Decimal;
  let freightFxUnresolved = false;
  if (freightCcy === "USD") {
    dFreightFx = new Decimal(1);
  } else if (Number.isFinite(rawFreightFx) && rawFreightFx > 0 && freightFxConfirmed) {
    dFreightFx = new Decimal(rawFreightFx);
  } else if (freightCcy === containerCcy) {
    dFreightFx = dFxRate;
  } else if (freightVal.gt(0)) {
    freightFxUnresolved = true;
    dFreightFx = new Decimal(0);
  } else {
    dFreightFx = dFxRate;
  }
  const freightUsd = freightCcy === "USD" ? freightVal : freightVal.times(dFreightFx);
  const freightInContainerCcy =
    freightCcy === containerCcy
      ? freightVal
      : dFxRate.gt(0)
        ? freightUsd.div(dFxRate)
        : freightVal;

  let ocInContainerCcy: Decimal;
  let ocUsd: Decimal;
  let ocFxUnresolved = false;
  if (otherChargesRows && otherChargesRows.length > 0) {
    ocInContainerCcy = new Decimal(0);
    ocUsd = new Decimal(0);
    for (const otherCharge of otherChargesRows) {
      const amount = new Decimal(otherCharge.amount || "0");
      const currency = otherCharge.currencyCode || containerCcy;
      const rawFx = parseFloat((otherCharge as any).fxRateToUsd || "");
      const confirmed = !!(otherCharge as any).fxRateConfirmed;
      let chargeFx: Decimal;
      if (currency === "USD") {
        chargeFx = new Decimal(1);
      } else if (Number.isFinite(rawFx) && rawFx > 0 && confirmed) {
        chargeFx = new Decimal(rawFx);
      } else if (currency === containerCcy) {
        chargeFx = dFxRate;
      } else if (amount.gt(0)) {
        ocFxUnresolved = true;
        continue;
      } else {
        chargeFx = dFxRate;
      }
      const amountUsd = currency === "USD" ? amount : amount.times(chargeFx);
      const amountInContainerCcy =
        currency === containerCcy
          ? amount
          : dFxRate.gt(0)
            ? amountUsd.div(dFxRate)
            : amount;
      ocInContainerCcy = ocInContainerCcy.plus(amountInContainerCcy);
      ocUsd = ocUsd.plus(amountUsd);
    }
  } else {
    const amount = new Decimal(container.otherCharges || "0");
    const currency = (container as any).otherChargesCurrencyCode || containerCcy;
    if (currency === "USD") {
      ocUsd = amount;
      ocInContainerCcy =
        containerCcy === "USD" ? amount : dFxRate.gt(0) ? amount.div(dFxRate) : amount;
    } else if (currency === containerCcy) {
      ocInContainerCcy = amount;
      ocUsd = dFxRate.gt(0) ? amount.times(dFxRate) : amount;
    } else if (amount.gt(0)) {
      ocFxUnresolved = true;
      ocUsd = new Decimal(0);
      ocInContainerCcy = new Decimal(0);
    } else {
      ocUsd = new Decimal(0);
      ocInContainerCcy = new Decimal(0);
    }
  }

  let commissionUsd = new Decimal(0);
  let commissionInContainerCcy = new Decimal(0);
  let commissionFxUnresolved = false;

  function applyCommissionFx(amount: Decimal, currency: string, commissionFx: Decimal): void {
    if (currency === "USD") {
      commissionUsd = amount;
      commissionInContainerCcy =
        containerCcy === "USD" ? amount : dFxRate.gt(0) ? amount.div(dFxRate) : amount;
    } else if (currency === containerCcy) {
      commissionInContainerCcy = amount;
      commissionUsd = dFxRate.gt(0) ? amount.times(dFxRate) : amount;
    } else {
      commissionUsd = amount.times(commissionFx);
      commissionInContainerCcy =
        dFxRate.gt(0) ? commissionUsd.div(dFxRate) : amount;
    }
  }

  if (commissionRecord) {
    const amount = new Decimal(commissionRecord.commissionTotal || "0");
    const currency = commissionRecord.currencyCode || containerCcy;
    const rawFx = parseFloat(commissionRecord.fxRateToUsd || "");
    const confirmed = (commissionRecord as any).fxRateConfirmed === true;
    if (currency === "USD") {
      applyCommissionFx(amount, "USD", new Decimal(1));
    } else if (currency === containerCcy) {
      applyCommissionFx(amount, currency, dFxRate);
    } else if (Number.isFinite(rawFx) && rawFx > 0 && confirmed) {
      applyCommissionFx(amount, currency, new Decimal(rawFx));
    } else {
      const snapshotFx = parseFloat((container as any).commissionFxRateToUsd || "");
      const snapshotConfirmed = (container as any).commissionFxRateConfirmed === true;
      if (Number.isFinite(snapshotFx) && snapshotFx > 0 && snapshotConfirmed) {
        applyCommissionFx(amount, currency, new Decimal(snapshotFx));
      } else {
        commissionFxUnresolved = true;
      }
    }
  } else {
    const amount = new Decimal(container.commissionAmount || "0");
    const currency = (container as any).commissionCurrencyCode || containerCcy;
    if (currency === "USD") {
      applyCommissionFx(amount, "USD", new Decimal(1));
    } else if (currency === containerCcy) {
      applyCommissionFx(amount, currency, dFxRate);
    } else {
      const snapshotFx = parseFloat((container as any).commissionFxRateToUsd || "");
      const snapshotConfirmed = (container as any).commissionFxRateConfirmed === true;
      if (Number.isFinite(snapshotFx) && snapshotFx > 0 && snapshotConfirmed) {
        applyCommissionFx(amount, currency, new Decimal(snapshotFx));
      } else if (amount.gt(0)) {
        commissionFxUnresolved = true;
      }
    }
  }

  const dutyValue =
    container.dutyStatus === "CONFIRMED"
      ? new Decimal(container.dutyAmount || "0")
      : new Decimal(0);
  const dutyUsd = containerCcy === "USD" ? dutyValue : dutyValue.times(dFxRate);

  let additionalInContainerCcy = new Decimal(0);
  let additionalUsd = new Decimal(0);
  let additionalFxUnresolved = false;
  for (const charge of additionalCharges) {
    const amount = new Decimal(charge.amount || "0");
    const currency = charge.currencyCode || containerCcy;
    const rawFx = parseFloat(charge.fxRateToUsd || "");
    const confirmed = !!(charge as any).fxRateConfirmed;
    let chargeFx: Decimal;
    if (currency === "USD") {
      chargeFx = new Decimal(1);
    } else if (Number.isFinite(rawFx) && rawFx > 0 && confirmed) {
      chargeFx = new Decimal(rawFx);
    } else if (currency === containerCcy) {
      chargeFx = dFxRate;
    } else if (amount.gt(0)) {
      additionalFxUnresolved = true;
      continue;
    } else {
      chargeFx = dFxRate;
    }
    const amountUsd = currency === "USD" ? amount : amount.times(chargeFx);
    const amountInContainerCcy =
      currency === containerCcy
        ? amount
        : dFxRate.gt(0)
          ? amountUsd.div(dFxRate)
          : amount;
    additionalInContainerCcy = additionalInContainerCcy.plus(amountInContainerCcy);
    additionalUsd = additionalUsd.plus(amountUsd);
  }

  const totalCost = basePayable
    .plus(freightInContainerCcy)
    .plus(ocInContainerCcy)
    .plus(commissionInContainerCcy)
    .plus(dutyValue)
    .plus(additionalInContainerCcy);
  const totalUsd = baseMaterialUsd
    .plus(freightUsd)
    .plus(ocUsd)
    .plus(commissionUsd)
    .plus(dutyUsd)
    .plus(additionalUsd);

  return {
    valuationKg: originalCostBasisKg.toNumber(),
    allocationKg: allocationKg.toNumber(),
    fullCost: totalCost.toNumber(),
    fullCostUsd: totalUsd.toNumber(),
    costPerKg: totalCost.div(allocationKg).toDecimalPlaces(COST_SCALE).toNumber(),
    costPerKgUsd: totalUsd.div(allocationKg).toDecimalPlaces(COST_SCALE).toNumber(),
    fxUnresolved:
      commissionFxUnresolved ||
      freightFxUnresolved ||
      ocFxUnresolved ||
      additionalFxUnresolved,
  };
}
