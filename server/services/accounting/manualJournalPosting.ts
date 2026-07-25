import { createHash, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { VoucherEntryInsertFields } from "./accountingTypes";
import {
  PostingValidationError,
  type CentralPostingRequest,
  type PostingActor,
} from "./centralPostingEngine";
import { normalizeVoucherEntryAmounts } from "./currencyAmounts";

const ACCOUNT_TARGET_BY_TYPE = {
  ledger: "ledgerAccountId",
  bank: "bankAccountId",
  supplier: "supplierId",
  factorySupplier: "factorySupplierId",
  employee: "employeeId",
  fixedAsset: "fixedAssetId",
  customer: "customerId",
} as const;

type ManualJournalAccountType = keyof typeof ACCOUNT_TARGET_BY_TYPE;
type ManualJournalSide = "DR" | "CR";

export interface ManualJournalEntryInput {
  type: ManualJournalSide;
  accountType: ManualJournalAccountType | string;
  accountId: number | string;
  amount: string | number;
  narration?: string | null;
}

export interface BuildManualJournalPostingInput {
  companyId: number;
  voucherNumber: string;
  voucherDate: string;
  entries: ManualJournalEntryInput[];
  notes?: string | null;
  currency?: string | null;
  exchangeRate?: string | number | null;
  effectiveDate?: string | null;
  clientRequestId?: unknown;
  actor?: PostingActor;
}

export interface BuiltManualJournalPosting {
  request: CentralPostingRequest;
  clientRequestId: string;
  transactionDebitTotal: string;
  transactionCreditTotal: string;
}

const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_ROUNDING_ADJUSTMENT = new Decimal("0.001000");

function positiveAccountId(value: unknown): number {
  const accountId = Number(value);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new PostingValidationError(
      "POSTING_TARGET_ID_INVALID",
      "Journal accountId must be a positive integer"
    );
  }
  return accountId;
}

function positiveAmount(value: unknown, index: number): Decimal {
  let amount: Decimal;
  try {
    amount = new Decimal(String(value ?? ""));
  } catch {
    throw new PostingValidationError(
      "POSTING_AMOUNT_INVALID",
      `Journal entry ${index + 1} has an invalid amount`
    );
  }

  if (!amount.isFinite() || amount.lte(0)) {
    throw new PostingValidationError(
      "POSTING_AMOUNT_INVALID",
      `Journal entry ${index + 1} amount must be positive`
    );
  }
  return amount;
}

export function resolveManualJournalClientRequestId(value: unknown): string {
  const supplied = typeof value === "string" ? value.trim() : "";
  if (!supplied) return `server-${randomUUID()}`;

  if (supplied.length > MAX_REQUEST_ID_LENGTH || !REQUEST_ID_PATTERN.test(supplied)) {
    throw new PostingValidationError(
      "POSTING_REQUEST_ID_INVALID",
      "clientRequestId must contain only letters, numbers, period, underscore, colon, or hyphen"
    );
  }
  return supplied;
}

function accountTarget(accountType: string, accountId: number): VoucherEntryInsertFields {
  const targetField = ACCOUNT_TARGET_BY_TYPE[accountType as ManualJournalAccountType];
  if (!targetField) {
    throw new PostingValidationError(
      "POSTING_TARGET_INVALID",
      `Unsupported journal account type: ${accountType}`
    );
  }
  return { [targetField]: accountId } as VoucherEntryInsertFields;
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
      `Journal ${side} conversion differs from the aggregate total by ${adjustment.toFixed(6)}`
    );
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const currentEntryAmount = new Decimal(entry[amountField] ?? "0");
    if (currentEntryAmount.lte(0)) continue;

    const adjusted = currentEntryAmount.plus(adjustment);
    if (adjusted.lte(0)) {
      throw new PostingValidationError(
        "POSTING_CURRENCY_ROUNDING_INVALID",
        `Journal ${side} rounding adjustment would make an entry non-positive`
      );
    }

    const value = adjusted.toDecimalPlaces(6).toFixed(6);
    entry[amountField] = value;
    entry[baseField] = value;
    return;
  }

  throw new PostingValidationError(
    "POSTING_CURRENCY_ROUNDING_INVALID",
    `Journal has no ${side} entry available for rounding adjustment`
  );
}

function postingFingerprint(input: {
  companyId: number;
  voucherDate: string;
  notes: string | null;
  currency: string;
  exchangeRate: string | null;
  effectiveDate: string | null;
  entries: VoucherEntryInsertFields[];
}): string {
  const canonicalEntries = input.entries.map((entry) => ({
    ledgerAccountId: entry.ledgerAccountId ?? null,
    bankAccountId: entry.bankAccountId ?? null,
    fixedAssetId: entry.fixedAssetId ?? null,
    supplierId: entry.supplierId ?? null,
    employeeId: entry.employeeId ?? null,
    customerId: entry.customerId ?? null,
    factorySupplierId: entry.factorySupplierId ?? null,
    transactionCurrency: entry.transactionCurrency ?? null,
    transactionDebitAmount: entry.transactionDebitAmount ?? null,
    transactionCreditAmount: entry.transactionCreditAmount ?? null,
    baseDebitAmount: entry.baseDebitAmount ?? null,
    baseCreditAmount: entry.baseCreditAmount ?? null,
    narration: entry.narration ?? null,
  }));

  return createHash("sha256")
    .update(
      JSON.stringify({
        companyId: input.companyId,
        voucherDate: input.voucherDate,
        notes: input.notes,
        currency: input.currency,
        exchangeRate: input.exchangeRate,
        effectiveDate: input.effectiveDate,
        entries: canonicalEntries,
      })
    )
    .digest("hex");
}

export function buildManualJournalPostingRequest(
  input: BuildManualJournalPostingInput
): BuiltManualJournalPosting {
  if (!Number.isInteger(input.companyId) || input.companyId <= 0) {
    throw new PostingValidationError("POSTING_COMPANY_INVALID", "A valid companyId is required");
  }
  if (!input.voucherDate || !Array.isArray(input.entries) || input.entries.length < 2) {
    throw new PostingValidationError(
      "POSTING_ENTRIES_REQUIRED",
      "A manual journal requires a date and at least two entries"
    );
  }

  let transactionDebitTotal = new Decimal(0);
  let transactionCreditTotal = new Decimal(0);
  const normalizedEntries: VoucherEntryInsertFields[] = input.entries.map((entry, index) => {
    if (entry.type !== "DR" && entry.type !== "CR") {
      throw new PostingValidationError(
        "POSTING_ENTRY_SIDE_INVALID",
        `Journal entry ${index + 1} must be DR or CR`
      );
    }

    const amount = positiveAmount(entry.amount, index);
    if (entry.type === "DR") transactionDebitTotal = transactionDebitTotal.plus(amount);
    else transactionCreditTotal = transactionCreditTotal.plus(amount);

    let normalized;
    try {
      normalized = normalizeVoucherEntryAmounts({
        transactionCurrency: input.currency || "USD",
        baseCurrency: "USD",
        transactionDebitAmount: entry.type === "DR" ? amount.toFixed() : "0",
        transactionCreditAmount: entry.type === "CR" ? amount.toFixed() : "0",
        historicalRate: input.exchangeRate ?? null,
      });
    } catch (error: unknown) {
      throw new PostingValidationError(
        "POSTING_CURRENCY_INVALID",
        error instanceof Error ? error.message : "Journal currency normalization failed"
      );
    }

    return {
      ...accountTarget(String(entry.accountType), positiveAccountId(entry.accountId)),
      debitAmount: normalized.debitAmount,
      creditAmount: normalized.creditAmount,
      transactionCurrency: normalized.transactionCurrency,
      transactionDebitAmount: normalized.transactionDebitAmount,
      transactionCreditAmount: normalized.transactionCreditAmount,
      baseDebitAmount: normalized.baseDebitAmount,
      baseCreditAmount: normalized.baseCreditAmount,
      historicalExchangeRate: normalized.historicalExchangeRate,
      rateConvention: normalized.rateConvention,
      narration: entry.narration?.trim() || null,
    };
  });

  if (!transactionDebitTotal.equals(transactionCreditTotal)) {
    throw new PostingValidationError(
      "POSTING_UNBALANCED",
      `Journal is not balanced: debit=${transactionDebitTotal.toFixed()} credit=${transactionCreditTotal.toFixed()}`
    );
  }

  let aggregate;
  try {
    aggregate = normalizeVoucherEntryAmounts({
      transactionCurrency: input.currency || "USD",
      baseCurrency: "USD",
      transactionDebitAmount: transactionDebitTotal.toFixed(),
      transactionCreditAmount: "0",
      historicalRate: input.exchangeRate ?? null,
    });
  } catch (error: unknown) {
    throw new PostingValidationError(
      "POSTING_CURRENCY_INVALID",
      error instanceof Error ? error.message : "Journal total currency normalization failed"
    );
  }

  const baseTotal = new Decimal(aggregate.baseDebitAmount);
  adjustBaseSideToTarget(normalizedEntries, "debit", baseTotal);
  adjustBaseSideToTarget(normalizedEntries, "credit", baseTotal);

  const clientRequestId = resolveManualJournalClientRequestId(input.clientRequestId);
  const currency = aggregate.transactionCurrency;
  const normalizedExchangeRate = aggregate.historicalExchangeRate;
  const suppliedRate = input.exchangeRate;
  const voucherExchangeRate =
    suppliedRate === null || suppliedRate === undefined || suppliedRate === ""
      ? currency === "USD"
        ? null
        : normalizedExchangeRate
      : String(suppliedRate);
  const notes = input.notes?.trim() || null;
  const effectiveDate = input.effectiveDate || null;
  const fingerprint = postingFingerprint({
    companyId: input.companyId,
    voucherDate: input.voucherDate,
    notes,
    currency,
    exchangeRate: normalizedExchangeRate,
    effectiveDate,
    entries: normalizedEntries,
  });

  return {
    clientRequestId,
    transactionDebitTotal: transactionDebitTotal.toFixed(),
    transactionCreditTotal: transactionCreditTotal.toFixed(),
    request: {
      voucher: {
        companyId: input.companyId,
        voucherNumber: input.voucherNumber,
        voucherType: "Journal",
        voucherDate: input.voucherDate,
        description: notes,
        totalAmount: baseTotal.toFixed(6),
        optional: false,
        currency,
        exchangeRate: voucherExchangeRate,
        effectiveDate,
      },
      entries: normalizedEntries,
      source: {
        sourceType: "manual-journal",
        sourceId: clientRequestId,
        idempotencyKey: `manual-journal:${clientRequestId}:${fingerprint.slice(0, 32)}`,
      },
      actor: input.actor,
    },
  };
}
