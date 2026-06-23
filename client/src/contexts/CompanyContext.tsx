import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

const PREFETCH_KEYS = [
  "/api/suppliers",
  "/api/customers",
  "/api/stock-items",
  "/api/ledger-accounts",
  "/api/bank-accounts",
  "/api/locations",
  "/api/employees",
  "/api/fixed-assets",
];

function prefetchReferenceData(companyId: number) {
  for (const key of PREFETCH_KEYS) {
    queryClient.prefetchQuery({ queryKey: [key, companyId] });
  }
}

interface Company {
  id: number;
  code: string;
  name: string;
  active: boolean;
  companyType: "erp" | "factory" | "factory_v2" | "properties" | "supplier_partner";
  displayCurrency?: string | null;
}

interface CompanyContextType {
  selectedCompany: Company | null;
  companies: Company[];
  isLoading: boolean;
  selectCompany: (company: Company) => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

async function switchCompanyOnServer(companyId: number): Promise<boolean> {
  try {
    const res = await apiRequest("POST", "/api/auth/set-company", { companyId });
    return res.ok;
  } catch {
    return false;
  }
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const lastSyncedCompanyId = useRef<number | null>(null);

  const { data: userCompanies = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/user/companies"],
  });

  const companies: Company[] = userCompanies
    .map((uc) => ({
      id: uc.companyId,
      code: uc.companyCode,
      name: uc.companyName,
      active: uc.companyActive,
      companyType: uc.companyType || "erp",
    }))
    .filter((company, index, self) => index === self.findIndex((c) => c.id === company.id));

  const invalidateCompanyQueries = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        if (typeof key === "string" && (key.includes("/api/auth") || key.includes("/api/user/companies"))) {
          return false;
        }
        return true;
      },
    });
  };

  const selectCompany = async (company: Company) => {
    setSelectedCompany(company);
    localStorage.setItem("selectedCompanyId", company.id.toString());

    const ok = await switchCompanyOnServer(company.id);
    if (ok) {
      lastSyncedCompanyId.current = company.id;
      invalidateCompanyQueries();
    } else {
      invalidateCompanyQueries();
    }
    prefetchReferenceData(company.id);
  };

  useEffect(() => {
    if (companies.length > 0 && !selectedCompany) {
      const savedCompanyId = localStorage.getItem("selectedCompanyId");
      let companyToSelect: Company | undefined;

      if (savedCompanyId) {
        companyToSelect = companies.find((c) => c.id === parseInt(savedCompanyId));
      }
      if (!companyToSelect) {
        companyToSelect = companies[0];
      }

      setSelectedCompany(companyToSelect);
      prefetchReferenceData(companyToSelect.id);

      if (companyToSelect && lastSyncedCompanyId.current !== companyToSelect.id) {
        switchCompanyOnServer(companyToSelect.id).then((ok) => {
          if (ok) {
            lastSyncedCompanyId.current = companyToSelect!.id;
          }
          // Do NOT invalidate queries here — this is the initial auto-select on page load.
          // The server session already persists currentCompanyId, so all data queries
          // return correct data without needing a full invalidation. Invalidating here
          // resets in-flight queries to isLoading:true, causing blank white screens.
        });
      }
    }
  }, [companies, selectedCompany]);

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
