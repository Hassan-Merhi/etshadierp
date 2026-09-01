/**
 * Shared state and helpers for the factoryContainersRoutes routes.
 *
 * Extracted verbatim from the former single-file factoryContainersRoutes.ts.
 */
import Decimal from "decimal.js";
import { normalizeVoucherEntryAmounts } from "../../../services/accounting/currencyAmounts";

/**
 * Normalize a factory voucher entry.
 * Factory stores fxRateToUsd in BASE_PER_TRANSACTION convention (USD per foreign unit).
 * ERP voucher entries need TRANSACTION_PER_BASE (foreign per USD), so we invert the rate.
 */
export function normFactoryEntry(
  transactionCurrency: string | null | undefined,
  debit: string | number,
  credit: string | number,
  fxRateToUsdFactory: number | string | null | undefined
) {
  const ccy = transactionCurrency || "USD";
  let historicalRate = "1";
  if (ccy !== "USD" && fxRateToUsdFactory != null) {
    const factoryRate = parseFloat(String(fxRateToUsdFactory));
    if (factoryRate > 0) {
      historicalRate = new Decimal(1).div(factoryRate).toDecimalPlaces(10).toFixed(10);
    }
  }
  const norm = normalizeVoucherEntryAmounts({
    transactionCurrency: ccy,
    baseCurrency: "USD",
    transactionDebitAmount: String(debit),
    transactionCreditAmount: String(credit),
    historicalRate,
  });
  return {
    transactionCurrency: norm.transactionCurrency,
    transactionDebitAmount: norm.transactionDebitAmount,
    transactionCreditAmount: norm.transactionCreditAmount,
    baseDebitAmount: norm.baseDebitAmount,
    baseCreditAmount: norm.baseCreditAmount,
    historicalExchangeRate: norm.historicalExchangeRate,
    rateConvention: norm.rateConvention,
    debitAmount: norm.debitAmount,
    creditAmount: norm.creditAmount,
  };
}
