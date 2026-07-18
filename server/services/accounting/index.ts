/**
 * Central Accounting Service
 *
 * Re-exports the low-level compatibility helpers and the strict Program 2
 * posting, lifecycle, reconciliation, and period-lock boundaries. New or
 * migrated posting flows should use postBalancedVoucherTx inside the transaction
 * that owns the source document and mandatory inventory or secondary-ledger
 * effects. Every dated business write must call assertPeriodOpenTx before its
 * first write in that same transaction.
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

export {
  assertPeriodOpenTx,
  lockThroughTx,
  PeriodLockError,
} from "./periodLockService";
export type {
  ClosedPeriodOverride,
  PeriodLockActor,
  PeriodLockAdapter,
  PeriodLockRecord,
  PeriodLockScope,
  ProtectedDomain,
} from "./periodLockService";