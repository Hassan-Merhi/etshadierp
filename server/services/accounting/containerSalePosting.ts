import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { VoucherEntryInsertFields } from "./accountingTypes";
import {
  PostingValidationError,
  type CentralPostingRequest,
  type PostingActor,
} from "./centralPostingEngine";

export interface BuildContainerSalePostingInput {
  companyId: number;
  containerId: number;
  voucherNumber: string;
  voucherDate: string;
  description?: string | null;
  debitNarration?: string | null;
  creditNarration?: string | null;
  totalAmount: string | number;
  customerLedgerAccountId: number;
  commissionAccountId: number;
  actor?: PostingActor;
}

export interface BuiltContainerSalePosting {
  request: CentralPostingRequest;
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
    throw new PostingValidationError("POSTING_AMOUNT_INVALID", "Container sale amount is invalid");
  }
  if (!amount.isFinite() || amount.lte(0)) {
    throw new PostingValidationError("POSTING_AMOUNT_INVALID", "Container sale amount must be positive");
  }
  return amount;
}

export function buildContainerSalePostingRequest(
  input: BuildContainerSalePostingInput,
): BuiltContainerSalePosting {
  const amount = positiveAmount(input.totalAmount).toFixed();
  const customerLedgerAccountId = positiveId(input.customerLedgerAccountId, "customerLedgerAccountId");
  const commissionAccountId = positiveId(input.commissionAccountId, "commissionAccountId");
  if (customerLedgerAccountId === commissionAccountId) {
    throw new PostingValidationError(
      "POSTING_TARGET_INVALID",
      "Container sale debit and credit accounts must be different",
    );
  }

  const description = input.description?.trim() || null;
  const debitNarration = input.debitNarration?.trim() || description;
  const creditNarration = input.creditNarration?.trim() || description;
  const entries: VoucherEntryInsertFields[] = [
    {
      ledgerAccountId: customerLedgerAccountId,
      debitAmount: amount,
      creditAmount: "0",
      narration: debitNarration,
    },
    {
      ledgerAccountId: commissionAccountId,
      debitAmount: "0",
      creditAmount: amount,
      narration: creditNarration,
    },
  ];
  const payloadFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        companyId: input.companyId,
        containerId: input.containerId,
        voucherDate: input.voucherDate,
        description,
        debitNarration,
        creditNarration,
        amount,
        customerLedgerAccountId,
        commissionAccountId,
      }),
    )
    .digest("hex");

  return {
    amount,
    request: {
      voucher: {
        companyId: input.companyId,
        voucherNumber: input.voucherNumber,
        voucherType: "Sales",
        voucherDate: input.voucherDate,
        description,
        totalAmount: amount,
      },
      entries,
      source: {
        sourceType: "container-sale",
        sourceId: `${input.companyId}:${input.containerId}`,
        idempotencyKey: `container-sale:${input.companyId}:${input.containerId}:${payloadFingerprint.slice(0, 32)}`,
      },
      actor: input.actor,
    },
  };
}
