import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { VoucherEntryInsertFields } from "./accountingTypes";
import {
  PostingValidationError,
  type CentralPostingRequest,
  type PostingActor,
} from "./centralPostingEngine";
import { normalizeVoucherEntryAmounts } from "./currencyAmounts";
import { resolveManualJournalClientRequestId } from "./manualJournalPosting";

export type PaymentReceiptVoucherType = "Payment" | "Receipt";

export interface PaymentReceiptLineInput {
  accountType: string;
  accountId: number | string;
  amount: string | number;
}

export interface BuildPaymentReceiptPostingInput {
  companyId: number;
  voucherNumber: string;
  voucherType: PaymentReceiptVoucherType | string;
  voucherDate: string;
  paymentAccountType: string;
  paymentAccountId: number | string;
  entries: PaymentReceiptLineInput[];
  notes?: string | null;
  currency?: string | null;
  exchangeRate?: string | number | null;
  effectiveDate?: string | null;
  clientRequestId?: unknown;
  actor?: PostingActor;
  resolveTarget: (
    accountType: string,
    accountId: number
  ) => Promise<VoucherEntryInsertFields>;
}

export interface BuiltPaymentReceiptPosting {
  request: CentralPostingRequest;
  clientRequestId: string;
  transactionTotal: string;
}

const MAX_ROUNDING_ADJUSTMENT = new Decimal("0.001000");

function positiveId(value: unknown, field: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new PostingValidationError(
      "POSTING_TARGET_ID_INVALID",
      `${field} must be a positive integer`
    );
  }
  return id;
}

function positiveAmount(value: unknown, index: number): Decimal {
  let amount: Decimal;
  try {
    amount = new Decimal(String(value ?? ""));
  } catch {
    throw new PostingValidationError(
      "POSTING_AMOUNT_INVALID",
      `Payment/Receipt line ${index + 1} has an invalid amount`
    );
  }
  if (!amount.isFinite() || amount.lte(0)) {
    throw new PostingValidationError(
      "POSTING_AMOUNT_INVALID",
      `Payment/Receipt line ${index + 1} amount must be positive`
    );
  }
  return amount;
}

function normalizeLeg(input: {
  currency: string;
  exchangeRate: string | number | null | undefined;
  amount: Decimal;
  side: "DR" | "CR";
  target: VoucherEntryInsertFields;
  narration: string | null;
}): VoucherEntryInsertFields {
  let normalized;
  try {
    normalized = normalizeVoucherEntryAmounts({
      transactionCurrency: input.currency,
      baseCurrency: "USD",
      transactionDebitAmount: input.side === "DR" ? input.amount.toFixed() : "0",
      transactionCreditAmount: input.side === "CR" ? input.amount.toFixed() : "0",
      historicalRate: input.exchangeRate ?? null,
    });
  } catch (error: unknown) {
    throw new PostingValidationError(
      "POSTING_CURRENCY_INVALID",
      error instanceof Error ? error.message : "Payment/Receipt currency normalization failed"
    );
  }

  return {
    ...input.target,
    debitAmount: normalized.debitAmount,
    creditAmount: normalized.creditAmount,
    transactionCurrency: normalized.transactionCurrency,
    transactionDebitAmount: normalized.transactionDebitAmount,
    transactionCreditAmount: normalized.transactionCreditAmount,
    baseDebitAmount: normalized.baseDebitAmount,
    baseCreditAmount: normalized.baseCreditAmount,
    historicalExchangeRate: normalized.historicalExchangeRate,
    rateConvention: normalized.rateConvention,
    narration: input.narration,
  };
}

function adjustBaseSideToTarget(
  entries: VoucherEntryInsertFields[],
  side: "debit" | "credit",
  target: Decimal
): void {
  const amountField = side === "debit" ? "debitAmount" : "creditAmount";
  const baseField = side === "debit" ? "baseDebitAmount" : "baseCreditAmount";
  const current = entries.reduce(
    (sum, entry) => sum.plus(new Decimal(entry[amountField] ?? "0")),
    new Decimal(0)
  );
  const adjustment = target.minus(current);
  if (adjustment.isZero()) return;
  if (adjustment.abs().gt(MAX_ROUNDING_ADJUSTMENT)) {
    throw new PostingValidationError(
      "POSTING_CURRENCY_ROUNDING_INVALID",
      `Payment/Receipt ${side} conversion differs from the aggregate total by ${adjustment.toFixed(6)}`
    );
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const currentAmount = new Decimal(entry[amountField] ?? "0");
    if (currentAmount.lte(0)) continue;
    const adjusted = currentAmount.plus(adjustment);
    if (adjusted.lte(0)) {
      throw new PostingValidationError(
        "POSTING_CURRENCY_ROUNDING_INVALID",
        `Payment/Receipt ${side} rounding would make an entry non-positive`
      );
    }
    const value = adjusted.toDecimalPlaces(6).toFixed(6);
    entry[amountField] = value;
    entry[baseField] = value;
    return;
  }

  throw new PostingValidationError(
    "POSTING_CURRENCY_ROUNDING_INVALID",
    `Payment/Receipt has no ${side} entry available for rounding adjustment`
  );
}

function fingerprint(input: {
  companyId: number;
  voucherType: PaymentReceiptVoucherType;
  voucherDate: string;
  notes: string | null;
  currency: string;
  exchangeRate: string | null;
  effectiveDate: string | null;
  entries: VoucherEntryInsertFields[];
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      companyId: input.companyId,
      voucherType: input.voucherType,
      voucherDate: input.voucherDate,
      notes: input.notes,
      currency: input.currency,
      exchangeRate: input.exchangeRate,
      effectiveDate: input.effectiveDate,
      entries: input.entries.map((entry) => ({
        ledgerAccountId: entry.ledgerAccountId ?? null,
        bankAccountId: entry.bankAccountId ?? null,
        fixedAssetId: entry.fixedAssetId ?? null,
        supplierId: entry.supplierId ?? null,
        employeeId: entry.employeeId ?? null,
        customerId: entry.customerId ?? null,
        factorySupplierId: entry.factorySupplierId ?? null,
        transactionDebitAmount: entry.transactionDebitAmount ?? null,
        transactionCreditAmount: entry.transactionCreditAmount ?? null,
        baseDebitAmount: entry.baseDebitAmount ?? null,
        baseCreditAmount: entry.baseCreditAmount ?? null,
        narration: entry.narration ?? null,
      })),
    }))
    .digest("hex");
}

export async function buildPaymentReceiptPostingRequest(
  input: BuildPaymentReceiptPostingInput
): Promise<BuiltPaymentReceiptPosting> {
  if (!Number.isInteger(input.companyId) || input.companyId <= 0) {
    throw new PostingValidationError("POSTING_COMPANY_INVALID", "A valid companyId is required");
  }
  if (input.voucherType !== "Payment" && input.voucherType !== "Receipt") {
    throw new PostingValidationError(
      "POSTING_VOUCHER_TYPE_INVALID",
      "voucherType must be Payment or Receipt"
    );
  }
  if (!input.voucherDate || !Array.isArray(input.entries) || input.entries.length === 0) {
    throw new PostingValidationError(
      "POSTING_ENTRIES_REQUIRED",
      "A Payment/Receipt requires a date and at least one line"
    );
  }

  const voucherType = input.voucherType;
  const paymentAccountId = positiveId(input.paymentAccountId, "paymentAccountId");
  const paymentTarget = await input.resolveTarget(input.paymentAccountType, paymentAccountId);
  const currency = String(input.currency || "USD").trim().toUpperCase();
  const notes = input.notes?.trim() || null;
  const effectiveDate = input.effectiveDate || null;
  const normalizedEntries: VoucherEntryInsertFields[] = [];
  let transactionTotal = new Decimal(0);

  const liabilityPaymentAccount =
    input.paymentAccountType === "supplier" ||
    input.paymentAccountType === "factorySupplier" ||
    input.paymentAccountType === "employee";

  for (let index = 0; index < input.entries.length; index += 1) {
    const line = input.entries[index];
    const amount = positiveAmount(line.amount, index);
    transactionTotal = transactionTotal.plus(amount);
    const contraTarget = await input.resolveTarget(
      line.accountType,
      positiveId(line.accountId, `entries[${index}].accountId`)
    );

    const drTarget = voucherType === "Payment"
      ? liabilityPaymentAccount ? paymentTarget : contraTarget
      : liabilityPaymentAccount ? contraTarget : paymentTarget;
    const crTarget = voucherType === "Payment"
      ? liabilityPaymentAccount ? contraTarget : paymentTarget
      : liabilityPaymentAccount ? paymentTarget : contraTarget;

    normalizedEntries.push(
      normalizeLeg({
        currency,
        exchangeRate: input.exchangeRate,
        amount,
        side: "DR",
        target: drTarget,
        narration: notes,
      }),
      normalizeLeg({
        currency,
        exchangeRate: input.exchangeRate,
        amount,
        side: "CR",
        target: crTarget,
        narration: notes,
      })
    );
  }

  let aggregate;
  try {
    aggregate = normalizeVoucherEntryAmounts({
      transactionCurrency: currency,
      baseCurrency: "USD",
      transactionDebitAmount: transactionTotal.toFixed(),
      transactionCreditAmount: "0",
      historicalRate: input.exchangeRate ?? null,
    });
  } catch (error: unknown) {
    throw new PostingValidationError(
      "POSTING_CURRENCY_INVALID",
      error instanceof Error ? error.message : "Payment/Receipt total normalization failed"
    );
  }

  const baseTotal = new Decimal(aggregate.baseDebitAmount);
  adjustBaseSideToTarget(normalizedEntries, "debit", baseTotal);
  adjustBaseSideToTarget(normalizedEntries, "credit", baseTotal);

  const clientRequestId = resolveManualJournalClientRequestId(input.clientRequestId);
  const voucherExchangeRate =
    input.exchangeRate === null || input.exchangeRate === undefined || input.exchangeRate === ""
      ? null
      : String(input.exchangeRate);
  const payloadFingerprint = fingerprint({
    companyId: input.companyId,
    voucherType,
    voucherDate: input.voucherDate,
    notes,
    currency: aggregate.transactionCurrency,
    exchangeRate: voucherExchangeRate,
    effectiveDate,
    entries: normalizedEntries,
  });

  return {
    clientRequestId,
    transactionTotal: transactionTotal.toFixed(),
    request: {
      voucher: {
        companyId: input.companyId,
        voucherNumber: input.voucherNumber,
        voucherType,
        voucherDate: input.voucherDate,
        description: notes,
        totalAmount: baseTotal.toFixed(6),
        optional: false,
        currency: aggregate.transactionCurrency,
        exchangeRate: voucherExchangeRate,
        effectiveDate,
      },
      entries: normalizedEntries,
      source: {
        sourceType: "payment-receipt",
        sourceId: clientRequestId,
        idempotencyKey: `payment-receipt:${clientRequestId}:${payloadFingerprint.slice(0, 32)}`,
      },
      actor: input.actor,
    },
  };
}
