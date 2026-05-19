import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, CheckCircle2, Eye, PlayCircle, RotateCcw,
  ShieldAlert, Info, Package, DollarSign, BarChart3, History,
} from "lucide-react";

type Company = { id: number; code: string; name: string; company_type: string };

// ── Company selectors ─────────────────────────────────────────────────────────

function useCompanies() {
  return useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });
}

// ── Preview panel ─────────────────────────────────────────────────────────────

function PreviewPanel({ sourceId, targetId }: { sourceId: number; targetId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/sp/migration/preview", sourceId, targetId],
    queryFn: () =>
      fetch(`/api/sp/migration/preview?sourceCompanyId=${sourceId}&targetCompanyId=${targetId}`, {
        credentials: "include",
      }).then(r => r.json()),
    enabled: !!sourceId && !!targetId && sourceId !== targetId,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading preview…</p>;
  if (error || data?.message) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {data?.message ?? "Failed to load preview"}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
        <ShieldAlert className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-amber-600 dark:text-amber-400">Dry Run — No data written</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            This is a preview only. Use the Rehearsal tab to copy data into the target company.
          </p>
        </div>
      </div>

      {/* Company info */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Source (read-only)</p>
            <p className="font-semibold">{data.sourceCompany.name}</p>
            <Badge variant="secondary" className="mt-1 text-xs">{data.sourceCompany.type}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">Target</p>
            <p className="font-semibold">{data.targetCompany.name}</p>
            <Badge variant="secondary" className="mt-1 text-xs">{data.targetCompany.type}</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Items", value: data.totals.itemCount, icon: Package },
          { label: "Total Qty", value: data.totals.totalQty.toLocaleString(), icon: BarChart3 },
          { label: "Total Value (USD)", value: `$${Number(data.totals.totalValueUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign },
          { label: "Will Copy", value: data.totals.willBeCopied, icon: CheckCircle2 },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <Icon className="h-3 w-3" /> {label}
              </div>
              <p className="font-bold text-lg">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Warnings */}
      {data.warnings?.length > 0 && (
        <div className="space-y-1">
          {data.warnings.map((w: string, i: number) => (
            <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Stock items table */}
      <div>
        <p className="text-sm font-medium mb-2">Stock Items to Copy ({data.stockItems?.length})</p>
        <div className="rounded-md border overflow-auto max-h-80">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Avg Cost</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead>Alias</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.stockItems?.map((item: any) => (
                <TableRow key={item.stockItemId}>
                  <TableCell className="font-mono text-xs">{item.code}</TableCell>
                  <TableCell className="text-xs">{item.name}</TableCell>
                  <TableCell className="text-right text-xs">{Number(item.quantity).toLocaleString()}</TableCell>
                  <TableCell className="text-right text-xs">${Number(item.averageCostUsd).toFixed(4)}</TableCell>
                  <TableCell className="text-right text-xs font-medium">${Number(item.totalValueUsd).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    {item.aliasExists
                      ? <Badge variant="secondary" className="text-xs gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />Mapped</Badge>
                      : <Badge variant="outline" className="text-xs gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" />New</Badge>
                    }
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* SP Accounts status */}
      <div>
        <p className="text-sm font-medium mb-2">SP Chart of Accounts in Target</p>
        <div className="grid grid-cols-2 gap-1">
          {data.spAccountsStatus?.map((acct: any) => (
            <div key={acct.subType} className="flex items-center gap-1.5 text-xs">
              {acct.exists
                ? <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                : <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
              }
              <span className={acct.exists ? "text-muted-foreground" : ""}>{acct.name}</span>
              {!acct.exists && <Badge variant="outline" className="text-xs ml-auto">will create</Badge>}
            </div>
          ))}
        </div>
      </div>

      {/* Source balances */}
      {data.balanceAccounts?.filter((b: any) => Math.abs(b.balance) > 0.01).length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Source Account Balances (approximate — manual verification required)</p>
          <div className="rounded-md border overflow-auto max-h-48">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Balance (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.balanceAccounts
                  .filter((b: any) => Math.abs(b.balance) > 0.01)
                  .map((b: any) => (
                    <TableRow key={b.code}>
                      <TableCell className="font-mono text-xs">{b.code}</TableCell>
                      <TableCell className="text-xs">{b.name}</TableCell>
                      <TableCell className="text-xs">{b.accountType}</TableCell>
                      <TableCell className={`text-right text-xs font-medium ${b.balance < 0 ? "text-destructive" : ""}`}>
                        {b.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Rehearsal form ────────────────────────────────────────────────────────────

function RehearsalPanel({
  sourceId, targetId, sourceName,
  onSuccess,
}: {
  sourceId: number; targetId: number; sourceName: string;
  onSuccess: (runId: string) => void;
}) {
  const [nameConfirm, setNameConfirm]   = useState("");
  const [actionConfirm, setActionConfirm] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const canSubmit = nameConfirm.trim() === sourceName && actionConfirm === "REHEARSE";

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/sp/migration/rehearsal", {
        sourceCompanyId:   sourceId,
        targetCompanyId:   targetId,
        companyNameConfirm: nameConfirm.trim(),
        confirmation:      actionConfirm,
      }),
    onSuccess: async (res) => {
      const data = await res.json();
      if (data.success) {
        toast({ title: "Rehearsal copy complete", description: `Run ID: ${data.runId} — ${data.rowsCreated} rows created` });
        qc.invalidateQueries({ queryKey: ["/api/sp/migration/runs"] });
        onSuccess(data.runId);
      } else {
        toast({ title: "Rehearsal failed", description: data.message, variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5">
      {/* Hard warning */}
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-1">
        <div className="flex items-center gap-2 font-medium text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" />
          Safety Confirmation Required
        </div>
        <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5 mt-2">
          <li>Source company <strong>{sourceName}</strong> will remain read-only — never modified</li>
          <li>Opening stock rows will be created only in the target SP company</li>
          <li>This is a <strong>rehearsal</strong> — you can roll it back afterwards</li>
          <li>Final production migration (cutover) is <strong>permanently disabled</strong></li>
        </ul>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="name-confirm" className="text-sm">
            Type the source company name exactly: <code className="bg-muted px-1 rounded text-xs">{sourceName}</code>
          </Label>
          <Input
            id="name-confirm"
            data-testid="input-source-name-confirm"
            value={nameConfirm}
            onChange={e => setNameConfirm(e.target.value)}
            placeholder={sourceName}
            className={nameConfirm && nameConfirm.trim() !== sourceName ? "border-destructive" : ""}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="action-confirm" className="text-sm">
            Type <code className="bg-muted px-1 rounded text-xs">REHEARSE</code> to confirm the rehearsal copy
          </Label>
          <Input
            id="action-confirm"
            data-testid="input-action-confirm"
            value={actionConfirm}
            onChange={e => setActionConfirm(e.target.value)}
            placeholder="REHEARSE"
            className={actionConfirm && actionConfirm !== "REHEARSE" ? "border-destructive" : ""}
          />
        </div>
      </div>

      <Button
        data-testid="button-run-rehearsal"
        onClick={() => mutation.mutate()}
        disabled={!canSubmit || mutation.isPending}
        className="w-full"
      >
        <PlayCircle className="h-4 w-4 mr-2" />
        {mutation.isPending ? "Running rehearsal…" : "Run Rehearsal Copy"}
      </Button>

      {!canSubmit && (
        <p className="text-xs text-muted-foreground text-center">
          Both confirmations must match exactly before the button activates
        </p>
      )}
    </div>
  );
}

// ── Run history ───────────────────────────────────────────────────────────────

function RunHistoryPanel() {
  const { data, isLoading } = useQuery<{ runs: any[] }>({ queryKey: ["/api/sp/migration/runs"] });
  const { toast } = useToast();
  const qc = useQueryClient();

  const rollback = useMutation({
    mutationFn: (runId: string) =>
      apiRequest("POST", "/api/sp/migration/rollback", { runId }),
    onSuccess: async (res) => {
      const d = await res.json();
      toast({ title: "Rollback complete", description: `${d.rowsDeleted} rows removed from target company` });
      qc.invalidateQueries({ queryKey: ["/api/sp/migration/runs"] });
      qc.invalidateQueries({ queryKey: ["/api/sp/migration/preview"] });
    },
    onError: (err: any) => toast({ title: "Rollback failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading history…</p>;
  if (!data?.runs?.length) return <p className="text-sm text-muted-foreground p-4">No rehearsal runs yet.</p>;

  const statusColor = (s: string) => {
    if (s === "completed")    return "text-green-600 dark:text-green-400";
    if (s === "rolled_back")  return "text-muted-foreground";
    if (s === "failed")       return "text-destructive";
    return "text-amber-500";
  };

  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Run ID</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Rows</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.runs.map((run: any) => (
            <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
              <TableCell className="font-mono text-xs max-w-28 truncate">{run.id}</TableCell>
              <TableCell className="text-xs">{run.source_name}</TableCell>
              <TableCell className="text-xs">{run.target_name}</TableCell>
              <TableCell>
                <span className={`text-xs font-medium ${statusColor(run.status)}`}>{run.status}</span>
              </TableCell>
              <TableCell className="text-right text-xs">{run.rows_created}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(run.created_at).toLocaleString()}
              </TableCell>
              <TableCell>
                {run.status === "completed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`button-rollback-${run.id}`}
                    onClick={() => rollback.mutate(run.id)}
                    disabled={rollback.isPending}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Rollback
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SpMigrationRehearsal() {
  const [sourceId, setSourceId] = useState<number>(0);
  const [targetId, setTargetId] = useState<number>(0);
  const [activeTab, setActiveTab] = useState("preview");

  const { data: companies = [] } = useCompanies();
  const erpCompanies = companies.filter((c: Company) => c.company_type === "erp");
  const spCompanies  = companies.filter((c: Company) => c.company_type === "supplier_partner");

  const sourceComp = companies.find((c: Company) => c.id === sourceId);
  const targetComp = companies.find((c: Company) => c.id === targetId);

  // Default selections
  useEffect(() => {
    if (!sourceId && erpCompanies.length)
      setSourceId(erpCompanies[0].id);
    if (!targetId && spCompanies.length)
      setTargetId(spCompanies[0].id);
  }, [erpCompanies.length, spCompanies.length]);

  const bothSelected = !!sourceId && !!targetId && sourceId !== targetId;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-6 space-y-6 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold">Migration Rehearsal</h1>
            <Badge variant="outline" className="text-xs gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-3 w-3" />
              Rehearsal Only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Preview and rehearse copying ERP company data into a supplier_partner company for testing.
            Source data is never modified.
          </p>
        </div>

        {/* Hard guard banner — Phase 5 cutover disabled */}
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 flex items-center gap-2 text-xs text-destructive">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span><strong>Final production migration (cutover) is permanently disabled.</strong> Phase 5 does not exist in this build.</span>
        </div>

        {/* Company selectors */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Select Companies</CardTitle>
            <CardDescription className="text-xs">Source must be an ERP company. Target must be a supplier_partner company.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Source ERP Company (read-only)</Label>
                <Select
                  value={String(sourceId || "")}
                  onValueChange={v => setSourceId(parseInt(v, 10))}
                  data-testid="select-source-company"
                >
                  <SelectTrigger data-testid="select-source-company">
                    <SelectValue placeholder="Select source…" />
                  </SelectTrigger>
                  <SelectContent>
                    {erpCompanies.map((c: Company) => (
                      <SelectItem key={c.id} value={String(c.id)} data-testid={`option-source-${c.id}`}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Target SP Company</Label>
                <Select
                  value={String(targetId || "")}
                  onValueChange={v => setTargetId(parseInt(v, 10))}
                >
                  <SelectTrigger data-testid="select-target-company">
                    <SelectValue placeholder="Select target…" />
                  </SelectTrigger>
                  <SelectContent>
                    {spCompanies.map((c: Company) => (
                      <SelectItem key={c.id} value={String(c.id)} data-testid={`option-target-${c.id}`}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main tabs */}
        {bothSelected ? (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="preview" data-testid="tab-preview">
                <Eye className="h-3.5 w-3.5 mr-1.5" />Preview
              </TabsTrigger>
              <TabsTrigger value="rehearsal" data-testid="tab-rehearsal">
                <PlayCircle className="h-3.5 w-3.5 mr-1.5" />Rehearsal Copy
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history">
                <History className="h-3.5 w-3.5 mr-1.5" />Run History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preview" className="mt-4">
              <PreviewPanel sourceId={sourceId} targetId={targetId} />
            </TabsContent>

            <TabsContent value="rehearsal" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Rehearsal Copy</CardTitle>
                  <CardDescription className="text-xs">
                    Copies opening stock from <strong>{sourceComp?.name}</strong> into <strong>{targetComp?.name}</strong>.
                    You can roll this back from the Run History tab.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RehearsalPanel
                    sourceId={sourceId}
                    targetId={targetId}
                    sourceName={sourceComp?.name ?? ""}
                    onSuccess={() => setActiveTab("history")}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <RunHistoryPanel />
            </TabsContent>
          </Tabs>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Select both a source and target company above to begin.
            </CardContent>
          </Card>
        )}

        {/* Assumptions & manual steps */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Info className="h-4 w-4 text-muted-foreground" />
              Assumptions and Manual Steps Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
              <li>Opening stock costs use the source inventory <strong>average_rate</strong>. Verify these match your agreed supplier unit costs before going live.</li>
              <li>Goods-OTW containers (ERP purchase orders in transit) cannot be auto-migrated. Recreate them manually in the SP Containers screen.</li>
              <li>Cash, bank, and prepaid balances shown in Preview are approximate. Verify and enter them manually in the SP Setup screen.</li>
              <li>Accrued duties, prepaid charges, and freight deposits must be added manually after rehearsal.</li>
              <li>After a rehearsal copy, review the opening stock values in SP Opening Stock before running any sales.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
