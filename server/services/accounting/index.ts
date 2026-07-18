/**
 * Central Accounting Service
 *
 * Re-exports the low-level compatibility helpers and the strict Program 2
 * posting boundary. New or migrated posting flows should use
 * postBalancedVoucherTx inside the transaction that owns the source document
 * and any mandatory inventory or secondary-ledger effects.
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
