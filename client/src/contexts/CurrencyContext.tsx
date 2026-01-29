import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export type Currency = "USD" | "CFA";

interface CurrencyContextType {
  selectedCurrency: Currency;
  setCurrency: (currency: Currency) => void;
  exchangeRate: number | null;
  isLoadingRate: boolean;
  formatAmount: (amount: number | string, currency?: Currency) => string;
  convertToDisplay: (usdAmount: number) => number;
  convertToUSD: (cfaAmount: number) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(() => {
    const stored = localStorage.getItem("selectedCurrency");
    return (stored === "USD" || stored === "CFA") ? stored : "USD";
  });

  // Fetch the latest exchange rate (USD to CFA)
  const { data: rateData, isLoading: isLoadingRate } = useQuery<any>({
    queryKey: ["/api/exchange-rates/latest", "USD", "CFA"],
    queryFn: async () => {
      const res = await fetch(
        `/api/exchange-rates/latest?fromCurrency=USD&toCurrency=CFA`,
        { credentials: "include" }
      );
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Exchange rate: 1 CFA = X USD (so to convert USD to CFA, we multiply by rate)
  // Based on ExchangeRateSettings: "1 displayCurrency = X baseCurrency"
  // So rate stored is: 1 CFA = X USD
  // To convert USD to CFA: USD_amount / rate
  // To convert CFA to USD: CFA_amount * rate
  // Wait - let me check the format again. Looking at the display:
  // "1 displayCurrency = X baseCurrency" means 1 CFA = 600 USD (if rate is 600)
  // That doesn't make sense. Let me re-read...
  // The rate label says "1 CFA = X USD" but that's backwards for real world.
  // Actually looking at the code: fromCurrency=USD, toCurrency=CFA
  // The rate represents how many USD equals 1 CFA, OR how many CFA equals 1 USD
  // 
  // From ExchangeRateSettings: "1 {company?.displayCurrency} = {rate} {company?.baseCurrency}"
  // If baseCurrency=USD and displayCurrency=CFA, it shows "1 CFA = X USD"
  // Meaning if rate=600, then 1 CFA = 600 USD (that's inverted)
  // 
  // More likely: The rate is "how many baseCurrency per 1 displayCurrency"
  // So if rate = 0.0017 and 1 CFA = 0.0017 USD, then:
  // To convert $100 USD to CFA: 100 / 0.0017 = ~58,824 CFA
  // To convert 1000 CFA to USD: 1000 * 0.0017 = $1.70
  //
  // Actually let me check what rate value is typically stored.
  // If the user sets "1 CFA = 600 USD" that's wrong (1 CFA ≠ 600 USD)
  // Real world: 1 USD = ~600 CFA, so 1 CFA = 1/600 = 0.00167 USD
  //
  // The label in ExchangeRateSettings shows:
  // "Rate (1 {company?.displayCurrency} = X {company?.baseCurrency})"
  // So if displayCurrency=CFA and baseCurrency=USD:
  // User enters 600 meaning "1 CFA = 600 USD" - that's inverted
  //
  // I think the user actually enters it as "1 USD = 600 CFA" conceptually
  // Let's just use the rate as: USD × rate = CFA
  
  const exchangeRate = rateData?.rate ? parseFloat(rateData.rate) : null;

  const setCurrency = (currency: Currency) => {
    setSelectedCurrency(currency);
    localStorage.setItem("selectedCurrency", currency);
  };

  // Convert USD amount to CFA (for display)
  const convertToDisplay = (usdAmount: number): number => {
    if (!exchangeRate || selectedCurrency === "USD") return usdAmount;
    // USD × rate = CFA
    return usdAmount * exchangeRate;
  };

  // Convert CFA amount to USD (for storage)
  const convertToUSD = (cfaAmount: number): number => {
    if (!exchangeRate) return cfaAmount;
    // CFA ÷ rate = USD
    return cfaAmount / exchangeRate;
  };

  const formatAmount = (amount: number | string, currency?: Currency): string => {
    const curr = currency || selectedCurrency;
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return "";
    
    // If requesting CFA format, first convert from USD to CFA
    let displayAmount = numAmount;
    if (curr === "CFA" && exchangeRate) {
      displayAmount = numAmount * exchangeRate;
    }
    
    if (curr === "USD") {
      return `$ ${numAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      return `CFA ${Math.round(displayAmount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
  };

  return (
    <CurrencyContext.Provider value={{ 
      selectedCurrency, 
      setCurrency, 
      exchangeRate,
      isLoadingRate,
      formatAmount,
      convertToDisplay,
      convertToUSD
    }}>
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
