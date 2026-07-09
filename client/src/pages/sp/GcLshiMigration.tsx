import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Play,
  RotateCcw,
  Plus,
  DollarSign,
  Package,
  FileText,
  Layers,
  Lock,
  type LucideIcon,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Company {
  id: number;
  code: string;
  name: string;
  company_type: string;
  companyType?: string;
}

interface GcPreview {
  sourceCompany: { id: number; code: string; name: string };
  targetCompany: { id: number; code: string; name: string };
  stockSummary: { itemCount: number; totalQty: number; totalValueUsd: number; alreadyMapped: number };
  stockItems: Array<{
    code: string;
    name: string;
    quantity: number;
    averageCostUsd: number;
    totalValueUsd: number;
    aliasExists: boolean;
  }>;
  voucherSummary: { sourceCount: number; totalAmount: number; alreadyMigrated: number };
  spAccountsStatus: Array<{ subType: string; name: string; exists: boolean }>;
  gcProfitAccountsStatus: Array<{ subType: string; name: string; exists: boolean }>;
  warnings: string[];
}

interface MigrationRun {
  id: string;
  source_company_id: number;
  target_company_id: number;
  action: string;
  status: string;
  rows_created: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  notes: string | null;
  source_name: string;
  target_name: string;
}

interface MigProgress {
  pct: number;
  step: string;
  detail?: string;
}

// ── StatusBadge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    completed: { variant: "default", label: "Completed" },
    running: { variant: "secondary", label: "Running" },
    failed: { variant: "destructive", label: "Failed" },
    rolled_back: { variant: "outline", label: "Rolled Back" },
  };
  const cfg = map[status] ?? { variant: "secondary", label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function GcLshiMigration() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Company selection state
  const [sourceCompanyId, setSourceCompanyId] = useState<number | null>(null);
  const [targetCompanyId, setTargetCompanyId] = useState<number | null>(null);

  // Preview open state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [stockTableOpen, setStockTableOpen] = useState(false);

  // Migration confirmation dialog
  const [showMigrateDialog, setShowMigrateDialog] = useState(false);
  const [migrateConfirmName, setMigrateConfirmName] = useState("");

  // Account plan / rename state (Step 2.5 — before Run Migration)
  const [accountEdits, setAccountEdits] = useState<Record<string, { code: string; name: string }>>({});
  const [accountsCreated, setAccountsCreated] = useState(false);

  // Live migration progress
  const [migrating, setMigrating] = useState(false);
  const [migProgress, setMigProgress] = useState<MigProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Opening balance
  const [obAmount, setObAmount] = useState("");
  const [obDate, setObDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [obNarration, setObNarration] = useState("GC Opening Cash Balance");
  const [obCashAccountId, setObCashAccountId] = useState<number | null>(null);

  // Rollback confirmation
  const [rollbackRunId, setRollbackRunId] = useState<string | null>(null);

  // Create company dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("GC-LSHI");
  const [createCode, setCreateCode] = useState("GC-LSHI-SP");

  // ── Role gate ────────────────────────────────────────────────────────────

  const { data: sessionRole, isLoading: roleLoading } = useQuery<{ role: string }>({
    queryKey: ["/api/sp/migration/session-role"],
  });

  // ── Queries ─────────────────────────────────────────────────────────────

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const erpCompanies = (companies ?? []).filter((c) => (c.company_type ?? c.companyType) === "erp");
  const spCompanies = (companies ?? []).filter((c) => (c.company_type ?? c.companyType) === "supplier_partner");

  const {
    data: preview,
    isLoading: previewLoading,
    refetch: refetchPreview,
    error: previewError,
  } = useQuery<GcPreview>({
    queryKey: ["/api/sp/migration/gc-preview", sourceCompanyId, targetCompanyId],
    queryFn: async () => {
      const r = await fetch(
        `/api/sp/migration/gc-preview?sourceCompanyId=${sourceCompanyId}&targetCompanyId=${targetCompanyId}`
      );
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.message);
      }
      return r.json();
    },
    enabled: !!(sourceCompanyId && targetCompanyId),
    retry: false,
  });

  const { data: runsData, refetch: refetchRuns } = useQuery<{ runs: MigrationRun[] }>({
    queryKey: ["/api/sp/migration/runs"],
  });

  interface AccountPlanRow {
    subType: string;
    accountType: string;
    defaultCode: string;
    defaultName: string;
    exists: boolean;
    currentCode: string;
    currentName: string;
    group: "sp" | "gc";
  }

  const {
    data: accountPlan,
    isLoading: accountPlanLoading,
    refetch: refetchAccountPlan,
  } = useQuery<{ accounts: AccountPlanRow[] }>({
    queryKey: ["/api/sp/migration/gc-account-plan", targetCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/sp/migration/gc-account-plan?targetCompanyId=${targetCompanyId}`);
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.message);
      }
      return r.json();
    },
    enabled: !!targetCompanyId,
  });

  const { data: cashAccountsData } = useQuery<{
    accounts: Array<{ id: number; code: string; name: string; account_type: string }>;
  }>({
    queryKey: ["/api/sp/migration/cash-accounts", targetCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/sp/migration/cash-accounts?targetCompanyId=${targetCompanyId}`);
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.message);
      }
      return r.json();
    },
    enabled: !!targetCompanyId,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createCompanyMutation = useMutation({
    mutationFn: (body: { name: string; code: string }) =>
      apiRequest("POST", "/api/sp/migration/create-sp-company", body),
    onSuccess: async (data: any) => {
      const result = await data.json();
      toast({
        title: "Company created",
        description: `${result.company.name} (${result.company.code}) created successfully.`,
      });
      setShowCreateDialog(false);
      qc.invalidateQueries({ queryKey: ["/api/companies"] });
      setTargetCompanyId(result.company.id);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openingBalanceMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/sp/migration/opening-balance", body),
    onSuccess: async (data: any) => {
      const result = await data.json();
      toast({ title: "Opening balance created", description: `Voucher ${result.voucherNumber} for $${result.amount}` });
      setObAmount("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createAccountsMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/sp/migration/gc-create-accounts", body),
    onSuccess: async (data: any) => {
      const result = await data.json();
      toast({
        title: "Accounts created",
        description: result.createdCount > 0 ? `Created: ${result.created.join(", ")}` : "All accounts already exist.",
      });
      setAccountsCreated(true);
      refetchAccountPlan();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rollbackMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", "/api/sp/migration/rollback", { runId }),
    onSuccess: async () => {
      toast({ title: "Rollback complete", description: "All rows from that run have been deleted." });
      setRollbackRunId(null);
      refetchRuns();
      refetchPreview();
    },
    onError: (e: any) => toast({ title: "Rollback failed", description: e.message, variant: "destructive" }),
  });

  // ── SSE migration runner ──────────────────────────────────────────────────

  async function runMigration() {
    if (!sourceCompanyId || !targetCompanyId || !migrateConfirmName) return;

    setMigrating(true);
    setMigProgress({ pct: 0, step: "Starting migration…" });
    setShowMigrateDialog(false);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch("/api/sp/migration/gc-rehearsal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCompanyId,
          targetCompanyId,
          companyNameConfirm: migrateConfirmName,
          confirmation: "MIGRATE",
          accountOverrides: accountEdits,
        }),
        signal: abort.signal,
        credentials: "include",
      });

      // Pre-SSE validation errors arrive as JSON (4xx/5xx)
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message ?? "Migration failed");
      }

      // Parse SSE events from the streaming response body
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newline
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const msg of messages) {
          const dataLine = msg.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          let event: any;
          try {
            event = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }

          if (event.type === "progress") {
            setMigProgress({ pct: event.pct, step: event.step, detail: event.detail });
          } else if (event.type === "done") {
            setMigProgress({ pct: 100, step: "Complete!" });
            setTimeout(() => {
              setMigrating(false);
              setMigProgress(null);
              setMigrateConfirmName("");
            }, 1200);
            toast({
              title: "Migration complete",
              description: `${event.rowsCreated} rows created. Run ID: ${String(event.runId).slice(0, 8)}`,
            });
            refetchPreview();
            refetchRuns();
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Migration failed");
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setMigrating(false);
      setMigProgress(null);
      toast({ title: "Migration failed", description: err.message, variant: "destructive" });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  const sourceComp = erpCompanies.find((c) => c.id === sourceCompanyId);
  const targetComp = spCompanies.find((c) => c.id === targetCompanyId);
  const allRuns = runsData?.runs ?? [];

  function fmt(n: number) {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Role gate ────────────────────────────────────────────────────────────

  if (roleLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
        <RefreshCw className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (sessionRole?.role !== "Developer") {
    return (
      <div className="p-6 max-w-md mx-auto mt-16 text-center space-y-4">
        <div className="flex justify-center">
          <div className="rounded-full bg-muted p-4">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>
        <h2 className="text-xl font-semibold">Developer access required</h2>
        <p className="text-muted-foreground text-sm">
          The GC Migration tool is restricted to the Developer role. Your current role is{" "}
          <span className="font-medium">{sessionRole?.role ?? "unknown"}</span>.
        </p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="h-6 w-6 text-muted-foreground" />
          GC-LSHI → SP Migration
        </h1>
        <p className="text-muted-foreground mt-1">
          Migrate an ERP company's stock, accounts, and historical sale vouchers into a new Supplier Partner company.
        </p>
        <Badge variant="outline" className="mt-2 text-xs gap-1">
          <Lock className="h-3 w-3" /> Developer only
        </Badge>
      </div>

      {/* Step 1 — Company Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Step 1 — Select Companies
          </CardTitle>
          <CardDescription>Choose the source ERP company and the target SP company.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Source */}
            <div className="space-y-2">
              <Label>Source ERP Company</Label>
              <select
                className="w-full border rounded-md h-9 px-3 text-sm bg-background"
                value={sourceCompanyId ?? ""}
                onChange={(e) => setSourceCompanyId(e.target.value ? Number(e.target.value) : null)}
                data-testid="select-source-company"
              >
                <option value="">— select ERP company —</option>
                {erpCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
              {sourceComp && <p className="text-xs text-muted-foreground">ID: {sourceComp.id} · Type: ERP</p>}
            </div>

            {/* Target */}
            <div className="space-y-2">
              <Label>Target SP Company</Label>
              <div className="flex gap-2">
                <select
                  className="flex-1 border rounded-md h-9 px-3 text-sm bg-background"
                  value={targetCompanyId ?? ""}
                  onChange={(e) => setTargetCompanyId(e.target.value ? Number(e.target.value) : null)}
                  data-testid="select-target-company"
                >
                  <option value="">— select SP company —</option>
                  {spCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowCreateDialog(true)}
                  title="Create new SP company"
                  data-testid="button-create-sp-company"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {targetComp && (
                <p className="text-xs text-muted-foreground">ID: {targetComp.id} · Type: Supplier Partner</p>
              )}
            </div>
          </div>

          {sourceCompanyId && targetCompanyId && (
            <Button
              variant="outline"
              onClick={() => {
                setPreviewOpen(true);
                refetchPreview();
              }}
              data-testid="button-load-preview"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Load Preview
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Step 2 — Preview */}
      {previewOpen && sourceCompanyId && targetCompanyId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Step 2 — Migration Preview
            </CardTitle>
            <CardDescription>Review what will be created in the target SP company.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {previewLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <RefreshCw className="h-4 w-4 animate-spin" /> Loading preview…
              </div>
            )}

            {previewError && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <XCircle className="h-4 w-4" />
                {(previewError as Error).message}
              </div>
            )}

            {preview && !previewLoading && (
              <div className="space-y-4">
                {/* Warnings */}
                {preview.warnings.length > 0 && (
                  <div className="space-y-1">
                    {preview.warnings.map((w, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-md px-3 py-2"
                      >
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        {w}
                      </div>
                    ))}
                  </div>
                )}

                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground">Stock Items</p>
                    <p className="text-lg font-semibold">{preview.stockSummary.itemCount}</p>
                    <p className="text-xs text-muted-foreground">{preview.stockSummary.alreadyMapped} already mapped</p>
                  </div>
                  <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground">Total Stock Value</p>
                    <p className="text-lg font-semibold">${fmt(preview.stockSummary.totalValueUsd)}</p>
                    <p className="text-xs text-muted-foreground">{fmt(preview.stockSummary.totalQty)} units</p>
                  </div>
                  <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground">Sale Vouchers</p>
                    <p className="text-lg font-semibold">{preview.voucherSummary.sourceCount}</p>
                    <p className="text-xs text-muted-foreground">
                      {preview.voucherSummary.alreadyMigrated} already migrated
                    </p>
                  </div>
                  <div className="rounded-md border p-3 space-y-0.5">
                    <p className="text-xs text-muted-foreground">Voucher Total</p>
                    <p className="text-lg font-semibold">${fmt(preview.voucherSummary.totalAmount)}</p>
                    <p className="text-xs text-muted-foreground">historical sales</p>
                  </div>
                </div>

                {/* Accounts */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">SP Accounts (10 standard)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.spAccountsStatus.map((a) => (
                      <Badge key={a.subType} variant={a.exists ? "secondary" : "outline"} className="gap-1">
                        {a.exists ? (
                          <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        {a.name}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-sm font-medium mt-2">GC Profit Accounts (2 new)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.gcProfitAccountsStatus.map((a) => (
                      <Badge key={a.subType} variant={a.exists ? "secondary" : "outline"} className="gap-1">
                        {a.exists ? (
                          <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        {a.name}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Stock item table (collapsible) */}
                <Collapsible open={stockTableOpen} onOpenChange={setStockTableOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-muted-foreground"
                      data-testid="button-toggle-stock-table"
                    >
                      {stockTableOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Package className="h-4 w-4" />
                      Show stock items ({preview.stockItems.length})
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 border rounded-md overflow-auto max-h-72">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Code</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Avg Cost</TableHead>
                            <TableHead className="text-right">Value</TableHead>
                            <TableHead className="text-center">Alias</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.stockItems.map((item) => (
                            <TableRow key={item.code}>
                              <TableCell className="font-mono text-xs">{item.code}</TableCell>
                              <TableCell className="text-sm">{item.name}</TableCell>
                              <TableCell className="text-right text-sm">{item.quantity.toLocaleString()}</TableCell>
                              <TableCell className="text-right text-sm">${fmt(item.averageCostUsd)}</TableCell>
                              <TableCell className="text-right text-sm">${fmt(item.totalValueUsd)}</TableCell>
                              <TableCell className="text-center">
                                {item.aliasExists ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" />
                                ) : (
                                  <Plus className="h-4 w-4 text-muted-foreground mx-auto" />
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2.5 — Account Plan / Rename */}
      {targetCompanyId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" />
              Step 2.5 — Chart of Accounts
            </CardTitle>
            <CardDescription>
              Review the accounts that will be created in {targetComp?.name ?? "the target company"}. Rename any
              code/name before creating — names cannot be changed here after creation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {accountPlanLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <RefreshCw className="h-4 w-4 animate-spin" /> Loading account plan…
              </div>
            )}
            {accountPlan && (
              <>
                <div className="border rounded-md overflow-auto max-h-80">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accountPlan.accounts.map((a) => {
                        const edit = accountEdits[a.subType] ?? { code: a.currentCode, name: a.currentName };
                        return (
                          <TableRow key={a.subType}>
                            <TableCell>
                              {a.exists ? (
                                <Badge variant="secondary" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" /> Exists
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="gap-1">
                                  <Plus className="h-3 w-3" /> New
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-28 font-mono text-xs"
                                value={edit.code}
                                disabled={a.exists}
                                onChange={(e) =>
                                  setAccountEdits((prev) => ({
                                    ...prev,
                                    [a.subType]: { ...edit, code: e.target.value },
                                  }))
                                }
                                data-testid={`input-account-code-${a.subType}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 w-56 text-sm"
                                value={edit.name}
                                disabled={a.exists}
                                onChange={(e) =>
                                  setAccountEdits((prev) => ({
                                    ...prev,
                                    [a.subType]: { ...edit, name: e.target.value },
                                  }))
                                }
                                data-testid={`input-account-name-${a.subType}`}
                              />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{a.accountType}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    const accounts = accountPlan.accounts
                      .filter((a) => !a.exists)
                      .map((a) => {
                        const edit = accountEdits[a.subType];
                        return { subType: a.subType, code: edit?.code ?? a.currentCode, name: edit?.name ?? a.currentName };
                      });
                    if (!accounts.length) {
                      toast({ title: "Nothing to create", description: "All accounts already exist." });
                      return;
                    }
                    createAccountsMutation.mutate({ targetCompanyId, accounts });
                  }}
                  disabled={createAccountsMutation.isPending}
                  data-testid="button-create-accounts"
                >
                  {createAccountsMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Create Missing Accounts
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Run Migration */}
      {sourceCompanyId && targetCompanyId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Play className="h-4 w-4" />
              Step 3 — Run Migration
            </CardTitle>
            <CardDescription>
              Copies stock, accounts, GC profit accounts, and historical sale vouchers from{" "}
              {sourceComp?.name ?? "source"} into {targetComp?.name ?? "target"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={() => setShowMigrateDialog(true)} disabled={migrating} data-testid="button-run-migration">
              {migrating ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Migrating…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run GC Migration
                </>
              )}
            </Button>

            {/* Live progress bar */}
            {migrating && migProgress && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{migProgress.step}</span>
                  <span>{migProgress.pct}%</span>
                </div>
                <Progress value={migProgress.pct} className="h-2" />
                {migProgress.detail && <p className="text-xs text-muted-foreground">{migProgress.detail}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4 — Opening Balance */}
      {targetCompanyId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" />
              Step 4 — Opening Cash Balance
            </CardTitle>
            <CardDescription>Creates a Journal voucher: Dr Cash → Cr Opening Balance Clearing.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <div className="space-y-1">
                <Label>Cash / Bank Account</Label>
                {(cashAccountsData?.accounts ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No Cash or Bank accounts found in target company. Run the migration first to create SP accounts, or
                    add a Cash account manually.
                  </p>
                ) : (
                  <select
                    className="w-full border rounded-md h-9 px-3 text-sm bg-background"
                    value={obCashAccountId ?? ""}
                    onChange={(e) => setObCashAccountId(e.target.value ? Number(e.target.value) : null)}
                    data-testid="select-ob-cash-account"
                  >
                    <option value="">— select cash/bank account —</option>
                    {(cashAccountsData?.accounts ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.account_type})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-amount">Amount (USD)</Label>
                <Input
                  id="ob-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={obAmount}
                  onChange={(e) => setObAmount(e.target.value)}
                  data-testid="input-ob-amount"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-date">Date</Label>
                <Input
                  id="ob-date"
                  type="date"
                  value={obDate}
                  onChange={(e) => setObDate(e.target.value)}
                  data-testid="input-ob-date"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ob-narration">Narration</Label>
                <Input
                  id="ob-narration"
                  value={obNarration}
                  onChange={(e) => setObNarration(e.target.value)}
                  data-testid="input-ob-narration"
                />
              </div>
            </div>
            <Button
              className="mt-3"
              onClick={() =>
                openingBalanceMutation.mutate({
                  targetCompanyId,
                  cashAccountId: obCashAccountId,
                  amount: obAmount,
                  date: obDate,
                  narration: obNarration,
                })
              }
              disabled={!obCashAccountId || !obAmount || !obDate || openingBalanceMutation.isPending}
              data-testid="button-submit-opening-balance"
            >
              {openingBalanceMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <DollarSign className="h-4 w-4 mr-2" />
                  Post Opening Balance
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 4.5 — Stage 2 Full Rehearsal (location-aware stock, read-only sales, containers, profit-share) */}
      {sourceCompanyId && targetCompanyId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              Step 4.5 — Full Rehearsal (Stage 2)
            </CardTitle>
            <CardDescription>
              Run each area independently. All steps are idempotent and safe to re-run; only tracked rows are ever
              touched on rollback, and the source ERP company is never modified.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              {
                key: "stockOpening",
                label: "Location-aware Stock Opening",
                icon: Package,
                endpoint: "/api/sp/migration/gc-stock-opening",
                extraBody: {},
              },
              {
                key: "salesReadonly",
                label: "Historical Sales (read-only)",
                icon: FileText,
                endpoint: "/api/sp/migration/gc-sales-readonly",
                extraBody: {},
              },
              {
                key: "containers",
                label: "Containers → SP",
                icon: Building2,
                endpoint: "/api/sp/migration/gc-containers",
                extraBody: {},
              },
            ].map((step) => (
              <Stage2StepRunner
                key={step.key}
                label={step.label}
                Icon={step.icon}
                endpoint={step.endpoint}
                sourceCompanyId={sourceCompanyId}
                targetCompanyId={targetCompanyId}
                sourceCompanyName={sourceComp?.name}
                onDone={() => {
                  refetchRuns();
                  refetchPreview();
                }}
              />
            ))}

            <div className="border-t pt-4">
              <ProfitOpeningRunner targetCompanyId={targetCompanyId} onDone={() => refetchRuns()} />
            </div>

            <div className="border-t pt-4">
              <ReconciliationRunner sourceCompanyId={sourceCompanyId} targetCompanyId={targetCompanyId} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5 — Run History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4" />
            Step 5 — Run History &amp; Rollback
          </CardTitle>
          <CardDescription>All migration runs. You can rollback any non-rolled-back run.</CardDescription>
        </CardHeader>
        <CardContent>
          {allRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allRuns.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {String(run.id).slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {run.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{run.source_name}</TableCell>
                      <TableCell className="text-sm">{run.target_name}</TableCell>
                      <TableCell className="text-right text-sm">{run.rows_created}</TableCell>
                      <TableCell>
                        <StatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(run.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {run.status !== "rolled_back" && run.status !== "running" && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setRollbackRunId(run.id)}
                            disabled={rollbackMutation.isPending}
                            data-testid={`button-rollback-${run.id}`}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Rollback
                          </Button>
                        )}
                        {run.error_message && (
                          <p className="text-xs text-destructive mt-1">{run.error_message.slice(0, 60)}</p>
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

      {/* Create Company Dialog */}
      <AlertDialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create New SP Company</AlertDialogTitle>
            <AlertDialogDescription>This creates a new Supplier Partner company in the system.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Company Name</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="GC-LSHI"
                data-testid="input-create-company-name"
              />
            </div>
            <div className="space-y-1">
              <Label>Company Code (unique)</Label>
              <Input
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
                placeholder="GC-LSHI-SP"
                data-testid="input-create-company-code"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-create-company">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => createCompanyMutation.mutate({ name: createName, code: createCode })}
              disabled={!createName || !createCode || createCompanyMutation.isPending}
              data-testid="button-confirm-create-company"
            >
              {createCompanyMutation.isPending ? "Creating…" : "Create Company"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Migration Confirmation Dialog */}
      <AlertDialog
        open={showMigrateDialog}
        onOpenChange={(open) => {
          if (!open && !migrating) setShowMigrateDialog(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm GC Migration</AlertDialogTitle>
            <AlertDialogDescription>
              This will copy stock items, opening stock movements, SP accounts, GC profit accounts, and historical sale
              vouchers from <strong>{sourceComp?.name}</strong> into <strong>{targetComp?.name}</strong>.
              <br />
              <br />
              Type the source company name exactly to confirm:
              <strong className="block mt-1">{sourceComp?.name}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              placeholder={sourceComp?.name}
              value={migrateConfirmName}
              onChange={(e) => setMigrateConfirmName(e.target.value)}
              data-testid="input-migrate-confirm-name"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-migrate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runMigration}
              disabled={migrateConfirmName !== sourceComp?.name}
              data-testid="button-confirm-migrate"
            >
              Run Migration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rollback Confirmation Dialog */}
      <AlertDialog
        open={!!rollbackRunId}
        onOpenChange={(open) => {
          if (!open) setRollbackRunId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback Run {rollbackRunId?.slice(0, 8)}</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all rows created by this migration run from the target company. The source
              ERP company will not be touched. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-rollback">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => rollbackRunId && rollbackMutation.mutate(rollbackRunId)}
              disabled={rollbackMutation.isPending}
              data-testid="button-confirm-rollback"
            >
              {rollbackMutation.isPending ? "Rolling back…" : "Rollback"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Stage 2 step runner (stock-opening / sales-readonly / containers) ──────

function Stage2StepRunner({
  label,
  Icon,
  endpoint,
  sourceCompanyId,
  targetCompanyId,
  sourceCompanyName,
  onDone,
}: {
  label: string;
  Icon: LucideIcon;
  endpoint: string;
  sourceCompanyId: number;
  targetCompanyId: number;
  sourceCompanyName?: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [result, setResult] = useState<any>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", endpoint, {
        sourceCompanyId,
        targetCompanyId,
        companyNameConfirm: confirmName,
        confirmation: "MIGRATE",
      }),
    onSuccess: async (data: any) => {
      const r = await data.json();
      setResult(r);
      setConfirmOpen(false);
      setConfirmName("");
      toast({ title: `${label} complete`, description: `${r.rowsCreated} row(s) created.` });
      onDone();
    },
    onError: (e: any) => toast({ title: `${label} failed`, description: e.message, variant: "destructive" }),
  });

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {label}
        </div>
        <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)} data-testid={`button-run-${endpoint.split("/").pop()}`}>
          <Play className="h-3 w-3 mr-1" /> Run
        </Button>
      </div>
      {result && (
        <div className="text-xs space-y-1 bg-muted/50 rounded p-2">
          {(result.summary ?? []).map((s: string, i: number) => (
            <p key={i}>{s}</p>
          ))}
          {(result.warnings ?? []).length > 0 && (
            <div className="text-amber-600 dark:text-amber-400 space-y-0.5 mt-1">
              {result.warnings.map((w: string, i: number) => (
                <p key={i} className="flex gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" /> {w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !mutation.isPending && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm: {label}</AlertDialogTitle>
            <AlertDialogDescription>
              Type the source company name exactly to confirm:
              <strong className="block mt-1">{sourceCompanyName}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={sourceCompanyName} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => mutation.mutate()}
              disabled={confirmName !== sourceCompanyName || mutation.isPending}
            >
              {mutation.isPending ? "Running…" : "Run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Profit-share opening balance runner ─────────────────────────────────────

function ProfitOpeningRunner({ targetCompanyId, onDone }: { targetCompanyId: number; onDone: () => void }) {
  const { toast } = useToast();
  const [cutoffDate, setCutoffDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [accumulatedProfit, setAccumulatedProfit] = useState("");
  const [ourSplitPct, setOurSplitPct] = useState("50");
  const [result, setResult] = useState<any>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/sp/migration/gc-profit-opening", {
        targetCompanyId,
        cutoffDate,
        accumulatedProfit,
        ourSplitPct,
      }),
    onSuccess: async (data: any) => {
      const r = await data.json();
      setResult(r);
      toast({ title: "Profit-share opening balance posted", description: `Voucher ${r.voucherNumber}` });
      onDone();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        Profit-Share Opening Balance
      </div>
      <p className="text-xs text-muted-foreground">
        Posts a balanced journal: Dr Accumulated Profit Clearing → Cr Our Share + Cr Supplier Share.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <div className="space-y-1">
          <Label>Cutoff Date</Label>
          <Input type="date" value={cutoffDate} onChange={(e) => setCutoffDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Accumulated Profit (USD)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={accumulatedProfit}
            onChange={(e) => setAccumulatedProfit(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-1">
          <Label>Our Split %</Label>
          <Input type="number" min="0" max="100" step="1" value={ourSplitPct} onChange={(e) => setOurSplitPct(e.target.value)} />
        </div>
      </div>
      <Button
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={!cutoffDate || !accumulatedProfit || mutation.isPending}
        data-testid="button-run-profit-opening"
      >
        {mutation.isPending ? "Posting…" : "Post Opening Balance"}
      </Button>
      {result && (
        <p className="text-xs text-muted-foreground">
          Our share: ${fmtNum(result.ourShare)} · Supplier share: ${fmtNum(result.supplierShare)} (voucher {result.voucherNumber})
        </p>
      )}
    </div>
  );
}

// ── Final reconciliation report ─────────────────────────────────────────────

function ReconciliationRunner({
  sourceCompanyId,
  targetCompanyId,
}: {
  sourceCompanyId: number;
  targetCompanyId: number;
}) {
  const [report, setReport] = useState<{ overall: string; areas: Array<{ area: string; status: string; detail: string }> } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const r = await fetch(`/api/sp/migration/gc-reconciliation?sourceCompanyId=${sourceCompanyId}&targetCompanyId=${targetCompanyId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      setReport(data);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          Final Reconciliation Report
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={loading} data-testid="button-run-reconciliation">
          {loading ? "Checking…" : "Check"}
        </Button>
      </div>
      {report && (
        <div className="border rounded-md overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.areas.map((a) => (
                <TableRow key={a.area}>
                  <TableCell className="text-sm">{a.area}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "PASS" ? "default" : a.status === "FAIL" ? "destructive" : "secondary"}>
                      {a.status === "PASS" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {a.status === "FAIL" && <XCircle className="h-3 w-3 mr-1" />}
                      {a.status === "WARN" && <AlertTriangle className="h-3 w-3 mr-1" />}
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function fmtNum(n: number) {
  return (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
