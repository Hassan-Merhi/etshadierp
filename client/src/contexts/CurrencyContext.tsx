import { createContext, useContext, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";

export type Currency = "USD" | "CFA";

interface CurrencyContextType {
  selectedCurrency: Currency;
  setCurrency: (currency: Currency) => void;
  exchangeRate: number | null;
  isLoadingRate: boolean;
  displayCurrency: string | null;
  formatAmount: (amount: number | string, currency?: Currency) => string;
  convertToDisplay: (usdAmount: number) => number;
  convertToUSD: (displayAmount: number) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { selectedCompany } = useCompany();
  
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(() => {
    const stored = localStorage.getItem("selectedCurrency");
    return (stored === "USD" || stored === "CFA") ? stored : "USD";
  });

  // Fetch company details to get baseCurrency and displayCurrency
  const { data: company } = useQuery<any>({
    queryKey: ["/api/companies", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const baseCurrency = company?.baseCurrency || "USD";
  const displayCurrency = company?.displayCurrency || null;

  // Fetch the latest exchange rate using company's currencies
  const { data: rateData, isLoading: isLoadingRate } = useQuery<any>({
    queryKey: ["/api/exchange-rates/latest", baseCurrency, displayCurrency],
    queryFn: async () => {
      if (!displayCurrency) return null;
      const res = await fetch(
        `/api/exchange-rates/latest?fromCurrency=${baseCurrency}&toCurrency=${displayCurrency}`,
        { credentials: "include" }
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedCompany?.id && !!displayCurrency,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Exchange rate: $1 USD = X CFA
  // User enters: 600 (meaning $1 = 600 CFA)
  // To convert USD to CFA: USD_amount × rate = CFA_amount
  // To convert CFA to USD: CFA_amount ÷ rate = USD_amount
  const exchangeRate = rateData?.rate ? parseFloat(rateData.rate) : null;

  const setCurrency = (currency: Currency) => {
    setSelectedCurrency(currency);
    localStorage.setItem("selectedCurrency", currency);
  };

  // Convert USD amount to display currency (for display)
  const convertToDisplay = (usdAmount: number): number => {
    if (!exchangeRate || selectedCurrency === "USD") return usdAmount;
    // USD × rate = display currency amount
    return usdAmount * exchangeRate;
  };

  // Convert display currency amount to USD (for storage)
  const convertToUSD = (displayAmount: number): number => {
    if (!exchangeRate) return displayAmount;
    // display amount ÷ rate = USD
    return displayAmount / exchangeRate;
  };

  const formatAmount = (amount: number | string, currency?: Currency): string => {
    const curr = currency || selectedCurrency;
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return "";
    
    // If requesting display currency format (CFA), first convert from USD
    let displayAmount = numAmount;
    if (curr === "CFA" && exchangeRate) {
      displayAmount = numAmount * exchangeRate;
    }
    
    if (curr === "USD") {
      return `$ ${numAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      // Show the display currency (CFA)
      return `CFA ${Math.round(displayAmount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
  };

  return (
    <CurrencyContext.Provider value={{ 
      selectedCurrency, 
      setCurrency, 
      exchangeRate,
      isLoadingRate,
      displayCurrency,
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
