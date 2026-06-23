import { db, BulkFxCacheEntry, BulkFxSupplierEntry } from "./db";

const CACHE_TTL_MS = 10 * 60 * 1000;

export async function cacheBulkFxData(
  brokerId: number,
  currency: string,
  suppliers: BulkFxSupplierEntry[]
): Promise<void> {
  await db.bulkFxCache.put({ brokerId, currency, suppliers, cachedAt: Date.now() });
}

export async function getCachedBulkFxData(brokerId: number, currency: string): Promise<BulkFxCacheEntry | null> {
  const entry = await db.bulkFxCache.get([brokerId, currency]);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;
  return entry;
}

export interface BulkFxPreviewResult {
  dryRun: true;
  offline: true;
  totalRequested: string;
  totalAllocated: string;
  remaining: string;
  totalUsd: string;
  transfers: Array<{ supplierId: number; supplierName: string; allocated: string; toAmountUsd: string }>;
}

export function computeBulkFxPreview(
  suppliers: BulkFxSupplierEntry[],
  totalAmount: number,
  fxRate: number,
  order: "oldest" | "newest"
): BulkFxPreviewResult | null {
  if (suppliers.length === 0 || totalAmount <= 0 || fxRate <= 0) return null;

  const sorted = [...suppliers].sort((a, b) => {
    const da = order === "newest" ? a.newestDate : a.oldestDate;
    const db2 = order === "newest" ? b.newestDate : b.oldestDate;
    if (!da) return 1;
    if (!db2) return -1;
    return order === "newest"
      ? new Date(db2).getTime() - new Date(da).getTime()
      : new Date(da).getTime() - new Date(db2).getTime();
  });

  let rem = totalAmount;
  const transfers: BulkFxPreviewResult["transfers"] = [];

  for (const s of sorted) {
    if (rem <= 0.001) break;
    if (s.available < 0.001) continue;
    const toAllocate = Math.min(rem, s.available);
    transfers.push({
      supplierId: s.id,
      supplierName: s.name,
      allocated: toAllocate.toFixed(4),
      toAmountUsd: (toAllocate * fxRate).toFixed(4),
    });
    rem -= toAllocate;
  }

  if (transfers.length === 0) return null;

  const totalAllocated = transfers.reduce((s, t) => s + parseFloat(t.allocated), 0);
  const totalUsd = transfers.reduce((s, t) => s + parseFloat(t.toAmountUsd), 0);

  return {
    dryRun: true,
    offline: true,
    totalRequested: totalAmount.toFixed(4),
    totalAllocated: totalAllocated.toFixed(4),
    remaining: Math.max(0, rem).toFixed(4),
    totalUsd: totalUsd.toFixed(4),
    transfers,
  };
}
