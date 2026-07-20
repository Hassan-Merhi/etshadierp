/**
 * Historical Raw-Material Cost Replay facade.
 *
 * Prepare uses the read-only executor-aware preview. Apply uses the exact signed
 * scope implementation inside one serializable, advisory-locked transaction.
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
export { captureExactReplaySnapshot } from "./historical-replay/exactSnapshot";
export { applyExactHistoricalCostReplay as applyHistoricalCostReplay } from "./historical-replay/exactApply";
