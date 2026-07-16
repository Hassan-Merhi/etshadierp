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
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import crypto from "crypto";
import { db } from "../../db";
import {
  factoryContainers,
  factoryRawStock,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factoryContainerOtherCharges,
  factorySuppliers,
  factoryMixBatchSources,
  factoryMixBatches,
  factoryBales,
} from "@shared/schema";
import { cascadeContainerCostChange, recomputeBatchAndCascadeBales } from "./rawStockCostCascade";
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
 *
 * @param otherChargesRows  Optional: detailed factoryContainerOtherCharges rows.
 *   When present (and non-empty), they are used INSTEAD of the aggregate
 *   container.otherCharges field — avoids double-counting.  Each row carries its
 *   own fxRateToUsd so multi-currency other-charges are converted correctly.
 *   When absent, falls back to container.otherCharges (legacy path).
 */
export function computeCorrectContainerCost(
  container: typeof factoryContainers.$inferSelect,
  additionalCharges: (typeof factoryOffloadAdditionalCharges.$inferSelect)[],
  commissionRecord: typeof factoryContainerCommissions.$inferSelect | null,
  otherChargesRows?: (typeof factoryContainerOtherCharges.$inferSelect)[]
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

  // Freight — may have its own FX rate stored separately (freightFxRateToUsd /
  // freightFxRateConfirmed), populated when freight is in a third currency.
  // Fall back to the container's own FX rate when not set (unchanged legacy path).
  const freightVal = new Decimal(container.freight || "0");
  const freightCcy = container.freightCurrencyCode || containerCcy;
  const rawFreightFx = parseFloat((container as any).freightFxRateToUsd || "");
  const freightFxConfirmed = !!(container as any).freightFxRateConfirmed;
  let dFreightFx: Decimal;
  if (freightCcy === "USD") {
    dFreightFx = new Decimal(1);
  } else if (Number.isFinite(rawFreightFx) && rawFreightFx > 0 && freightFxConfirmed) {
    // Freight-specific rate takes priority over the container's rate.
    dFreightFx = new Decimal(rawFreightFx);
  } else {
    dFreightFx = dFxRate;
  }
  const freightUsd = freightCcy === "USD" ? freightVal : freightVal.times(dFreightFx);
  const freightInContainerCcy =
    freightCcy === containerCcy ? freightVal : dFxRate.gt(0) ? freightUsd.div(dFxRate) : freightVal;

  // Other charges — use per-row detail when available, otherwise the aggregate field.
  // Using both would double-count.
  let ocInContainerCcy: Decimal;
  let ocUsd: Decimal;
  if (otherChargesRows && otherChargesRows.length > 0) {
    // Detailed path: each row carries its own currency + FX rate.
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
      const ocAmtInContainerCcy = ocCcy === containerCcy ? ocAmt : dFxRate.gt(0) ? ocAmtUsd.div(dFxRate) : ocAmt;
      ocInContainerCcy = ocInContainerCcy.plus(ocAmtInContainerCcy);
      ocUsd = ocUsd.plus(ocAmtUsd);
    }
  } else {
    // Legacy aggregate path — the buggy post-offload-charge route ignored the
    // OC currency; use otherChargesCurrencyCode if present, default to containerCcy.
    const ocVal = new Decimal(container.otherCharges || "0");
    const ocCcy = (container as any).otherChargesCurrencyCode || containerCcy;
    ocUsd = ocCcy === "USD" ? ocVal : ocVal.times(dFxRate);
    ocInContainerCcy = ocCcy === containerCcy ? ocVal : dFxRate.gt(0) ? ocUsd.div(dFxRate) : ocVal;
  }

  // Commission — prefer the dedicated commission record (it stores its own currency +
  // fx rate explicitly), falling back to the container's commission snapshot fields.
  //
  // IMPORTANT: never use the container's material fxRateToUsd (dFxRate) as a fallback
  // for a commission that is denominated in a different currency. Example: an AUD
  // container (fxRate=0.67) with a EUR commission (EUR/USD=1.18) would produce
  // commUsd = EUR_amount × 0.67 = wrong. Each currency must have its own confirmed rate.
  let commUsd: Decimal = new Decimal(0);
  let commInContainerCcy: Decimal = new Decimal(0);
  let commFxUnresolved = false;

  /** Helper: compute commUsd + commInContainerCcy given value, currency, and a resolved fx */
  function applyCommFx(commVal: Decimal, commCcy: string, commFx: Decimal): void {
    if (commCcy === "USD") {
      commUsd = commVal;
      commInContainerCcy = containerCcy === "USD" ? commVal : dFxRate.gt(0) ? commVal.div(dFxRate) : commVal;
    } else if (commCcy === containerCcy) {
      commInContainerCcy = commVal;
      commUsd = dFxRate.gt(0) ? commVal.times(dFxRate) : commVal;
    } else {
      // Different non-USD currency: use the dedicated commission FX rate
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
      // Same currency as container: use confirmed container FX
      applyCommFx(commVal, commCcy, dFxRate);
    } else {
      // Different non-USD: commission record must carry its own confirmed rate
      if (Number.isFinite(rawCommFx) && rawCommFx > 0 && commConfirmed) {
        applyCommFx(commVal, commCcy, new Decimal(rawCommFx));
      } else {
        // Fall back to container snapshot commission FX fields
        const snapFx = parseFloat((container as any).commissionFxRateToUsd || "");
        const snapConfirmed = (container as any).commissionFxRateConfirmed === true;
        if (Number.isFinite(snapFx) && snapFx > 0 && snapConfirmed) {
          applyCommFx(commVal, commCcy, new Decimal(snapFx));
        } else {
          // No valid commission-specific FX: flag as unresolved, contribute zero
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
      // Different non-USD: must use commission snapshot FX fields (not container material FX)
      const snapFx = parseFloat((container as any).commissionFxRateToUsd || "");
      const snapConfirmed = (container as any).commissionFxRateConfirmed === true;
      if (Number.isFinite(snapFx) && snapFx > 0 && snapConfirmed) {
        applyCommFx(commVal, commCcy, new Decimal(snapFx));
      } else if (commVal.gt(0)) {
        // Commission exists but no commission-specific FX: flag as unresolved
        commFxUnresolved = true;
        commUsd = new Decimal(0);
        commInContainerCcy = new Decimal(0);
      } else {
        commUsd = new Decimal(0);
        commInContainerCcy = new Decimal(0);
      }
    }
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
    fxUnresolved: commFxUnresolved,
  };
}

export interface RecalcFingerprintInputs {
  container: typeof factoryContainers.$inferSelect;
  additionalCharges: (typeof factoryOffloadAdditionalCharges.$inferSelect)[];
  commissionRecord: typeof factoryContainerCommissions.$inferSelect | null;
  rawStock: typeof factoryRawStock.$inferSelect | null;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Deterministic fingerprint of every input that feeds a container's corrected
 * landed cost, plus the current stored cost and the expected corrected
 * result. Used to bind a recalc confirmation token to the EXACT approved
 * calculation — not just its numeric output — so ANY change to a
 * contributing field (container status/updatedAt, rate, currency, FX rate or
 * confirmed state, freight, duty, commission, other charges, or any
 * individual additional-charge row's amount/currency/rate/version) between
 * dry-run and apply invalidates the token, even if the corrected numbers
 * happen to net out the same.
 */
export function computeRecalcFingerprint(inputs: RecalcFingerprintInputs): string {
  const c = inputs.container;
  const next = computeCorrectContainerCost(c, inputs.additionalCharges, inputs.commissionRecord);
  const canonical = {
    containerId: c.id,
    status: c.status,
    updatedAt: toIso((c as any).updatedAt),
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

/** Loads the current, fresh inputs for one container (outside any transaction —
 * used for dry-run preview fingerprinting; the apply path re-loads under a row
 * lock and calls computeRecalcFingerprint again itself). Returns null if the
 * container doesn't exist in this company. */
export async function loadRecalcFingerprintInputs(
  companyId: number,
  containerId: number,
  dbOrTx: any = db
): Promise<RecalcFingerprintInputs | null> {
  const [container] = await dbOrTx
    .select()
    .from(factoryContainers)
    .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));
  if (!container) return null;

  const [additionalCharges, commissionRecords, rawStockRows] = await Promise.all([
    dbOrTx
      .select()
      .from(factoryOffloadAdditionalCharges)
      .where(
        and(
          eq(factoryOffloadAdditionalCharges.containerId, containerId),
          eq(factoryOffloadAdditionalCharges.companyId, companyId)
        )
      ),
    dbOrTx
      .select()
      .from(factoryContainerCommissions)
      .where(
        and(
          eq(factoryContainerCommissions.containerId, containerId),
          eq(factoryContainerCommissions.companyId, companyId)
        )
      ),
    dbOrTx
      .select()
      .from(factoryRawStock)
      .where(
        and(
          eq(factoryRawStock.containerId, containerId),
          eq(factoryRawStock.companyId, companyId),
          isNull(factoryRawStock.deletedAt)
        )
      ),
  ]);
  const commissionRecord = commissionRecords.sort((a: any, b: any) => b.id - a.id)[0] || null;

  return { container, additionalCharges, commissionRecord, rawStock: rawStockRows[0] || null };
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

export interface AffectedMixBatchPreviewRow {
  batchId: number;
  batchCode: string;
  name: string | null;
  status: string;
  batchDate: string | null;
  wasCompleted: boolean;
  totalWeightKg: number;
  oldCostPerKg: number;
  newCostPerKg: number;
  diffPct: number;
  baleCount: number;
  sourceContainerNumbers: string[];
}

const OPEN_BATCH_STATUSES = ["ACTIVE", "OPEN", "CARRY_FORWARD"];
const COMPLETED_BATCH_STATUSES = ["COMPLETED", "CLOSED"];

/**
 * Read-only preview of every mix batch that would be touched by applying the
 * given containers' corrected cost — mirrors cascadeContainerCostChange's
 * batch-selection and weighted-average math exactly, but never writes
 * anything. Used to show an admin the downstream blast radius (and, when
 * includeCompletedBatches is true, which already-completed/closed batches
 * would also be rewritten) before they click Apply.
 */
export async function getAffectedMixBatchesPreview(
  companyId: number,
  containerIds: number[],
  includeCompletedBatches: boolean
): Promise<AffectedMixBatchPreviewRow[]> {
  if (containerIds.length === 0) return [];

  const preview = await getRawStockRecalcPreview(companyId);
  const correctedCostByContainer = new Map(
    preview.filter((r) => containerIds.includes(r.containerId) && !r.fxUnresolved).map((r) => [r.containerId, r.next.costPerKg])
  );
  if (correctedCostByContainer.size === 0) return [];

  const statusFilter = includeCompletedBatches
    ? [...OPEN_BATCH_STATUSES, ...COMPLETED_BATCH_STATUSES]
    : OPEN_BATCH_STATUSES;

  const sourceRows = await db
    .select({
      src: factoryMixBatchSources,
      batch: factoryMixBatches,
      containerNumber: factoryContainers.containerNumber,
    })
    .from(factoryMixBatchSources)
    .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
    .leftJoin(factoryContainers, eq(factoryContainers.id, factoryMixBatchSources.containerId))
    .where(
      and(
        inArray(factoryMixBatchSources.containerId, [...correctedCostByContainer.keys()]),
        eq(factoryMixBatches.companyId, companyId),
        inArray(factoryMixBatches.status, statusFilter),
        isNull(factoryMixBatches.deletedAt)
      )
    );

  const touchedBatchIds = [...new Set(sourceRows.map((r) => r.batch.id))];
  if (touchedBatchIds.length === 0) return [];

  // Recompute each touched batch's weighted-average cost from ALL of its
  // sources (not just the ones from the corrected containers) — a batch may
  // blend multiple suppliers/containers, exactly like the real cascade does.
  const [allSourcesForTouchedBatches, baleCounts] = await Promise.all([
    db
      .select({ src: factoryMixBatchSources, containerNumber: factoryContainers.containerNumber })
      .from(factoryMixBatchSources)
      .leftJoin(factoryContainers, eq(factoryContainers.id, factoryMixBatchSources.containerId))
      .where(inArray(factoryMixBatchSources.mixBatchId, touchedBatchIds)),
    db
      .select({ mixBatchId: factoryBales.mixBatchId, count: sql<number>`count(*)` })
      .from(factoryBales)
      .where(
        and(
          inArray(factoryBales.mixBatchId, touchedBatchIds),
          eq(factoryBales.companyId, companyId),
          sql`${factoryBales.status} NOT IN ('DELETED','REMOVED')`
        )
      )
      .groupBy(factoryBales.mixBatchId),
  ]);

  const baleCountByBatch = new Map(baleCounts.map((b) => [b.mixBatchId as number, Number(b.count)]));
  const batchById = new Map(sourceRows.map((r) => [r.batch.id, r.batch]));

  const results: AffectedMixBatchPreviewRow[] = [];
  for (const batchId of touchedBatchIds) {
    const batch = batchById.get(batchId)!;
    const sourcesForBatch = allSourcesForTouchedBatches.filter((r) => r.src.mixBatchId === batchId);
    let totalCost = 0;
    let totalWeight = 0;
    const containerNumbers = new Set<string>();
    for (const { src, containerNumber } of sourcesForBatch) {
      const weight = parseFloat(src.weightKg || "0");
      const correctedCost = src.containerId != null ? correctedCostByContainer.get(src.containerId) : undefined;
      const costPerKg = correctedCost !== undefined ? correctedCost : parseFloat(src.costPerKg || "0");
      totalCost += weight * costPerKg;
      totalWeight += weight;
      if (containerNumber) containerNumbers.add(containerNumber);
    }
    const oldCostPerKg = parseFloat(batch.costPerKg || "0");
    const newCostPerKg = totalWeight > 0 ? totalCost / totalWeight : oldCostPerKg;
    const diffPct = oldCostPerKg > 0 ? ((newCostPerKg - oldCostPerKg) / oldCostPerKg) * 100 : 0;

    results.push({
      batchId,
      batchCode: batch.batchCode,
      name: batch.name,
      status: batch.status,
      batchDate: batch.batchDate ? String(batch.batchDate) : null,
      wasCompleted: COMPLETED_BATCH_STATUSES.includes(batch.status),
      totalWeightKg: totalWeight,
      oldCostPerKg,
      newCostPerKg,
      diffPct,
      baleCount: baleCountByBatch.get(batchId) || 0,
      sourceContainerNumbers: [...containerNumbers],
    });
  }

  results.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
  return results;
}

export interface ApplyResult {
  containerId: number;
  containerNumber: string;
  applied: boolean;
  skippedReason?: string;
  staleToken?: boolean;
  rawStockRowsUpdated: number;
  affectedBatches: number;
  affectedBales: number;
  completedBatchesRewritten?: number;
}

// Recalc is a forward-looking correction to an already-offloaded container's
// landed cost — OFFLOADED is the NORMAL state of every eligible container, so
// (unlike the FX-confirmation lock) it is never refused here. Only genuinely
// historical/closed containers are off-limits.
const RECALC_REFUSED_STATUSES = new Set(["CLOSED", "COMPLETED"]);

// Advisory-lock namespace distinct from fxResolutionRepair's (1/2/3) so the two
// repair tools never collide on the same numeric key space.
const RECALC_LOCK_NAMESPACE = 9001;

export interface ApplyRawStockRecalcOptions {
  /** Called with the transaction handle AFTER the container/cascade writes but
   * BEFORE commit for each individual container, so an audit-log insert here
   * is atomic with that container's update: if it throws, that container's
   * transaction (and only that one) rolls back. */
  onAudit?: (tx: any, result: ApplyResult) => Promise<void>;
  /** Per-container fingerprint captured at dry-run/token-issue time (see
   * computeRecalcFingerprint). When provided, the fingerprint is RECOMPUTED
   * from the fresh, row-locked state inside this container's own transaction
   * — not just compared before the transaction opens — and the write is
   * refused (staleToken=true) if anything the token approved has changed.
   * Skipped for a container already sitting at its corrected value: that is
   * a safe idempotent replay of an already-applied token, not staleness. */
  expectedFingerprints?: Record<number, string>;
  /** Explicit, per-request admin override: also rewrite COMPLETED/CLOSED mix
   * batches (and their bales) sourced from these containers, instead of leaving
   * them as locked historical record. Off by default — see rawStockCostCascade.ts. */
  includeCompletedBatches?: boolean;
}

/**
 * Apply the corrected cost for a specific set of containers, cascading down the chain.
 * Each container is applied in its own transaction with a `SELECT ... FOR UPDATE` row
 * lock plus an advisory lock, so a concurrent apply/offload on the same container
 * serializes instead of racing. Refuses (reports, does not throw) CLOSED/COMPLETED
 * containers — historical costing is never auto-rewritten. Idempotent: re-applying
 * to a container whose stored cost already matches the corrected value is a no-op
 * (applied=false).
 */
export async function applyRawStockRecalc(
  companyId: number,
  containerIds: number[],
  opts: ApplyRawStockRecalcOptions = {}
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  for (const containerId of containerIds) {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${RECALC_LOCK_NAMESPACE}, ${containerId})`);

      const [container] = await tx
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)))
        .for("update");
      if (!container) return null;

      if (RECALC_REFUSED_STATUSES.has(container.status)) {
        return {
          containerId,
          containerNumber: container.containerNumber,
          applied: false,
          skippedReason: `Container status is ${container.status} — historical costing on closed containers is never auto-rewritten.`,
          rawStockRowsUpdated: 0,
          affectedBatches: 0,
          affectedBales: 0,
        } as ApplyResult;
      }

      const [additionalCharges, commissionRecords] = await Promise.all([
        tx
          .select()
          .from(factoryOffloadAdditionalCharges)
          .where(
            and(
              eq(factoryOffloadAdditionalCharges.containerId, containerId),
              eq(factoryOffloadAdditionalCharges.companyId, companyId)
            )
          ),
        tx
          .select()
          .from(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.containerId, containerId),
              eq(factoryContainerCommissions.companyId, companyId)
            )
          ),
      ]);
      const commissionRecord = commissionRecords.sort((a: any, b: any) => b.id - a.id)[0] || null;

      const rawStockRows = await tx
        .select()
        .from(factoryRawStock)
        .where(
          and(
            eq(factoryRawStock.containerId, containerId),
            eq(factoryRawStock.companyId, companyId),
            isNull(factoryRawStock.deletedAt)
          )
        );
      const rawStockRow = rawStockRows[0] || null;

      const next = computeCorrectContainerCost(container, additionalCharges, commissionRecord);
      if (next.fxUnresolved) {
        return {
          containerId,
          containerNumber: container.containerNumber,
          applied: false,
          skippedReason: "FX rate is unresolved for this container — never auto-apply a recompute derived from a guessed rate.",
          rawStockRowsUpdated: 0,
          affectedBatches: 0,
          affectedBales: 0,
        } as ApplyResult;
      }
      if (next.costPerKgUsd === 0 && next.costPerKg === 0) {
        return {
          containerId,
          containerNumber: container.containerNumber,
          applied: false,
          skippedReason: "No received kg — nothing to recompute.",
          rawStockRowsUpdated: 0,
          affectedBatches: 0,
          affectedBales: 0,
        } as ApplyResult;
      }

      const oldCostPerKgUsd = parseFloat(container.ratePerKgUsd || "0");
      const EPS = 0.0005;
      const alreadyCorrect = Math.abs(next.costPerKgUsd - oldCostPerKgUsd) <= EPS;
      if (alreadyCorrect) {
        return {
          containerId,
          containerNumber: container.containerNumber,
          applied: false,
          skippedReason: "Stored cost already matches the corrected value — idempotent no-op.",
          rawStockRowsUpdated: 0,
          affectedBatches: 0,
          affectedBales: 0,
        } as ApplyResult;
      }

      // Recalculate the fingerprint from THIS fresh, row-locked read — not the
      // one taken before the transaction opened — so a concurrent edit that
      // landed between dry-run/token-issue and this exact apply attempt is
      // caught even under concurrency, not just via a best-effort pre-check.
      const expectedFingerprint = opts.expectedFingerprints?.[containerId];
      if (expectedFingerprint) {
        const freshFingerprint = computeRecalcFingerprint({
          container,
          additionalCharges,
          commissionRecord,
          rawStock: rawStockRow,
        });
        if (freshFingerprint !== expectedFingerprint) {
          return {
            containerId,
            containerNumber: container.containerNumber,
            applied: false,
            staleToken: true,
            skippedReason: "Container's approved calculation inputs changed since the confirmation token was issued — re-run the dry-run preview and try again.",
            rawStockRowsUpdated: 0,
            affectedBatches: 0,
            affectedBales: 0,
          } as ApplyResult;
        }
      }

      await tx
        .update(factoryContainers)
        .set({
          finalPayableAmount: String(next.totalCost),
          ratePerKgUsd: String(next.costPerKgUsd),
          finalPayableAmountUsd: String(next.totalUsd),
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      const cascadeResult = await cascadeContainerCostChange(
        tx,
        {
          companyId,
          containerId,
          newCostPerKg: next.costPerKg,
          newCostPerKgUsd: next.costPerKgUsd,
        },
        { includeCompletedBatches: opts.includeCompletedBatches }
      );

      const applyResult: ApplyResult = {
        containerId,
        containerNumber: container.containerNumber,
        applied: true,
        rawStockRowsUpdated: cascadeResult.rawStockRowsUpdated,
        affectedBatches: cascadeResult.affectedBatches.length,
        affectedBales: cascadeResult.affectedBales.length,
        completedBatchesRewritten: cascadeResult.affectedBatches.filter((b) => b.wasCompleted).length,
      };

      // Atomic with the writes above: if this throws, this container's entire
      // transaction (container update + cascade) rolls back too.
      if (opts.onAudit) {
        await opts.onAudit(tx, applyResult);
      }

      return applyResult;
    });

    if (result) results.push(result);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Zero-cost mix-batch-source repair.
//
// A mix batch's blended cost/kg is a weighted average of its sources
// (factoryMixBatchSources). A handful of historical batches were created from
// a container (or, in one known case, direct-from-supplier) whose source row
// never got its costPerKg/totalCost populated at all — it was left at 0. This
// is a DIFFERENT bug from the container-level landed-cost drift the recalc
// preview/apply above targets: the container's own stored cost can be
// perfectly correct (so it never appears as a "changed" row above and is
// never selectable there) while its mix-batch-source rows still silently
// drag every batch that drew from it toward zero. This section finds those
// source rows directly and repairs them + cascades to their batch/bales,
// independent of whether the parent container's cost changed.
// ---------------------------------------------------------------------------

export interface ZeroCostSourceRow {
  sourceId: number;
  batchId: number;
  batchCode: string;
  batchStatus: string;
  containerId: number | null;
  containerNumber: string | null;
  supplierId: number | null;
  supplierName: string | null;
  weightKg: number;
  currentCostPerKg: number;
  correctedCostPerKg: number | null;
  fixable: boolean;
  reason: string;
}

/**
 * Read-only scan for mix-batch-source rows recorded with cost 0 despite
 * having real weight — i.e. a batch whose blended cost is understated
 * because a piece of it was never priced. For container-linked sources the
 * correction is unambiguous: the container's own current raw-stock cost/kg
 * (run the container recalc above FIRST if that container's own cost is also
 * wrong, so this reads the already-corrected value). Direct-from-supplier
 * sources with no container link have no stored historical rate to recover,
 * so they're surfaced as non-fixable — an admin has to supply a rate manually.
 */
export async function getZeroCostMixBatchSourcesPreview(companyId: number): Promise<ZeroCostSourceRow[]> {
  const rows = await db
    .select({
      src: factoryMixBatchSources,
      batch: factoryMixBatches,
      containerNumber: factoryContainers.containerNumber,
      supplierName: factorySuppliers.name,
    })
    .from(factoryMixBatchSources)
    .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
    .leftJoin(factoryContainers, eq(factoryContainers.id, factoryMixBatchSources.containerId))
    .leftJoin(factorySuppliers, eq(factorySuppliers.id, factoryMixBatchSources.supplierId))
    .where(
      and(
        eq(factoryMixBatches.companyId, companyId),
        isNull(factoryMixBatches.deletedAt),
        sql`${factoryMixBatchSources.costPerKg}::numeric <= 0`,
        sql`${factoryMixBatchSources.weightKg}::numeric > 0`
      )
    );

  if (rows.length === 0) return [];

  const containerIds = [...new Set(rows.map((r) => r.src.containerId).filter((id): id is number => id != null))];
  const rawStockByContainer = containerIds.length
    ? new Map(
        (
          await db
            .select()
            .from(factoryRawStock)
            .where(and(inArray(factoryRawStock.containerId, containerIds), isNull(factoryRawStock.deletedAt)))
        ).map((r) => [r.containerId as number, r])
      )
    : new Map();

  return rows
    .map(({ src, batch, containerNumber, supplierName }) => {
      const weightKg = parseFloat(src.weightKg || "0");
      const rawStock = src.containerId != null ? rawStockByContainer.get(src.containerId) : undefined;
      const correctedCostPerKg = rawStock ? parseFloat(rawStock.costPerKg || "0") : null;
      const fixable = correctedCostPerKg != null && correctedCostPerKg > 0;
      return {
        sourceId: src.id,
        batchId: batch.id,
        batchCode: batch.batchCode,
        batchStatus: batch.status,
        containerId: src.containerId,
        containerNumber: containerNumber || null,
        supplierId: src.supplierId,
        supplierName: supplierName || null,
        weightKg,
        currentCostPerKg: parseFloat(src.costPerKg || "0"),
        correctedCostPerKg,
        fixable,
        reason: fixable
          ? "Container's current landed cost is known — safe to backfill."
          : src.containerId != null
            ? "Container has no priced raw-stock row to copy a cost from."
            : "Sourced directly from a supplier with no container link — no historical rate on file; requires a manually entered cost/kg.",
      };
    })
    .sort((a, b) => b.weightKg - a.weightKg);
}

const ZERO_COST_SOURCE_LOCK_NAMESPACE = 9002;

export interface ZeroCostSourceFixResult {
  sourceId: number;
  batchId: number;
  batchCode: string;
  applied: boolean;
  skippedReason?: string;
  costPerKgApplied?: number;
  affectedBales: number;
}

/**
 * Apply the fix for a specific set of zero-cost mix-batch-source rows.
 * `manualRates` lets an admin supply an explicit cost/kg for sources that
 * have no container to copy a rate from (e.g. direct-from-supplier sources);
 * container-linked sources always use the container's current raw-stock
 * cost — never a manual override, so this can't be used to smuggle in an
 * arbitrary number for a source that already has a real answer on file.
 * Each source's batch is locked (advisory + row) and recomputed/cascaded in
 * its own transaction, mirroring applyRawStockRecalc's per-item isolation.
 */
export async function applyZeroCostMixBatchSourcesFix(
  companyId: number,
  sourceIds: number[],
  opts: { manualRates?: Record<number, number>; onAudit?: (tx: any, result: ZeroCostSourceFixResult) => Promise<void> } = {}
): Promise<ZeroCostSourceFixResult[]> {
  const results: ZeroCostSourceFixResult[] = [];

  for (const sourceId of sourceIds) {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ZERO_COST_SOURCE_LOCK_NAMESPACE}, ${sourceId})`);

      const [src] = await tx
        .select()
        .from(factoryMixBatchSources)
        .where(and(eq(factoryMixBatchSources.id, sourceId)))
        .for("update");
      if (!src) return null;

      const [batch] = await tx
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.id, src.mixBatchId), eq(factoryMixBatches.companyId, companyId)));
      if (!batch) return null;

      const currentCostPerKg = parseFloat(src.costPerKg || "0");
      const weightKg = parseFloat(src.weightKg || "0");
      if (currentCostPerKg > 0 || weightKg <= 0) {
        return {
          sourceId,
          batchId: batch.id,
          batchCode: batch.batchCode,
          applied: false,
          skippedReason: "Source is no longer zero-cost — idempotent no-op.",
          affectedBales: 0,
        } as ZeroCostSourceFixResult;
      }

      let correctedCostPerKg: number | null = null;
      if (src.containerId != null) {
        const [rawStock] = await tx
          .select()
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.containerId, src.containerId), isNull(factoryRawStock.deletedAt)));
        correctedCostPerKg = rawStock ? parseFloat(rawStock.costPerKg || "0") : null;
        if (!correctedCostPerKg || correctedCostPerKg <= 0) {
          return {
            sourceId,
            batchId: batch.id,
            batchCode: batch.batchCode,
            applied: false,
            skippedReason: "Container has no priced raw-stock row to copy a cost from.",
            affectedBales: 0,
          } as ZeroCostSourceFixResult;
        }
      } else {
        const manualRate = opts.manualRates?.[sourceId];
        if (!manualRate || manualRate <= 0) {
          return {
            sourceId,
            batchId: batch.id,
            batchCode: batch.batchCode,
            applied: false,
            skippedReason: "Direct-from-supplier source with no container link — requires a manually entered cost/kg.",
            affectedBales: 0,
          } as ZeroCostSourceFixResult;
        }
        correctedCostPerKg = manualRate;
      }

      await tx
        .update(factoryMixBatchSources)
        .set({
          costPerKg: new Decimal(correctedCostPerKg).toDecimalPlaces(6).toFixed(6),
          totalCost: new Decimal(weightKg).times(new Decimal(correctedCostPerKg)).toDecimalPlaces(6).toFixed(6),
        })
        .where(eq(factoryMixBatchSources.id, sourceId));

      const { bales } = await recomputeBatchAndCascadeBales(tx, companyId, batch.id);

      const fixResult: ZeroCostSourceFixResult = {
        sourceId,
        batchId: batch.id,
        batchCode: batch.batchCode,
        applied: true,
        costPerKgApplied: correctedCostPerKg,
        affectedBales: bales.length,
      };

      if (opts.onAudit) {
        await opts.onAudit(tx, fixResult);
      }

      return fixResult;
    });

    if (result) results.push(result);
  }

  return results;
}
