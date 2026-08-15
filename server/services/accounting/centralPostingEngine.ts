import Decimal from "decimal.js";
import type { VoucherEntryInsertFields, VoucherInsertFields, VoucherWithEntries } from "./accountingTypes";
import { insertVoucherWithEntriesTx } from "./voucherPostingService";
import { assertTransactionCompanyScope } from "../security/transactionCompanyScope";

const TARGET_FIELDS = [
  "ledgerAccountId",
  "bankAccountId",
  "fixedAssetId",
  "supplierId",
  "employeeId",
  "customerId",
  "factorySupplierId",
] as const;

type TargetField = (typeof TARGET_FIELDS)[number];

export interface PostingSourceIdentity {
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
}

export interface PostingActor {
  userId?: string | number | null;
  username?: string | null;
  reason?: string | null;
}

export interface PostingOwnershipValidator {
  validateVoucherOwnership(input: {
    tx: any;
    companyId: number;
    voucher: VoucherInsertFields;
    entries: VoucherEntryInsertFields[];
  }): Promise<void>;
}

export interface PostingIdempotencyStore {
  findExisting(input: {
    tx: any;
    companyId: number;
    source: PostingSourceIdentity;
  }): Promise<VoucherWithEntries | null>;
  record(input: { tx: any; companyId: number; voucherId: number; source: PostingSourceIdentity }): Promise<void>;
}

export interface PostingAuditWriter {
  recordPosting(input: {
    tx: any;
    companyId: number;
    voucherId: number;
    source: PostingSourceIdentity;
    actor: PostingActor;
    debitTotal: string;
    creditTotal: string;
  }): Promise<void>;
}

export interface CentralPostingDependencies {
  ownership: PostingOwnershipValidator;
  idempotency: PostingIdempotencyStore;
  audit: PostingAuditWriter;
}

export interface CentralPostingRequest {
  voucher: VoucherInsertFields;
  entries: VoucherEntryInsertFields[];
  source: PostingSourceIdentity;
  actor?: PostingActor;
}

export interface ValidatedPostingTotals {
  debitTotal: string;
  creditTotal: string;
}

export interface CentralPostingResult<V = unknown, E = unknown> extends VoucherWithEntries<V, E> {
  replayed: boolean;
}

export class PostingValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PostingValidationError";
    this.code = code;
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new PostingValidationError("POSTING_SOURCE_REQUIRED", `${field} is required`);
  }
  return normalized;
}

function amount(value: string | undefined, field: string, index: number): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value ?? "0");
  } catch {
    throw new PostingValidationError("POSTING_AMOUNT_INVALID", `Entry ${index + 1} has an invalid ${field}`);
  }
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new PostingValidationError(
      "POSTING_AMOUNT_INVALID",
      `Entry ${index + 1} ${field} must be a finite non-negative amount`
    );
  }
  return parsed;
}

export function populatedPostingTargets(entry: VoucherEntryInsertFields): TargetField[] {
  return TARGET_FIELDS.filter((field) => entry[field] != null);
}

/**
 * Most voucher entries must reference one accounting target. The only supported
 * compatibility exception is a customer plus that customer's own linked ledger.
 * The database ownership adapter validates the relationship before insert.
 */
export function hasSupportedPostingTargetShape(entry: VoucherEntryInsertFields): boolean {
  const populated = populatedPostingTargets(entry);
  if (populated.length === 1) return true;
  return populated.length === 2 && populated.includes("customerId") && populated.includes("ledgerAccountId");
}

export function validateCentralPostingRequest(request: CentralPostingRequest): ValidatedPostingTotals {
  const { voucher, entries, source } = request;

  if (!Number.isInteger(voucher.companyId) || voucher.companyId <= 0) {
    throw new PostingValidationError("POSTING_COMPANY_INVALID", "A valid companyId is required");
  }
  requiredText(voucher.voucherNumber, "voucherNumber");
  requiredText(voucher.voucherType, "voucherType");
  requiredText(voucher.voucherDate, "voucherDate");
  requiredText(source.sourceType, "sourceType");
  requiredText(source.sourceId, "sourceId");
  requiredText(source.idempotencyKey, "idempotencyKey");

  if (!Array.isArray(entries) || entries.length < 2) {
    throw new PostingValidationError("POSTING_ENTRIES_REQUIRED", "A balanced voucher requires at least two entries");
  }

  let debitTotal = new Decimal(0);
  let creditTotal = new Decimal(0);

  entries.forEach((entry, index) => {
    const debit = amount(entry.debitAmount, "debitAmount", index);
    const credit = amount(entry.creditAmount, "creditAmount", index);

    if (!hasSupportedPostingTargetShape(entry)) {
      throw new PostingValidationError(
        "POSTING_TARGET_INVALID",
        `Entry ${index + 1} must reference one accounting target or a verified customer and linked ledger pair`
      );
    }
    if (debit.isZero() === credit.isZero()) {
      throw new PostingValidationError(
        "POSTING_ENTRY_SIDE_INVALID",
        `Entry ${index + 1} must contain either a debit or a credit, but not both`
      );
    }

    debitTotal = debitTotal.plus(debit);
    creditTotal = creditTotal.plus(credit);
  });

  if (debitTotal.isZero() || !debitTotal.equals(creditTotal)) {
    throw new PostingValidationError(
      "POSTING_UNBALANCED",
      `Voucher is not balanced: debit=${debitTotal.toFixed()} credit=${creditTotal.toFixed()}`
    );
  }

  let declaredTotal: Decimal;
  try {
    declaredTotal = new Decimal(voucher.totalAmount);
  } catch {
    throw new PostingValidationError("POSTING_TOTAL_INVALID", "totalAmount is invalid");
  }
  if (!declaredTotal.isFinite() || declaredTotal.isNegative() || !declaredTotal.equals(debitTotal)) {
    throw new PostingValidationError(
      "POSTING_TOTAL_MISMATCH",
      `totalAmount must equal the balanced debit total (${debitTotal.toFixed()})`
    );
  }

  return {
    debitTotal: debitTotal.toFixed(),
    creditTotal: creditTotal.toFixed(),
  };
}

/**
 * Canonical transaction-owned voucher posting boundary.
 *
 * The caller supplies an existing transaction so required source-document,
 * inventory, and secondary-ledger effects can share the same commit. The
 * boundary validates the posting before writes, asserts transaction-local company
 * scope for compatible PostgreSQL RLS policies, enforces company ownership,
 * performs deterministic idempotency lookup/recording, and writes audit data
 * before the transaction is allowed to commit.
 *
 * `replayed` lets callers avoid repeating non-transactional compatibility side
 * effects when the same idempotency key is submitted more than once.
 */
export async function postBalancedVoucherTx(
  tx: any,
  request: CentralPostingRequest,
  dependencies: CentralPostingDependencies
): Promise<CentralPostingResult> {
  const totals = validateCentralPostingRequest(request);
  const companyId = request.voucher.companyId;

  await assertTransactionCompanyScope(tx, companyId);

  const existing = await dependencies.idempotency.findExisting({
    tx,
    companyId,
    source: request.source,
  });
  if (existing) return { ...existing, replayed: true };

  await dependencies.ownership.validateVoucherOwnership({
    tx,
    companyId,
    voucher: request.voucher,
    entries: request.entries,
  });

  const result = await insertVoucherWithEntriesTx(tx, request.voucher, request.entries);

  await dependencies.idempotency.record({
    tx,
    companyId,
    voucherId: result.voucher.id,
    source: request.source,
  });

  await dependencies.audit.recordPosting({
    tx,
    companyId,
    voucherId: result.voucher.id,
    source: request.source,
    actor: request.actor ?? {},
    debitTotal: totals.debitTotal,
    creditTotal: totals.creditTotal,
  });

  return { ...result, replayed: false };
}
