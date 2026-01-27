import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";

interface CurrencyInfo {
  baseCurrency: string | null;
  displayCurrency: string | null;
  currentRate: number | null;
  isMultiCurrency: boolean;
  convertToDisplay: (amount: number | string, rateOverride?: number | string | null) => number | null;
  formatDualCurrency: (amount: number | string, rateOverride?: number | string | null) => string;
}

export function useCurrency(): CurrencyInfo {
  const { selectedCompany } = useCompany();

  const { data: company } = useQuery<any>({
    queryKey: ["/api/companies", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const { data: latestRate } = useQuery<any>({
    queryKey: ["/api/exchange-rates/latest", company?.baseCurrency, company?.displayCurrency],
    queryFn: async () => {
      if (!company?.baseCurrency || !company?.displayCurrency) return null;
      const res = await fetch(
        `/api/exchange-rates/latest?fromCurrency=${company.baseCurrency}&toCurrency=${company.displayCurrency}`,
        { credentials: "include" }
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!company?.baseCurrency && !!company?.displayCurrency,
  });

  const baseCurrency = company?.baseCurrency || null;
  const displayCurrency = company?.displayCurrency || null;
  const currentRate = latestRate?.rate ? parseFloat(latestRate.rate) : null;
  const isMultiCurrency = !!baseCurrency && !!displayCurrency;

  const convertToDisplay = (amount: number | string, rateOverride?: number | string | null): number | null => {
    const rate = rateOverride ? parseFloat(String(rateOverride)) : currentRate;
    if (!rate || rate === 0) return null;
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return null;
    return numAmount / rate;
  };

  const formatDualCurrency = (amount: number | string, rateOverride?: number | string | null): string => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return '';
    
    const baseFormatted = `${baseCurrency || ''} ${numAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    if (!isMultiCurrency) return baseFormatted;
    
    const displayAmount = convertToDisplay(amount, rateOverride);
    if (displayAmount === null) return baseFormatted;
    
    const displayFormatted = `${displayCurrency} ${displayAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    return `${baseFormatted} (${displayFormatted})`;
  };

  return {
    baseCurrency,
    displayCurrency,
    currentRate,
    isMultiCurrency,
    convertToDisplay,
    formatDualCurrency,
  };
}
