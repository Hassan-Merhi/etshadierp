/**
 * Historical Raw-Material Cost Replay facade.
 *
 * Prepare uses one read-only snapshot. Apply uses the exact signed scope inside
 * one serializable, advisory-locked transaction with complete cost-only
 * invariants, one-use token enforcement, and atomic undo/audit persistence.
 */
export * from "./historical-replay/types";
export {
  loadContainerUniverse,
  buildBatchConsumptionEvents,
  sortEvents,
  replaySupplierTimeline,
  computeBatchCorrections,
} from "./historical-replay/readModel";
export {
  computeCanonicalCostsV6 as computeCanonicalCosts,
  normalizePreviewPersistedContainerTotals,
} from "./historical-replay/canonicalCostsV6";
export {
  previewHistoricalCostReplay,
  previewHistoricalCostReplayWithExecutor,
} from "./historical-replay/securePreview";
export * from "./historical-replay/closure";
export {
  normalizeReplayWriteScope,
  replayWriteScopesEqual,
  computeReplayWriteScope,
} from "./historical-replay/selectedScope";
export { buildNotFinalizedClause } from "./historical-replay/baleFinalizationSql";
export {
  buildExactHistoricalReplayScope as buildHistoricalReplayScope,
  buildExactHistoricalReplayScopeInternal as buildHistoricalReplayScopeInternal,
} from "./historical-replay/exactScope";
export {
  classifyReplayBalesForBatches,
  classifyReplayBalesByIds,
} from "./historical-replay/baleClassification";
export {
  computeReplayFingerprint,
  loadReplayAuthoritativeInputDigest,
} from "./historical-replay/fingerprint";
export { captureReplaySnapshot } from "./historical-replay/scope";
export {
  captureExactReplaySnapshot,
  lockExactReplayScopeRows,
  replayBaleIdsForScope,
  type ExactReplaySnapshot,
} from "./historical-replay/exactSnapshot";
export {
  assertExactReplayNonCostInvariants,
  assertExactReplayCurrentCostsMatchApplied,
  assertPersistedReplaySourceTotals,
} from "./historical-replay/exactInvariants";
export {
  applyExactHistoricalCostReplayV6 as applyHistoricalCostReplay,
  type ExactReplayCommitContext,
} from "./historical-replay/exactApplyFinal";
