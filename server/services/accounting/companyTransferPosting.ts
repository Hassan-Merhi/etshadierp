import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { VoucherEntryInsertFields } from "./accountingTypes";
import {
  PostingValidationError,
  type CentralPostingRequest,
  type PostingActor,
} from "./centralPostingEngine";
import { resolveManualJournalClientRequestId } from "./manualJournalPosting";

export type CompanyTransferVoucherType = "Payment" | "Receipt";
export type CompanyTransferSide = "from" | "to";

export interface BuildCompanyTransferPostingInput {
  companyId: number;
  voucherNumber: string;
  voucherType: CompanyTransferVoucherType;
  voucherDate: string;
  description?: string | null;
  amount: string | number;
  debitLedgerAccountId: number;
  creditLedgerAccountId: number;
  clientRequestId?: unknown;
  sourceType: "simple-company-transfer" | "inter-company-transfer";
  sourceSide: CompanyTransferSide;
  actor?: PostingActor;
}

export interface BuiltCompanyTransferPosting {
  request: CentralPostingRequest;
  clientRequestId: string;
  amount: string;
}

function positiveId(value: unknown, field: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new PostingValidationError("POSTING_TARGET_ID_INVALID", `${field} must be a positive integer`);
  }
  return id;
}

function positiveAmount(value: unknown): Decimal {
  let amount: Decimal;
  try {
    amount = new Decimal(String(value ?? ""));
  } catch {
    throw new PostingValidationError("POSTING_AMOUNT_INVALID", "Transfer amount is invalid");
  }
  if (!amount.isFinite() || amount.lte(0)) {
    throw new PostingValidationError("POSTING_AMOUNT_INVALID", "Transfer amount must be positive");
  }
  return amount;
}

function fingerprint(input: {
  companyId: number;
  voucherType: CompanyTransferVoucherType;
  voucherDate: string;
  description: string | null;
  amount: string;
  debitLedgerAccountId: number;
  creditLedgerAccountId: number;
  sourceType: string;
  sourceSide: CompanyTransferSide;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function buildCompanyTransferPostingRequest(
  input: BuildCompanyTransferPostingInput,
): BuiltCompanyTransferPosting {
  const amount = positiveAmount(input.amount).toFixed();
  const debitLedgerAccountId = positiveId(input.debitLedgerAccountId, "debitLedgerAccountId");
  const creditLedgerAccountId = positiveId(input.creditLedgerAccountId, "creditLedgerAccountId");
  if (debitLedgerAccountId === creditLedgerAccountId) {
    throw new PostingValidationError(
      "POSTING_TARGET_INVALID",
      "Transfer debit and credit accounts must be different",
    );
  }

  const clientRequestId = resolveManualJournalClientRequestId(input.clientRequestId);
  const description = input.description?.trim() || null;
  const entries: VoucherEntryInsertFields[] = [
    {
      ledgerAccountId: debitLedgerAccountId,
      debitAmount: amount,
      creditAmount: "0",
      narration: description,
    },
    {
      ledgerAccountId: creditLedgerAccountId,
      debitAmount: "0",
      creditAmount: amount,
      narration: description,
    },
  ];
  const payloadFingerprint = fingerprint({
    companyId: input.companyId,
    voucherType: input.voucherType,
    voucherDate: input.voucherDate,
    description,
    amount,
    debitLedgerAccountId,
    creditLedgerAccountId,
    sourceType: input.sourceType,
    sourceSide: input.sourceSide,
  });

  return {
    clientRequestId,
    amount,
    request: {
      voucher: {
        companyId: input.companyId,
        voucherNumber: input.voucherNumber,
        voucherType: input.voucherType,
        voucherDate: input.voucherDate,
        description,
        totalAmount: amount,
        optional: false,
      },
      entries,
      source: {
        sourceType: input.sourceType,
        sourceId: `${clientRequestId}:${input.sourceSide}`,
        idempotencyKey: `${input.sourceType}:${clientRequestId}:${input.sourceSide}:${payloadFingerprint.slice(0, 32)}`,
      },
      actor: input.actor,
    },
  };
}
