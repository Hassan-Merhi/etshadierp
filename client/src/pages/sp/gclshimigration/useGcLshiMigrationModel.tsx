import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, GcPreview, MigrationRun } from "./types";

export interface AccountPlanRow {
  subType: string;
  accountType: string;
  defaultCode: string;
  defaultName: string;
  exists: boolean;
  currentCode: string;
  currentName: string;
  group: "sp" | "gc";
}

interface CompanyCreateResult {
  company: { id: number; name: string; code: string };
}

interface OpeningBalanceResult {
  voucherNumber: string;
  amount: string | number;
}

interface AccountCreateResult {
  createdCount: number;
  created: string[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected migration error";
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function useGcLshiMigrationModel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [sourceCompanyId, setSourceCompanyId] = useState<number | null>(null);
  const [targetCompanyId, setTargetCompanyId] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [stockTableOpen, setStockTableOpen] = useState(false);
  const [accountEdits, setAccountEdits] = useState<Record<string, { code: string; name: string }>>({});
  const [accountsCreated, setAccountsCreated] = useState(false);
  const [obAmount, setObAmount] = useState("");
  const [obDate, setObDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [obNarration, setObNarration] = useState("GC Opening Cash Balance");
  const [obCashAccountId, setObCashAccountId] = useState<number | null>(null);
  const [rollbackRunId, setRollbackRunId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("GC-LSHI");
  const [createCode, setCreateCode] = useState("GC-LSHI-SP");

  const { data: sessionRole, isLoading: roleLoading } = useQuery<{ role: string }>({
    queryKey: ["/api/sp/migration/session-role"],
  });

  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const erpCompanies = (companies ?? []).filter((company) => (company.company_type ?? company.companyType) === "erp");
  const spCompanies = (companies ?? []).filter(
    (company) => (company.company_type ?? company.companyType) === "supplier_partner"
  );

  const {
    data: preview,
    isLoading: previewLoading,
    refetch: refetchPreview,
    error: previewError,
  } = useQuery<GcPreview>({
    queryKey: ["/api/sp/migration/gc-preview", sourceCompanyId, targetCompanyId],
    queryFn: async () => {
      const response = await fetch(
        `/api/sp/migration/gc-preview?sourceCompanyId=${sourceCompanyId}&targetCompanyId=${targetCompanyId}`
      );
      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        throw new Error(error.message || "Failed to load migration preview");
      }
      return readJson<GcPreview>(response);
    },
    enabled: !!(sourceCompanyId && targetCompanyId),
    retry: false,
  });

  const { data: runsData, refetch: refetchRuns } = useQuery<{ runs: MigrationRun[] }>({
    queryKey: ["/api/sp/migration/runs"],
  });

  const {
    data: accountPlan,
    isLoading: accountPlanLoading,
    refetch: refetchAccountPlan,
  } = useQuery<{ accounts: AccountPlanRow[] }>({
    queryKey: ["/api/sp/migration/gc-account-plan", targetCompanyId],
    queryFn: async () => {
      const response = await fetch(`/api/sp/migration/gc-account-plan?targetCompanyId=${targetCompanyId}`);
      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        throw new Error(error.message || "Failed to load account plan");
      }
      return readJson<{ accounts: AccountPlanRow[] }>(response);
    },
    enabled: !!targetCompanyId,
  });

  const { data: cashAccountsData } = useQuery<{
    accounts: Array<{ id: number; code: string; name: string; account_type: string }>;
  }>({
    queryKey: ["/api/sp/migration/cash-accounts", targetCompanyId],
    queryFn: async () => {
      const response = await fetch(`/api/sp/migration/cash-accounts?targetCompanyId=${targetCompanyId}`);
      if (!response.ok) {
        const error = (await response.json()) as { message?: string };
        throw new Error(error.message || "Failed to load cash accounts");
      }
      return readJson<{ accounts: Array<{ id: number; code: string; name: string; account_type: string }> }>(response);
    },
    enabled: !!targetCompanyId,
  });

  const createCompanyMutation = useMutation({
    mutationFn: (body: { name: string; code: string }) => apiRequest("POST", "/api/sp/migration/create-sp-company", body),
    onSuccess: async (response) => {
      const result = await readJson<CompanyCreateResult>(response);
      toast({ title: "Company created", description: `${result.company.name} (${result.company.code}) created successfully.` });
      setShowCreateDialog(false);
      qc.invalidateQueries({ queryKey: ["/api/companies"] });
      setTargetCompanyId(result.company.id);
    },
    onError: (error: unknown) => toast({ title: "Error", description: messageOf(error), variant: "destructive" }),
  });

  const openingBalanceMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/sp/migration/opening-balance", body),
    onSuccess: async (response) => {
      const result = await readJson<OpeningBalanceResult>(response);
      toast({ title: "Opening balance created", description: `Voucher ${result.voucherNumber} for $${result.amount}` });
      setObAmount("");
    },
    onError: (error: unknown) => toast({ title: "Error", description: messageOf(error), variant: "destructive" }),
  });

  const createAccountsMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/sp/migration/gc-create-accounts", body),
    onSuccess: async (response) => {
      const result = await readJson<AccountCreateResult>(response);
      toast({
        title: "Accounts created",
        description: result.createdCount > 0 ? `Created: ${result.created.join(", ")}` : "All accounts already exist.",
      });
      setAccountsCreated(true);
      refetchAccountPlan();
    },
    onError: (error: unknown) => toast({ title: "Error", description: messageOf(error), variant: "destructive" }),
  });

  const rollbackMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", "/api/sp/migration/rollback", { runId }),
    onSuccess: async () => {
      toast({ title: "Rollback complete", description: "All rows from that run have been deleted." });
      setRollbackRunId(null);
      refetchRuns();
      refetchPreview();
    },
    onError: (error: unknown) => toast({ title: "Rollback failed", description: messageOf(error), variant: "destructive" }),
  });

  const sourceComp = erpCompanies.find((company) => company.id === sourceCompanyId);
  const targetComp = spCompanies.find((company) => company.id === targetCompanyId);
  const allRuns = runsData?.runs ?? [];
  const fmt = (number: number) => number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return {
    toast,
    sourceCompanyId,
    setSourceCompanyId,
    targetCompanyId,
    setTargetCompanyId,
    previewOpen,
    setPreviewOpen,
    stockTableOpen,
    setStockTableOpen,
    accountEdits,
    setAccountEdits,
    accountsCreated,
    obAmount,
    setObAmount,
    obDate,
    setObDate,
    obNarration,
    setObNarration,
    obCashAccountId,
    setObCashAccountId,
    rollbackRunId,
    setRollbackRunId,
    showCreateDialog,
    setShowCreateDialog,
    createName,
    setCreateName,
    createCode,
    setCreateCode,
    sessionRole,
    roleLoading,
    erpCompanies,
    spCompanies,
    preview,
    previewLoading,
    refetchPreview,
    previewError,
    refetchRuns,
    accountPlan,
    accountPlanLoading,
    cashAccountsData,
    createCompanyMutation,
    openingBalanceMutation,
    createAccountsMutation,
    rollbackMutation,
    sourceComp,
    targetComp,
    allRuns,
    fmt,
  };
}
