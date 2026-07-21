import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

const PREFETCH_KEYS = [
  "/api/suppliers",
  "/api/customers",
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
  const [isSyncingCompany, setIsSyncingCompany] = useState(false);
  const lastSyncedCompanyId = useRef<number | null>(null);
  const initialSyncStarted = useRef(false);

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

  const clearActivityCache = () => {
    // Audit history is strictly company-scoped. Remove the previous company's
    // page immediately so it can never remain visible while a new company is
    // becoming active on the server.
    queryClient.removeQueries({ queryKey: ["/api/audit-log"] });
  };

  const selectCompany = async (company: Company) => {
    if (lastSyncedCompanyId.current === company.id && selectedCompany?.id === company.id) return;

    setIsSyncingCompany(true);
    const ok = await switchCompanyOnServer(company.id);

    if (ok) {
      clearActivityCache();
      lastSyncedCompanyId.current = company.id;
      setSelectedCompany(company);
      localStorage.setItem("selectedCompanyId", company.id.toString());
      invalidateCompanyQueries();
      prefetchReferenceData(company.id);
    }

    setIsSyncingCompany(false);
  };

  useEffect(() => {
    if (companies.length === 0 || selectedCompany || initialSyncStarted.current) return;

    const savedCompanyId = localStorage.getItem("selectedCompanyId");
    let companyToSelect: Company | undefined;

    if (savedCompanyId) {
      companyToSelect = companies.find((c) => c.id === parseInt(savedCompanyId, 10));
    }
    if (!companyToSelect) {
      companyToSelect = companies[0];
    }
    if (!companyToSelect) return;

    initialSyncStarted.current = true;
    setIsSyncingCompany(true);

    // Do not expose a selected company to company-scoped screens until the
    // server session confirms the same company. This prevents an initial
    // request from running with no company and receiving cross-company data.
    switchCompanyOnServer(companyToSelect.id)
      .then((ok) => {
        if (!ok) {
          // Keep the attempt latched so a failed request cannot create an
          // immediate render/retry loop. The user can retry by selecting a
          // company explicitly from the company switcher.
          console.error("[Company] Failed to synchronize the initial company selection.");
          return;
        }

        clearActivityCache();
        lastSyncedCompanyId.current = companyToSelect!.id;
        setSelectedCompany(companyToSelect!);
        localStorage.setItem("selectedCompanyId", companyToSelect!.id.toString());
        prefetchReferenceData(companyToSelect!.id);

        // Only reset the activity query here. A broad initial invalidation can
        // reset unrelated in-flight pages and cause blank-screen flashes.
        queryClient.invalidateQueries({ queryKey: ["/api/audit-log"] });
      })
      .finally(() => {
        setIsSyncingCompany(false);
      });
  }, [companies, selectedCompany]);

  return (
    <CompanyContext.Provider
      value={{
        selectedCompany,
        companies,
        isLoading: isLoading || isSyncingCompany || (companies.length > 0 && !selectedCompany),
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
