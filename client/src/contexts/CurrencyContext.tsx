import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type Currency = "USD" | "CFA";

interface CurrencyContextType {
  selectedCurrency: Currency;
  setCurrency: (currency: Currency) => void;
  toggleCurrency: () => void;
  exchangeRate: number | null;
  isLoadingRate: boolean;
  isLoadingCompany: boolean;
  displayCurrency: string | null;
  isMultiCurrency: boolean;
  /** Converts USD → display currency and formats with symbol */
  formatAmount: (amount: number | string, currency?: Currency) => string;
  /** Formats amount as-is in the selected currency WITHOUT conversion.
   *  Use this for values already stored in the display currency (e.g. customer balances in CFA). */
  formatAmountRaw: (amount: number | string) => string;
  /** For amounts stored in CFA: shows CFA as-is, divides by rate to show USD.
   *  e.g. CFA 5,600,000 ÷ 551 = $10,162 when in USD mode. */
  formatCashAmount: (amount: number | string) => string;
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

  // Fetch user preferences (includes preferredCurrency for logged-in users)
  const { data: userPrefs } = useQuery<any>({
    queryKey: ["/api/user-preferences"],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Mutation to save currency preference to backend
  const saveCurrencyMutation = useMutation({
    mutationFn: async (currency: Currency) => {
      await apiRequest("PUT", "/api/user-preferences", { preferredCurrency: currency });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-preferences"] });
    },
  });

  // Sync from backend preference on initial load (logged-in users)
  useEffect(() => {
    if (userPrefs?.preferredCurrency) {
      const backendCurrency = userPrefs.preferredCurrency as Currency;
      if (backendCurrency === "USD" || backendCurrency === "CFA") {
        setSelectedCurrency(backendCurrency);
        localStorage.setItem("selectedCurrency", backendCurrency);
      }
    }
  }, [userPrefs?.preferredCurrency]);

  // Fetch company details to get baseCurrency and displayCurrency
  const { data: company, isLoading: isLoadingCompanyQuery } = useQuery<any>({
    queryKey: [`/api/companies/${selectedCompany?.id}`],
    enabled: !!selectedCompany?.id,
  });

  const isLoadingCompany = !selectedCompany?.id || isLoadingCompanyQuery || !company;

  const baseCurrency = company?.baseCurrency || "USD";
  const displayCurrency = company?.displayCurrency && company.displayCurrency !== "none" ? company.displayCurrency : null;
  const isMultiCurrency = !!displayCurrency;

  // Fetch the latest exchange rate using company's currencies
  const { data: rateData, isLoading: isLoadingRate } = useQuery<any>({
    queryKey: ["/api/exchange-rates/latest", selectedCompany?.id, baseCurrency, displayCurrency],
    queryFn: async () => {
      if (!selectedCompany?.id || !displayCurrency || displayCurrency === "none") return null;
      const res = await fetch(
        `/api/exchange-rates/latest?companyId=${selectedCompany.id}&fromCurrency=${baseCurrency}&toCurrency=${displayCurrency}`,
        { credentials: "include" }
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedCompany?.id && !!displayCurrency,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const exchangeRate = rateData?.rate ? parseFloat(rateData.rate) : null;

  // Warn if multi-currency but no exchange rate
  useEffect(() => {
    if (isMultiCurrency && !isLoadingRate && !exchangeRate) {
      console.warn("[Currency] Multi-currency company but no exchange rate found. Prices will display in base currency (USD). Set exchange rate in Settings.");
    }
  }, [isMultiCurrency, isLoadingRate, exchangeRate]);

  const setCurrency = (currency: Currency) => {
    setSelectedCurrency(currency);
    localStorage.setItem("selectedCurrency", currency);
    
    // Save to backend for logged-in users (fire and forget)
    saveCurrencyMutation.mutate(currency);
  };

  const toggleCurrency = () => {
    const newCurrency = selectedCurrency === "USD" ? "CFA" : "USD";
    setCurrency(newCurrency);
  };

  const convertToDisplay = (usdAmount: number): number => {
    if (!exchangeRate || selectedCurrency === "USD") return usdAmount;
    return usdAmount * exchangeRate;
  };

  const convertToUSD = (displayAmount: number): number => {
    if (!exchangeRate) return displayAmount;
    return displayAmount / exchangeRate;
  };

  // Shows the raw number as-is with the correct currency symbol — no USD→CFA conversion.
  // Use for amounts already stored in the display currency (e.g. customer balances).
  const formatAmountRaw = (amount: number | string): string => {
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return "";
    if (selectedCurrency === "CFA") {
      return `CFA ${Math.round(numAmount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    const isWhole = Math.abs(numAmount) % 1 === 0;
    return `$ ${numAmount.toLocaleString(undefined, { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: 2 })}`;
  };

  // For cash/sales amounts stored in CFA:
  //   CFA mode  → show raw CFA (no change)
  //   USD mode  → divide CFA by exchange rate to get USD equivalent
  // e.g. CFA 5,600,000 at rate 551 → $10,162 USD
  const formatCashAmount = (amount: number | string): string => {
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return "";
    if (selectedCurrency === "USD" && exchangeRate) {
      const usdAmount = numAmount / exchangeRate;
      const isWhole = Math.abs(usdAmount) % 1 === 0;
      return `$ ${usdAmount.toLocaleString(undefined, { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: 2 })}`;
    }
    // CFA mode (or no exchange rate) — show raw CFA
    return `CFA ${Math.round(numAmount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const formatAmount = (amount: number | string, currency?: Currency): string => {
    const curr = currency || selectedCurrency;
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return "";
    
    // If requesting display currency format (CFA), first convert from USD
    let displayAmount = numAmount;
    if (curr === "CFA" && exchangeRate) {
      displayAmount = numAmount * exchangeRate;
    } else if (curr === "CFA" && !exchangeRate) {
      // No exchange rate available - show USD with warning
      console.warn("[Currency] No exchange rate available, displaying in USD");
      const isWhole = Math.abs(numAmount) % 1 === 0;
      return `$ ${numAmount.toLocaleString(undefined, { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: 2 })}`;
    }
    
    if (curr === "USD") {
      const isWhole = Math.abs(numAmount) % 1 === 0;
      return `$ ${numAmount.toLocaleString(undefined, { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: 2 })}`;
    } else {
      return `CFA ${Math.round(displayAmount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
  };

  return (
    <CurrencyContext.Provider value={{ 
      selectedCurrency, 
      setCurrency,
      toggleCurrency,
      exchangeRate,
      isLoadingRate,
      isLoadingCompany,
      displayCurrency,
      isMultiCurrency,
      formatAmount,
      formatAmountRaw,
      formatCashAmount,
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
