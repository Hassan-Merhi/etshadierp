import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, FileText } from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

import type { ErpWorkerDoc, Props, SalaryAdvance, Transaction } from "./types";
import { buildERPWorkerStatementRows } from "./statement";
import { ALLOWED_TYPES } from "./utils";

function getERPWorkerDetailErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "An unexpected error occurred";
}

export function useERPWorkerDetailModel({ worker, onBack }: Pick<Props, "worker" | "onBack">) {
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const { selectedCompany } = useCompany();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState("profile");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [editDocDialog, setEditDocDialog] = useState<ErpWorkerDoc | null>(null);
  const [editDocName, setEditDocName] = useState("");
  const [editDocDesc, setEditDocDesc] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceDate, setAdvanceDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [advanceNotes, setAdvanceNotes] = useState("");
  const [editAdvance, setEditAdvance] = useState<SalaryAdvance | null>(null);

  const [endContractDialogOpen, setEndContractDialogOpen] = useState(false);

  // Fetch ERP transactions for this worker
  const { data: transactions = [], isLoading: txLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/accounts/employee", worker.id, "transactions"],
    queryFn: async () => {
      const res = await fetch(`/api/accounts/employee/${worker.id}/transactions`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "statement",
    staleTime: 15000,
  });

  // Fetch ERP advances for this worker
  const { data: advances = [], isLoading: advancesLoading } = useQuery<SalaryAdvance[]>({
    queryKey: ["/api/salary-advances/employee", worker.id],
    queryFn: async () => {
      const res = await fetch(`/api/salary-advances/employee/${worker.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "advances" || activeTab === "statement",
  });

  // Fetch ERP docs for this worker
  const { data: docs = [], isLoading: docsLoading } = useQuery<ErpWorkerDoc[]>({
    queryKey: ["/api/employees", worker.id, "docs"],
    queryFn: async () => {
      const res = await fetch(`/api/employees/${worker.id}/docs`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "docs",
  });

  // ─── Advance mutations ────────────────────────────────────────────────────────

  const createAdvanceMutation = useMutation({
    mutationFn: async (data: {
      employeeId: number;
      companyId: number;
      advanceDate: string;
      amount: string;
      notes?: string;
    }) => {
      return apiRequest("POST", "/api/salary-advances", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances/employee", worker.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      setAdvanceDialogOpen(false);
      setAdvanceAmount("");
      setAdvanceNotes("");
      toast({ title: "Advance recorded" });
    },
    onError: (e: unknown) =>
      toast({ title: "Error", description: getERPWorkerDetailErrorMessage(e), variant: "destructive" }),
  });

  const deleteAdvanceMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/salary-advances/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances/employee", worker.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      toast({ title: "Advance deleted" });
    },
    onError: (e: unknown) =>
      toast({ title: "Error", description: getERPWorkerDetailErrorMessage(e), variant: "destructive" }),
  });

  // ─── Doc mutations ────────────────────────────────────────────────────────────

  const uploadDocMutation = useMutation({
    mutationFn: async (data: {
      fileName: string;
      fileType: string;
      fileSize: number;
      fileData: string;
      description?: string;
    }) => {
      return apiRequest("POST", `/api/employees/${worker.id}/docs`, {
        ...data,
        companyId: selectedCompany?.id,
        employeeId: worker.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees", worker.id, "docs"] });
      setUploadDialogOpen(false);
      setUploadDesc("");
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast({ title: "Document uploaded" });
    },
    onError: (e: unknown) =>
      toast({ title: "Upload failed", description: getERPWorkerDetailErrorMessage(e), variant: "destructive" }),
  });

  const editDocMutation = useMutation({
    mutationFn: async ({ id, fileName, description }: { id: number; fileName: string; description: string }) => {
      return apiRequest("PATCH", `/api/erp-worker-docs/${id}`, { fileName, description });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees", worker.id, "docs"] });
      setEditDocDialog(null);
      toast({ title: "Document updated" });
    },
    onError: (e: unknown) =>
      toast({ title: "Error", description: getERPWorkerDetailErrorMessage(e), variant: "destructive" }),
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/erp-worker-docs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees", worker.id, "docs"] });
      toast({ title: "Document deleted" });
    },
    onError: (e: unknown) =>
      toast({ title: "Error", description: getERPWorkerDetailErrorMessage(e), variant: "destructive" }),
  });

  const endContractMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/employees/${worker.id}`, { active: false }),
    onSuccess: () => {
      toast({
        title: "Contract ended",
        description: `${worker.firstName} ${worker.lastName} has been marked as inactive.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setEndContractDialogOpen(false);
      onBack();
    },
    onError: (e: unknown) =>
      toast({ title: "Error", description: getERPWorkerDetailErrorMessage(e), variant: "destructive" }),
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const fmt = (val: string | number | undefined | null) => {
    if (val === undefined || val === null || val === "") return "—";
    const n = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(n)) return "—";
    return formatAmount(n);
  };

  const fmtDate = (val: string | undefined | null) => {
    if (!val) return "—";
    return val.slice(0, 10);
  };

  const infoRow = (label: string, value: string | number | boolean | undefined | null, testId?: string) => (
    <div className="flex justify-between py-1.5 border-b last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-right max-w-[55%] truncate" data-testid={testId}>
        {value === undefined || value === null || value === "" ? "—" : String(value)}
      </span>
    </div>
  );

  const initials = `${worker.firstName?.[0] ?? ""}${worker.lastName?.[0] ?? ""}`.toUpperCase();
  const fullName = `${worker.firstName} ${worker.lastName}`;
  const monthlySalary = parseFloat(worker.monthlySalary || "0");
  const currentBalance = parseFloat(worker.currentBalance || "0");
  const totalDeposits = parseFloat(worker.totalDeposits || "0");
  const totalWithdrawals = parseFloat(worker.totalWithdrawals || "0");
  const openingBalance = parseFloat(worker.openingBalance || "0");

  // ─── Statement running balance calculation ────────────────────────────────────
  const statementRows = buildERPWorkerStatementRows({
    advances,
    joinDate: worker.joinDate,
    openingBalance,
    transactions,
  });

  const netBalance = statementRows.length > 0 ? statementRows[statementRows.length - 1].balance : currentBalance;
  const totalAdvancesGiven = advances.reduce((s, a) => s + parseFloat(a.amount || "0"), 0);
  const advancesOutstanding = advances
    .filter((a) => !a.fullyPaid)
    .reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);

  // ─── File upload handler ──────────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Allowed: PDF, JPG, PNG, WEBP, DOC, DOCX, XLS, XLSX, TXT",
        variant: "destructive",
      });
      return;
    }
    setPendingFile(file);
    setUploadDialogOpen(true);
  };

  const handleUploadConfirm = () => {
    if (!pendingFile) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const fileData = e.target?.result as string;
      uploadDocMutation.mutate({
        fileName: pendingFile.name,
        fileType: pendingFile.type,
        fileSize: pendingFile.size,
        fileData,
        description: uploadDesc,
      });
    };
    reader.readAsDataURL(pendingFile);
  };

  const handleDownload = (doc: ErpWorkerDoc) => {
    window.open(`/api/erp-worker-docs/${doc.id}/download`, "_blank");
  };

  const handleView = (doc: ErpWorkerDoc) => {
    window.open(`/api/erp-worker-docs/${doc.id}/download`, "_blank");
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith("image/")) return <Eye className="h-4 w-4 text-blue-500" />;
    if (fileType === "application/pdf") return <FileText className="h-4 w-4 text-red-500" />;
    return <FileText className="h-4 w-4 text-muted-foreground" />;
  };

  return {
    activeTab,
    advanceAmount,
    advanceDate,
    advanceDialogOpen,
    advanceNotes,
    advances,
    advancesLoading,
    advancesOutstanding,
    createAdvanceMutation,
    currentBalance,
    deleteAdvanceMutation,
    deleteDocMutation,
    docs,
    docsLoading,
    editAdvance,
    editDocDesc,
    editDocDialog,
    editDocMutation,
    editDocName,
    endContractDialogOpen,
    endContractMutation,
    fileInputRef,
    fmt,
    fmtDate,
    fullName,
    getFileIcon,
    handleDownload,
    handleFileSelect,
    handleUploadConfirm,
    handleView,
    infoRow,
    initials,
    monthlySalary,
    netBalance,
    openingBalance,
    pendingFile,
    setActiveTab,
    setAdvanceAmount,
    setAdvanceDate,
    setAdvanceDialogOpen,
    setAdvanceNotes,
    setEditAdvance,
    setEditDocDesc,
    setEditDocDialog,
    setEditDocName,
    setEndContractDialogOpen,
    setPendingFile,
    setUploadDesc,
    setUploadDialogOpen,
    statementRows,
    totalAdvancesGiven,
    totalDeposits,
    totalWithdrawals,
    txLoading,
    uploadDesc,
    uploadDialogOpen,
    uploadDocMutation,
  };
}
