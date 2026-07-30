import Decimal from "decimal.js";
import { normalizeCurrencyCode } from "./currencyAmounts";

export type HistoricalRepairClassification =
  | "auto-identity"
  | "auto-from-transaction"
  | "auto-from-base"
  | "auto-opening-metadata"
  | "manual-storage-mode"
  | "manual-currency"
  | "manual-rate"
  | "manual-partial-metadata";

export type StoredAmountMode = "transaction" | "base";

export interface HistoricalRepairRecommendation {
  classification: HistoricalRepairClassification;
  autoRepairable: boolean;
  reason: string;
  suggestedCurrency: string | null;
  suggestedHistoricalRate: string | null;
  suggestedStorageMode: StoredAmountMode | null;
  suggestedTransactionDebitAmount: string | null;
  suggestedTransactionCreditAmount: string | null;
  suggestedNativeAmount: string | null;
  suggestedBaseAmount: string | null;
}

export interface VoucherRepairEvidence {
  voucherCurrency: string | null;
  voucherExchangeRate: string | null;
  historicalExchangeRate: string | null;
  debitAmount: string | null;
  creditAmount: string | null;
  transactionDebitAmount: string | null;
  transactionCreditAmount: string | null;
  baseDebitAmount: string | null;
  baseCreditAmount: string | null;
  baseCurrency: string;
}

export interface OpeningRepairEvidence {
  currency: string | null;
  historicalRate: string | null;
  rawAmount: string | null;
  nativeAmount: string | null;
  baseAmount: string | null;
  baseCurrency: string;
}

function decimalString(value: string | null | undefined, places = 6): string | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed.toDecimalPlaces(places).toFixed(places) : null;
  } catch {
    return null;
  }
}

function positiveRate(value: string | null | undefined): string | null {
  const normalized = decimalString(value, 10);
  if (!normalized) return null;
  return new Decimal(normalized).gt(0) ? normalized : null;
}

function currency(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeCurrencyCode(value);
  } catch {
    return value.trim().toUpperCase() || null;
  }
}

function baseRecommendation(
  classification: HistoricalRepairClassification,
  autoRepairable: boolean,
  reason: string,
): HistoricalRepairRecommendation {
  return {
    classification,
    autoRepairable,
    reason,
    suggestedCurrency: null,
    suggestedHistoricalRate: null,
    suggestedStorageMode: null,
    suggestedTransactionDebitAmount: null,
    suggestedTransactionCreditAmount: null,
    suggestedNativeAmount: null,
    suggestedBaseAmount: null,
  };
}

export function recommendVoucherRepair(evidence: VoucherRepairEvidence): HistoricalRepairRecommendation {
  const transactionCurrency = currency(evidence.voucherCurrency);
  const baseCurrency = currency(evidence.baseCurrency) || "USD";
  const storedRate = positiveRate(evidence.historicalExchangeRate) || positiveRate(evidence.voucherExchangeRate);
  const txDebit = decimalString(evidence.transactionDebitAmount);
  const txCredit = decimalString(evidence.transactionCreditAmount);
  const baseDebit = decimalString(evidence.baseDebitAmount);
  const baseCredit = decimalString(evidence.baseCreditAmount);
  const legacyDebit = decimalString(evidence.debitAmount) || "0.000000";
  const legacyCredit = decimalString(evidence.creditAmount) || "0.000000";
  const hasCompleteTransaction = txDebit !== null && txCredit !== null;
  const hasCompleteBase = baseDebit !== null && baseCredit !== null;
  const hasPartialTransaction = (txDebit !== null) !== (txCredit !== null);
  const hasPartialBase = (baseDebit !== null) !== (baseCredit !== null);

  if (!transactionCurrency) {
    return baseRecommendation("manual-currency", false, "The voucher currency is missing; an operator must confirm the original currency.");
  }

  if (transactionCurrency === baseCurrency) {
    const recommendation = baseRecommendation("auto-identity", true, "The transaction currency equals the company base currency.");
    recommendation.suggestedCurrency = transactionCurrency;
    recommendation.suggestedHistoricalRate = "1.0000000000";
    recommendation.suggestedStorageMode = "transaction";
    recommendation.suggestedTransactionDebitAmount = txDebit ?? baseDebit ?? legacyDebit;
    recommendation.suggestedTransactionCreditAmount = txCredit ?? baseCredit ?? legacyCredit;
    return recommendation;
  }

  if (!storedRate) {
    const recommendation = baseRecommendation(
      "manual-rate",
      false,
      "No valid positive historical rate is stored on the entry or voucher.",
    );
    recommendation.suggestedCurrency = transactionCurrency;
    return recommendation;
  }

  if (hasPartialTransaction || hasPartialBase) {
    const recommendation = baseRecommendation(
      "manual-partial-metadata",
      false,
      "Only part of the dual-currency metadata is populated; review the original document before repairing.",
    );
    recommendation.suggestedCurrency = transactionCurrency;
    recommendation.suggestedHistoricalRate = storedRate;
    return recommendation;
  }

  if (hasCompleteTransaction) {
    const recommendation = baseRecommendation(
      "auto-from-transaction",
      true,
      hasCompleteBase
        ? "Transaction and base amounts are present; the locked transaction values can restore missing rate/convention metadata."
        : "The original transaction-currency debit and credit are already stored; the historical base amounts can be derived safely.",
    );
    recommendation.suggestedCurrency = transactionCurrency;
    recommendation.suggestedHistoricalRate = storedRate;
    recommendation.suggestedStorageMode = "transaction";
    recommendation.suggestedTransactionDebitAmount = txDebit;
    recommendation.suggestedTransactionCreditAmount = txCredit;
    return recommendation;
  }

  if (hasCompleteBase) {
    const rate = new Decimal(storedRate);
    const recommendation = baseRecommendation(
      "auto-from-base",
      true,
      "The historical base debit and credit are already stored; the original transaction amounts can be reconstructed with the locked historical rate.",
    );
    recommendation.suggestedCurrency = transactionCurrency;
    recommendation.suggestedHistoricalRate = storedRate;
    recommendation.suggestedStorageMode = "base";
    recommendation.suggestedTransactionDebitAmount = new Decimal(baseDebit || 0).times(rate).toDecimalPlaces(6).toFixed(6);
    recommendation.suggestedTransactionCreditAmount = new Decimal(baseCredit || 0).times(rate).toDecimalPlaces(6).toFixed(6);
    return recommendation;
  }

  const recommendation = baseRecommendation(
    "manual-storage-mode",
    false,
    "The legacy debit and credit columns have no trustworthy denomination marker. Confirm whether they store transaction currency or historical base currency.",
  );
  recommendation.suggestedCurrency = transactionCurrency;
  recommendation.suggestedHistoricalRate = storedRate;
  recommendation.suggestedTransactionDebitAmount = legacyDebit;
  recommendation.suggestedTransactionCreditAmount = legacyCredit;
  return recommendation;
}

export function recommendOpeningRepair(evidence: OpeningRepairEvidence): HistoricalRepairRecommendation {
  const openingCurrency = currency(evidence.currency);
  const baseCurrency = currency(evidence.baseCurrency) || "USD";
  const rawAmount = decimalString(evidence.rawAmount);
  const nativeAmount = decimalString(evidence.nativeAmount);
  const existingBase = decimalString(evidence.baseAmount);

  if (!openingCurrency) {
    const recommendation = baseRecommendation(
      "manual-currency",
      false,
      "The original opening or acquisition currency is missing.",
    );
    recommendation.suggestedNativeAmount = nativeAmount ?? rawAmount;
    recommendation.suggestedBaseAmount = existingBase;
    return recommendation;
  }

  if (openingCurrency === baseCurrency) {
    const recommendation = baseRecommendation(
      "auto-opening-metadata",
      true,
      "The opening or acquisition currency equals the company base currency.",
    );
    recommendation.suggestedCurrency = openingCurrency;
    recommendation.suggestedHistoricalRate = "1.0000000000";
    recommendation.suggestedNativeAmount = nativeAmount ?? existingBase ?? rawAmount;
    recommendation.suggestedBaseAmount = existingBase ?? nativeAmount ?? rawAmount;
    return recommendation;
  }

  const storedRate = positiveRate(evidence.historicalRate);
  if (!storedRate) {
    const recommendation = baseRecommendation(
      "manual-rate",
      false,
      "The original currency is known but its historical rate is missing or invalid.",
    );
    recommendation.suggestedCurrency = openingCurrency;
    recommendation.suggestedNativeAmount = nativeAmount ?? rawAmount;
    recommendation.suggestedBaseAmount = existingBase;
    return recommendation;
  }

  if (nativeAmount !== null) {
    const recommendation = baseRecommendation(
      "auto-opening-metadata",
      true,
      "The original native amount, currency, and locked historical rate are present; the missing historical base metadata can be rebuilt safely.",
    );
    recommendation.suggestedCurrency = openingCurrency;
    recommendation.suggestedHistoricalRate = storedRate;
    recommendation.suggestedNativeAmount = nativeAmount;
    recommendation.suggestedBaseAmount = existingBase;
    return recommendation;
  }

  if (existingBase !== null) {
    const recommendation = baseRecommendation(
      "auto-opening-metadata",
      true,
      "The historical base amount, currency, and locked rate are present; the original native amount can be reconstructed safely.",
    );
    recommendation.suggestedCurrency = openingCurrency;
    recommendation.suggestedHistoricalRate = storedRate;
    recommendation.suggestedNativeAmount = new Decimal(existingBase).times(storedRate).toDecimalPlaces(6).toFixed(6);
    recommendation.suggestedBaseAmount = existingBase;
    return recommendation;
  }

  const recommendation = baseRecommendation(
    "manual-storage-mode",
    false,
    "The currency and rate are known, but the legacy amount column does not prove whether it stores native or base currency.",
  );
  recommendation.suggestedCurrency = openingCurrency;
  recommendation.suggestedHistoricalRate = storedRate;
  recommendation.suggestedNativeAmount = rawAmount;
  return recommendation;
}
