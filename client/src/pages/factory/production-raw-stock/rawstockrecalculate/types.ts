/**
 * Types for the RawStockRecalculate page.
 *
 * Extracted from RawStockRecalculate.tsx during the Phase 4 god-file split.
 */

export interface RecalcRow {
  containerId: number;
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
  rawStockDeleted: boolean;
  mixSourceCount: number;
  affectedOpenBatchCount: number;
  affectedCompletedBatchCount: number;
  old: { costPerKg: number; costPerKgUsd: number };
  next: { costPerKg: number; costPerKgUsd: number };
  diffPct: number;
  changed: boolean;
  fxUnresolved: boolean;
  valuationKg?: number;
  actualReceivedKg?: number;
  wasPartialReceipt?: boolean;
}

export interface AffectedMixBatchRow {
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
  costDifferencePerKg: number;
  totalCostDifference: number;
  oldTotalCost: number;
  newTotalCost: number;
  diffPct: number;
  baleCount: number;
  sourceContainerNumbers: string[];
  sourceChanges: Array<{
    containerId: number;
    containerNumber: string;
    weightKg: number;
    oldCostPerKgUsd: number;
    newCostPerKgUsd: number;
  }>;
}

export interface SourceMismatchRow {
  sourceId: number;
  batchId: number;
  batchCode: string;
  batchStatus: string;
  containerId: number | null;
  containerNumber: string | null;
  supplierId: number | null;
  supplierName: string | null;
  weightKg: number;
  oldCostPerKgUsd: number;
  newCostPerKgUsd: number;
  fixable: boolean;
  reason: string;
}

export interface FullAuditSummary {
  totalContainersScanned: number;
  containersCorrect: number;
  containerCostMismatches: number;
  activeRawStockMismatches: number;
  fullyUsedContainersWithMismatches: number;
  missingRawStockContainers: number;
  zeroCostSources: number;
  nonZeroSourceCostMismatches: number;
  unresolvedFxContainers: number;
  safeRepairsAvailable: number;
}

export interface FullAuditRow {
  containerId: number;
  containerNumber: string;
  containerStatus: string;
  codes: string[];
  safeToRepair: boolean;
  fxUnresolved: boolean;
  fullyUsed: boolean;
}

export interface FullAuditResult {
  summary: FullAuditSummary;
  rows: FullAuditRow[];
}

export interface UndoLogRow {
  id: number;
  companyId: number;
  userId: number | null;
  username: string | null;
  description: string;
  containerCount: number;
  containerNumbers: string[];
  appliedAt: string;
  undoneAt: string | null;
  undoneByUserId: number | null;
  undoneByUsername: string | null;
}

export interface SupplierRateAuditRow {
  supplierId: number;
  supplierName: string;
  /** The moving-average rate that was in place before "Recompute Supplier Rates" overwrote it. */
  oldRate: number;
  /** The all-time stable rate that the recompute wrote. */
  recomputedRate: number;
  /** The rate currently stored in the DB (may differ from recomputedRate if something else changed it since). */
  currentRate: number;
  overwroteAt: string;
  changedBy: string | null;
  /** True only when currentRate still matches what the recompute wrote — safe to restore. */
  canRestore: boolean;
}

export interface SupplierRatePreviewRow {
  supplierId: number;
  supplierName: string;
  oldRate: number;
  newRate: number;
  rowCount: number;
  totalReceivedKg: number;
  skipped?: string;
}

// ─── Historical Replay interfaces ────────────────────────────────────────────

export interface ReplaySupplierRow {
  supplierId: number;
  supplierName: string;
  startingRate: number;
  endingExpectedRate: number;
  currentStoredRate: number;
  replayRemainingKg: number;
  authoritativeRemainingKg: number;
  safeToRepair: boolean;
  reasons: string[];
  eventCount: number;
  affectedContainerCount: number;
  affectedSourceCount: number;
  affectedBatchCount: number;
  affectedBaleCount: number;
}

export interface ReplaySummary {
  totalReceivedContainers: number;
  containersScanned: number;
  canonicalContainerMismatches: number;
  suppliersScanned: number;
  safeSuppliers: number;
  manualReviewSuppliers: number;
  supplierPricedSourcesScanned: number;
  sourceMismatches: number;
  batchesToUpdate: number;
  completedBatchesToUpdate?: number;
  balesToUpdate: number;
  finalizedBalesToUpdate?: number;
  unresolvedFx: number;
  missingDates: number;
  quantityTimelineMismatches: number;
  ambiguousEventOrdering: number;
  scanCoverageError: boolean;
}

export interface HistoricalReplayResult {
  summary: ReplaySummary;
  supplierRows: ReplaySupplierRow[];
  containerRows: unknown[];
  sourceRows: unknown[];
  batchRows: unknown[];
}

export interface PreparedReplayData {
  confirmationToken: string;
  summary: Record<string, unknown>;
  safeSupplierIds: number[];
  suppliersToApply: unknown[];
  fingerprint?: string;
  expiresInMs: number;
  algorithmVersion: string;
  scope?: {
    suppliers: number;
    containers: number;
    rawStockRows: number;
    supplierSources: number;
    batches: number;
    availableBales: number;
    finalizedBales: number;
    blockedBatches: number;
  };
}

export interface HistoricalReplayApplyResponse {
  suppliersApplied: number;
  sourcesUpdated: number;
  batchesUpdated: number;
  balesUpdated: number;
}

export interface UndoApplyResponse {
  containersRestored: number;
  mixBatchesRestored: number;
  balesRestored: number;
}

export interface RecalcApplyResultRow {
  applied: boolean;
  affectedBatches: number;
  affectedBales: number;
  completedBatchesRewritten?: number;
  skippedReason?: string;
}

export interface RecalcApplyResponse {
  results?: RecalcApplyResultRow[];
}

export interface SupplierRatePreviewResponse {
  results: SupplierRatePreviewRow[];
}

export interface RestoreRatesResponse {
  restored: number;
}

export interface SourceMismatchApplyResultRow {
  applied: boolean;
  affectedBales?: number;
}

export interface SourceMismatchApplyResponse {
  results?: SourceMismatchApplyResultRow[];
}

export interface PartialOffloadApplyResponse {
  applied: number;
  skipped: number;
}

// ─── Component ───────────────────────────────────────────────────────────────
