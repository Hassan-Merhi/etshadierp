import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import {
  parseSessionCompany,
  parseUserCompanies,
  type CompanyType,
  type UserCompanyAssignment,
} from "@/contracts/sessionContracts";

const PREFETCH_KEYS = [
  "/api/suppliers",
  "/api/customers",
  "/api/ledger-accounts",
  "/api/bank-accounts",
  "/api/locations",
  "/api/employees",
  "/api/fixed-assets",
] as const;

function prefetchReferenceData(companyId: number, role?: string) {
  // POS sessions are intentionally denied access to the general ERP reference
  // endpoints below. Their dedicated POS queries load only the permitted data.
  if (role === "POS") return;

  for (const key of PREFETCH_KEYS) {
    queryClient.prefetchQuery({ queryKey: [key, companyId] });
  }
}

export interface Company {
  id: number;
  code: string;
  name: string;
  active: boolean;
  role?: string;
  companyType: CompanyType;
  displayCurrency?: string | null;
}

interface CompanyContextType {
  selectedCompany: Company | null;
  companies: Company[];
  isLoading: boolean;
  selectCompany: (company: Company) => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

function mapCompanyAssignment(assignment: UserCompanyAssignment): Company {
  return {
    id: assignment.companyId,
    code: assignment.companyCode,
    name: assignment.companyName,
    active: assignment.companyActive,
    role: assignment.role,
    companyType: assignment.companyType,
    displayCurrency: assignment.displayCurrency,
  };
}

async function switchCompanyOnServer(companyId: number): Promise<boolean> {
  try {
    const response = await apiRequest("POST", "/api/auth/set-company", { companyId });
    return response.ok;
  } catch {
    return false;
  }
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [isSyncingCompany, setIsSyncingCompany] = useState(false);
  const lastSyncedCompanyId = useRef<number | null>(null);
  const initialSyncStarted = useRef(false);

  const { data: userCompanyAssignments = [], isLoading } = useQuery<UserCompanyAssignment[]>({
    queryKey: ["/api/user/companies"],
    queryFn: async (context) => {
      const value = await getQueryFn({ on401: "throw" })(context);
      return parseUserCompanies(value);
    },
  });

  const companies: Company[] = userCompanyAssignments
    .map(mapCompanyAssignment)
    .filter((company, index, allCompanies) =>
      index === allCompanies.findIndex((candidate) => candidate.id === company.id),
    );

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

  const selectCompany = async (company: Company): Promise<void> => {
    if (lastSyncedCompanyId.current === company.id && selectedCompany?.id === company.id) return;

    setIsSyncingCompany(true);

    // Write localStorage immediately so a page reload that follows will pick
    // up the right company before the async POST resolves.
    localStorage.setItem("selectedCompanyId", company.id.toString());

    const ok = await switchCompanyOnServer(company.id);

    if (ok) {
      clearActivityCache();
      lastSyncedCompanyId.current = company.id;
      setSelectedCompany(company);
      invalidateCompanyQueries();
      prefetchReferenceData(company.id, company.role);
    }

    setIsSyncingCompany(false);
  };

  useEffect(() => {
    if (companies.length === 0 || selectedCompany || initialSyncStarted.current) return;

    const savedCompanyId = localStorage.getItem("selectedCompanyId");
    let companyToSelect: Company | undefined;

    if (savedCompanyId) {
      companyToSelect = companies.find((company) => company.id === Number.parseInt(savedCompanyId, 10));
    }
    if (!companyToSelect) {
      companyToSelect = companies[0];
    }
    if (!companyToSelect) return;

    initialSyncStarted.current = true;
    setIsSyncingCompany(true);

    const target = companyToSelect;

    // Fast path: if the server session already holds the target company we can
    // skip the set-company POST entirely and unblock the UI immediately.
    // Slow path (session differs or GET fails): fall back to the full POST.
    fetch("/api/auth/session-company", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return { companyId: null };
        const value: unknown = await response.json();
        return parseSessionCompany(value);
      })
      .catch(() => ({ companyId: null }))
      .then(async ({ companyId: sessionCompanyId }) => {
        if (sessionCompanyId === target.id) {
          clearActivityCache();
          lastSyncedCompanyId.current = target.id;
          setSelectedCompany(target);
          localStorage.setItem("selectedCompanyId", target.id.toString());
          prefetchReferenceData(target.id, target.role);
          queryClient.invalidateQueries({ queryKey: ["/api/audit-log"] });
          return;
        }

        const ok = await switchCompanyOnServer(target.id);
        if (!ok) {
          console.error("[Company] Failed to synchronize the initial company selection.");
          return;
        }

        clearActivityCache();
        lastSyncedCompanyId.current = target.id;
        setSelectedCompany(target);
        localStorage.setItem("selectedCompanyId", target.id.toString());
        prefetchReferenceData(target.id, target.role);
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
