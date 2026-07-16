/**
 * Historical raw-material cost recalculation.
 *
 * Recomputes the correct inclusive cost/kg (native + USD) for every offloaded
 * container from its stored charge fields, using the SAME math as the original
 * offload route (rawStockOffloadRoutes.ts) — each charge (freight, other charges,
 * commission, duty, additional charges) converted from its OWN currency, not
 * assumed to already be in the container's currency.
 *
 * Read-only preview never writes anything. Apply runs inside a transaction per container.
 */
import { eq, and, isNull, sql, inArray, gt } from "drizzle-orm";
import { pool } from "../../db";
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

// ─────────────────────────────────────────────────────────────────────────────
// Precision helpers
// ─────────────────────────────────────────────────────────────────────────────

/** All per-KG cost comparisons are normalised to 6 decimal places. */
export const COST_SCALE = 6;

/** True when two cost/kg values are equal at six-decimal precision. */
export function costEquals(
  a: string | number | null | undefined,
  b: string | number | null | undefined
): boolean {
  return new Decimal(a ?? 0).toDecimalPlaces(COST_SCALE).equals(new Decimal(b ?? 0).toDecimalPlaces(COST_SCALE));
}

/** Round a cost/kg to exactly COST_SCALE decimals; returns a string for DB writes. */
export function costRound(v: string | number | null | undefined): string {
  return new Decimal(v ?? 0).toDecimalPlaces(COST_SCALE).toFixed(COST_SCALE);
}

// ─────────────────────────────────────────────────────────────────────────────
// computeCorrectContainerCost — authoritative landed-cost formula
// ─────────────────────────────────────────────────────────────────────────────

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

  // Freight
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

  // Other charges — use per-row detail when available, otherwise the aggregate field.
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
      const ocAmtInContainerCcy = ocCcy === containerCcy ? ocAmt : dFxRate.gt(0) ? ocAmtUsd.div(dFxRate) : ocAmt;
      ocInContainerCcy = ocInContainerCcy.plus(ocAmtInContainerCcy);
      ocUsd = ocUsd.plus(ocAmtUsd);
    }
  } else {
    const ocVal = new Decimal(container.otherCharges || "0");
    const ocCcy = (container as any).otherChargesCurrencyCode || containerCcy;
    ocUsd = ocCcy === "USD" ? ocVal : ocVal.times(dFxRate);
    ocInContainerCcy = ocCcy === containerCcy ? ocVal : dFxRate.gt(0) ? ocUsd.div(dFxRate) : ocVal;
  }

  // Commission
  let commUsd: Decimal = new Decimal(0);
  let commInContainerCcy: Decimal = new Decimal(0);
  let commFxUnresolved = false;

  function applyCommFx(commVal: Decimal, commCcy: string, commFx: Decimal): void {
    if (commCcy === "USD") {
      commUsd = commVal;
      commInContainerCcy = containerCcy === "USD" ? commVal : dFxRate.gt(0) ? commVal.div(dFxRate) : commVal;
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
      } else {
        commUsd = new Decimal(0);
        commInContainerCcy = new Decimal(0);
      }
    }
  }

  // Duty — always container currency
  const dutyVal = container.dutyStatus === "CONFIRMED" ? new Decimal(container.dutyAmount || "0") : new Decimal(0);
  const dutyUsd = containerCcy === "USD" ? dutyVal : dutyVal.times(dFxRate);

  // Additional charges — each row stores its own currency + fx rate
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
    costPerKg: totalCost.div(actualKg).toDecimalPlaces(COST_SCALE).toNumber(),
    costPerKgUsd: totalUsd.div(actualKg).toDecimalPlaces(COST_SCALE).toNumber(),
    totalCost: totalCost.toNumber(),
    totalUsd: totalUsd.toNumber(),
    fxUnresolved: commFxUnresolved,
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
  const next = computeCorrectContainerCost(c, inputs.additionalCharges, inputs.commissionRecord, inputs.otherChargesRows);
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

  const [additionalCharges, commissionRecords, rawStockRows, otherChargesRows] = await Promise.all([
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
    dbOrTx
      .select()
      .from(factoryContainerOtherCharges)
      .where(
        and(
          eq(factoryContainerOtherCharges.containerId, containerId),
          eq(factoryContainerOtherCharges.companyId, companyId)
        )
      ),
  ]);
  const commissionRecord = commissionRecords.sort((a: any, b: any) => b.id - a.id)[0] || null;

  return {
    container,
    additionalCharges,
    commissionRecord,
    rawStock: rawStockRows[0] || null,
    otherChargesRows,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getRawStockRecalcPreview
// ─────────────────────────────────────────────────────────────────────────────

export interface RecalcRow {
  containerId: number;
  /** null when the active raw-stock row is missing/deleted */
  rawStockId: number | null;
  containerNumber: string;
  containerStatus: string;
  supplierId: number | null;
  supplierName: string;
  currencyCode: string;
  receivedKg: number;
  usedKg: number;
  remainingKg: number;
  fullyUsed: boolean;
  activeRawStockRowExists: boolean;
  /** A soft-deleted raw-stock row exists for this container */
  rawStockDeleted: boolean;
  mixSourceCount: number;
  affectedOpenBatchCount: number;
  affectedCompletedBatchCount: number;
  old: { costPerKg: number; costPerKgUsd: number };
  next: { costPerKg: number; costPerKgUsd: number };
  diffPct: number;
  changed: boolean;
  fxUnresolved: boolean;
}

const OPEN_BATCH_STATUSES = ["ACTIVE", "OPEN", "CARRY_FORWARD"];
const COMPLETED_BATCH_STATUSES = ["COMPLETED", "CLOSED"];

/** Read-only: build the full diff list.
 *  Covers containers with an active raw-stock row AND historical/fully-consumed
 *  containers that have linked mix-batch sources but no active raw-stock row. */
export async function getRawStockRecalcPreview(companyId: number): Promise<RecalcRow[]> {
  // A. Containers with an active raw-stock row
  const rowsWithStock = await db
    .select({
      rawStockId: factoryRawStock.id,
      containerId: factoryRawStock.containerId,
      receivedKg: factoryRawStock.receivedKg,
      usedKg: factoryRawStock.usedKg,
      costPerKg: factoryRawStock.costPerKg,
      costPerKgUsd: factoryRawStock.costPerKgUsd,
      container: factoryContainers,
      supplierName: factorySuppliers.name,
    })
    .from(factoryRawStock)
    .innerJoin(factoryContainers, eq(factoryContainers.id, factoryRawStock.containerId))
    .leftJoin(factorySuppliers, eq(factorySuppliers.id, factoryContainers.supplierId))
    .where(and(eq(factoryRawStock.companyId, companyId), isNull(factoryRawStock.deletedAt)));

  // B. Containers without active raw-stock but with linked mix-batch sources
  const stockedIds = rowsWithStock.length > 0
    ? rowsWithStock.map((r) => r.containerId)
    : [-1];

  const historicalRows = await db
    .select({
      container: factoryContainers,
      supplierName: factorySuppliers.name,
    })
    .from(factoryContainers)
    .leftJoin(factorySuppliers, eq(factorySuppliers.id, factoryContainers.supplierId))
    .where(
      and(
        eq(factoryContainers.companyId, companyId),
        sql`${factoryContainers.id} NOT IN (${sql.join(stockedIds.map((id) => sql`${id}`), sql`, `)})`,
        sql`EXISTS (SELECT 1 FROM factory_mix_batch_sources fmbs WHERE fmbs.container_id = ${factoryContainers.id})`,
        gt(factoryContainers.actualReceivedKg, "0")
      )
    );

  if (rowsWithStock.length === 0 && historicalRows.length === 0) return [];

  const allContainerIds = [
    ...rowsWithStock.map((r) => r.containerId),
    ...historicalRows.map((r) => r.container.id),
  ];

  // Load supporting data in parallel
  const [allAdditionalCharges, allCommissions, allOtherCharges, sourceCountResult, deletedRsRows] =
    await Promise.all([
      db.select().from(factoryOffloadAdditionalCharges).where(eq(factoryOffloadAdditionalCharges.companyId, companyId)),
      db.select().from(factoryContainerCommissions).where(eq(factoryContainerCommissions.companyId, companyId)),
      db.select().from(factoryContainerOtherCharges).where(eq(factoryContainerOtherCharges.companyId, companyId)),
      pool.query<{
        container_id: string;
        source_count: string;
        open_batch_count: string;
        completed_batch_count: string;
      }>(
        `SELECT
          fmbs.container_id,
          COUNT(*)::int AS source_count,
          COUNT(DISTINCT CASE WHEN fmb.status IN ('ACTIVE','OPEN','CARRY_FORWARD') THEN fmb.id END)::int AS open_batch_count,
          COUNT(DISTINCT CASE WHEN fmb.status IN ('COMPLETED','CLOSED') THEN fmb.id END)::int AS completed_batch_count
        FROM factory_mix_batch_sources fmbs
        JOIN factory_mix_batches fmb ON fmb.id = fmbs.mix_batch_id
        WHERE fmbs.container_id = ANY($1)
          AND fmb.deleted_at IS NULL
        GROUP BY fmbs.container_id`,
        [allContainerIds]
      ),
      // Soft-deleted raw-stock per container
      db
        .select({ containerId: factoryRawStock.containerId })
        .from(factoryRawStock)
        .where(
          and(
            eq(factoryRawStock.companyId, companyId),
            inArray(factoryRawStock.containerId, allContainerIds),
            sql`${factoryRawStock.deletedAt} IS NOT NULL`
          )
        ),
    ]);

  // Build lookup maps
  const chargesByContainer = new Map<number, (typeof factoryOffloadAdditionalCharges.$inferSelect)[]>();
  for (const c of allAdditionalCharges) {
    if (!chargesByContainer.has(c.containerId)) chargesByContainer.set(c.containerId, []);
    chargesByContainer.get(c.containerId)!.push(c);
  }
  const commissionByContainer = new Map<number, typeof factoryContainerCommissions.$inferSelect>();
  for (const c of allCommissions) {
    const existing = commissionByContainer.get(c.containerId);
    if (!existing || c.id > existing.id) commissionByContainer.set(c.containerId, c);
  }
  const otherChargesByContainer = new Map<number, (typeof factoryContainerOtherCharges.$inferSelect)[]>();
  for (const oc of allOtherCharges) {
    if (!otherChargesByContainer.has(oc.containerId)) otherChargesByContainer.set(oc.containerId, []);
    otherChargesByContainer.get(oc.containerId)!.push(oc);
  }
  const sourceCountByContainer = new Map<number, { source_count: number; open_batch_count: number; completed_batch_count: number }>();
  for (const r of sourceCountResult.rows) {
    sourceCountByContainer.set(Number(r.container_id), {
      source_count: Number(r.source_count),
      open_batch_count: Number(r.open_batch_count),
      completed_batch_count: Number(r.completed_batch_count),
    });
  }
  const deletedRsContainerIds = new Set(deletedRsRows.map((r) => r.containerId as number));

  const results: RecalcRow[] = [];

  // Process containers with active raw-stock
  for (const row of rowsWithStock) {
    const container = row.container;
    const additionalCharges = chargesByContainer.get(container.id) || [];
    const commissionRecord = commissionByContainer.get(container.id) || null;
    const ocRows = otherChargesByContainer.get(container.id) || [];
    const next = computeCorrectContainerCost(container, additionalCharges, commissionRecord, ocRows);

    const oldCostPerKg = parseFloat(row.costPerKg || "0");
    const oldCostPerKgUsd = parseFloat(row.costPerKgUsd || "0");
    const changed =
      !next.fxUnresolved &&
      (!costEquals(next.costPerKg, oldCostPerKg) || !costEquals(next.costPerKgUsd, oldCostPerKgUsd));
    const diffPct = oldCostPerKgUsd > 0 ? ((next.costPerKgUsd - oldCostPerKgUsd) / oldCostPerKgUsd) * 100 : 0;

    const receivedKg = parseFloat(row.receivedKg || "0");
    const usedKg = parseFloat((row.usedKg as any) || "0");
    const remainingKg = Math.max(0, receivedKg - usedKg);
    const sc = sourceCountByContainer.get(container.id);

    results.push({
      containerId: container.id,
      rawStockId: row.rawStockId,
      containerStatus: container.status,
      containerNumber: container.containerNumber,
      supplierId: container.supplierId,
      supplierName: row.supplierName || "Unknown Supplier",
      currencyCode: container.currencyCode || "USD",
      receivedKg,
      usedKg,
      remainingKg,
      fullyUsed: receivedKg > 0 && remainingKg === 0,
      activeRawStockRowExists: true,
      rawStockDeleted: deletedRsContainerIds.has(container.id),
      mixSourceCount: sc?.source_count || 0,
      affectedOpenBatchCount: sc?.open_batch_count || 0,
      affectedCompletedBatchCount: sc?.completed_batch_count || 0,
      old: { costPerKg: oldCostPerKg, costPerKgUsd: oldCostPerKgUsd },
      next: { costPerKg: next.costPerKg, costPerKgUsd: next.costPerKgUsd },
      diffPct: next.fxUnresolved ? 0 : diffPct,
      changed,
      fxUnresolved: next.fxUnresolved,
    });
  }

  // Process historical containers without active raw-stock
  for (const { container, supplierName } of historicalRows) {
    const additionalCharges = chargesByContainer.get(container.id) || [];
    const commissionRecord = commissionByContainer.get(container.id) || null;
    const ocRows = otherChargesByContainer.get(container.id) || [];
    const next = computeCorrectContainerCost(container, additionalCharges, commissionRecord, ocRows);

    // For historical containers compare against ratePerKgUsd snapshot
    const oldCostPerKgUsd = parseFloat(container.ratePerKgUsd || "0");
    const oldCostPerKg = parseFloat(container.ratePerKg || "0");
    const changed = !next.fxUnresolved && (!costEquals(next.costPerKg, oldCostPerKg) || !costEquals(next.costPerKgUsd, oldCostPerKgUsd));
    const diffPct = oldCostPerKgUsd > 0 ? ((next.costPerKgUsd - oldCostPerKgUsd) / oldCostPerKgUsd) * 100 : 0;

    const receivedKg = parseFloat(container.actualReceivedKg || "0");
    const sc = sourceCountByContainer.get(container.id);

    results.push({
      containerId: container.id,
      rawStockId: null,
      containerStatus: container.status,
      containerNumber: container.containerNumber,
      supplierId: container.supplierId,
      supplierName: supplierName || "Unknown Supplier",
      currencyCode: container.currencyCode || "USD",
      receivedKg,
      usedKg: receivedKg,
      remainingKg: 0,
      fullyUsed: true,
      activeRawStockRowExists: false,
      rawStockDeleted: deletedRsContainerIds.has(container.id),
      mixSourceCount: sc?.source_count || 0,
      affectedOpenBatchCount: sc?.open_batch_count || 0,
      affectedCompletedBatchCount: sc?.completed_batch_count || 0,
      old: { costPerKg: oldCostPerKg, costPerKgUsd: oldCostPerKgUsd },
      next: { costPerKg: next.costPerKg, costPerKgUsd: next.costPerKgUsd },
      diffPct: next.fxUnresolved ? 0 : diffPct,
      // Historical containers always need review if they have sources
      changed: changed || (sc?.source_count || 0) > 0,
      fxUnresolved: next.fxUnresolved,
    });
  }

  results.sort((a, b) => {
    if (a.fxUnresolved !== b.fxUnresolved) return a.fxUnresolved ? -1 : 1;
    if (a.changed !== b.changed) return a.changed ? -1 : 1;
    return Math.abs(b.diffPct) - Math.abs(a.diffPct);
  });

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateBatchCostPreview — shared Decimal.js weighted-average helper
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchSourceChange {
  sourceId: number;
  containerId: number | null;
  containerNumber: string | null;
  weightKg: number;
  oldCostPerKgUsd: number;
  newCostPerKgUsd: number;
  oldTotalCost: number;
  newTotalCost: number;
  changed: boolean;
}

export interface BatchCostPreviewResult {
  newCostPerKg: Decimal;
  newTotalCost: Decimal;
  totalWeightKg: Decimal;
  weightKgFromSelectedContainers: Decimal;
  sourceChanges: BatchSourceChange[];
}

/**
 * Pure Decimal.js weighted-average recompute for ONE batch, given a map of
 * corrected USD costs for the containers being repaired.
 * Sources whose container is NOT in the map keep their current stored cost.
 * Mirrors the exact arithmetic that recomputeBatchAndCascadeBales uses — so
 * preview === apply.
 */
export function calculateBatchCostPreview(
  allSources: Array<{ src: typeof factoryMixBatchSources.$inferSelect; containerNumber: string | null }>,
  correctedCostUsdByContainer: Map<number, Decimal>
): BatchCostPreviewResult {
  let dTotalCost = new Decimal(0);
  let dTotalWeight = new Decimal(0);
  let dWeightFromSelected = new Decimal(0);
  const sourceChanges: BatchSourceChange[] = [];

  for (const { src, containerNumber } of allSources) {
    const dWeight = new Decimal(src.weightKg || "0");
    const correctedUsd =
      src.containerId != null ? correctedCostUsdByContainer.get(src.containerId) : undefined;
    const oldCostPerKgUsd = parseFloat(src.costPerKg || "0");
    const dEffectiveCost = correctedUsd !== undefined ? correctedUsd : new Decimal(oldCostPerKgUsd);
    const dSourceTotalCost = dWeight.times(dEffectiveCost);
    const oldTotalCost = parseFloat(src.totalCost || "0");

    dTotalCost = dTotalCost.plus(dSourceTotalCost);
    dTotalWeight = dTotalWeight.plus(dWeight);
    if (correctedUsd !== undefined) {
      dWeightFromSelected = dWeightFromSelected.plus(dWeight);
    }

    sourceChanges.push({
      sourceId: src.id,
      containerId: src.containerId,
      containerNumber: containerNumber || null,
      weightKg: dWeight.toNumber(),
      oldCostPerKgUsd,
      newCostPerKgUsd: dEffectiveCost.toDecimalPlaces(COST_SCALE).toNumber(),
      oldTotalCost,
      newTotalCost: dSourceTotalCost.toDecimalPlaces(COST_SCALE).toNumber(),
      changed: correctedUsd !== undefined && !costEquals(oldCostPerKgUsd, dEffectiveCost.toNumber()),
    });
  }

  const newCostPerKg = dTotalWeight.gt(0)
    ? dTotalCost.div(dTotalWeight).toDecimalPlaces(COST_SCALE)
    : new Decimal(0);

  return { newCostPerKg, newTotalCost: dTotalCost, totalWeightKg: dTotalWeight, weightKgFromSelectedContainers: dWeightFromSelected, sourceChanges };
}

// ─────────────────────────────────────────────────────────────────────────────
// getAffectedMixBatchesPreview
// ─────────────────────────────────────────────────────────────────────────────

export interface AffectedMixBatchPreviewRow {
  batchId: number;
  batchCode: string;
  name: string | null;
  status: string;
  batchDate: string | null;
  wasCompleted: boolean;
  totalWeightKg: number;
  weightKgFromSelectedContainers: number;
  oldCostPerKg: number;
  newCostPerKg: number;
  oldTotalCost: number;
  newTotalCost: number;
  costDifferencePerKg: number;
  totalCostDifference: number;
  diffPct: number;
  baleCount: number;
  sourceContainerNumbers: string[];
  sourceChanges: BatchSourceChange[];
}

export async function getAffectedMixBatchesPreview(
  companyId: number,
  containerIds: number[],
  includeCompletedBatches: boolean,
  previewRows?: RecalcRow[]
): Promise<AffectedMixBatchPreviewRow[]> {
  if (containerIds.length === 0) return [];

  const preview = previewRows ?? (await getRawStockRecalcPreview(companyId));

  // Build corrected USD cost map — use costPerKgUsd (sources are USD-denominated)
  const correctedCostUsdByContainer = new Map<number, Decimal>(
    preview
      .filter((r) => containerIds.includes(r.containerId) && !r.fxUnresolved)
      .map((r) => [r.containerId, new Decimal(r.next.costPerKgUsd)])
  );
  if (correctedCostUsdByContainer.size === 0) return [];

  const statusFilter = includeCompletedBatches
    ? [...OPEN_BATCH_STATUSES, ...COMPLETED_BATCH_STATUSES]
    : OPEN_BATCH_STATUSES;

  const sourceRows = await db
    .select({ src: factoryMixBatchSources, batch: factoryMixBatches, containerNumber: factoryContainers.containerNumber })
    .from(factoryMixBatchSources)
    .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
    .leftJoin(factoryContainers, eq(factoryContainers.id, factoryMixBatchSources.containerId))
    .where(
      and(
        inArray(factoryMixBatchSources.containerId, [...correctedCostUsdByContainer.keys()]),
        eq(factoryMixBatches.companyId, companyId),
        inArray(factoryMixBatches.status, statusFilter),
        isNull(factoryMixBatches.deletedAt)
      )
    );

  const touchedBatchIds = [...new Set(sourceRows.map((r) => r.batch.id))];
  if (touchedBatchIds.length === 0) return [];

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
    const calc = calculateBatchCostPreview(sourcesForBatch, correctedCostUsdByContainer);

    const oldCostPerKg = parseFloat(batch.costPerKg || "0");
    const newCostPerKg = calc.newCostPerKg.toNumber();
    const oldTotalCost = calc.totalWeightKg.times(new Decimal(oldCostPerKg)).toNumber();
    const newTotalCost = calc.newTotalCost.toNumber();
    const diffPct = oldCostPerKg > 0 ? ((newCostPerKg - oldCostPerKg) / oldCostPerKg) * 100 : 0;

    const containerNumbers = new Set<string>();
    for (const { src, containerNumber } of sourcesForBatch) {
      if (containerNumber && src.containerId != null && correctedCostUsdByContainer.has(src.containerId)) {
        containerNumbers.add(containerNumber);
      }
    }

    results.push({
      batchId,
      batchCode: batch.batchCode,
      name: batch.name,
      status: batch.status,
      batchDate: batch.batchDate ? String(batch.batchDate) : null,
      wasCompleted: COMPLETED_BATCH_STATUSES.includes(batch.status),
      totalWeightKg: calc.totalWeightKg.toNumber(),
      weightKgFromSelectedContainers: calc.weightKgFromSelectedContainers.toNumber(),
      oldCostPerKg,
      newCostPerKg,
      oldTotalCost,
      newTotalCost,
      costDifferencePerKg: new Decimal(newCostPerKg).minus(new Decimal(oldCostPerKg)).toDecimalPlaces(COST_SCALE).toNumber(),
      totalCostDifference: new Decimal(newTotalCost).minus(new Decimal(oldTotalCost)).toDecimalPlaces(COST_SCALE).toNumber(),
      diffPct,
      baleCount: baleCountByBatch.get(batchId) || 0,
      sourceContainerNumbers: [...containerNumbers],
      sourceChanges: calc.sourceChanges,
    });
  }

  results.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// applyRawStockRecalc
// ─────────────────────────────────────────────────────────────────────────────

export interface ApplyResult {
  containerId: number;
  containerNumber: string;
  fullyUsed: boolean;
  remainingKg: number;
  applied: boolean;
  skippedReason?: string;
  staleToken?: boolean;
  rawStockRowsUpdated: number;
  /** Backward-compat count fields */
  affectedBatches: number;
  affectedBales: number;
  completedBatchesRewritten?: number;
}

const RECALC_REFUSED_STATUSES = new Set(["CLOSED", "COMPLETED"]);
const RECALC_LOCK_NAMESPACE = 9001;

export interface ApplyRawStockRecalcOptions {
  onAudit?: (tx: any, result: ApplyResult) => Promise<void>;
  expectedFingerprints?: Record<number, string>;
  includeCompletedBatches?: boolean;
  /** Allow CLOSED/COMPLETED containers when all safety checks pass. */
  includeHistoricalContainers?: boolean;
}

/**
 * Check whether ALL relevant valuation layers for a container already match
 * the corrected values (using 6dp precision). Returns true only when nothing
 * needs to be written.
 */
async function isFullyCorrect(
  tx: any,
  containerId: number,
  next: ReturnType<typeof computeCorrectContainerCost>,
  container: any,
  rawStockRow: any
): Promise<boolean> {
  // A. Container snapshot
  if (
    !costEquals(next.costPerKgUsd, container.ratePerKgUsd) ||
    !costEquals(next.totalCost, container.finalPayableAmount) ||
    !costEquals(next.totalUsd, container.finalPayableAmountUsd)
  ) {
    return false;
  }
  // B. Raw-stock row
  if (rawStockRow) {
    if (!costEquals(next.costPerKg, rawStockRow.costPerKg) || !costEquals(next.costPerKgUsd, rawStockRow.costPerKgUsd)) {
      return false;
    }
  }
  // C. Mix-batch sources
  const sources = await tx.select().from(factoryMixBatchSources).where(eq(factoryMixBatchSources.containerId, containerId));
  for (const src of sources) {
    const expectedTotal = new Decimal(src.weightKg || "0")
      .times(new Decimal(next.costPerKgUsd))
      .toDecimalPlaces(COST_SCALE)
      .toFixed(COST_SCALE);
    if (!costEquals(src.costPerKg, next.costPerKgUsd) || !costEquals(src.totalCost, expectedTotal)) {
      return false;
    }
  }
  return true;
}

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

      // Guard: refuse CLOSED/COMPLETED unless admin explicitly opts in
      if (RECALC_REFUSED_STATUSES.has(container.status) && !opts.includeHistoricalContainers) {
        return {
          containerId,
          containerNumber: container.containerNumber,
          fullyUsed: false,
          remainingKg: 0,
          applied: false,
          skippedReason: `Container status is ${container.status} — pass includeHistoricalContainers to repair historical containers.`,
          rawStockRowsUpdated: 0,
          affectedBatches: 0,
          affectedBales: 0,
        } as ApplyResult;
      }

      const [additionalCharges, commissionRecords, otherChargesRows] = await Promise.all([
        tx.select().from(factoryOffloadAdditionalCharges).where(
          and(eq(factoryOffloadAdditionalCharges.containerId, containerId), eq(factoryOffloadAdditionalCharges.companyId, companyId))
        ),
        tx.select().from(factoryContainerCommissions).where(
          and(eq(factoryContainerCommissions.containerId, containerId), eq(factoryContainerCommissions.companyId, companyId))
        ),
        tx.select().from(factoryContainerOtherCharges).where(
          and(eq(factoryContainerOtherCharges.containerId, containerId), eq(factoryContainerOtherCharges.companyId, companyId))
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

      const next = computeCorrectContainerCost(container, additionalCharges, commissionRecord, otherChargesRows);

      if (next.fxUnresolved) {
        return {
          containerId,
          containerNumber: container.containerNumber,
          fullyUsed: false,
          remainingKg: 0,
          applied: false,
          skippedReason: "FX rate is unresolved — never auto-apply a recompute derived from a guessed rate.",
          rawStockRowsUpdated: 0,
          affectedBatches: 0,
          affectedBales: 0,
        } as ApplyResult;
      }
      if (next.costPerKgUsd === 0 && next.costPerKg === 0) {
        return {
          containerId,
          containerNumber: container.containerNumber,
          fullyUsed: false,
          remainingKg: 0,
          applied: false,
          skippedReason: "No received kg — nothing to recompute.",
          rawStockRowsUpdated: 0,
          affectedBatches: 0,
          affectedBales: 0,
        } as ApplyResult;
      }

      // Multi-layer "already correct" check (all 3 layers must match)
      const alreadyCorrect = await isFullyCorrect(tx, containerId, next, container, rawStockRow);
      if (alreadyCorrect) {
        const receivedKg = parseFloat(container.actualReceivedKg || "0");
        const usedKg = rawStockRow ? parseFloat((rawStockRow as any).usedKg || "0") : receivedKg;
        const remainingKg = Math.max(0, receivedKg - usedKg);
        return {
          containerId,
          containerNumber: container.containerNumber,
          fullyUsed: receivedKg > 0 && remainingKg === 0,
          remainingKg,
          applied: false,
          skippedReason: "All valuation layers already match the corrected value — idempotent no-op.",
          rawStockRowsUpdated: 0,
          affectedBatches: 0,
          affectedBales: 0,
        } as ApplyResult;
      }

      // Fingerprint check (inside row lock — catches concurrent edits)
      const expectedFingerprint = opts.expectedFingerprints?.[containerId];
      if (expectedFingerprint) {
        const freshFingerprint = computeRecalcFingerprint({
          container,
          additionalCharges,
          commissionRecord,
          rawStock: rawStockRow,
          otherChargesRows,
        });
        if (freshFingerprint !== expectedFingerprint) {
          return {
            containerId,
            containerNumber: container.containerNumber,
            fullyUsed: false,
            remainingKg: 0,
            applied: false,
            staleToken: true,
            skippedReason:
              "Container's approved calculation inputs changed since the confirmation token was issued — re-run the dry-run preview and try again.",
            rawStockRowsUpdated: 0,
            affectedBatches: 0,
            affectedBales: 0,
          } as ApplyResult;
        }
      }

      // Determine fully-used before writing (for locked-rate decision)
      const receivedKg = parseFloat(container.actualReceivedKg || "0");
      const usedKg = rawStockRow ? parseFloat((rawStockRow as any).usedKg || "0") : receivedKg;
      const remainingKg = Math.max(0, receivedKg - usedKg);
      const fullyUsed = receivedKg > 0 && remainingKg === 0;

      // Update container snapshot
      await tx
        .update(factoryContainers)
        .set({
          finalPayableAmount: String(next.totalCost),
          ratePerKgUsd: costRound(next.costPerKgUsd),
          finalPayableAmountUsd: String(next.totalUsd),
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      // The cascade naturally skips supplier locked-rate for fully-used containers
      // because remainingKg=0 makes dCorrectedContainerRemainingKg=0. No extra param needed.
      const cascadeResult = await cascadeContainerCostChange(
        tx,
        { companyId, containerId, newCostPerKg: next.costPerKg, newCostPerKgUsd: next.costPerKgUsd },
        { includeCompletedBatches: opts.includeCompletedBatches }
      );

      const applyResult: ApplyResult = {
        containerId,
        containerNumber: container.containerNumber,
        fullyUsed,
        remainingKg,
        applied: true,
        rawStockRowsUpdated: cascadeResult.rawStockRowsUpdated,
        affectedBatches: cascadeResult.affectedBatches.length,
        affectedBales: cascadeResult.affectedBales.length,
        completedBatchesRewritten: cascadeResult.affectedBatches.filter((b) => b.wasCompleted).length,
      };

      if (opts.onAudit) {
        await opts.onAudit(tx, applyResult);
      }

      return applyResult;
    });

    if (result) results.push(result);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// getMixBatchSourceCostMismatchPreview — full scan (replaces zero-cost-only)
// ─────────────────────────────────────────────────────────────────────────────

export interface MixBatchSourceCostMismatchRow {
  sourceId: number;
  batchId: number;
  batchCode: string;
  batchStatus: string;
  containerId: number | null;
  containerNumber: string | null;
  containerStatus: string | null;
  supplierId: number | null;
  supplierName: string | null;
  weightKg: number;
  oldCostPerKgUsd: number;
  newCostPerKgUsd: number;
  oldTotalCost: number;
  newTotalCost: number;
  difference: number;
  fixable: boolean;
  reason: string;
  rawStockExists: boolean;
  remainingKg: number;
  fullyUsed: boolean;
}

/** Backward-compat type — all the old fields plus new ones. */
export type ZeroCostSourceRow = MixBatchSourceCostMismatchRow & {
  currentCostPerKg: number;
  correctedCostPerKg: number | null;
};

/**
 * Read-only scan for ALL mix-batch-source rows whose cost doesn't match the
 * container's authoritative corrected USD landed cost. Catches:
 *   - zero cost
 *   - nonzero but incorrect cost
 *   - incorrect totalCost even when costPerKg looks right
 */
export async function getMixBatchSourceCostMismatchPreview(
  companyId: number
): Promise<MixBatchSourceCostMismatchRow[]> {
  const rows = await db
    .select({
      src: factoryMixBatchSources,
      batch: factoryMixBatches,
      containerNumber: factoryContainers.containerNumber,
      containerStatus: factoryContainers.status,
      supplierName: factorySuppliers.name,
      container: factoryContainers,
    })
    .from(factoryMixBatchSources)
    .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
    .leftJoin(factoryContainers, eq(factoryContainers.id, factoryMixBatchSources.containerId))
    .leftJoin(factorySuppliers, eq(factorySuppliers.id, factoryMixBatchSources.supplierId))
    .where(
      and(
        eq(factoryMixBatches.companyId, companyId),
        isNull(factoryMixBatches.deletedAt),
        sql`${factoryMixBatchSources.weightKg}::numeric > 0`
      )
    );

  if (rows.length === 0) return [];

  const containerIds = [
    ...new Set(rows.map((r) => r.src.containerId).filter((id): id is number => id != null)),
  ];

  // Load raw-stock for existence checks
  const rawStockRows = containerIds.length
    ? await db
        .select()
        .from(factoryRawStock)
        .where(
          and(
            inArray(factoryRawStock.containerId, containerIds),
            eq(factoryRawStock.companyId, companyId),
            isNull(factoryRawStock.deletedAt)
          )
        )
    : [];
  const rawStockByContainer = new Map(rawStockRows.map((r) => [r.containerId as number, r]));

  // Load charges for corrected-cost computation
  const [allAdditionalCharges, allCommissions, allOtherCharges] = containerIds.length
    ? await Promise.all([
        db.select().from(factoryOffloadAdditionalCharges).where(inArray(factoryOffloadAdditionalCharges.containerId, containerIds)),
        db.select().from(factoryContainerCommissions).where(inArray(factoryContainerCommissions.containerId, containerIds)),
        db.select().from(factoryContainerOtherCharges).where(inArray(factoryContainerOtherCharges.containerId, containerIds)),
      ])
    : [[], [], []];

  const chargesByContainer = new Map<number, any[]>();
  for (const c of allAdditionalCharges) {
    if (!chargesByContainer.has(c.containerId)) chargesByContainer.set(c.containerId, []);
    chargesByContainer.get(c.containerId)!.push(c);
  }
  const commissionByContainer = new Map<number, any>();
  for (const c of allCommissions) {
    const ex = commissionByContainer.get(c.containerId);
    if (!ex || c.id > ex.id) commissionByContainer.set(c.containerId, c);
  }
  const otherChargesByContainer = new Map<number, any[]>();
  for (const oc of allOtherCharges) {
    if (!otherChargesByContainer.has(oc.containerId)) otherChargesByContainer.set(oc.containerId, []);
    otherChargesByContainer.get(oc.containerId)!.push(oc);
  }

  // Compute corrected USD cost per container
  const correctedUsdByContainer = new Map<number, { costPerKgUsd: number; fxUnresolved: boolean }>();
  const uniqueContainers = new Map<number, any>();
  for (const { container } of rows) {
    if (container && !uniqueContainers.has(container.id)) uniqueContainers.set(container.id, container);
  }
  for (const [cid, container] of uniqueContainers) {
    const computed = computeCorrectContainerCost(
      container,
      chargesByContainer.get(cid) || [],
      commissionByContainer.get(cid) || null,
      otherChargesByContainer.get(cid) || []
    );
    correctedUsdByContainer.set(cid, { costPerKgUsd: computed.costPerKgUsd, fxUnresolved: computed.fxUnresolved });
  }

  const result: MixBatchSourceCostMismatchRow[] = [];

  for (const { src, batch, containerNumber, containerStatus, supplierName, container } of rows) {
    const weightKg = parseFloat(src.weightKg || "0");
    const oldCostPerKgUsd = parseFloat(src.costPerKg || "0");
    const oldTotalCost = parseFloat(src.totalCost || "0");

    if (src.containerId == null) {
      result.push({
        sourceId: src.id,
        batchId: batch.id,
        batchCode: batch.batchCode,
        batchStatus: batch.status,
        containerId: null,
        containerNumber: null,
        containerStatus: null,
        supplierId: src.supplierId,
        supplierName: supplierName || null,
        weightKg,
        oldCostPerKgUsd,
        newCostPerKgUsd: 0,
        oldTotalCost,
        newTotalCost: 0,
        difference: 0,
        fixable: false,
        reason: "Direct-from-supplier source — requires manually entered cost/kg.",
        rawStockExists: false,
        remainingKg: 0,
        fullyUsed: false,
      });
      continue;
    }

    const corrected = correctedUsdByContainer.get(src.containerId);
    if (!corrected) continue;

    if (corrected.fxUnresolved) {
      result.push({
        sourceId: src.id,
        batchId: batch.id,
        batchCode: batch.batchCode,
        batchStatus: batch.status,
        containerId: src.containerId,
        containerNumber: containerNumber || null,
        containerStatus: containerStatus || null,
        supplierId: src.supplierId,
        supplierName: supplierName || null,
        weightKg,
        oldCostPerKgUsd,
        newCostPerKgUsd: 0,
        oldTotalCost,
        newTotalCost: 0,
        difference: 0,
        fixable: false,
        reason: "Container FX rate is unresolved — cannot determine authoritative USD cost.",
        rawStockExists: rawStockByContainer.has(src.containerId),
        remainingKg: 0,
        fullyUsed: false,
      });
      continue;
    }

    const newCostPerKgUsd = corrected.costPerKgUsd;
    const newTotalCost = new Decimal(weightKg).times(new Decimal(newCostPerKgUsd)).toDecimalPlaces(COST_SCALE).toNumber();

    if (costEquals(oldCostPerKgUsd, newCostPerKgUsd) && costEquals(oldTotalCost, newTotalCost)) continue;

    const rawStock = rawStockByContainer.get(src.containerId);
    const containerReceivedKg = parseFloat(container?.actualReceivedKg || "0");
    const rawStockUsedKg = rawStock ? parseFloat((rawStock as any).usedKg || "0") : containerReceivedKg;
    const remainingKg = rawStock ? Math.max(0, parseFloat(rawStock.receivedKg || "0") - rawStockUsedKg) : 0;

    result.push({
      sourceId: src.id,
      batchId: batch.id,
      batchCode: batch.batchCode,
      batchStatus: batch.status,
      containerId: src.containerId,
      containerNumber: containerNumber || null,
      containerStatus: containerStatus || null,
      supplierId: src.supplierId,
      supplierName: supplierName || null,
      weightKg,
      oldCostPerKgUsd,
      newCostPerKgUsd,
      oldTotalCost,
      newTotalCost,
      difference: new Decimal(newCostPerKgUsd).minus(new Decimal(oldCostPerKgUsd)).toDecimalPlaces(COST_SCALE).toNumber(),
      fixable: newCostPerKgUsd > 0,
      reason:
        oldCostPerKgUsd === 0
          ? "Source has zero cost — container's authoritative USD landed cost is known."
          : `Source cost differs from container's authoritative USD landed cost (diff: ${(newCostPerKgUsd - oldCostPerKgUsd).toFixed(COST_SCALE)}).`,
      rawStockExists: !!rawStock,
      remainingKg,
      fullyUsed: containerReceivedKg > 0 && remainingKg === 0,
    });
  }

  return result.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

/** Backward-compat: returns only zero-cost rows from the full mismatch scan. */
export async function getZeroCostMixBatchSourcesPreview(companyId: number): Promise<ZeroCostSourceRow[]> {
  const all = await getMixBatchSourceCostMismatchPreview(companyId);
  return all
    .filter((r) => r.oldCostPerKgUsd === 0)
    .map((r) => ({
      ...r,
      currentCostPerKg: r.oldCostPerKgUsd,
      correctedCostPerKg: r.newCostPerKgUsd > 0 ? r.newCostPerKgUsd : null,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// applyZeroCostMixBatchSourcesFix
// ─────────────────────────────────────────────────────────────────────────────

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
 * Apply the fix for a specific set of mix-batch-source rows (zero-cost or
 * any mismatch). Container-linked sources use the container's authoritative
 * USD cost/kg (costPerKgUsd, not costPerKg). Manual rates only for no-container sources.
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

      const weightKg = parseFloat(src.weightKg || "0");
      if (weightKg <= 0) {
        return { sourceId, batchId: batch.id, batchCode: batch.batchCode, applied: false, skippedReason: "Source has zero weight.", affectedBales: 0 } as ZeroCostSourceFixResult;
      }

      let correctedCostPerKgUsd: number | null = null;

      if (src.containerId != null) {
        // Container-linked: use costPerKgUsd (mix-batch sources are USD-denominated)
        const [rawStock] = await tx
          .select()
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.containerId, src.containerId), eq(factoryRawStock.companyId, companyId), isNull(factoryRawStock.deletedAt)));

        if (rawStock) {
          correctedCostPerKgUsd = parseFloat(rawStock.costPerKgUsd || "0");
        } else {
          // No active raw-stock: derive from container record
          const [container] = await tx
            .select()
            .from(factoryContainers)
            .where(and(eq(factoryContainers.id, src.containerId), eq(factoryContainers.companyId, companyId)));
          if (container) {
            const [addl, comms, ocs] = await Promise.all([
              tx.select().from(factoryOffloadAdditionalCharges).where(and(eq(factoryOffloadAdditionalCharges.containerId, src.containerId), eq(factoryOffloadAdditionalCharges.companyId, companyId))),
              tx.select().from(factoryContainerCommissions).where(and(eq(factoryContainerCommissions.containerId, src.containerId), eq(factoryContainerCommissions.companyId, companyId))),
              tx.select().from(factoryContainerOtherCharges).where(and(eq(factoryContainerOtherCharges.containerId, src.containerId), eq(factoryContainerOtherCharges.companyId, companyId))),
            ]);
            const comm = comms.sort((a: any, b: any) => b.id - a.id)[0] || null;
            const computed = computeCorrectContainerCost(container, addl, comm, ocs);
            if (!computed.fxUnresolved && computed.costPerKgUsd > 0) {
              correctedCostPerKgUsd = computed.costPerKgUsd;
            }
          }
        }

        if (!correctedCostPerKgUsd || correctedCostPerKgUsd <= 0) {
          return { sourceId, batchId: batch.id, batchCode: batch.batchCode, applied: false, skippedReason: "Container has no resolvable USD cost.", affectedBales: 0 } as ZeroCostSourceFixResult;
        }
      } else {
        const manualRate = opts.manualRates?.[sourceId];
        if (!manualRate || manualRate <= 0) {
          return { sourceId, batchId: batch.id, batchCode: batch.batchCode, applied: false, skippedReason: "Direct-from-supplier source — requires a manually entered cost/kg.", affectedBales: 0 } as ZeroCostSourceFixResult;
        }
        correctedCostPerKgUsd = manualRate;
      }

      // Idempotency check
      const newTotalCost = new Decimal(weightKg).times(new Decimal(correctedCostPerKgUsd)).toDecimalPlaces(COST_SCALE).toFixed(COST_SCALE);
      if (costEquals(src.costPerKg, correctedCostPerKgUsd) && costEquals(src.totalCost, newTotalCost)) {
        return { sourceId, batchId: batch.id, batchCode: batch.batchCode, applied: false, skippedReason: "Source cost already matches — idempotent no-op.", affectedBales: 0 } as ZeroCostSourceFixResult;
      }

      await tx
        .update(factoryMixBatchSources)
        .set({
          costPerKg: costRound(correctedCostPerKgUsd),
          totalCost: newTotalCost,
        })
        .where(eq(factoryMixBatchSources.id, sourceId));

      const { bales } = await recomputeBatchAndCascadeBales(tx, companyId, batch.id);

      const fixResult: ZeroCostSourceFixResult = {
        sourceId,
        batchId: batch.id,
        batchCode: batch.batchCode,
        applied: true,
        costPerKgApplied: correctedCostPerKgUsd,
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

// ─────────────────────────────────────────────────────────────────────────────
// getFullAuditScan
// ─────────────────────────────────────────────────────────────────────────────

export type AuditCode =
  | "CORRECT"
  | "CONTAINER_COST_MISMATCH"
  | "RAW_STOCK_COST_MISMATCH"
  | "SOURCE_ZERO_COST"
  | "SOURCE_COST_MISMATCH"
  | "FULLY_USED"
  | "RAW_STOCK_MISSING"
  | "RAW_STOCK_DELETED"
  | "UNRESOLVED_FX"
  | "MANUAL_REVIEW_REQUIRED";

export interface FullAuditRow {
  containerId: number;
  containerNumber: string;
  containerStatus: string;
  supplierId: number | null;
  supplierName: string;
  currencyCode: string;
  receivedKg: number;
  usedKg: number;
  remainingKg: number;
  fullyUsed: boolean;
  activeRawStockRowExists: boolean;
  rawStockDeleted: boolean;
  mixSourceCount: number;
  affectedOpenBatchCount: number;
  affectedCompletedBatchCount: number;
  old: { costPerKg: number; costPerKgUsd: number };
  next: { costPerKg: number; costPerKgUsd: number };
  diffPct: number;
  fxUnresolved: boolean;
  codes: AuditCode[];
  safeToRepair: boolean;
}

export interface FullAuditSummary {
  totalContainersScanned: number;
  containersCorrect: number;
  containerCostMismatches: number;
  activeRawStockMismatches: number;
  fullyUsedContainers: number;
  fullyUsedContainersWithMismatches: number;
  missingRawStockContainers: number;
  zeroCostSources: number;
  nonZeroSourceCostMismatches: number;
  unresolvedFxContainers: number;
  safeRepairsAvailable: number;
  manualReviewRequired: number;
}

export interface FullAuditResult {
  summary: FullAuditSummary;
  rows: FullAuditRow[];
}

/** Comprehensive read-only audit of every relevant container in the company. */
export async function getFullAuditScan(companyId: number): Promise<FullAuditResult> {
  const [previewRows, sourceMismatches] = await Promise.all([
    getRawStockRecalcPreview(companyId),
    getMixBatchSourceCostMismatchPreview(companyId),
  ]);

  const sourceMismatchByContainer = new Map<number, MixBatchSourceCostMismatchRow[]>();
  for (const sm of sourceMismatches) {
    if (sm.containerId == null) continue;
    if (!sourceMismatchByContainer.has(sm.containerId)) sourceMismatchByContainer.set(sm.containerId, []);
    sourceMismatchByContainer.get(sm.containerId)!.push(sm);
  }

  const auditRows: FullAuditRow[] = [];
  const summary: FullAuditSummary = {
    totalContainersScanned: 0,
    containersCorrect: 0,
    containerCostMismatches: 0,
    activeRawStockMismatches: 0,
    fullyUsedContainers: 0,
    fullyUsedContainersWithMismatches: 0,
    missingRawStockContainers: 0,
    zeroCostSources: 0,
    nonZeroSourceCostMismatches: 0,
    unresolvedFxContainers: 0,
    safeRepairsAvailable: 0,
    manualReviewRequired: 0,
  };

  for (const row of previewRows) {
    const codes = new Set<AuditCode>();

    if (row.fxUnresolved) {
      codes.add("UNRESOLVED_FX");
      codes.add("MANUAL_REVIEW_REQUIRED");
    } else if (row.changed) {
      codes.add("CONTAINER_COST_MISMATCH");
      if (row.activeRawStockRowExists) codes.add("RAW_STOCK_COST_MISMATCH");
    }

    if (row.fullyUsed) codes.add("FULLY_USED");
    if (!row.activeRawStockRowExists) {
      if (row.rawStockDeleted) codes.add("RAW_STOCK_DELETED");
      else codes.add("RAW_STOCK_MISSING");
    }

    const containerSourceMismatches = sourceMismatchByContainer.get(row.containerId) || [];
    for (const sm of containerSourceMismatches) {
      if (sm.oldCostPerKgUsd === 0) codes.add("SOURCE_ZERO_COST");
      else codes.add("SOURCE_COST_MISMATCH");
    }

    if (codes.size === 0) codes.add("CORRECT");

    const safeToRepair =
      !codes.has("UNRESOLVED_FX") &&
      !codes.has("MANUAL_REVIEW_REQUIRED") &&
      !codes.has("CORRECT") &&
      (row.activeRawStockRowExists || row.rawStockDeleted || containerSourceMismatches.length > 0);

    summary.totalContainersScanned++;
    if (codes.has("CORRECT")) summary.containersCorrect++;
    if (codes.has("CONTAINER_COST_MISMATCH")) summary.containerCostMismatches++;
    if (codes.has("RAW_STOCK_COST_MISMATCH")) summary.activeRawStockMismatches++;
    if (codes.has("FULLY_USED")) summary.fullyUsedContainers++;
    if (codes.has("FULLY_USED") && !codes.has("CORRECT")) summary.fullyUsedContainersWithMismatches++;
    if (codes.has("RAW_STOCK_MISSING") || codes.has("RAW_STOCK_DELETED")) summary.missingRawStockContainers++;
    if (codes.has("UNRESOLVED_FX")) summary.unresolvedFxContainers++;
    if (codes.has("MANUAL_REVIEW_REQUIRED")) summary.manualReviewRequired++;
    if (safeToRepair) summary.safeRepairsAvailable++;
    summary.zeroCostSources += containerSourceMismatches.filter((s) => s.oldCostPerKgUsd === 0).length;
    summary.nonZeroSourceCostMismatches += containerSourceMismatches.filter((s) => s.oldCostPerKgUsd !== 0).length;

    auditRows.push({
      containerId: row.containerId,
      containerNumber: row.containerNumber,
      containerStatus: row.containerStatus,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      currencyCode: row.currencyCode,
      receivedKg: row.receivedKg,
      usedKg: row.usedKg,
      remainingKg: row.remainingKg,
      fullyUsed: row.fullyUsed,
      activeRawStockRowExists: row.activeRawStockRowExists,
      rawStockDeleted: row.rawStockDeleted,
      mixSourceCount: row.mixSourceCount,
      affectedOpenBatchCount: row.affectedOpenBatchCount,
      affectedCompletedBatchCount: row.affectedCompletedBatchCount,
      old: row.old,
      next: row.next,
      diffPct: row.diffPct,
      fxUnresolved: row.fxUnresolved,
      codes: [...codes],
      safeToRepair,
    });
  }

  return { summary, rows: auditRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// computeApplyAllDryRun — dry-run estimate for "Apply All Safe Repairs"
// ─────────────────────────────────────────────────────────────────────────────

export interface ApplyAllDryRunResult {
  containersToUpdate: number;
  rawStockRowsToUpdate: number;
  openBatchesToUpdate: number;
  completedBatchesToUpdate: number;
  fullyUsedContainersIncluded: number;
  unresolvedRecordsExcluded: number;
  supplierRatesThatWillChange: number;
  fullyUsedContainersNoSupplierRateChange: number;
  safeContainerIds: number[];
}

export async function computeApplyAllDryRun(
  companyId: number,
  opts: { includeHistoricalContainers?: boolean; includeCompletedBatches?: boolean } = {}
): Promise<ApplyAllDryRunResult> {
  const audit = await getFullAuditScan(companyId);
  let safeRows = audit.rows.filter((r) => r.safeToRepair);
  if (!opts.includeHistoricalContainers) {
    safeRows = safeRows.filter((r) => !["CLOSED", "COMPLETED"].includes(r.containerStatus));
  }

  const safeContainerIds = safeRows.map((r) => r.containerId);
  const batchPreview = safeContainerIds.length
    ? await getAffectedMixBatchesPreview(companyId, safeContainerIds, opts.includeCompletedBatches ?? false)
    : [];

  const openBatches = batchPreview.filter((b) => !b.wasCompleted).length;
  const completedBatches = batchPreview.filter((b) => b.wasCompleted).length;
  const fullyUsed = safeRows.filter((r) => r.fullyUsed).length;

  return {
    containersToUpdate: safeContainerIds.length,
    rawStockRowsToUpdate: safeRows.filter((r) => r.activeRawStockRowExists).length,
    openBatchesToUpdate: openBatches,
    completedBatchesToUpdate: completedBatches,
    fullyUsedContainersIncluded: fullyUsed,
    unresolvedRecordsExcluded: audit.rows.filter((r) => r.fxUnresolved).length,
    supplierRatesThatWillChange: safeRows.filter((r) => !r.fullyUsed && r.supplierId != null).length,
    fullyUsedContainersNoSupplierRateChange: fullyUsed,
    safeContainerIds,
  };
}
