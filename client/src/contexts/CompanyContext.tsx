import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, setAppTimezone } from "@/lib/queryClient";
import {
  cancelCompanySessionQueries,
  companyQueryKey,
  isCompanySessionQueryKey,
  removeCompanySessionQueries,
} from "@/lib/companyQueryScope";
import { createCompanySwitchQueue, type CompanySwitchQueue } from "@/lib/companySwitchQueue";

const PREFETCH_KEYS = [
  "/api/suppliers",
  "/api/customers",
  "/api/ledger-accounts",
  "/api/bank-accounts",
  "/api/locations",
  "/api/employees",
  "/api/fixed-assets",
];

function prefetchReferenceData(companyId: number, role?: string) {
  // POS sessions are intentionally denied access to the general ERP reference
  // endpoints below. Their dedicated POS queries load only the permitted data.
  if (role === "POS") return;

  for (const url of PREFETCH_KEYS) {
    queryClient.prefetchQuery({ queryKey: companyQueryKey(url, companyId) });
  }
}

interface Company {
  id: number;
  code: string;
  name: string;
  active: boolean;
  role?: string;
  companyType: "erp" | "factory" | "factory_v2" | "properties" | "supplier_partner";
  displayCurrency?: string | null;
}

export interface CompanySelectionOptions {
  /** Deliberately change the local workspace while the server is unreachable. */
  offline?: boolean;
}

interface CompanyContextType {
  selectedCompany: Company | null;
  companies: Company[];
  isLoading: boolean;
  selectCompany: (company: Company, options?: CompanySelectionOptions) => Promise<boolean>;
}

interface CompanyCommitOptions {
  prefetch: boolean;
  serverSynced: boolean;
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
  const [initialSyncAttempt, setInitialSyncAttempt] = useState(0);
  const selectedCompanyRef = useRef<Company | null>(null);
  const lastSyncedCompanyId = useRef<number | null>(null);
  const initialSyncStarted = useRef(false);
  const initialRetryTimer = useRef<number | null>(null);
  const switchQueueRef = useRef<CompanySwitchQueue | null>(null);

  if (!switchQueueRef.current) {
    switchQueueRef.current = createCompanySwitchQueue(setIsSyncingCompany);
  }

  const { data: userCompanies = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/user/companies"],
  });

  const companies: Company[] = userCompanies
    .map((uc) => ({
      id: uc.companyId,
      code: uc.companyCode,
      name: uc.companyName,
      active: uc.companyActive,
      role: uc.role,
      companyType: uc.companyType || "erp",
      displayCurrency: uc.displayCurrency ?? null,
    }))
    .filter((company, index, self) => index === self.findIndex((candidate) => candidate.id === company.id));

  const commitCompanySelection = useCallback((company: Company, options: CompanyCommitOptions) => {
    // Prevent the previous company's timezone from being used while the new
    // company's settings query is loading.
    setAppTimezone(null);
    lastSyncedCompanyId.current = options.serverSynced ? company.id : null;
    selectedCompanyRef.current = company;
    setSelectedCompany(company);
    localStorage.setItem("selectedCompanyId", company.id.toString());
    if (options.prefetch) prefetchReferenceData(company.id, company.role);
  }, []);

  const performCompanySelection = useCallback(
    async (company: Company, options: CompanySelectionOptions = {}): Promise<boolean> => {
      if (selectedCompanyRef.current?.id === company.id) {
        if (options.offline || lastSyncedCompanyId.current === company.id) return true;
      }

      // Stop previous-company responses before changing the server session. A
      // late response must never repopulate the cache after the switch.
      await cancelCompanySessionQueries(queryClient);

      if (options.offline) {
        removeCompanySessionQueries(queryClient);
        commitCompanySelection(company, { prefetch: false, serverSynced: false });
        return true;
      }

      const ok = await switchCompanyOnServer(company.id);
      if (!ok) {
        // The active company did not change. Restore any mounted queries that
        // were cancelled while the switch was attempted.
        queryClient.invalidateQueries({
          predicate: (query) => isCompanySessionQueryKey(query.queryKey),
          refetchType: "active",
        });
        return false;
      }

      // Remove, rather than merely invalidate, every previous-company cache.
      // Global auth/company-list queries remain available through the allow-list.
      removeCompanySessionQueries(queryClient);
      commitCompanySelection(company, { prefetch: true, serverSynced: true });
      return true;
    },
    [commitCompanySelection],
  );

  const selectCompany = useCallback(
    (company: Company, options: CompanySelectionOptions = {}) =>
      switchQueueRef.current!.enqueue(() => performCompanySelection(company, options)),
    [performCompanySelection],
  );

  const scheduleInitialSyncRetry = useCallback(() => {
    if (initialRetryTimer.current !== null) return;
    initialRetryTimer.current = window.setTimeout(() => {
      initialRetryTimer.current = null;
      initialSyncStarted.current = false;
      setInitialSyncAttempt((attempt) => attempt + 1);
    }, 2000);
  }, []);

  useEffect(
    () => () => {
      if (initialRetryTimer.current !== null) window.clearTimeout(initialRetryTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (companies.length === 0 || selectedCompany || initialSyncStarted.current) return;

    const savedCompanyId = localStorage.getItem("selectedCompanyId");
    const savedCompany = savedCompanyId
      ? companies.find((company) => company.id === Number.parseInt(savedCompanyId, 10))
      : undefined;
    const target = savedCompany ?? companies[0];
    if (!target) return;

    initialSyncStarted.current = true;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      selectCompany(target, { offline: true });
      return;
    }

    // Fast path: if the server session already holds the target company, clear
    // any persisted in-memory company data and activate it without another write.
    // Otherwise use the same serialized switch path as every user-initiated change.
    fetch("/api/auth/session-company", { credentials: "include", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.resolve({ companyId: null })))
      .catch(() => ({ companyId: null }))
      .then(async ({ companyId: sessionCompanyId }) => {
        if (sessionCompanyId === target.id) {
          await switchQueueRef.current!.enqueue(async () => {
            await cancelCompanySessionQueries(queryClient);
            removeCompanySessionQueries(queryClient);
            commitCompanySelection(target, { prefetch: true, serverSynced: true });
          });
          return;
        }

        const ok = await selectCompany(target);
        if (ok) return;

        // The requested company could not be activated. If the server reported
        // another accessible company, align the browser to that confirmed scope.
        const serverCompany = companies.find((company) => company.id === sessionCompanyId);
        if (serverCompany) {
          await switchQueueRef.current!.enqueue(async () => {
            await cancelCompanySessionQueries(queryClient);
            removeCompanySessionQueries(queryClient);
            commitCompanySelection(serverCompany, { prefetch: true, serverSynced: true });
          });
          return;
        }

        console.error("[Company] Failed to synchronize the initial company selection; retrying.");
        scheduleInitialSyncRetry();
      });
  }, [
    commitCompanySelection,
    companies,
    initialSyncAttempt,
    scheduleInitialSyncRetry,
    selectCompany,
    selectedCompany,
  ]);

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
