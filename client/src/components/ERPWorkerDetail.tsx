import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  User,
  Phone,
  Building,
  CreditCard,
  FileText,
  DollarSign,
  Upload,
  Trash2,
  Download,
  Eye,
  Pencil,
  Banknote,
  Plus,
  UserX,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  joinDate?: string;
  department?: string;
  employeeType: string;
  monthlySalary: string;
  openingBalance?: string;
  currentBalance?: string;
  totalDeposits?: string;
  totalWithdrawals?: string;
  active?: boolean;
}

interface SalaryAdvance {
  id: number;
  companyId: number;
  employeeId: number;
  employeeCode?: string;
  employeeName?: string;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  fullyPaid: boolean;
  notes?: string;
  createdAt: string;
}

interface ErpWorkerDoc {
  id: number;
  employeeId: number;
  companyId: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  description?: string;
  uploadedBy?: string;
  uploadedAt: string;
}

interface Transaction {
  id: number;
  voucherId?: number;
  voucherNumber?: string;
  voucherType?: string;
  voucherDate?: string;
  voucherDescription?: string;
  narration?: string;
  debitAmount?: string;
  creditAmount?: string;
}

interface Props {
  worker: Employee;
  onBack: () => void;
  onEdit?: (worker: Employee) => void;
}

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ERPWorkerDetail({ worker, onBack, onEdit }: Props) {
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
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteAdvanceMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/salary-advances/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances/employee", worker.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      toast({ title: "Advance deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
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
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/erp-worker-docs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees", worker.id, "docs"] });
      toast({ title: "Document deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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
  type LedgerRow = {
    date: string;
    type: string;
    ref: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    status?: string;
  };

  const statementRows: LedgerRow[] = (() => {
    const rows: Omit<LedgerRow, "balance">[] = [];

    // Opening balance row
    if (openingBalance !== 0) {
      rows.push({
        date: worker.joinDate?.slice(0, 10) || "—",
        type: "Opening Balance",
        ref: "—",
        description: "Opening balance",
        debit: openingBalance > 0 ? openingBalance : 0,
        credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      });
    }

    // Transactions (voucher entries)
    for (const tx of transactions) {
      const credit = parseFloat(tx.creditAmount || "0");
      const debit = parseFloat(tx.debitAmount || "0");
      rows.push({
        date: tx.voucherDate?.slice(0, 10) || "—",
        type: tx.voucherType || "Entry",
        ref: tx.voucherNumber || `#${tx.voucherId || tx.id}`,
        description: tx.voucherDescription || tx.narration || "",
        debit: credit,
        credit: debit,
      });
    }

    // Advances (decrease balance — credit column)
    for (const adv of advances) {
      rows.push({
        date: adv.advanceDate?.slice(0, 10) || "—",
        type: "Advance",
        ref: `ADV-${adv.id}`,
        description: adv.notes || "Salary advance",
        debit: 0,
        credit: parseFloat(adv.amount || "0"),
        status: adv.fullyPaid ? "Repaid" : "Outstanding",
      });
    }

    // Sort by date
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Compute running balance
    let running = 0;
    return rows.map((r) => {
      running += r.debit - r.credit;
      return { ...r, balance: running };
    });
  })();

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

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button size="icon" variant="ghost" onClick={onBack} data-testid="button-back-worker-detail">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold" data-testid="text-worker-detail-name">
            {fullName}
          </h2>
          <p className="text-sm text-muted-foreground">
            {worker.code} · {worker.department || "—"}
          </p>
        </div>
      </div>

      {/* Main layout: left card + right tabs */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Left summary card */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-3">
          <Card>
            <CardContent className="p-5 flex flex-col items-center gap-3">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-xl font-semibold">{initials}</AvatarFallback>
              </Avatar>
              <div className="text-center">
                <p className="font-semibold text-base" data-testid="text-card-worker-name">
                  {fullName}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-card-worker-code">
                  {worker.code}
                </p>
              </div>
              <Badge
                variant={worker.active === false ? "secondary" : "outline"}
                className="text-xs"
                data-testid="badge-worker-status"
              >
                {worker.active === false ? "Inactive" : "Active"}
              </Badge>
              {onEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => onEdit(worker)}
                  data-testid="button-edit-worker-profile"
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit Worker
                </Button>
              )}
              {worker.active !== false && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  onClick={() => setEndContractDialogOpen(true)}
                  data-testid="button-end-contract"
                >
                  <UserX className="h-3.5 w-3.5 mr-1.5" /> End Contract
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-0">
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Salary Summary</p>
              {infoRow("Monthly Salary", fmt(monthlySalary), "text-card-monthly-salary")}
              {infoRow("Current Balance", fmt(currentBalance), "text-card-current-balance")}
              {infoRow("Total Earned", fmt(totalDeposits), "text-card-total-earned")}
              {infoRow("Total Paid Out", fmt(totalWithdrawals), "text-card-total-paid")}
              {infoRow("Advances Given", fmt(totalAdvancesGiven), "text-card-advances")}
              {infoRow("Joined", fmtDate(worker.joinDate), "text-card-joined")}
            </CardContent>
          </Card>
        </div>

        {/* Right tabs */}
        <div className="flex-1 min-w-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4 flex-wrap">
              <TabsTrigger value="profile" data-testid="tab-erp-profile">
                Profile
              </TabsTrigger>
              <TabsTrigger value="statement" data-testid="tab-erp-statement">
                Statement
              </TabsTrigger>
              <TabsTrigger value="advances" data-testid="tab-erp-advances">
                Advances
              </TabsTrigger>
              <TabsTrigger value="docs" data-testid="tab-erp-docs">
                Docs
              </TabsTrigger>
            </TabsList>

            {/* ── Profile ── */}
            <TabsContent value="profile" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <User className="h-3.5 w-3.5" /> Personal
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {infoRow("Full Name", fullName, "text-profile-fullname")}
                    {infoRow("Father Name", undefined)}
                    {infoRow("National ID", undefined)}
                    {infoRow("Date of Birth", undefined)}
                    {infoRow("Gender", undefined)}
                    {infoRow("Nationality", undefined)}
                    {infoRow("Marital Status", undefined)}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5" /> Contact
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {infoRow("Phone", worker.phone, "text-profile-phone")}
                    {infoRow("Email", worker.email, "text-profile-email")}
                    {infoRow("Emergency Contact", undefined)}
                    {infoRow("Address", undefined)}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Building className="h-3.5 w-3.5" /> Employment
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {infoRow("Employee Code", worker.code, "text-profile-code")}
                    {infoRow("Department", worker.department, "text-profile-department")}
                    {infoRow("Employee Type", worker.employeeType, "text-profile-type")}
                    {infoRow("Date Joined", fmtDate(worker.joinDate), "text-profile-joined")}
                    {infoRow("Status", worker.active === false ? "Inactive" : "Active", "text-profile-status")}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CreditCard className="h-3.5 w-3.5" /> Compensation
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {infoRow("Monthly Salary", fmt(monthlySalary), "text-profile-salary")}
                    {infoRow("Opening Balance", fmt(openingBalance), "text-profile-opening")}
                    {infoRow("Current Balance", fmt(currentBalance), "text-profile-balance")}
                    {infoRow("Salary Type", "Monthly")}
                    {infoRow("Payment Method", undefined)}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── Statement ── */}
            <TabsContent value="statement" className="space-y-4">
              {/* KPI summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Current Balance</p>
                    <p
                      className={`text-xl font-bold ${netBalance >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
                      data-testid="stat-erp-net-balance"
                    >
                      {fmt(netBalance)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Owed to worker</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Total Earned</p>
                    <p
                      className="text-xl font-bold text-green-700 dark:text-green-400"
                      data-testid="stat-erp-total-earned"
                    >
                      {fmt(totalDeposits)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Accrued salary</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Total Paid</p>
                    <p className="text-xl font-bold text-blue-700 dark:text-blue-400" data-testid="stat-erp-total-paid">
                      {fmt(totalWithdrawals)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Paid out</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Advances Left</p>
                    <p
                      className={`text-xl font-bold ${advancesOutstanding > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}
                      data-testid="stat-erp-advances-left"
                    >
                      {fmt(advancesOutstanding)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Outstanding</p>
                  </CardContent>
                </Card>
              </div>

              {/* Ledger table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Running Ledger</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {txLoading || advancesLoading ? (
                    <div className="p-4 space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                      ))}
                    </div>
                  ) : statementRows.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <DollarSign className="mx-auto h-8 w-8 mb-3 opacity-30" />
                      <p className="text-sm">No entries yet</p>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Earned</TableHead>
                            <TableHead className="text-right">Paid/Deducted</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {statementRows.map((row, i) => (
                            <TableRow key={i} data-testid={`row-statement-${i}`}>
                              <TableCell className="text-xs whitespace-nowrap">{row.date}</TableCell>
                              <TableCell className="text-xs whitespace-nowrap">{row.type}</TableCell>
                              <TableCell className="text-xs font-mono whitespace-nowrap">{row.ref}</TableCell>
                              <TableCell className="text-xs max-w-[140px] truncate">{row.description || "—"}</TableCell>
                              <TableCell className="text-right font-mono text-xs text-green-700 dark:text-green-400">
                                {row.debit > 0 ? fmt(row.debit) : "—"}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-red-700 dark:text-red-400">
                                {row.credit > 0 ? fmt(row.credit) : "—"}
                              </TableCell>
                              <TableCell
                                className={`text-right font-mono text-xs font-semibold ${row.balance >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
                              >
                                {fmt(row.balance)}
                              </TableCell>
                              <TableCell>
                                {row.status && (
                                  <Badge variant="outline" className="text-xs">
                                    {row.status}
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Advances ── */}
            <TabsContent value="advances" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Salary Advances</h3>
                  <p className="text-xs text-muted-foreground">ERP advances for this worker only</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditAdvance(null);
                    setAdvanceAmount("");
                    setAdvanceDate(new Date().toLocaleDateString("en-CA"));
                    setAdvanceNotes("");
                    setAdvanceDialogOpen(true);
                  }}
                  data-testid="button-add-advance"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Advance
                </Button>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Total Given</p>
                    <p className="text-lg font-bold" data-testid="stat-adv-total">
                      {fmt(totalAdvancesGiven)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Outstanding</p>
                    <p
                      className={`text-lg font-bold ${advancesOutstanding > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}
                      data-testid="stat-adv-outstanding"
                    >
                      {fmt(advancesOutstanding)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Unpaid Count</p>
                    <p className="text-lg font-bold" data-testid="stat-adv-count">
                      {advances.filter((a) => !a.fullyPaid).length}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="p-0">
                  {advancesLoading ? (
                    <div className="p-4 space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : advances.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <Banknote className="mx-auto h-8 w-8 mb-3 opacity-30" />
                      <p className="text-sm">No advances recorded</p>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-right">Remaining</TableHead>
                            <TableHead>Notes</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {advances.map((adv) => (
                            <TableRow key={adv.id} data-testid={`row-advance-${adv.id}`}>
                              <TableCell className="text-xs whitespace-nowrap">
                                {adv.advanceDate?.slice(0, 10)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">{fmt(adv.amount)}</TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {fmt(adv.remainingBalance)}
                              </TableCell>
                              <TableCell className="text-xs max-w-[120px] truncate">{adv.notes || "—"}</TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${adv.fullyPaid ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}
                                >
                                  {adv.fullyPaid ? "Repaid" : "Outstanding"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditAdvance(adv);
                                      setAdvanceAmount(adv.amount);
                                      setAdvanceDate(adv.advanceDate?.slice(0, 10) || "");
                                      setAdvanceNotes(adv.notes || "");
                                      setAdvanceDialogOpen(true);
                                    }}
                                    data-testid={`button-edit-advance-${adv.id}`}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => deleteAdvanceMutation.mutate(adv.id)}
                                    data-testid={`button-delete-advance-${adv.id}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Docs ── */}
            <TabsContent value="docs" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Worker Documents</h3>
                  <p className="text-xs text-muted-foreground">ERP-only document storage for this worker</p>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt"
                    onChange={handleFileSelect}
                    data-testid="input-upload-doc"
                  />
                  <Button size="sm" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-doc">
                    <Upload className="h-4 w-4 mr-1" /> Upload
                  </Button>
                </div>
              </div>

              {docsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : docs.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <FileText className="mx-auto h-8 w-8 mb-3 opacity-30" />
                    <p className="text-sm">No documents uploaded</p>
                    <p className="text-xs mt-1">PDF, JPG, PNG, WEBP, DOC, DOCX, XLS, XLSX, TXT</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <Card key={doc.id} data-testid={`card-doc-${doc.id}`}>
                      <CardContent className="p-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {getFileIcon(doc.fileType)}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate" data-testid={`text-doc-name-${doc.id}`}>
                              {doc.fileName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatBytes(doc.fileSize)} · {doc.uploadedAt?.slice(0, 10)}
                            </p>
                            {doc.description && (
                              <p className="text-xs text-muted-foreground truncate">{doc.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleView(doc)}
                            data-testid={`button-view-doc-${doc.id}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDownload(doc)}
                            data-testid={`button-download-doc-${doc.id}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setEditDocDialog(doc);
                              setEditDocName(doc.fileName);
                              setEditDocDesc(doc.description || "");
                            }}
                            data-testid={`button-edit-doc-${doc.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteDocMutation.mutate(doc.id)}
                            data-testid={`button-delete-doc-${doc.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* ── Upload dialog ── */}
      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setUploadDialogOpen(false);
            setPendingFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {pendingFile && (
              <div className="p-3 rounded-md bg-muted text-sm">
                <p className="font-medium">{pendingFile.name}</p>
                <p className="text-muted-foreground text-xs">{formatBytes(pendingFile.size)}</p>
              </div>
            )}
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                className="mt-1"
                placeholder="Describe the document..."
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                data-testid="input-upload-desc"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUploadDialogOpen(false);
                setPendingFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUploadConfirm}
              disabled={!pendingFile || uploadDocMutation.isPending}
              data-testid="button-confirm-upload"
            >
              {uploadDocMutation.isPending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit doc dialog ── */}
      <Dialog
        open={!!editDocDialog}
        onOpenChange={(open) => {
          if (!open) setEditDocDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>File Name</Label>
              <Input
                className="mt-1"
                value={editDocName}
                onChange={(e) => setEditDocName(e.target.value)}
                data-testid="input-edit-doc-name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                className="mt-1"
                value={editDocDesc}
                onChange={(e) => setEditDocDesc(e.target.value)}
                data-testid="input-edit-doc-desc"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDocDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editDocDialog)
                  editDocMutation.mutate({ id: editDocDialog.id, fileName: editDocName, description: editDocDesc });
              }}
              disabled={editDocMutation.isPending}
              data-testid="button-confirm-edit-doc"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── End Contract dialog ── */}
      <Dialog open={endContractDialogOpen} onOpenChange={setEndContractDialogOpen}>
        <DialogContent data-testid="dialog-end-contract">
          <DialogHeader>
            <DialogTitle>
              End Contract — {worker.firstName} {worker.lastName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-sm text-muted-foreground">
              This will mark the worker as <span className="font-semibold text-foreground">Inactive</span> and hide them
              from all active worker lists and payroll calculations.
            </p>
            <p className="text-sm text-muted-foreground">
              Their history, statement, and documents will remain accessible by filtering for Inactive workers.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEndContractDialogOpen(false)}
              data-testid="button-cancel-end-contract"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => endContractMutation.mutate()}
              disabled={endContractMutation.isPending}
              data-testid="button-confirm-end-contract"
            >
              <UserX className="h-3.5 w-3.5 mr-1.5" />
              {endContractMutation.isPending ? "Ending…" : "End Contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Advance dialog ── */}
      <Dialog open={advanceDialogOpen} onOpenChange={setAdvanceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editAdvance ? "Edit Advance" : "Add Advance"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={advanceDate}
                onChange={(e) => setAdvanceDate(e.target.value)}
                data-testid="input-advance-date"
              />
            </div>
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                className="mt-1"
                placeholder="0.00"
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                data-testid="input-advance-amount"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                className="mt-1"
                placeholder="Reason for advance..."
                value={advanceNotes}
                onChange={(e) => setAdvanceNotes(e.target.value)}
                data-testid="input-advance-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!advanceAmount || isNaN(parseFloat(advanceAmount))) return;
                createAdvanceMutation.mutate({
                  employeeId: worker.id,
                  companyId: selectedCompany?.id ?? 0,
                  advanceDate,
                  amount: advanceAmount,
                  notes: advanceNotes || undefined,
                });
              }}
              disabled={createAdvanceMutation.isPending}
              data-testid="button-confirm-advance"
            >
              {createAdvanceMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
