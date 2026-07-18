/**
 * Central Accounting Service
 *
 * Re-exports the low-level compatibility helpers and the strict Program 2
 * posting, lifecycle, and reconciliation boundaries. New or migrated posting
 * flows should use postBalancedVoucherTx inside the transaction that owns the
 * source document and any mandatory inventory or secondary-ledger effects.
 * Voucher edits and deletes must use reverseVoucherTx or replaceVoucherTx rather
 * than deleting committed accounting rows. Balance checks should compare
 * operational projections against voucher-entry truth through reconcileTargetTx.
 */

export type { VoucherInsertFields, VoucherEntryInsertFields, VoucherWithEntries } from "./accountingTypes";

export { insertVoucherWithEntriesTx, insertVoucherWithEntries } from "./voucherPostingService";

export {
  postBalancedVoucherTx,
  validateCentralPostingRequest,
  PostingValidationError,
} from "./centralPostingEngine";
export type {
  CentralPostingDependencies,
  CentralPostingRequest,
  PostingActor,
  PostingAuditWriter,
  PostingIdempotencyStore,
  PostingOwnershipValidator,
  PostingSourceIdentity,
  ValidatedPostingTotals,
} from "./centralPostingEngine";

export {
  replaceVoucherTx,
  reverseVoucherTx,
  VoucherLifecycleError,
} from "./voucherLifecycleService";
export type {
  LifecycleResult,
  LifecycleVoucherSnapshot,
  ReplaceVoucherRequest,
  ReverseVoucherRequest,
  VoucherLifecycleAdapter,
  VoucherLifecycleState,
} from "./voucherLifecycleService";

export {
  reconcileTargetTx,
  reconcileTargetsTx,
  ReconciliationValidationError,
  validateReconciliationTarget,
} from "./partyReconciliationService";
export type {
  ReconciliationAdapter,
  ReconciliationBalance,
  ReconciliationBatchResult,
  ReconciliationDomain,
  ReconciliationResult,
  ReconciliationTarget,
} from "./partyReconciliationService";
