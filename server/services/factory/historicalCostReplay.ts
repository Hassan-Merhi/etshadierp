/**
 * Historical Raw-Material Cost Replay facade.
 *
 * Read-only preview supplies the PostgreSQL pool as an executor. Apply acquires
 * one client, begins a serializable transaction, takes the company advisory
 * lock, and passes that same executor through the complete calculation chain.
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
  buildHistoricalReplayScope,
  buildHistoricalReplayScopeInternal,
  computeReplayWriteScope,
  classifyBalesByFinalization,
  captureReplaySnapshot,
} from "./historical-replay/selectedScope";
export {
  computeReplayFingerprint,
  loadReplayAuthoritativeInputDigest,
} from "./historical-replay/fingerprint";
export * from "./historical-replay/apply";
