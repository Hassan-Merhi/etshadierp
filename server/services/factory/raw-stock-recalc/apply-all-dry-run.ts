import { getAffectedMixBatchesPreview } from "./batch-cost";
import { getFullAuditScan } from "./full-audit";

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
