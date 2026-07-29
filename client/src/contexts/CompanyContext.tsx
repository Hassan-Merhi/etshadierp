import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, getQueryFn, queryClient, setAppTimezone } from "@/lib/queryClient";
import {
  cancelCompanySessionQueries,
  companyQueryKey,
  isCompanySessionQueryKey,
  removeCompanySessionQueries,
} from "@/lib/companyQueryScope";
import { createCompanySwitchQueue, type CompanySwitchQueue } from "@/lib/companySwitchQueue";
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
  if (role === "POS") return;
  for (const url of PREFETCH_KEYS) {
    queryClient.prefetchQuery({ queryKey: companyQueryKey(url, companyId) });
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

export interface CompanySelectionOptions {
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
  const [initialSyncAttempt, setInitialSyncAttempt] = useState(0);
  const selectedCompanyRef = useRef<Company | null>(null);
  const lastSyncedCompanyId = useRef<number | null>(null);
  const initialSyncStarted = useRef(false);
  const initialRetryTimer = useRef<number | null>(null);
  const switchQueueRef = useRef<CompanySwitchQueue | null>(null);

  if (!switchQueueRef.current) {
    switchQueueRef.current = createCompanySwitchQueue(setIsSyncingCompany);
  }

  const { data: userCompanyAssignments = [], isLoading } = useQuery<UserCompanyAssignment[]>({
    queryKey: ["/api/user/companies"],
    queryFn: async (context) => {
      const value = await getQueryFn({ on401: "throw" })(context);
      return parseUserCompanies(value);
    },
  });

  const companies: Company[] = userCompanyAssignments
    .map(mapCompanyAssignment)
    .filter(
      (company, index, allCompanies) =>
        index === allCompanies.findIndex((candidate) => candidate.id === company.id),
    );

  const commitCompanySelection = useCallback((company: Company, options: CompanyCommitOptions) => {
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

      await cancelCompanySessionQueries(queryClient);

      if (options.offline) {
        removeCompanySessionQueries(queryClient);
        commitCompanySelection(company, { prefetch: false, serverSynced: false });
        return true;
      }

      const ok = await switchCompanyOnServer(company.id);
      if (!ok) {
        queryClient.invalidateQueries({
          predicate: (query) => isCompanySessionQueryKey(query.queryKey),
          refetchType: "active",
        });
        return false;
      }

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
      void selectCompany(target, { offline: true }).catch((error: unknown) => {
        console.error("[Company] Failed to activate the offline company selection.", error);
        scheduleInitialSyncRetry();
      });
      return;
    }

    void fetch("/api/auth/session-company", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return { companyId: null };
        const value: unknown = await response.json();
        return parseSessionCompany(value);
      })
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
      })
      .catch((error: unknown) => {
        console.error("[Company] Initial company synchronization failed; retrying.", error);
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
