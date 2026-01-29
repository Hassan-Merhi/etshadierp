import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type Currency = "USD" | "CDF";

interface CurrencyContextType {
  selectedCurrency: Currency;
  setCurrency: (currency: Currency) => void;
  formatAmount: (amount: number | string, currency?: Currency) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(() => {
    const stored = localStorage.getItem("selectedCurrency");
    return (stored === "USD" || stored === "CDF") ? stored : "USD";
  });

  const setCurrency = (currency: Currency) => {
    setSelectedCurrency(currency);
    localStorage.setItem("selectedCurrency", currency);
  };

  const formatAmount = (amount: number | string, currency?: Currency): string => {
    const curr = currency || selectedCurrency;
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return "";
    
    if (curr === "USD") {
      return `$ ${numAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      return `CDF ${numAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
  };

  return (
    <CurrencyContext.Provider value={{ selectedCurrency, setCurrency, formatAmount }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrencyContext() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrencyContext must be used within a CurrencyProvider");
  }
  return context;
}
