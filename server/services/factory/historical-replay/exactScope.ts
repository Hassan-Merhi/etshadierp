/**
 * Stable exact-scope entry point.
 *
 * V7 expands every selected supplier to the complete connected mixed-batch
 * supplier closure, rejects unresolved ownership/unsafe timelines, and refuses
 * to issue a scope containing blocked batches.
 */
export {
  buildExactHistoricalReplayScopeV7Final as buildExactHistoricalReplayScope,
  buildExactHistoricalReplayScopeInternalV7Final as buildExactHistoricalReplayScopeInternal,
} from "./exactScopeV7Final";
