import { useCurrencyContext, Currency } from "@/contexts/CurrencyContext";

interface CurrencyInfo {
  selectedCurrency: Currency;
  setCurrency: (currency: Currency) => void;
  formatAmount: (amount: number | string, currency?: Currency) => string;
  formatWithCurrency: (amount: number | string, currency: Currency) => string;
}

export function useCurrency(): CurrencyInfo {
  const { selectedCurrency, setCurrency, formatAmount } = useCurrencyContext();

  const formatWithCurrency = (amount: number | string, currency: Currency): string => {
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return "";
    
    if (currency === "USD") {
      return `$ ${numAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      return `CFA ${numAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
  };

  return {
    selectedCurrency,
    setCurrency,
    formatAmount,
    formatWithCurrency,
  };
}

export type { Currency };
