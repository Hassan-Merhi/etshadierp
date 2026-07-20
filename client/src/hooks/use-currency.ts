import { useCurrencyContext, Currency } from "@/contexts/CurrencyContext";

interface CurrencyInfo {
  selectedCurrency: Currency;
  setCurrency: (currency: Currency) => void;
  toggleCurrency: () => void;
  exchangeRate: number | null;
  isMultiCurrency: boolean;
  formatAmount: (amount: number | string, currency?: Currency) => string;
  formatWithCurrency: (amount: number | string | null | undefined, currency: Currency) => string;
  /** Format an amount already in a specific transaction currency — no conversion. */
  formatTransactionAmount: (amount: number | string | null | undefined, currency: string) => string;
  /** Format a historical base (USD) amount — always shown in USD, never re-translated. */
  formatHistoricalBaseAmount: (amount: number | string | null | undefined) => string;
  /** Translate a native-currency cash/bank balance to the selected currency at the current rate (display-only). */
  formatCurrentCashTranslation: (nativeAmount: number | string | null | undefined, nativeCurrency: string) => string;
  /** Preview a new transaction entry in both currencies using the current rate. */
  formatNewTransactionPreview: (amount: number | string | null | undefined) => string;
  convertToDisplay: (usdAmount: number) => number;
  convertToUSD: (displayAmount: number) => number;
}

export function useCurrency(): CurrencyInfo {
  const {
    selectedCurrency,
    setCurrency,
    toggleCurrency,
    exchangeRate,
    isMultiCurrency,
    formatAmount,
    formatTransactionAmount,
    formatHistoricalBaseAmount,
    formatCurrentCashTranslation,
    formatNewTransactionPreview,
    convertToDisplay,
    convertToUSD,
  } = useCurrencyContext();

  const formatWithCurrency = (amount: number | string | null | undefined, currency: Currency): string => {
    if (amount == null) return "";
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return "";

    if (currency === "USD") {
      const isWhole = Math.abs(numAmount) % 1 === 0;
      return `$ ${numAmount.toLocaleString(undefined, { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: 2 })}`;
    } else {
      return `CFA ${numAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
  };

  return {
    selectedCurrency,
    setCurrency,
    toggleCurrency,
    exchangeRate,
    isMultiCurrency,
    formatAmount,
    formatWithCurrency,
    formatTransactionAmount,
    formatHistoricalBaseAmount,
    formatCurrentCashTranslation,
    formatNewTransactionPreview,
    convertToDisplay,
    convertToUSD,
  };
}

export type { Currency };
