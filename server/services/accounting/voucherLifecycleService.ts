import Decimal from "decimal.js";
import type { PostingActor, PostingSourceIdentity } from "./centralPostingEngine";

export type VoucherLifecycleState = "POSTED" | "REVERSED" | "REPLACED";

export interface LifecycleVoucherSnapshot {
  voucher: {
    id: number;
    companyId: number;
    voucherNumber: string;
    voucherType: string;
    voucherDate: string;
    totalAmount: string;
    description?: string | null;
    lifecycleState?: VoucherLifecycleState | null;
    reversalVoucherId?: number | null;
    replacementVoucherId?: number | null;
  };
  entries: Array<{
    ledgerAccountId?: number | null;
    bankAccountId?: number | null;
    fixedAssetId?: number | null;
    supplierId?: number | null;
    employeeId?: number | null;
    customerId?: number | null;
    factorySupplierId?: number | null;
    debitAmount?: string | null;
    creditAmount?: string | null;
    narration?: string | null;
  }>;
}

export interface VoucherLifecycleAdapter {
  lockVoucher(input: { tx: any; companyId: number; voucherId: number }): Promise<LifecycleVoucherSnapshot | null>;
  findOperation(input: { tx: any; companyId: number; idempotencyKey: string }): Promise<LifecycleResult | null>;
  createReversal(input: {
    tx: any;
    original: LifecycleVoucherSnapshot;
    reversalDate: string;
    reason: string;
    actor: PostingActor;
    source: PostingSourceIdentity;
    entries: LifecycleVoucherSnapshot["entries"];
  }): Promise<LifecycleVoucherSnapshot>;
  createReplacement?(input: {
    tx: any;
    original: LifecycleVoucherSnapshot;
    reversal: LifecycleVoucherSnapshot;
    request: ReplaceVoucherRequest;
  }): Promise<LifecycleVoucherSnapshot>;
  reverseLinkedEffects(input: {
    tx: any;
    original: LifecycleVoucherSnapshot;
    reversal: LifecycleVoucherSnapshot;
    actor: PostingActor;
    reason: string;
  }): Promise<void>;
  markReversed(input: {
    tx: any;
    originalVoucherId: number;
    reversalVoucherId: number;
    replacementVoucherId?: number | null;
  }): Promise<void>;
  recordOperation(input: {
    tx: any;
    companyId: number;
    idempotencyKey: string;
    operation: "REVERSE" | "REPLACE";
    result: LifecycleResult;
    actor: PostingActor;
    reason: string;
  }): Promise<void>;
}

export interface ReverseVoucherRequest {
  tx: any;
  companyId: number;
  voucherId: number;
  reversalDate: string;
  reason: string;
  idempotencyKey: string;
  actor?: PostingActor;
  source: PostingSourceIdentity;
}

export interface ReplaceVoucherRequest extends ReverseVoucherRequest {
  replacementPayload: unknown;
}

export interface LifecycleResult {
  originalVoucherId: number;
  reversalVoucherId: number;
  replacementVoucherId?: number | null;
  state: "REVERSED" | "REPLACED";
  idempotent: boolean;
}

export class VoucherLifecycleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "VoucherLifecycleError";
  }
}

function required(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new VoucherLifecycleError("VOUCHER_LIFECYCLE_INPUT_REQUIRED", `${field} is required`);
  return text;
}

function assertPosted(snapshot: LifecycleVoucherSnapshot): void {
  const state = snapshot.voucher.lifecycleState ?? "POSTED";
  if (state !== "POSTED" || snapshot.voucher.reversalVoucherId) {
    throw new VoucherLifecycleError("VOUCHER_ALREADY_REVERSED", "Voucher has already been reversed or replaced");
  }
}

function reversalEntries(snapshot: LifecycleVoucherSnapshot): LifecycleVoucherSnapshot["entries"] {
  return snapshot.entries.map((entry, index) => {
    const debit = new Decimal(entry.debitAmount ?? "0");
    const credit = new Decimal(entry.creditAmount ?? "0");
    if (!debit.isFinite() || !credit.isFinite() || debit.isNegative() || credit.isNegative()) {
      throw new VoucherLifecycleError("VOUCHER_REVERSAL_AMOUNT_INVALID", `Entry ${index + 1} has an invalid amount`);
    }
    return {
      ...entry,
      debitAmount: credit.toFixed(),
      creditAmount: debit.toFixed(),
      narration: entry.narration ? `Reversal: ${entry.narration}` : `Reversal of ${snapshot.voucher.voucherNumber}`,
    };
  });
}

async function beginOperation(
  adapter: VoucherLifecycleAdapter,
  request: ReverseVoucherRequest
): Promise<{ existing: LifecycleResult | null; original?: LifecycleVoucherSnapshot }> {
  required(request.reason, "reason");
  required(request.reversalDate, "reversalDate");
  required(request.idempotencyKey, "idempotencyKey");
  if (!Number.isInteger(request.companyId) || request.companyId <= 0 || !Number.isInteger(request.voucherId)) {
    throw new VoucherLifecycleError("VOUCHER_LIFECYCLE_TARGET_INVALID", "Valid companyId and voucherId are required");
  }
  const existing = await adapter.findOperation({
    tx: request.tx,
    companyId: request.companyId,
    idempotencyKey: request.idempotencyKey,
  });
  if (existing) return { existing: { ...existing, idempotent: true } };
  const original = await adapter.lockVoucher({
    tx: request.tx,
    companyId: request.companyId,
    voucherId: request.voucherId,
  });
  if (!original) throw new VoucherLifecycleError("VOUCHER_NOT_FOUND", "Voucher was not found in the requested company");
  assertPosted(original);
  return { existing: null, original };
}

export async function reverseVoucherTx(
  adapter: VoucherLifecycleAdapter,
  request: ReverseVoucherRequest
): Promise<LifecycleResult> {
  const started = await beginOperation(adapter, request);
  if (started.existing) return started.existing;
  const original = started.original!;
  const actor = request.actor ?? {};
  const reversal = await adapter.createReversal({
    tx: request.tx,
    original,
    reversalDate: request.reversalDate,
    reason: request.reason,
    actor,
    source: request.source,
    entries: reversalEntries(original),
  });
  await adapter.reverseLinkedEffects({ tx: request.tx, original, reversal, actor, reason: request.reason });
  await adapter.markReversed({
    tx: request.tx,
    originalVoucherId: original.voucher.id,
    reversalVoucherId: reversal.voucher.id,
  });
  const result: LifecycleResult = {
    originalVoucherId: original.voucher.id,
    reversalVoucherId: reversal.voucher.id,
    replacementVoucherId: null,
    state: "REVERSED",
    idempotent: false,
  };
  await adapter.recordOperation({
    tx: request.tx,
    companyId: request.companyId,
    idempotencyKey: request.idempotencyKey,
    operation: "REVERSE",
    result,
    actor,
    reason: request.reason,
  });
  return result;
}

export async function replaceVoucherTx(
  adapter: VoucherLifecycleAdapter,
  request: ReplaceVoucherRequest
): Promise<LifecycleResult> {
  if (!adapter.createReplacement) {
    throw new VoucherLifecycleError("VOUCHER_REPLACEMENT_UNSUPPORTED", "Replacement adapter is not configured");
  }
  const started = await beginOperation(adapter, request);
  if (started.existing) return started.existing;
  const original = started.original!;
  const actor = request.actor ?? {};
  const reversal = await adapter.createReversal({
    tx: request.tx,
    original,
    reversalDate: request.reversalDate,
    reason: request.reason,
    actor,
    source: request.source,
    entries: reversalEntries(original),
  });
  await adapter.reverseLinkedEffects({ tx: request.tx, original, reversal, actor, reason: request.reason });
  const replacement = await adapter.createReplacement({ tx: request.tx, original, reversal, request });
  await adapter.markReversed({
    tx: request.tx,
    originalVoucherId: original.voucher.id,
    reversalVoucherId: reversal.voucher.id,
    replacementVoucherId: replacement.voucher.id,
  });
  const result: LifecycleResult = {
    originalVoucherId: original.voucher.id,
    reversalVoucherId: reversal.voucher.id,
    replacementVoucherId: replacement.voucher.id,
    state: "REPLACED",
    idempotent: false,
  };
  await adapter.recordOperation({
    tx: request.tx,
    companyId: request.companyId,
    idempotencyKey: request.idempotencyKey,
    operation: "REPLACE",
    result,
    actor,
    reason: request.reason,
  });
  return result;
}
