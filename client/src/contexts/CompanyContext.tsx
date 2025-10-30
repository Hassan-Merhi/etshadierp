import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

interface Company {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

interface CompanyContextType {
  selectedCompany: Company | null;
  companies: Company[];
  isLoading: boolean;
  selectCompany: (company: Company) => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  // Fetch user's companies with roles
  const { data: userCompanies = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/user/companies"],
  });

  // Extract unique companies from user's company roles
  const companies: Company[] = userCompanies
    .map((uc) => ({
      id: uc.companyId,
      code: uc.companyCode,
      name: uc.companyName,
      active: uc.companyActive,
    }))
    .filter((company, index, self) => 
      index === self.findIndex((c) => c.id === company.id)
    );

  // Auto-select first company if none selected and companies are loaded
  useEffect(() => {
    if (!selectedCompany && companies.length > 0) {
      setSelectedCompany(companies[0]);
    }
  }, [companies, selectedCompany]);

  const selectCompany = (company: Company) => {
    setSelectedCompany(company);
    // Store in localStorage for persistence
    localStorage.setItem("selectedCompanyId", company.id.toString());
    
    // Invalidate all queries to refresh data for the new company
    // Using a predicate to catch all queries except auth-related ones
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        // Don't invalidate auth-related queries
        if (typeof key === 'string' && (key.includes('/api/auth') || key.includes('/api/user/companies'))) {
          return false;
        }
        return true;
      }
    });
  };

  // Restore selected company from localStorage on mount
  useEffect(() => {
    const savedCompanyId = localStorage.getItem("selectedCompanyId");
    if (savedCompanyId && companies.length > 0) {
      const company = companies.find((c) => c.id === parseInt(savedCompanyId));
      if (company) {
        setSelectedCompany(company);
      }
    }
  }, [companies]);

  return (
    <CompanyContext.Provider
      value={{
        selectedCompany,
        companies,
        isLoading,
        selectCompany,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error("useCompany must be used within a CompanyProvider");
  }
  return context;
}
