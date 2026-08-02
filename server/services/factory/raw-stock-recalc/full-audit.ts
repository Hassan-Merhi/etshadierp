import { pool } from "../../../db";
import { getRawStockRecalcPreview } from "./preview";
import { MixBatchSourceCostMismatchRow, getMixBatchSourceCostMismatchPreview } from "./source-mismatches";

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
  // Pre-fetch supplier-linked container IDs using the same query as apply-all-safe's
  // DEFECT 12 guard. These containers cannot be fixed by apply-all-safe (the cascade
  // skips SUPPLIER_LOCKED_RATE sources), so they must NOT count as safeToRepair.
  const supplierLinkedQuery = await pool.query<{ container_id: number }>(
    `SELECT DISTINCT mbs.container_id
     FROM factory_mix_batch_sources mbs
     JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
     WHERE mb.company_id = $1
       AND mbs.supplier_id IS NOT NULL
       AND mbs.source_batch_id IS NULL`,
    [companyId]
  );
  const supplierLinkedIds = new Set(supplierLinkedQuery.rows.map((r) => r.container_id));

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

    // A container is only safe to repair if it has an ACTUAL cost-layer issue.
    // FULLY_USED alone is informational — it must not trigger a "safe repair"
    // for a container whose costs are already correct.
    const COST_ISSUE_CODES = new Set<AuditCode>([
      "CONTAINER_COST_MISMATCH",
      "RAW_STOCK_COST_MISMATCH",
      "SOURCE_ZERO_COST",
      "SOURCE_COST_MISMATCH",
      "RAW_STOCK_DELETED",
    ]);
    const hasCostIssue = [...codes].some((c) => COST_ISSUE_CODES.has(c));

    // Exclude supplier-linked containers — apply-all-safe's DEFECT 12 guard removes
    // these because the cascade skips SUPPLIER_LOCKED_RATE sources. Marking them
    // safeToRepair here would make the audit count disagree with what apply-all-safe
    // actually applies, showing "Nothing to repair" after a non-zero safe-repair count.
    const isSupplierLinked = supplierLinkedIds.has(row.containerId);
    const safeToRepair =
      !codes.has("UNRESOLVED_FX") &&
      !codes.has("MANUAL_REVIEW_REQUIRED") &&
      !codes.has("CORRECT") &&
      !isSupplierLinked &&
      hasCostIssue &&
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
