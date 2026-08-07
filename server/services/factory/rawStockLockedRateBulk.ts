import { and, eq, inArray } from "drizzle-orm";
import { factorySuppliers } from "@shared/schema";
import { getStableSupplierCost } from "./rawStockStableCost";

/**
 * Read the current locked USD rate for many suppliers without the normal
 * one-query-per-supplier loop used by list screens.
 *
 * Persisted locked rates are loaded in a single query. Legacy suppliers whose
 * persisted column is still NULL keep the exact read-only fallback semantics of
 * getLockedSupplierRateReadOnly: derive the stable historical rate without
 * writing it. Those legacy derivations run concurrently and should disappear as
 * the normal backfill/offload paths establish the persisted rate.
 */
export async function getLockedSupplierRatesReadOnlyBulk(
  tx: any,
  companyId: number,
  supplierIds: readonly number[],
): Promise<Map<number, number>> {
  const ids = Array.from(
    new Set(
      supplierIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
  const rates = new Map<number, number>();
  if (ids.length === 0) return rates;

  const suppliers = await tx
    .select({
      id: factorySuppliers.id,
      currentRawMaterialCostPerKgUsd: factorySuppliers.currentRawMaterialCostPerKgUsd,
    })
    .from(factorySuppliers)
    .where(and(eq(factorySuppliers.companyId, companyId), inArray(factorySuppliers.id, ids)));

  const legacyNullSupplierIds: number[] = [];
  for (const supplier of suppliers) {
    const raw = supplier.currentRawMaterialCostPerKgUsd;
    if (raw !== null && raw !== undefined) {
      const parsed = Number(raw);
      rates.set(supplier.id, Number.isFinite(parsed) ? parsed : 0);
    } else {
      legacyNullSupplierIds.push(supplier.id);
    }
  }

  if (legacyNullSupplierIds.length > 0) {
    const derived = await Promise.all(
      legacyNullSupplierIds.map(async (supplierId) => {
        const { costPerKgUsd } = await getStableSupplierCost(tx, companyId, supplierId);
        return [supplierId, costPerKgUsd] as const;
      }),
    );
    for (const [supplierId, rate] of derived) rates.set(supplierId, rate);
  }

  return rates;
}
