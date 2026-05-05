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
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  ArrowRight, Building2, BookOpen, AlertTriangle, CheckCircle, BarChart3, FileText,
  ChevronsUpDown, Check, Wallet, Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  openingBalance: string;
  openingBalanceSide: string;
}

interface ExecuteResult {
  success: boolean;
  accountId: number;
  accountName: string;
  originalCode: string;
  finalCode: string;
  srcCompanyId: number;
  destCompanyId: number;
  entryCount: number;
  movedVoucherCount: number;
  movedVoucherIds: number[];
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

interface AccountComboboxProps {
  accounts: LedgerAccount[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

function AccountCombobox({ accounts, value, onChange, disabled }: AccountComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find(a => String(a.id) === value);

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid="select-account"
        >
          {selected ? (
            <span className="flex items-center gap-2 truncate">
              <span className="font-mono text-xs text-muted-foreground shrink-0">{selected.code}</span>
              <span className="truncate">{selected.name}</span>
              <Badge variant="secondary" className="text-xs shrink-0">{selected.accountType}</Badge>
            </span>
          ) : (
            <span className="text-muted-foreground">Search account…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Type account name or code…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup>
              {[...accounts].sort((a, b) => a.name.localeCompare(b.name)).map(a => (
                <CommandItem
                  key={a.id}
                  value={`${a.code} ${a.name} ${a.accountType}`}
                  onSelect={() => {
                    onChange(String(a.id));
                    setOpen(false);
                  }}
                  className="flex items-center gap-2"
                >
                  <Check className={cn("h-4 w-4 shrink-0", String(a.id) === value ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">{a.code}</span>
                  <span className="flex-1 truncate">{a.name}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">{a.accountType}</Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function AccountMigration() {
  const { toast } = useToast();

  const [srcCompanyId, setSrcCompanyId] = useState<string>("");
  const [destCompanyId, setDestCompanyId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [undoConfirmOpen, setUndoConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<ExecuteResult | null>(null);
  const [undoDone, setUndoDone] = useState(false);

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
    onSuccess: (data) => setPreview(data),
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
      setUndoDone(false);
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

  const undoMutation = useMutation({
    mutationFn: async () => {
      if (!lastResult) throw new Error("Nothing to undo");
      const res = await apiRequest("POST", "/api/admin/account-migration/undo", {
        accountId: lastResult.accountId,
        srcCompanyId: lastResult.srcCompanyId,
        destCompanyId: lastResult.destCompanyId,
        originalCode: lastResult.originalCode,
        movedVoucherIds: lastResult.movedVoucherIds,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || "Undo failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setUndoConfirmOpen(false);
      setUndoDone(true);
      toast({ title: "Migration undone", description: `"${lastResult?.accountName}" has been moved back to the original company.` });
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
      setUndoConfirmOpen(false);
      toast({ title: "Undo failed", description: err.message, variant: "destructive" });
    },
  });

  const srcCompany = companies.find(c => c.id === parseInt(srcCompanyId));
  const destCompany = companies.find(c => c.id === parseInt(destCompanyId));

  const canPreview = !!srcCompanyId && !!destCompanyId && !!accountId && srcCompanyId !== destCompanyId;

  const obAmount = parseFloat(preview?.account.openingBalance || "0");
  const hasOB = obAmount !== 0;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader
        title="Account Migration"
        subtitle="Move a ledger account with its complete statement history to another company"
      />

      {/* Last result banner */}
      {lastResult && (
        <Card className={undoDone
          ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20"
          : "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20"
        }>
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              {undoDone
                ? <Undo2 className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                : <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              }
              <div className="flex-1 space-y-1">
                {undoDone ? (
                  <>
                    <p className="font-medium text-amber-800 dark:text-amber-300">Migration undone</p>
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      <strong>{lastResult.accountName}</strong> has been moved back to its original company.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-green-800 dark:text-green-300">Migration complete</p>
                    <p className="text-sm text-green-700 dark:text-green-400">
                      <strong>{lastResult.accountName}</strong> moved with{" "}
                      {lastResult.entryCount} entries and {lastResult.movedVoucherCount} exclusive vouchers.
                      {lastResult.sharedVoucherCount > 0 && (
                        <> {lastResult.sharedVoucherCount} shared vouchers remain in source (their entries still show in the account statement).</>
                      )}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => setUndoConfirmOpen(true)}
                      data-testid="button-undo-migration"
                    >
                      <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                      Undo migration
                    </Button>
                  </>
                )}
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
              {loadingSrcAccounts ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <AccountCombobox
                  accounts={srcAccounts}
                  value={accountId}
                  onChange={(v) => { setAccountId(v); setPreview(null); setLastResult(null); }}
                />
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

            {/* Opening balance */}
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40">
              <Wallet className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-sm space-y-0.5">
                <p className="font-medium">Opening balance included</p>
                {hasOB ? (
                  <p className="text-muted-foreground">
                    <span className="font-mono font-medium text-foreground">{fmt(obAmount)}</span>{" "}
                    <span className="font-medium text-foreground">{preview.account.openingBalanceSide}</span>
                    {" "}— will move to destination along with all transactions
                  </p>
                ) : (
                  <p className="text-muted-foreground">No opening balance set — account starts at zero</p>
                )}
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
                  This account has no transactions. Only the account record (including opening balance) will be moved.
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

      {/* Undo confirmation dialog */}
      <Dialog open={undoConfirmOpen} onOpenChange={setUndoConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-amber-500" />
              Undo migration
            </DialogTitle>
            <DialogDescription>
              This will move the account back to its original company. Any transactions posted to this account after the migration will still be visible in the statement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="p-3 rounded-md bg-muted/50 text-sm space-y-1">
              <p><span className="text-muted-foreground">Account:</span> <strong>{lastResult?.accountName}</strong></p>
              <p><span className="text-muted-foreground">Moving back from:</span> <strong>{companies.find(c => c.id === lastResult?.destCompanyId)?.name}</strong></p>
              <p><span className="text-muted-foreground">Moving back to:</span> <strong>{companies.find(c => c.id === lastResult?.srcCompanyId)?.name}</strong></p>
              <p><span className="text-muted-foreground">Vouchers to restore:</span> <strong>{lastResult?.movedVoucherCount}</strong></p>
              {lastResult?.originalCode !== lastResult?.finalCode && (
                <p><span className="text-muted-foreground">Code restored to:</span> <span className="font-mono font-medium">{lastResult?.originalCode}</span></p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUndoConfirmOpen(false)} data-testid="button-cancel-undo">
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => undoMutation.mutate()}
              disabled={undoMutation.isPending}
              data-testid="button-confirm-undo"
            >
              {undoMutation.isPending ? "Undoing…" : "Yes, move it back"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              The account, its opening balance, and full statement history will be moved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="p-3 rounded-md bg-muted/50 text-sm space-y-1">
              <p><span className="text-muted-foreground">Account:</span> <strong>{preview?.account.name}</strong></p>
              <p><span className="text-muted-foreground">From:</span> <strong>{preview?.srcCompany?.name}</strong></p>
              <p><span className="text-muted-foreground">To:</span> <strong>{preview?.destCompany?.name}</strong></p>
              <p><span className="text-muted-foreground">Opening balance:</span>{" "}
                <strong>
                  {hasOB
                    ? `${fmt(obAmount)} ${preview?.account.openingBalanceSide}`
                    : "None"}
                </strong>
              </p>
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
