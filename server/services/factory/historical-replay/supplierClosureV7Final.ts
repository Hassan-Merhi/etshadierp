import type { SourceInfo } from "./types";

export interface ConnectedSupplierClosure {
  supplierIds: Set<number>;
  batchIds: Set<number>;
  unresolvedBatchIds: Set<number>;
}

/**
 * Build the fixed-point closure required for a safe multi-supplier historical replay.
 *
 * Starting from the requested suppliers, this includes:
 *  - every batch that directly consumes one of those suppliers' raw material;
 *  - every other inventory supplier participating in an included mixed batch;
 *  - every downstream batch that consumes an included batch;
 *  - every supplier participating in those downstream batches;
 * and repeats until neither the supplier set nor batch set grows.
 *
 * BATCH sources do not directly add a supplier because the upstream batch already
 * consumed the raw material. A non-BATCH source with no inventorySupplierId marks
 * its connected batch unresolved and must block prepare/apply.
 */
export function expandConnectedSupplierClosure(
  sourceInfos: SourceInfo[],
  requestedSupplierIds: Set<number>
): ConnectedSupplierClosure {
  const supplierIds = new Set(requestedSupplierIds);
  const batchIds = new Set<number>();
  const unresolvedBatchIds = new Set<number>();

  let changed = true;
  while (changed) {
    changed = false;

    // Any batch directly consuming a supplier in scope becomes part of the closure.
    for (const source of sourceInfos) {
      if (source.pricingBasis === "BATCH") continue;
      if (source.inventorySupplierId != null && supplierIds.has(source.inventorySupplierId)) {
        if (!batchIds.has(source.batchId)) {
          batchIds.add(source.batchId);
          changed = true;
        }
      }
    }

    // Follow downstream BATCH dependencies from every included batch.
    for (const source of sourceInfos) {
      if (
        source.pricingBasis === "BATCH"
        && source.sourceBatchId != null
        && batchIds.has(source.sourceBatchId)
        && !batchIds.has(source.batchId)
      ) {
        batchIds.add(source.batchId);
        changed = true;
      }
    }

    // Every direct inventory supplier in an included batch must join the same atomic scope.
    for (const source of sourceInfos) {
      if (!batchIds.has(source.batchId) || source.pricingBasis === "BATCH") continue;
      if (source.inventorySupplierId == null) {
        unresolvedBatchIds.add(source.batchId);
        continue;
      }
      if (!supplierIds.has(source.inventorySupplierId)) {
        supplierIds.add(source.inventorySupplierId);
        changed = true;
      }
    }
  }

  return { supplierIds, batchIds, unresolvedBatchIds };
}

export function connectedScopeIsComplete(
  sourceInfos: SourceInfo[],
  closure: ConnectedSupplierClosure
): boolean {
  if (closure.unresolvedBatchIds.size > 0) return false;
  for (const source of sourceInfos) {
    if (!closure.batchIds.has(source.batchId) || source.pricingBasis === "BATCH") continue;
    if (source.inventorySupplierId == null || !closure.supplierIds.has(source.inventorySupplierId)) {
      return false;
    }
  }
  return true;
}
