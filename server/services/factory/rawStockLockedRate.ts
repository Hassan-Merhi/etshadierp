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
import { eq, and, sql, isNull } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  factorySuppliers,
  factoryRawStock,
  factoryContainers,
  factoryRawMaterialAdjustments,
  factoryMixBatchSources,
  factoryMixBatches,
} from "@shared/schema";
import { getStableSupplierCost } from "./rawStockStableCost";
import { db as sharedDb } from "../../db";

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

  const rk = new Decimal(remainingKg || 0);
  const nk = new Decimal(netAdjustedKg || 0);
  return rk.plus(nk).toNumber();
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
    return new Decimal(existing || 0).toNumber();
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
 * Pure read-only variant of getLockedSupplierRate: never writes, even when the
 * persisted rate has never been established. Diagnostics and any other
 * read-only surface must use this instead of getLockedSupplierRate, which
 * performs a one-time lazy backfill write as a side effect of reading.
 */
export async function getLockedSupplierRateReadOnly(
  tx: any,
  companyId: number,
  supplierId: number
): Promise<{ rate: number; wasBackfilled: boolean }> {
  const [supplier] = await tx
    .select({ currentRawMaterialCostPerKgUsd: factorySuppliers.currentRawMaterialCostPerKgUsd })
    .from(factorySuppliers)
    .where(and(eq(factorySuppliers.id, supplierId), eq(factorySuppliers.companyId, companyId)));
  if (!supplier) return { rate: 0, wasBackfilled: false };

  const existing = supplier.currentRawMaterialCostPerKgUsd;
  if (existing !== null && existing !== undefined) {
    return { rate: new Decimal(existing || 0).toNumber(), wasBackfilled: false };
  }

  // Never-established — compute what the lazy backfill WOULD persist, without writing.
  const { costPerKgUsd } = await getStableSupplierCost(tx, companyId, supplierId);
  return { rate: costPerKgUsd, wasBackfilled: false };
}

export interface LockedRateDiagnosticRow {
  companyId: number;
  supplierId: number;
  supplierName: string;
  persistedLockedRate: number | null;
  rawMaterialsDisplayedRate: number;
  mixBatchDialogRate: number;
  remainingKg: number;
  reservedKg: number;
  freeKg: number;
  displayedValue: string;
  expectedValue: string;
  difference: string;
  backfillRequired: boolean;
}

/**
 * Shared, read-only per-supplier locked-rate reconciliation for a company.
 * Reused by the `/raw-stock/diagnostics/locked-rates` route AND the broader
 * FX/raw-material reconciliation report so both surfaces report identical
 * numbers from one implementation instead of two independently-maintained
 * copies of this math. Zero writes: uses getLockedSupplierRateReadOnly (no
 * lazy backfill side effect).
 */
export async function getLockedRateDiagnosticsForCompany(companyId: number): Promise<LockedRateDiagnosticRow[]> {
  const db = sharedDb;
  const suppliers = await db
    .select({
      id: factorySuppliers.id,
      name: factorySuppliers.name,
      currentRawMaterialCostPerKgUsd: factorySuppliers.currentRawMaterialCostPerKgUsd,
    })
    .from(factorySuppliers)
    .where(eq(factorySuppliers.companyId, companyId));

  const reservedRows = await db
    .select({
      supplierId: factoryMixBatchSources.supplierId,
      reservedKg: sql<string>`SUM(${factoryMixBatchSources.weightKg})`,
    })
    .from(factoryMixBatchSources)
    .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
    .where(
      and(
        eq(factoryMixBatches.companyId, companyId),
        sql`${factoryMixBatchSources.supplierId} IS NOT NULL`,
        sql`${factoryMixBatches.status} NOT IN ('CLOSED', 'COMPLETED')`,
        isNull(factoryMixBatches.deletedAt)
      )
    )
    .groupBy(factoryMixBatchSources.supplierId);
  const reservedBySupplierId = new Map<number, number>();
  for (const r of reservedRows) {
    if (r.supplierId) reservedBySupplierId.set(r.supplierId, parseFloat(r.reservedKg as string) || 0);
  }

  return db.transaction(async (tx: any) => {
    const out: LockedRateDiagnosticRow[] = [];
    for (const supplier of suppliers) {
      const persistedRaw = supplier.currentRawMaterialCostPerKgUsd;
      const persistedLockedRate =
        persistedRaw !== null && persistedRaw !== undefined ? parseFloat(persistedRaw as string) || 0 : null;

      const { rate: rawMaterialsDisplayedRate } = await getLockedSupplierRateReadOnly(tx, companyId, supplier.id);
      const mixBatchDialogRate = rawMaterialsDisplayedRate;

      const remainingKg = await getAuthoritativeSupplierRemainingKg(tx, companyId, supplier.id);
      const reservedKg = reservedBySupplierId.get(supplier.id) || 0;
      const freeKg = remainingKg;

      const displayedValue = freeKg * rawMaterialsDisplayedRate;
      const expectedValue = freeKg * (persistedLockedRate ?? 0);
      const difference = displayedValue - expectedValue;

      out.push({
        companyId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        persistedLockedRate,
        rawMaterialsDisplayedRate,
        mixBatchDialogRate,
        remainingKg,
        reservedKg,
        freeKg,
        displayedValue: displayedValue.toFixed(2),
        expectedValue: expectedValue.toFixed(2),
        difference: difference.toFixed(2),
        backfillRequired: persistedLockedRate === null,
      });
    }
    return out;
  });
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
  const oldRemainingKgD = new Decimal(oldRemainingKg);
  const newReceivedKgD = new Decimal(newReceivedKg);
  const totalKgD = oldRemainingKgD.plus(newReceivedKgD);
  const newLockedRateD = totalKgD.gt(0)
    ? oldRemainingKgD
        .times(oldLockedRate)
        .plus(newReceivedKgD.times(newContainerLandedCostPerKgUsd))
        .dividedBy(totalKgD)
    : new Decimal(newContainerLandedCostPerKgUsd);
  const newLockedRate = newLockedRateD.toNumber();

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

/**
 * Single source of truth for the startup DB migration that adds and backfills
 * factorySuppliers.currentRawMaterialCostPerKgUsd. Consumed by both the real
 * startup migration runner (server/index.ts) and the migration test suite
 * (tests/factory-locked-rate-migration.test.ts), so the tested SQL is
 * byte-identical to what production actually runs — never a re-implemented
 * copy that could silently drift from the real migration.
 *
 * Column add: nullable NUMERIC(20,8), safe to re-run (IF NOT EXISTS).
 *
 * Backfill formula (per supplier):
 *   SUM(received_kg * COALESCE(cost_per_kg_usd, cost_per_kg)) / SUM(received_kg)
 * over that supplier's own non-deleted raw-stock rows, on non-deleted /
 * non-DELETED-status containers, with positive received kg. Only updates rows
 * where the locked rate is still NULL — never overwrites an established rate,
 * so it is safe to run against a fresh database or a live production database,
 * and safe to run repeatedly.
 */
export const FACTORY_SUPPLIER_LOCKED_RATE_ADD_COLUMN_SQL =
  `ALTER TABLE factory_suppliers ADD COLUMN IF NOT EXISTS current_raw_material_cost_per_kg_usd NUMERIC(20,8)`;

export const FACTORY_SUPPLIER_LOCKED_RATE_BACKFILL_MIGRATION_KEY =
  "factory-supplier-locked-raw-material-rate-backfill-v1";

/** The bare backfill UPDATE — no migrations_log gate. Used directly by tests to
 * verify the formula and per-row "never overwrite non-NULL" safety in isolation.
 * The real startup migration wraps this in a migrations_log-gated DO block
 * (see server/index.ts) so it only ever executes once per database. */
export const FACTORY_SUPPLIER_LOCKED_RATE_BACKFILL_SQL = `
  UPDATE factory_suppliers fs
  SET current_raw_material_cost_per_kg_usd = sub.rate
  FROM (
    SELECT
      c.supplier_id AS supplier_id,
      SUM(rs.received_kg * COALESCE(rs.cost_per_kg_usd, rs.cost_per_kg)) / SUM(rs.received_kg) AS rate
    FROM factory_raw_stock rs
    INNER JOIN factory_containers c ON c.id = rs.container_id
    WHERE rs.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND c.status != 'DELETED'
      AND c.supplier_id IS NOT NULL
      AND rs.received_kg > 0
    GROUP BY c.supplier_id
    HAVING SUM(rs.received_kg) > 0
  ) sub
  WHERE fs.id = sub.supplier_id
    AND fs.current_raw_material_cost_per_kg_usd IS NULL
`;
