import Decimal from "decimal.js";

export interface FactoryVoucherEntryAmounts {
  transactionCurrency: string;
  transactionDebitAmount: string;
  transactionCreditAmount: string;
  baseDebitAmount: string;
  baseCreditAmount: string;
  historicalExchangeRate: string;
  rateConvention: "IDENTITY" | "BASE_PER_TRANSACTION";
  debitAmount: string;
  creditAmount: string;
}

function decimal(value: string | number, label: string): Decimal {
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a finite number.`);
  }
}

/**
 * Normalize a factory voucher entry without changing the factory FX convention.
 *
 * Factory rates are stored as base USD per one transaction-currency unit, so a
 * foreign transaction is converted with: base USD = transaction amount × rate.
 */
export function normalizeFactoryVoucherEntryAmounts(params: {
  transactionCurrency: string;
  transactionDebitAmount: string | number;
  transactionCreditAmount: string | number;
  fxRateToUsd: string | number;
}): FactoryVoucherEntryAmounts {
  const transactionCurrency = String(params.transactionCurrency || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(transactionCurrency)) {
    throw new Error("Factory voucher transaction currency must be a three-letter code.");
  }

  const transactionDebit = decimal(params.transactionDebitAmount, "transactionDebitAmount");
  const transactionCredit = decimal(params.transactionCreditAmount, "transactionCreditAmount");
  if (transactionDebit.lt(0) || transactionCredit.lt(0)) {
    throw new Error("Factory voucher entry amounts cannot be negative.");
  }

  const debitPositive = transactionDebit.gt(0);
  const creditPositive = transactionCredit.gt(0);
  if (debitPositive === creditPositive) {
    throw new Error("A factory voucher entry must have exactly one positive debit or credit side.");
  }

  const identity = transactionCurrency === "USD";
  const fxRate = identity ? new Decimal(1) : decimal(params.fxRateToUsd, "fxRateToUsd");
  if (fxRate.lte(0)) {
    throw new Error("Factory voucher FX rate must be positive.");
  }

  const baseDebit = identity ? transactionDebit : transactionDebit.times(fxRate);
  const baseCredit = identity ? transactionCredit : transactionCredit.times(fxRate);
  const baseDebitAmount = baseDebit.toDecimalPlaces(6).toFixed(6);
  const baseCreditAmount = baseCredit.toDecimalPlaces(6).toFixed(6);

  return {
    transactionCurrency,
    transactionDebitAmount: transactionDebit.toDecimalPlaces(6).toFixed(6),
    transactionCreditAmount: transactionCredit.toDecimalPlaces(6).toFixed(6),
    baseDebitAmount,
    baseCreditAmount,
    historicalExchangeRate: fxRate.toDecimalPlaces(10).toFixed(10),
    rateConvention: identity ? "IDENTITY" : "BASE_PER_TRANSACTION",
    debitAmount: baseDebitAmount,
    creditAmount: baseCreditAmount,
  };
}
