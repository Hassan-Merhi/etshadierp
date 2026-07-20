import { factoryContainers, factoryRawStock } from "@shared/schema";

export interface ReplayQueryExecutor {
  query<T = any>(
    text: string,
    params?: any[]
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

/** Backwards-compatible alias used by existing callers and tests. */
export type QueryExecutor = ReplayQueryExecutor;

export class StaleTokenError extends Error {
  readonly code = "STALE_TOKEN" as const;

  constructor(message: string) {
    super(message);
    this.name = "StaleTokenError";
  }
}

export type ScanReason =
  | "ACTIVE_RAW_STOCK"
  | "DELETED_RAW_STOCK"
  | "RECEIPT_HISTORY"
  | "OFFLOAD_DAYBOOK"
  | "MIX_SOURCE_LINK"
  | "CONTAINER_RECEIVED_FIELD";

export interface ReplayContainerRow {
  containerId: number;
  containerNumber: string;
  status: string;
  supplierId: number | null;
  eventDate: string | null;
  storedCostPerKgUsd: number;
  canonicalCostPerKgUsd: number;
  storedTotalUsd: number;
  canonicalTotalUsd: number;
  fxUnresolved: boolean;
  safeToRepair: boolean;
  reason: string | null;
  scanReason: ScanReason;
}

export interface ReplaySourceRow {
  sourceId: number;
  batchId: number;
  batchCode: string;
  batchDate: string | null;
  supplierId: number | null;
  containerId: number | null;
  pricingBasis: string;
  storedCostPerKg: number;
  expectedHistoricalCostPerKg: number;
  storedTotalCost: number;
  expectedTotalCost: number;
  weightKg: number;
  safeToRepair: boolean;
  reason: string | null;
}

export interface ReplayBatchRow {
  batchId: number;
  batchCode: string;
  status: string;
  batchDate: string | null;
  storedCostPerKg: number;
  expectedCostPerKg: number;
  storedTotalCost: number;
  expectedTotalCost: number;
  affectedBales: number;
}

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
  omittedContainers: number;
  canonicalContainerMismatches: number;
  suppliersScanned: number;
  safeSuppliers: number;
  manualReviewSuppliers: number;
  supplierPricedSourcesScanned: number;
  sourceMismatches: number;
  batchesToUpdate: number;
  completedBatchesToUpdate: number;
  balesToUpdate: number;
  finalizedBalesToUpdate: number;
  unresolvedFx: number;
  missingDates: number;
  quantityTimelineMismatches: number;
  ambiguousEventOrdering: number;
  scanCoverageError: boolean;
}

export interface HistoricalReplayPreviewResult {
  summary: ReplaySummary;
  supplierRows: ReplaySupplierRow[];
  containerRows: ReplayContainerRow[];
  sourceRows: ReplaySourceRow[];
  batchRows: ReplayBatchRow[];
}

export interface HistoricalReplayScope {
  supplierIds: number[];
  containerIds: number[];
  sourceIds: number[];
  batchIds: number[];
  baleIds: number[];
  blockedBatchIds: number[];
}

export interface ReplayWriteScope {
  supplierIds: number[];
  containerIdsToUpdate: number[];
  rawStockIdsToUpdate: number[];
  sourceIdsToUpdate: number[];
  batchIdsToUpdate: number[];
  availableBaleIdsToUpdate: number[];
  finalizedBaleIdsToUpdate: number[];
  blockedBatches: Array<{ batchId: number; batchCode: string; reasons: string[] }>;
}

export interface ReplayApplyParams {
  companyId: number;
  supplierIds: number[];
  includeCompletedBatches: boolean;
  includeFinalizedBales: boolean;
  preview?: HistoricalReplayPreviewResult;
  expectedFingerprint: string;
  expectedScope?: ReplayWriteScope;
  algorithmVersion: string;
  issuedByUserId: string;
}

export interface ReplayApplyResult {
  suppliersApplied: number;
  rawStockRowsUpdated: number;
  sourcesUpdated: number;
  batchesUpdated: number;
  balesUpdated: number;
  supplierRatesUpdated: number;
  skippedSupplierIds: number[];
}

export interface SupplierEvent {
  kind:
    | "RECEIPT"
    | "ADD_ADJUSTMENT"
    | "REMOVE_ADJUSTMENT"
    | "DEDUCT_ADJUSTMENT"
    | "BATCH_CONSUMPTION";
  effectiveDate: string;
  createdAt: number;
  stableId: number;
  containerId?: number;
  canonicalRateUsd?: number;
  receiptKg?: number;
  adjustKg?: number;
  costPerKgUsd?: number | null;
  removeKg?: number;
  batchId?: number;
  batchCode?: string;
  consumptionKg?: number;
  sourceIds?: number[];
}

export interface ContainerUniverse {
  container: typeof factoryContainers.$inferSelect;
  supplierName: string | null;
  activeRawStock: typeof factoryRawStock.$inferSelect | null;
  deletedRawStockExists: boolean;
  receiptHistoryExists: boolean;
  offloadDaybookExists: boolean;
  mixSourceLinkExists: boolean;
  scanReason: ScanReason;
  offloadDate: string | null;
}

export interface CanonicalContainer {
  universe: ContainerUniverse;
  canonicalCostPerKgUsd: number;
  canonicalTotalUsd: number;
  storedCostPerKgUsd: number;
  storedTotalUsd: number;
  fxUnresolved: boolean;
  safeToRepair: boolean;
  reason: string | null;
}

export interface BatchInfo {
  batchId: number;
  batchCode: string;
  batchDate: string | null;
  status: string;
  createdAt: number;
  storedCostPerKg: number;
  storedTotalCost: number;
  totalWeightKg: number;
}

export interface SourceInfo {
  sourceId: number;
  batchId: number;
  batchCode: string;
  batchDate: string | null;
  supplierId: number | null;
  containerId: number | null;
  sourceBatchId: number | null;
  weightKg: number;
  storedCostPerKg: number;
  storedTotalCost: number;
  pricingBasis: string;
}

export interface SourceCorrection {
  sourceId: number;
  batchId: number;
  pricingBasis: string;
  weightKg: number;
  expectedCostPerKg: number;
  expectedTotalCost: number;
}

export interface BatchCorrection {
  batchId: number;
  batchCode: string;
  status: string;
  batchDate: string | null;
  storedCostPerKg: number;
  expectedCostPerKg: number;
  storedTotalCost: number;
  expectedTotalCost: number;
  correctedSourceCosts: Map<number, number>;
}

export interface BlockedBatch {
  batchId: number;
  batchCode: string;
  reasons: string[];
  dependencyPath: number[];
}

export interface ReplayScopeInternal extends ReplayWriteScope {
  _safeSupplierRows: ReplaySupplierRow[];
  _sourceInfos: SourceInfo[];
  _sourceCorrections?: Map<number, SourceCorrection>;
  _batchCorrections: BatchCorrection[];
  _canonicalRateByContainer: Map<number, number>;
  _canonicalTotalUsdByContainer: Map<number, number>;
  _rawStockIdToContainer: Map<number, number>;
  _fullPreview: HistoricalReplayPreviewResult;
}

export const FINALIZED_BALE_STATUSES = [
  "SOLD",
  "DISPATCHED",
  "RESERVED_FOR_DISPATCH",
  "RESERVED_FOR_ORDER",
  "FINALIZED",
] as const;

export const REPLAY_ALGORITHM_VERSION = "v4-selected-supplier-closure";

export function rowToCamel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase())] = value;
  }
  return out as T;
}

export function numeric(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}
