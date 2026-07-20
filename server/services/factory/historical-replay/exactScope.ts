/**
 * Stable exact-scope entry point.
 *
 * The final scope compares persisted container totals, follows the selected
 * supplier dependency closure, and includes parent batches even when corrected
 * source rows offset and leave the aggregate batch cost numerically unchanged.
 */
export {
  buildExactHistoricalReplayScopeFinal as buildExactHistoricalReplayScope,
  buildExactHistoricalReplayScopeInternalFinal as buildExactHistoricalReplayScopeInternal,
} from "./exactScopeFinal";
