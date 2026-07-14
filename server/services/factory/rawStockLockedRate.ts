/**
 * Authoritative, persisted, locked raw-material cost/kg (USD) per supplier.
 *
 * This is the ONLY source of truth for a supplier's current raw-material rate.
 * It lives on factorySuppliers.currentRawMaterialCostPerKgUsd and must:
 *   - NEVER change from mix-batch create/edit/top-up/delete, kg consumption,
 *     bale creation, stock reservation, or quantity-only ADD/DEDUCT adjustments.
 *   - ONLY change when a new container is actually offloaded for that supplier
 *     (moving average using the supplier's remaining kg immediately BEFORE the
 *     new offload), or via an explicit authorized landed-cost correction.
 *
 * Every supplier-source costing path (mix batch create/edit/top-up, Raw
 * Materials display, Create Mix Batch dialog data) must read the rate through
 * `getLockedSupplierRate`. Nothing should recompute a rate from remaining
 * value / free kg, or from all-time received kg, at read time.
 */
import { eq, and, sql } from "drizzle-orm";
import { factorySuppliers, factoryRawStock, factoryContainers, factoryRawMaterialAdjustments } from "@shared/schema";
import { getStableSupplierCost } from "./rawStockStableCost";

/**
 * The single authoritative "how much of this supplier's raw material is
 * currently on hand" figure — the SAME quantity GET /api/factory/raw-stock
 * shows as remainingKg (before reservations). It is:
 *   SUM(raw-stock rows: receivedKg - usedKg)
 *   + SUM(supplier-linked ADD adjustment kg)
 *   - SUM(supplier-linked REMOVE adjustment kg)
 * DEDUCT-type adjustments are excluded: they directly reduce a raw-stock row's
 * own receivedKg at write time, so counting them again here would double-count.
 * Both the offload moving-average formula and the Raw Materials API MUST read
 * this exact helper so they can never disagree about "remaining kg".
 */
export async function getAuthoritativeSupplierRemainingKg(
  tx: any,
  companyId: number,
  supplierId: number
): Promise<number> {
  const [{ remainingKg }] = await tx
    .select({
      remainingKg: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg} - ${factoryRawStock.usedKg}), 0)`,
    })
    .from(factoryRawStock)
    .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
    .where(
      and(
        eq(factoryRawStock.companyId, companyId),
        eq(factoryContainers.supplierId, supplierId),
        sql`${factoryContainers.status} != 'DELETED'`,
        sql`${factoryRawStock.deletedAt} IS NULL`,
        sql`${factoryContainers.deletedAt} IS NULL`
      )
    );

  const [{ netAdjustedKg }] = await tx
    .select({
      netAdjustedKg: sql<string>`COALESCE(SUM(CASE WHEN ${factoryRawMaterialAdjustments.type} = 'ADD' THEN ${factoryRawMaterialAdjustments.kg} WHEN ${factoryRawMaterialAdjustments.type} = 'REMOVE' THEN -${factoryRawMaterialAdjustments.kg} ELSE 0 END), 0)`,
    })
    .from(factoryRawMaterialAdjustments)
    .where(
      and(
        eq(factoryRawMaterialAdjustments.companyId, companyId),
        eq(factoryRawMaterialAdjustments.supplierId, supplierId),
        sql`${factoryRawMaterialAdjustments.deletedAt} IS NULL`
      )
    );

  return (parseFloat(remainingKg as string) || 0) + (parseFloat(netAdjustedKg as string) || 0);
}

/**
 * Reads the supplier's locked rate. If it has never been established (NULL —
 * e.g. a supplier created before this field existed, or the backfill migration
 * hasn't run against this row yet), lazily derives it ONCE from the legacy
 * receipt-weighted stable cost over existing raw-stock rows and persists it,
 * so every subsequent read is stable. Returns 0 for a supplier with no rate
 * and no historical rows to derive one from (never received anything yet).
 *
 * Pass `forUpdate: true` (inside a transaction) when the caller is about to
 * consume/use this rate as part of a write that must be serialized against
 * concurrent offloads for the same supplier (locks the factorySuppliers row).
 */
export async function getLockedSupplierRate(
  tx: any,
  companyId: number,
  supplierId: number,
  opts: { forUpdate?: boolean } = {}
): Promise<number> {
  let query = tx
    .select({
      id: factorySuppliers.id,
      currentRawMaterialCostPerKgUsd: factorySuppliers.currentRawMaterialCostPerKgUsd,
    })
    .from(factorySuppliers)
    .where(and(eq(factorySuppliers.id, supplierId), eq(factorySuppliers.companyId, companyId)));

  if (opts.forUpdate) query = query.for("update");

  const [supplier] = await query;
  if (!supplier) return 0;

  const existing = supplier.currentRawMaterialCostPerKgUsd;
  if (existing !== null && existing !== undefined) {
    return parseFloat(existing as string) || 0;
  }

  // Never-established rate — lazy one-time backfill from legacy stable cost so
  // this doesn't silently read as 0 for suppliers the migration missed.
  const { costPerKgUsd } = await getStableSupplierCost(tx, companyId, supplierId);
  if (costPerKgUsd > 0) {
    await tx
      .update(factorySuppliers)
      .set({ currentRawMaterialCostPerKgUsd: String(costPerKgUsd) })
      .where(and(eq(factorySuppliers.id, supplierId), eq(factorySuppliers.companyId, companyId)));
  }
  return costPerKgUsd;
}

/**
 * Applies the spec's exact moving-average formula when a new container is
 * offloaded for a supplier, and persists the result as the new locked rate.
 * MUST be called BEFORE the new raw-stock row is inserted, inside the same
 * transaction as that insert, so "remaining kg" reflects stock immediately
 * before this offload (already-consumed stock never re-enters the average).
 *
 *   newLockedRate = ((oldRemainingKg × oldLockedRate) + (newReceivedKg × newContainerLandedCostPerKgUsd))
 *                   ÷ (oldRemainingKg + newReceivedKg)
 *
 * Row-locks the supplier so two concurrent offloads for the same supplier
 * cannot race and overwrite one another.
 */
export async function applyOffloadMovingAverage(
  tx: any,
  params: {
    companyId: number;
    supplierId: number;
    newReceivedKg: number;
    newContainerLandedCostPerKgUsd: number;
  }
): Promise<{ oldRemainingKg: number; oldLockedRate: number; newLockedRate: number }> {
  const { companyId, supplierId, newReceivedKg, newContainerLandedCostPerKgUsd } = params;

  // Lock the supplier row first — serializes concurrent offloads for this supplier.
  const oldLockedRate = await getLockedSupplierRate(tx, companyId, supplierId, { forUpdate: true });

  // Remaining kg immediately BEFORE this offload — via the SAME shared helper the
  // Raw Materials API uses, so it includes supplier-linked ADD/REMOVE adjustment
  // quantity (not just raw-stock rows). The new container's row has not been
  // inserted yet when this is called, so it's correctly excluded here.
  const oldRemainingKg = Math.max(0, await getAuthoritativeSupplierRemainingKg(tx, companyId, supplierId));
  const totalKg = oldRemainingKg + newReceivedKg;
  const newLockedRate =
    totalKg > 0
      ? (oldRemainingKg * oldLockedRate + newReceivedKg * newContainerLandedCostPerKgUsd) / totalKg
      : newContainerLandedCostPerKgUsd;

  await tx
    .update(factorySuppliers)
    .set({ currentRawMaterialCostPerKgUsd: String(newLockedRate), updatedAt: new Date() })
    .where(and(eq(factorySuppliers.id, supplierId), eq(factorySuppliers.companyId, companyId)));

  return { oldRemainingKg, oldLockedRate, newLockedRate };
}

/**
 * For a manual (non-container) ADD receipt of stock at a supplier's existing
 * locked rate — e.g. the ADD adjustment path. Per spec, ADD must NOT establish
 * or shift the rate; it must use the existing locked rate as-is. If no rate
 * has ever been established for this supplier, the caller must reject the ADD
 * and require a real offload/opening-balance first — this helper never invents
 * a rate from a plain adjustment.
 */
export async function requireExistingLockedRate(
  tx: any,
  companyId: number,
  supplierId: number
): Promise<number | null> {
  const rate = await getLockedSupplierRate(tx, companyId, supplierId, { forUpdate: true });
  return rate > 0 ? rate : null;
}
