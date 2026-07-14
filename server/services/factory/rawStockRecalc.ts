/**
 * Historical raw-material cost recalculation.
 *
 * Recomputes the correct inclusive cost/kg (native + USD) for every offloaded
 * container from its stored charge fields, using the SAME math as the original
 * offload route (rawStockOffloadRoutes.ts) — each charge (freight, other charges,
 * commission, duty, additional charges) converted from its OWN currency, not
 * assumed to already be in the container's currency.
 *
 * This exists because the post-offload "add charge" route (rawStockContainerRoutes.ts)
 * historically added otherCharges/commission/duty straight into the container-currency
 * total WITHOUT converting them from their own currency first — so any container that
 * had a post-offload charge added in a different currency than the container drifted
 * out of sync with its true landed cost. This module lets us find every such container,
 * show the old vs. corrected numbers, and — only for the ones an admin approves — apply
 * the fix and cascade it down to mix batches/bales via cascadeContainerCostChange.
 *
 * Read-only preview never writes anything. Apply runs inside a transaction per container.
 */
import { eq, and, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "../../db";
import {
  factoryContainers,
  factoryRawStock,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factorySuppliers,
} from "@shared/schema";
import { cascadeContainerCostChange } from "./rawStockCostCascade";
import { resolveStoredFxRate } from "./currencyConversion";

export interface RecalcRow {
  containerId: number;
  rawStockId: number;
  containerNumber: string;
  supplierId: number | null;
  supplierName: string;
  currencyCode: string;
  receivedKg: number;
  old: { costPerKg: number; costPerKgUsd: number };
  next: { costPerKg: number; costPerKgUsd: number };
  diffPct: number; // % change in costPerKgUsd, signed
  changed: boolean;
  /** True when the container's currency is non-USD and no explicitly-resolved exchange
   * rate is available — `next` is NOT trustworthy in this case and must never be applied
   * automatically; surfaced for MANUAL_REVIEW_REQUIRED instead of an auto-fixable diff. */
  fxUnresolved: boolean;
}

/**
 * Pure computation: given a container row + its post-offload additional charges +
 * its commission record (if any), compute the correct inclusive cost/kg.
 * Mirrors rawStockOffloadRoutes.ts's original math exactly, but reads from the
 * container's CURRENT stored fields (which reflect all edits made since offload).
 */
export function computeCorrectContainerCost(
  container: typeof factoryContainers.$inferSelect,
  additionalCharges: (typeof factoryOffloadAdditionalCharges.$inferSelect)[],
  commissionRecord: typeof factoryContainerCommissions.$inferSelect | null
): { costPerKg: number; costPerKgUsd: number; totalCost: number; totalUsd: number; fxUnresolved: boolean } {
  const containerCcy = container.currencyCode || "USD";
  // The offload/edit fx rate actually applied to this container's charges — prefer the
  // rate captured at offload time, falling back to the general one if not set. Never
  // silently default an unresolved non-USD rate to 1 — surface it as fxUnresolved instead.
  const { fxRate, looksSet: fxLooksSet } = resolveStoredFxRate(
    containerCcy,
    container.fxRateToUsdOffload || container.fxRateToUsd,
    (container as any).fxRateConfirmed
  );
  if (!fxLooksSet) {
    return { costPerKg: 0, costPerKgUsd: 0, totalCost: 0, totalUsd: 0, fxUnresolved: true };
  }
  const actualKg = new Decimal(container.actualReceivedKg || "0");
  if (actualKg.lte(0)) {
    return { costPerKg: 0, costPerKgUsd: 0, totalCost: 0, totalUsd: 0, fxUnresolved: false };
  }

  const dFxRate = new Decimal(fxRate);
  const baseRate = new Decimal(container.ratePerKg || "0");
  const basePayable = actualKg.times(baseRate);
  const baseMaterialUsd = containerCcy === "USD" ? basePayable : basePayable.times(dFxRate);

  // Freight — has its own currency field, no separate stored fx rate, so it uses the
  // container's fx rate for conversion (same as at offload time).
  const freightVal = new Decimal(container.freight || "0");
  const freightCcy = container.freightCurrencyCode || containerCcy;
  const freightUsd = freightCcy === "USD" ? freightVal : freightVal.times(dFxRate);
  const freightInContainerCcy =
    freightCcy === containerCcy ? freightVal : dFxRate.gt(0) ? freightUsd.div(dFxRate) : freightVal;

  // Other charges — has its own currency field (otherChargesCurrencyCode) that the
  // buggy post-offload-charge route ignored. Convert it properly here.
  const ocVal = new Decimal(container.otherCharges || "0");
  const ocCcy = (container as any).otherChargesCurrencyCode || containerCcy;
  const ocUsd = ocCcy === "USD" ? ocVal : ocVal.times(dFxRate);
  const ocInContainerCcy = ocCcy === containerCcy ? ocVal : dFxRate.gt(0) ? ocUsd.div(dFxRate) : ocVal;

  // Commission — prefer the dedicated commission record (it stores its own currency +
  // fx rate explicitly), falling back to the container's mirrored fields.
  let commUsd: Decimal;
  let commInContainerCcy: Decimal;
  if (commissionRecord) {
    const commVal = new Decimal(commissionRecord.commissionTotal || "0");
    const commCcy = commissionRecord.currencyCode || containerCcy;
    const rawCommFx = parseFloat(commissionRecord.fxRateToUsd || "");
    const commFx = Number.isFinite(rawCommFx) && rawCommFx > 0 ? new Decimal(rawCommFx) : dFxRate;
    commUsd = commCcy === "USD" ? commVal : commVal.times(commFx);
    commInContainerCcy = commCcy === containerCcy ? commVal : dFxRate.gt(0) ? commUsd.div(dFxRate) : commVal;
  } else {
    const commVal = new Decimal(container.commissionAmount || "0");
    const commCcy = (container as any).commissionCurrencyCode || containerCcy;
    commUsd = commCcy === "USD" ? commVal : commVal.times(dFxRate);
    commInContainerCcy = commCcy === containerCcy ? commVal : dFxRate.gt(0) ? commUsd.div(dFxRate) : commVal;
  }

  // Duty — no separate currency field on the container; always container currency.
  const dutyVal = container.dutyStatus === "CONFIRMED" ? new Decimal(container.dutyAmount || "0") : new Decimal(0);
  const dutyUsd = containerCcy === "USD" ? dutyVal : dutyVal.times(dFxRate);

  // Additional charges — each row already stores its own currency + fx rate explicitly;
  // this part was already correct in the live code, kept identical here.
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
  const totalUsd = baseMaterialUsd.plus(freightUsd).plus(ocUsd).plus(commUsd).plus(dutyUsd).plus(addlUsd);

  return {
    costPerKg: totalCost.div(actualKg).toNumber(),
    costPerKgUsd: totalUsd.div(actualKg).toNumber(),
    totalCost: totalCost.toNumber(),
    totalUsd: totalUsd.toNumber(),
    fxUnresolved: false,
  };
}

/** Read-only: build the full diff list for every offloaded container in this company. */
export async function getRawStockRecalcPreview(companyId: number): Promise<RecalcRow[]> {
  const rows = await db
    .select({
      rawStockId: factoryRawStock.id,
      containerId: factoryRawStock.containerId,
      receivedKg: factoryRawStock.receivedKg,
      costPerKg: factoryRawStock.costPerKg,
      costPerKgUsd: factoryRawStock.costPerKgUsd,
      container: factoryContainers,
      supplierName: factorySuppliers.name,
    })
    .from(factoryRawStock)
    .innerJoin(factoryContainers, eq(factoryContainers.id, factoryRawStock.containerId))
    .leftJoin(factorySuppliers, eq(factorySuppliers.id, factoryContainers.supplierId))
    .where(and(eq(factoryRawStock.companyId, companyId), isNull(factoryRawStock.deletedAt)));

  if (rows.length === 0) return [];

  const containerIds = rows.map((r) => r.containerId);
  const [allAdditionalCharges, allCommissions] = await Promise.all([
    db
      .select()
      .from(factoryOffloadAdditionalCharges)
      .where(eq(factoryOffloadAdditionalCharges.companyId, companyId)),
    db.select().from(factoryContainerCommissions).where(eq(factoryContainerCommissions.companyId, companyId)),
  ]);

  const chargesByContainer = new Map<number, (typeof factoryOffloadAdditionalCharges.$inferSelect)[]>();
  for (const c of allAdditionalCharges) {
    if (!chargesByContainer.has(c.containerId)) chargesByContainer.set(c.containerId, []);
    chargesByContainer.get(c.containerId)!.push(c);
  }
  const commissionByContainer = new Map<number, typeof factoryContainerCommissions.$inferSelect>();
  for (const c of allCommissions) {
    // A container may have multiple commission edits over time; keep the latest.
    const existing = commissionByContainer.get(c.containerId);
    if (!existing || c.id > existing.id) commissionByContainer.set(c.containerId, c);
  }

  const results: RecalcRow[] = [];
  for (const row of rows) {
    if (!containerIds.includes(row.containerId)) continue;
    const container = row.container;
    const additionalCharges = chargesByContainer.get(container.id) || [];
    const commissionRecord = commissionByContainer.get(container.id) || null;
    const next = computeCorrectContainerCost(container, additionalCharges, commissionRecord);

    const oldCostPerKg = parseFloat(row.costPerKg || "0");
    const oldCostPerKgUsd = parseFloat(row.costPerKgUsd || "0");

    // Tiny float-noise tolerance — anything above this is a real, actionable diff.
    const EPS = 0.0005;
    const changed =
      !next.fxUnresolved &&
      (Math.abs(next.costPerKg - oldCostPerKg) > EPS || Math.abs(next.costPerKgUsd - oldCostPerKgUsd) > EPS);
    const diffPct = oldCostPerKgUsd > 0 ? ((next.costPerKgUsd - oldCostPerKgUsd) / oldCostPerKgUsd) * 100 : 0;

    results.push({
      containerId: container.id,
      rawStockId: row.rawStockId,
      containerNumber: container.containerNumber,
      supplierId: container.supplierId,
      supplierName: row.supplierName || "Unknown Supplier",
      currencyCode: container.currencyCode || "USD",
      receivedKg: parseFloat(row.receivedKg || "0"),
      old: { costPerKg: oldCostPerKg, costPerKgUsd: oldCostPerKgUsd },
      next: { costPerKg: next.costPerKg, costPerKgUsd: next.costPerKgUsd },
      diffPct: next.fxUnresolved ? 0 : diffPct,
      changed,
      fxUnresolved: next.fxUnresolved,
    });
  }

  // Unresolved-FX rows need human attention first, then changed rows, biggest impact first.
  results.sort((a, b) => {
    if (a.fxUnresolved !== b.fxUnresolved) return a.fxUnresolved ? -1 : 1;
    if (a.changed !== b.changed) return a.changed ? -1 : 1;
    return Math.abs(b.diffPct) - Math.abs(a.diffPct);
  });

  return results;
}

export interface ApplyResult {
  containerId: number;
  containerNumber: string;
  rawStockRowsUpdated: number;
  affectedBatches: number;
  affectedBales: number;
}

/** Apply the corrected cost for a specific set of containers, cascading down the chain. */
export async function applyRawStockRecalc(companyId: number, containerIds: number[]): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  for (const containerId of containerIds) {
    const [container] = await db
      .select()
      .from(factoryContainers)
      .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));
    if (!container) continue;

    const [additionalCharges, commissionRecords] = await Promise.all([
      db
        .select()
        .from(factoryOffloadAdditionalCharges)
        .where(
          and(
            eq(factoryOffloadAdditionalCharges.containerId, containerId),
            eq(factoryOffloadAdditionalCharges.companyId, companyId)
          )
        ),
      db
        .select()
        .from(factoryContainerCommissions)
        .where(
          and(
            eq(factoryContainerCommissions.containerId, containerId),
            eq(factoryContainerCommissions.companyId, companyId)
          )
        ),
    ]);
    const commissionRecord = commissionRecords.sort((a, b) => b.id - a.id)[0] || null;

    const next = computeCorrectContainerCost(container, additionalCharges, commissionRecord);
    if (next.fxUnresolved) continue; // never auto-apply a recompute derived from an unresolved FX rate
    if (next.costPerKgUsd === 0 && next.costPerKg === 0) continue; // no received kg, nothing to fix

    const result = await db.transaction(async (tx) => {
      await tx
        .update(factoryContainers)
        .set({
          finalPayableAmount: String(next.totalCost),
          ratePerKgUsd: String(next.costPerKgUsd),
          finalPayableAmountUsd: String(next.totalUsd),
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      const cascadeResult = await cascadeContainerCostChange(tx, {
        companyId,
        containerId,
        newCostPerKg: next.costPerKg,
        newCostPerKgUsd: next.costPerKgUsd,
      });

      return cascadeResult;
    });

    results.push({
      containerId,
      containerNumber: container.containerNumber,
      rawStockRowsUpdated: result.rawStockRowsUpdated,
      affectedBatches: result.affectedBatches.length,
      affectedBales: result.affectedBales.length,
    });
  }

  return results;
}
