import { useCurrencyContext, Currency } from "@/contexts/CurrencyContext";

interface CurrencyInfo {
  selectedCurrency: Currency;
  setCurrency: (currency: Currency) => void;
  toggleCurrency: () => void;
  exchangeRate: number | null;
  isMultiCurrency: boolean;
  formatAmount: (amount: number | string, currency?: Currency) => string;
  formatWithCurrency: (amount: number | string | null | undefined, currency: Currency) => string;
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
    convertToDisplay,
    convertToUSD,
  };
}

export type { Currency };
