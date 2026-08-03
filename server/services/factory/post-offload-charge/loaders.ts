import Decimal from "decimal.js";
import { and, eq, isNull } from "drizzle-orm";
import {
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factoryRawStock,
  factoryContainerOtherCharges,
} from "../../../../shared/schema";

export async function loadCostInputs(tx: any, companyId: number, containerId: number) {
  const commissions = await tx
    .select()
    .from(factoryContainerCommissions)
    .where(
      and(
        eq(factoryContainerCommissions.containerId, containerId),
        eq(factoryContainerCommissions.companyId, companyId)
      )
    );
  const commissionRecord = commissions.sort((a: any, b: any) => b.id - a.id)[0] || null;

  const otherChargeRows = await tx
    .select()
    .from(factoryContainerOtherCharges)
    .where(
      and(
        eq(factoryContainerOtherCharges.containerId, containerId),
        eq(factoryContainerOtherCharges.companyId, companyId)
      )
    );

  return { commissionRecord, otherChargeRows };
}

/** Load all active (non-deleted) additional-charge rows for this container. */
export async function loadActiveCharges(tx: any, companyId: number, containerId: number) {
  return tx
    .select()
    .from(factoryOffloadAdditionalCharges)
    .where(
      and(
        eq(factoryOffloadAdditionalCharges.containerId, containerId),
        eq(factoryOffloadAdditionalCharges.companyId, companyId),
        isNull(factoryOffloadAdditionalCharges.deletedAt)
      )
    );
}

/** Compute remaining-fraction from raw-stock rows. */
export async function computeRemainingFraction(tx: any, companyId: number, containerId: number) {
  const rows = await tx
    .select()
    .from(factoryRawStock)
    .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

  let dReceivedKg = new Decimal(0);
  let dUsedKg = new Decimal(0);
  for (const r of rows) {
    dReceivedKg = dReceivedKg.plus(new Decimal(String(r.receivedKg || "0")));
    dUsedKg = dUsedKg.plus(new Decimal(String(r.usedKg || "0")));
  }
  const dRemainingKg = Decimal.max(0, dReceivedKg.minus(dUsedKg));
  const dFraction = dReceivedKg.gt(0) ? Decimal.min(new Decimal(1), dRemainingKg.div(dReceivedKg)) : new Decimal(0);

  return { dReceivedKg, dUsedKg, dRemainingKg, dFraction };
}

/**
 * When voucherId or daybookEntryId is null on an existing charge (legacy),
 * attempt to resolve them from accounting records by exact reference lookup.
 * Persists the resolved IDs on the charge row and returns the updated charge.
 * Throws if multiple ambiguous matches exist.
 */
