/**
 * Stable selected-supplier closure entry point.
 *
 * The final implementation corrects canonical CONTAINER_DIRECT inputs, follows
 * downstream BATCH dependencies, and deduplicates repeated dependency edges.
 */
export {
  buildSelectedSupplierBatchClosure,
  buildSelectedSupplierCorrectionPlan,
  type SelectedSupplierCorrectionPlan,
} from "./closureFinal";
