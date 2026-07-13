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
import { db } from "../../db";
import {
  factoryContainers,
  factoryRawStock,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factorySuppliers,
} from "@shared/schema";
import { cascadeContainerCostChange } from "./rawStockCostCascade";

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
): { costPerKg: number; costPerKgUsd: number; totalCost: number; totalUsd: number } {
  const containerCcy = container.currencyCode || "USD";
  // The offload/edit fx rate actually applied to this container's charges — prefer the
  // rate captured at offload time, falling back to the general one if not set.
  const fxRate = parseFloat(container.fxRateToUsdOffload || container.fxRateToUsd || "1") || 1;
  const actualKg = parseFloat(container.actualReceivedKg || "0");
  if (actualKg <= 0) {
    return { costPerKg: 0, costPerKgUsd: 0, totalCost: 0, totalUsd: 0 };
  }

  const baseRate = parseFloat(container.ratePerKg || "0");
  const basePayable = actualKg * baseRate;
  const baseMaterialUsd = containerCcy === "USD" ? basePayable : basePayable * fxRate;

  // Freight — has its own currency field, no separate stored fx rate, so it uses the
  // container's fx rate for conversion (same as at offload time).
  const freightVal = parseFloat(container.freight || "0");
  const freightCcy = container.freightCurrencyCode || containerCcy;
  const freightUsd = freightCcy === "USD" ? freightVal : freightVal * fxRate;
  const freightInContainerCcy =
    freightCcy === containerCcy ? freightVal : fxRate > 0 ? freightUsd / fxRate : freightVal;

  // Other charges — has its own currency field (otherChargesCurrencyCode) that the
  // buggy post-offload-charge route ignored. Convert it properly here.
  const ocVal = parseFloat(container.otherCharges || "0");
  const ocCcy = (container as any).otherChargesCurrencyCode || containerCcy;
  const ocUsd = ocCcy === "USD" ? ocVal : ocVal * fxRate;
  const ocInContainerCcy = ocCcy === containerCcy ? ocVal : fxRate > 0 ? ocUsd / fxRate : ocVal;

  // Commission — prefer the dedicated commission record (it stores its own currency +
  // fx rate explicitly), falling back to the container's mirrored fields.
  let commUsd: number;
  let commInContainerCcy: number;
  if (commissionRecord) {
    const commVal = parseFloat(commissionRecord.commissionTotal || "0");
    const commCcy = commissionRecord.currencyCode || containerCcy;
    const commFx = parseFloat(commissionRecord.fxRateToUsd || String(fxRate)) || fxRate;
    commUsd = commCcy === "USD" ? commVal : commVal * commFx;
    commInContainerCcy = commCcy === containerCcy ? commVal : fxRate > 0 ? commUsd / fxRate : commVal;
  } else {
    const commVal = parseFloat(container.commissionAmount || "0");
    const commCcy = (container as any).commissionCurrencyCode || containerCcy;
    commUsd = commCcy === "USD" ? commVal : commVal * fxRate;
    commInContainerCcy = commCcy === containerCcy ? commVal : fxRate > 0 ? commUsd / fxRate : commVal;
  }

  // Duty — no separate currency field on the container; always container currency.
  const dutyVal = container.dutyStatus === "CONFIRMED" ? parseFloat(container.dutyAmount || "0") : 0;
  const dutyUsd = containerCcy === "USD" ? dutyVal : dutyVal * fxRate;

  // Additional charges — each row already stores its own currency + fx rate explicitly;
  // this part was already correct in the live code, kept identical here.
  let addlInContainerCcy = 0;
  let addlUsd = 0;
  for (const c of additionalCharges) {
    const amt = parseFloat(c.amount || "0");
    const ccy = c.currencyCode || containerCcy;
    const cfx = parseFloat(c.fxRateToUsd || String(fxRate)) || fxRate;
    const amtUsd = ccy === "USD" ? amt : amt * cfx;
    const amtInContainerCcy = ccy === containerCcy ? amt : fxRate > 0 ? amtUsd / fxRate : amt;
    addlInContainerCcy += amtInContainerCcy;
    addlUsd += amtUsd;
  }

  const totalCost = basePayable + freightInContainerCcy + ocInContainerCcy + commInContainerCcy + dutyVal + addlInContainerCcy;
  const totalUsd = baseMaterialUsd + freightUsd + ocUsd + commUsd + dutyUsd + addlUsd;

  return {
    costPerKg: totalCost / actualKg,
    costPerKgUsd: totalUsd / actualKg,
    totalCost,
    totalUsd,
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
      Math.abs(next.costPerKg - oldCostPerKg) > EPS || Math.abs(next.costPerKgUsd - oldCostPerKgUsd) > EPS;
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
      diffPct,
      changed,
    });
  }

  // Changed rows first, biggest impact first.
  results.sort((a, b) => {
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
