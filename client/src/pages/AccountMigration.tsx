import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/PageHeader";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowRight, Building2, BookOpen, AlertTriangle, CheckCircle, BarChart3, FileText,
} from "lucide-react";
import type { Company, LedgerAccount } from "@shared/schema";

interface PreviewResult {
  account: LedgerAccount;
  srcCompany: Company;
  destCompany: Company;
  entryCount: number;
  totalDebit: number;
  totalCredit: number;
  touchedVoucherCount: number;
  exclusiveVoucherCount: number;
  sharedVoucherCount: number;
  codeConflict: { id: number; name: string } | null;
}

interface ExecuteResult {
  success: boolean;
  accountId: number;
  accountName: string;
  srcCompanyId: number;
  destCompanyId: number;
  entryCount: number;
  movedVoucherCount: number;
  sharedVoucherCount: number;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function CompanyBadge({ company }: { company?: Company }) {
  if (!company) return null;
  const typeColors: Record<string, string> = {
    erp: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    factory: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    factory_v2: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    properties: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  };
  const label = company.companyType === "erp" ? "ERP"
    : company.companyType === "factory" || company.companyType === "factory_v2" ? "Factory"
    : "Properties";
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${typeColors[company.companyType] ?? typeColors.erp}`}>
      {label}
    </span>
  );
}

export default function AccountMigration() {
  const { toast } = useToast();

  const [srcCompanyId, setSrcCompanyId] = useState<string>("");
  const [destCompanyId, setDestCompanyId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<ExecuteResult | null>(null);

  const { data: companies = [], isLoading: loadingCompanies } = useQuery<Company[]>({
    queryKey: ["/api/admin/account-migration/companies"],
  });

  const { data: srcAccounts = [], isLoading: loadingSrcAccounts } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/admin/account-migration/accounts", srcCompanyId],
    queryFn: () => fetch(`/api/admin/account-migration/accounts/${srcCompanyId}`).then(r => r.json()),
    enabled: !!srcCompanyId,
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/account-migration/preview", {
        accountId: parseInt(accountId),
        srcCompanyId: parseInt(srcCompanyId),
        destCompanyId: parseInt(destCompanyId),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || "Preview failed");
      }
      return res.json() as Promise<PreviewResult>;
    },
    onSuccess: (data) => {
      setPreview(data);
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/account-migration/execute", {
        accountId: parseInt(accountId),
        srcCompanyId: parseInt(srcCompanyId),
        destCompanyId: parseInt(destCompanyId),
        resolveCodeConflict: preview?.codeConflict ? "suffix" : undefined,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || "Migration failed");
      }
      return res.json() as Promise<ExecuteResult>;
    },
    onSuccess: (data) => {
      setLastResult(data);
      setConfirmOpen(false);
      setPreview(null);
      setAccountId("");
      setSrcCompanyId("");
      setDestCompanyId("");
      toast({
        title: "Account migrated",
        description: `"${data.accountName}" moved with ${data.entryCount} entries and ${data.movedVoucherCount} vouchers.`,
      });
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
      setConfirmOpen(false);
      toast({ title: "Migration failed", description: err.message, variant: "destructive" });
    },
  });

  const srcCompany = companies.find(c => c.id === parseInt(srcCompanyId));
  const destCompany = companies.find(c => c.id === parseInt(destCompanyId));
  const selectedAccount = srcAccounts.find(a => a.id === parseInt(accountId));

  const canPreview = !!srcCompanyId && !!destCompanyId && !!accountId && srcCompanyId !== destCompanyId;
  const sortedAccounts = [...srcAccounts].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Account Migration"
        subtitle="Move a ledger account with its complete statement history to another company"
      />

      {/* Last result banner */}
      {lastResult && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-medium text-green-800 dark:text-green-300">Migration complete</p>
                <p className="text-sm text-green-700 dark:text-green-400">
                  <strong>{lastResult.accountName}</strong> moved with{" "}
                  {lastResult.entryCount} entries and {lastResult.movedVoucherCount} exclusive vouchers.
                  {lastResult.sharedVoucherCount > 0 && (
                    <> {lastResult.sharedVoucherCount} shared vouchers remain in source (their entries still show in the account statement).</>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1 — Source */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
            Source — pick company and account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Source company</label>
            {loadingCompanies ? <Skeleton className="h-9 w-full" /> : (
              <Select
                value={srcCompanyId}
                onValueChange={(v) => { setSrcCompanyId(v); setAccountId(""); setPreview(null); setLastResult(null); }}
                data-testid="select-src-company"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select company…" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <span className="flex items-center gap-2">
                        {c.name}
                        <CompanyBadge company={c} />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {srcCompanyId && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Account to move</label>
              {loadingSrcAccounts ? <Skeleton className="h-9 w-full" /> : (
                <Select
                  value={accountId}
                  onValueChange={(v) => { setAccountId(v); setPreview(null); setLastResult(null); }}
                  data-testid="select-account"
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {sortedAccounts.map(a => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                          {a.name}
                          <Badge variant="secondary" className="text-xs">{a.accountType}</Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2 — Destination */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
            Destination company
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingCompanies ? <Skeleton className="h-9 w-full" /> : (
            <Select
              value={destCompanyId}
              onValueChange={(v) => { setDestCompanyId(v); setPreview(null); setLastResult(null); }}
              data-testid="select-dest-company"
            >
              <SelectTrigger>
                <SelectValue placeholder="Select destination company…" />
              </SelectTrigger>
              <SelectContent>
                {companies
                  .filter(c => String(c.id) !== srcCompanyId)
                  .map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      <span className="flex items-center gap-2">
                        {c.name}
                        <CompanyBadge company={c} />
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Preview button */}
      <Button
        className="w-full"
        disabled={!canPreview || previewMutation.isPending}
        onClick={() => previewMutation.mutate()}
        data-testid="button-preview-migration"
      >
        {previewMutation.isPending ? "Loading preview…" : "Preview migration"}
      </Button>

      {/* Preview panel */}
      {preview && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Migration preview
            </CardTitle>
            <CardDescription>
              Review what will happen before executing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Route */}
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
              <div className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">{preview.srcCompany?.name}</span>
                <CompanyBadge company={preview.srcCompany} />
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">{preview.destCompany?.name}</span>
                <CompanyBadge company={preview.destCompany} />
              </div>
            </div>

            {/* Account details */}
            <div className="p-3 rounded-md border space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{preview.account.name}</span>
                </div>
                <Badge variant="secondary">{preview.account.accountType}</Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono">Code: {preview.account.code}</p>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-md bg-muted/40 space-y-0.5">
                <p className="text-xs text-muted-foreground">Transaction entries</p>
                <p className="text-lg font-semibold">{preview.entryCount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/40 space-y-0.5">
                <p className="text-xs text-muted-foreground">Vouchers touched</p>
                <p className="text-lg font-semibold">{preview.touchedVoucherCount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/40 space-y-0.5">
                <p className="text-xs text-muted-foreground">Total debits</p>
                <p className="font-mono font-semibold text-sm">{fmt(preview.totalDebit)}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/40 space-y-0.5">
                <p className="text-xs text-muted-foreground">Total credits</p>
                <p className="font-mono font-semibold text-sm">{fmt(preview.totalCredit)}</p>
              </div>
            </div>

            {/* Voucher split */}
            {preview.touchedVoucherCount > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                  Voucher breakdown
                </p>
                <div className="text-sm text-muted-foreground space-y-1 pl-5">
                  <p>
                    <span className="font-medium text-foreground">{preview.exclusiveVoucherCount}</span>{" "}
                    exclusive vouchers will move to destination company
                  </p>
                  {preview.sharedVoucherCount > 0 && (
                    <p>
                      <span className="font-medium text-foreground">{preview.sharedVoucherCount}</span>{" "}
                      shared vouchers stay in source — entries still appear in account statement
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Code conflict warning */}
            {preview.codeConflict && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <p className="font-medium">Account code conflict</p>
                  <p>Code <span className="font-mono">{preview.account.code}</span> already exists in destination as <strong>"{preview.codeConflict.name}"</strong>. The migrated account will be renamed to <span className="font-mono">{preview.account.code}-MIGRATED</span>.</p>
                </div>
              </div>
            )}

            {/* No entries info */}
            {preview.entryCount === 0 && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                <AlertTriangle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  This account has no transactions. Only the account record will be moved.
                </p>
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => setConfirmOpen(true)}
              data-testid="button-execute-migration"
            >
              Move account to {preview.destCompany?.name}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm account migration
            </DialogTitle>
            <DialogDescription>
              This operation directly modifies the database and cannot be undone from this screen.
              The account and its full statement history will be moved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="p-3 rounded-md bg-muted/50 text-sm space-y-1">
              <p><span className="text-muted-foreground">Account:</span> <strong>{preview?.account.name}</strong></p>
              <p><span className="text-muted-foreground">From:</span> <strong>{preview?.srcCompany?.name}</strong></p>
              <p><span className="text-muted-foreground">To:</span> <strong>{preview?.destCompany?.name}</strong></p>
              <p><span className="text-muted-foreground">Entries:</span> <strong>{preview?.entryCount.toLocaleString()}</strong></p>
              <p><span className="text-muted-foreground">Vouchers moving:</span> <strong>{preview?.exclusiveVoucherCount.toLocaleString()}</strong></p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} data-testid="button-cancel-migration">
              Cancel
            </Button>
            <Button
              onClick={() => executeMutation.mutate()}
              disabled={executeMutation.isPending}
              data-testid="button-confirm-migration"
            >
              {executeMutation.isPending ? "Migrating…" : "Yes, move account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
