/**
 * Historical Raw-Material Cost Replay facade.
 *
 * Prepare uses one read-only snapshot. Apply uses the exact signed scope inside
 * one serializable, advisory-locked transaction with post-write invariants.
 */
export * from "./historical-replay/types";
export {
  loadContainerUniverse,
  computeCanonicalCosts,
  buildBatchConsumptionEvents,
  sortEvents,
  replaySupplierTimeline,
  computeBatchCorrections,
} from "./historical-replay/readModel";
export {
  previewHistoricalCostReplay,
  previewHistoricalCostReplayWithExecutor,
} from "./historical-replay/securePreview";
export * from "./historical-replay/closure";
export {
  buildNotFinalizedClause,
  normalizeReplayWriteScope,
  replayWriteScopesEqual,
  computeReplayWriteScope,
} from "./historical-replay/selectedScope";
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
  applyExactHistoricalCostReplayV5 as applyHistoricalCostReplay,
  type ExactReplayCommitContext,
} from "./historical-replay/exactApplyV5";
