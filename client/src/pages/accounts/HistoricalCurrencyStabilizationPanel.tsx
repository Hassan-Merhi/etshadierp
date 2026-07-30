import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const REPAIR_CENTER_KEY = ["/api/accounts/multi-currency/repair-center"] as const;
const ALLOWED_ROLES = new Set(["Admin", "Owner", "Developer"]);

type RepairKind = "voucherEntry" | "ledger" | "bank" | "customer" | "supplier" | "employee" | "fixedAsset";
type StoredAmountMode = "transaction" | "base";

interface RepairRecommendation {
  classification: string;
  autoRepairable: boolean;
  reason: string;
  suggestedCurrency: string | null;
  suggestedHistoricalRate: string | null;
  suggestedStorageMode: StoredAmountMode | null;
  suggestedTransactionDebitAmount: string | null;
  suggestedTransactionCreditAmount: string | null;
  suggestedNativeAmount: string | null;
  suggestedBaseAmount: string | null;
}

interface RepairCase {
  kind: RepairKind;
  id: number;
  label: string;
  currency: string | null;
  rawAmount: string | null;
  nativeAmount: string | null;
  currentRate: string | null;
  currentBaseAmount: string | null;
  voucherId?: number;
  voucherNumber?: string | null;
  voucherType?: string | null;
  voucherDate?: string;
  sourceModule?: string | null;
  voucherCurrency?: string | null;
  voucherExchangeRate?: string | null;
  debitAmount?: string | null;
  creditAmount?: string | null;
  transactionDebitAmount?: string | null;
  transactionCreditAmount?: string | null;
  baseDebitAmount?: string | null;
  baseCreditAmount?: string | null;
  side?: string | null;
  classification: string;
  autoRepairable: boolean;
  reason: string;
  recommendation: RepairRecommendation;
}

interface Reconciliation {
  trialBalance: { debit: string; credit: string; difference: string; balanced: boolean };
  voucherIntegrity: {
    resolvedVoucherCount: number;
    unbalancedVoucherCount: number;
    sampleUnbalancedVoucherIds: number[];
    partialMetadataEntryCount: number;
  };
  cashBank: { accountCount: number; unresolvedAccountCount: number; currentCfaPerUsd: string | null };
  readyForHistoricalReports: boolean;
  readyForLiveNetPosition: boolean;
  issues: string[];
  informationalWarnings: string[];
}

interface RepairCenterResponse {
  generatedAt: string;
  totalCases: number;
  autoRepairableCount: number;
  manualReviewCount: number;
  cases: RepairCase[];
  reconciliation: Reconciliation;
  readiness: { ready: boolean; totalUnresolvedCount: number; schemaReady: boolean };
}

interface RepairInput {
  kind: RepairKind;
  id: number;
  currency: string;
  historicalRate: string;
  storedAmountMode?: StoredAmountMode;
  transactionDebitAmount?: string;
  transactionCreditAmount?: string;
  nativeAmount?: string;
  baseAmount?: string;
  side?: "Dr" | "Cr";
  note?: string;
}

interface PreviewResponse {
  repairs: RepairInput[];
  confirmationToken: string;
  confirmationExpiresAt: string;
  plan: {
    itemCount: number;
    voucherCount: number;
    fingerprint: string;
    items: Array<{ before: RepairCase; after: Record<string, string | null> }>;
  };
}

interface VoucherDraft {
  currency: string;
  historicalRate: string;
  storedAmountMode: StoredAmountMode;
  note: string;
}

function formatAmount(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: 6 }) : value;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await apiRequest("POST", url, body);
  return response.json() as Promise<T>;
}

function invalidateAccountingCurrencyQueries() {
  for (const queryKey of [
    REPAIR_CENTER_KEY,
    ["/api/accounts/multi-currency/readiness"],
    ["/api/accounts/multi-currency/cash-bank-revaluation"],
    ["/api/accounts/multi-currency/unresolved-openings"],
    ["/api/ledger-accounts"],
    ["/api/bank-accounts"],
    ["/api/stats/net-position"],
    ["/api/stats/net-profit"],
  ]) {
    queryClient.invalidateQueries({ queryKey });
  }
}

export function HistoricalCurrencyStabilizationPanel() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const authorized = Boolean(selectedCompany?.role && ALLOWED_ROLES.has(selectedCompany.role));
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<number, VoucherDraft>>({});

  const query = useQuery<RepairCenterResponse>({
    queryKey: REPAIR_CENTER_KEY,
    enabled: authorized,
    staleTime: 30_000,
  });

  const manualVoucherGroups = useMemo(() => {
    const groups = new Map<number, RepairCase[]>();
    for (const repairCase of query.data?.cases || []) {
      if (repairCase.kind !== "voucherEntry" || !repairCase.voucherId) continue;
      const rows = groups.get(repairCase.voucherId) || [];
      rows.push(repairCase);
      groups.set(repairCase.voucherId, rows);
    }
    return [...groups.entries()]
      .filter(([, rows]) => rows.some((repairCase) => !repairCase.autoRepairable))
      .map(([voucherId, rows]) => ({ voucherId, rows }));
  }, [query.data?.cases]);

  const automaticPlan = useMutation({
    mutationFn: () => postJson<PreviewResponse>("/api/accounts/multi-currency/repair-center/auto-plan"),
    onSuccess: (data) => setPreview(data),
    onError: (error: Error) => toast({ title: "Safe repair preview failed", description: error.message, variant: "destructive" }),
  });

  const manualPlan = useMutation({
    mutationFn: (repairs: RepairInput[]) => postJson<PreviewResponse>("/api/accounts/multi-currency/repair-center/plan", { repairs }),
    onSuccess: (data) => setPreview(data),
    onError: (error: Error) => toast({ title: "Voucher preview failed", description: error.message, variant: "destructive" }),
  });

  const applyPlan = useMutation({
    mutationFn: async (approved: PreviewResponse) => {
      return postJson<{ result: { appliedCount: number; voucherCount: number }; reconciliation: Reconciliation }>(
        "/api/accounts/multi-currency/repair-center/apply",
        { repairs: approved.repairs, confirmationToken: approved.confirmationToken },
      );
    },
    onSuccess: (data) => {
      toast({
        title: "Historical currency repairs applied",
        description: `${data.result.appliedCount} row(s) across ${data.result.voucherCount} voucher(s) were repaired and reconciled.`,
      });
      setPreview(null);
      invalidateAccountingCurrencyQueries();
    },
    onError: (error: Error) => toast({ title: "Repair apply failed", description: error.message, variant: "destructive" }),
  });

  if (!authorized) return null;

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading historical currency stabilization…
        </CardContent>
      </Card>
    );
  }

  if (query.error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Historical currency stabilization unavailable</AlertTitle>
        <AlertDescription>{query.error instanceof Error ? query.error.message : "Unable to load the repair center."}</AlertDescription>
      </Alert>
    );
  }

  const data = query.data;
  if (!data) return null;
  const manualOpeningCount = data.cases.filter((repairCase) => repairCase.kind !== "voucherEntry" && !repairCase.autoRepairable).length;

  const previewVoucher = (voucherId: number, rows: RepairCase[]) => {
    const first = rows[0];
    const draft = drafts[voucherId] || {
      currency: first?.recommendation.suggestedCurrency || first?.voucherCurrency || first?.currency || "",
      historicalRate: first?.recommendation.suggestedHistoricalRate || first?.voucherExchangeRate || first?.currentRate || "",
      storedAmountMode: "transaction" as StoredAmountMode,
      note: "",
    };
    if (!draft.currency.trim() || !draft.historicalRate.trim() || Number(draft.historicalRate) <= 0) {
      toast({ title: "Currency and historical rate required", variant: "destructive" });
      return;
    }
    const repairs: RepairInput[] = rows.map((repairCase) => ({
      kind: "voucherEntry",
      id: repairCase.id,
      currency: draft.currency.trim().toUpperCase(),
      historicalRate: draft.historicalRate,
      storedAmountMode: draft.storedAmountMode,
      ...(draft.storedAmountMode === "transaction"
        ? {
            transactionDebitAmount: repairCase.transactionDebitAmount ?? repairCase.debitAmount ?? "0",
            transactionCreditAmount: repairCase.transactionCreditAmount ?? repairCase.creditAmount ?? "0",
          }
        : {}),
      note: draft.note || `Manual voucher-level repair for voucher #${voucherId}`,
    }));
    manualPlan.mutate(repairs);
  };

  return (
    <Card data-testid="historical-currency-stabilization-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Historical Currency Stabilization
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant={data.readiness.ready ? "outline" : "destructive"}>
              {data.readiness.totalUnresolvedCount} unresolved
            </Badge>
            <Badge variant="outline">{data.autoRepairableCount} evidence-backed</Badge>
            <Badge variant={data.manualReviewCount ? "secondary" : "outline"}>{data.manualReviewCount} manual</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.readiness.schemaReady ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Multi-currency schema incomplete</AlertTitle>
            <AlertDescription>Apply the structural currency migrations before using the repair center.</AlertDescription>
          </Alert>
        ) : data.reconciliation.readyForLiveNetPosition ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Historical accounting is reconciled</AlertTitle>
            <AlertDescription>Trial balance, repaired vouchers, openings, and live cash/bank translation are ready.</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Financial totals remain protected</AlertTitle>
            <AlertDescription>{data.reconciliation.issues.join(" ") || "Historical currency review is still required."}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Historical debit</div><div className="font-medium">{formatAmount(data.reconciliation.trialBalance.debit)}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Historical credit</div><div className="font-medium">{formatAmount(data.reconciliation.trialBalance.credit)}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Trial difference</div><div className="font-medium">{formatAmount(data.reconciliation.trialBalance.difference)}</div></div>
          <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Unresolved cash/bank</div><div className="font-medium">{data.reconciliation.cashBank.unresolvedAccountCount}</div></div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => automaticPlan.mutate()}
            disabled={data.autoRepairableCount === 0 || automaticPlan.isPending || applyPlan.isPending}
          >
            {automaticPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Preview {data.autoRepairableCount} safe repair{data.autoRepairableCount === 1 ? "" : "s"}
          </Button>
          <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh reconciliation
          </Button>
        </div>

        {preview && (
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Signed preview ready</AlertTitle>
            <AlertDescription>
              <div className="space-y-2">
                <div>{preview.plan.itemCount} row(s) across {preview.plan.voucherCount} voucher(s) will be changed. The plan expires at {new Date(preview.confirmationExpiresAt).toLocaleTimeString()}.</div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => applyPlan.mutate(preview)} disabled={applyPlan.isPending}>
                    {applyPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Apply signed plan
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPreview(null)} disabled={applyPlan.isPending}>Cancel</Button>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {manualVoucherGroups.length > 0 && (
          <div className="space-y-3">
            <div>
              <h3 className="font-medium">Manual voucher review</h3>
              <p className="text-sm text-muted-foreground">Each voucher is previewed and applied as one complete group. Confirm whether legacy debit/credit values are original transaction amounts or historical base amounts.</p>
            </div>
            {manualVoucherGroups.map(({ voucherId, rows }) => {
              const first = rows[0];
              const draft = drafts[voucherId] || {
                currency: first.recommendation.suggestedCurrency || first.voucherCurrency || first.currency || "",
                historicalRate: first.recommendation.suggestedHistoricalRate || first.voucherExchangeRate || first.currentRate || "",
                storedAmountMode: "transaction" as StoredAmountMode,
                note: "",
              };
              return (
                <div key={voucherId} className="space-y-3 rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{first.voucherNumber || `Voucher #${voucherId}`} · {first.voucherType || "Voucher"}</div>
                      <div className="text-xs text-muted-foreground">{first.voucherDate?.slice(0, 10)} · {first.sourceModule || "Unknown source"} · {rows.length} entr{rows.length === 1 ? "y" : "ies"}</div>
                    </div>
                    <Badge variant="secondary">{first.classification}</Badge>
                  </div>
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{rows.map((row) => row.reason).filter((reason, index, all) => all.indexOf(reason) === index).join(" ")}</AlertDescription>
                  </Alert>
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="space-y-1"><Label>Original currency</Label><Input value={draft.currency} placeholder="CFA, USD, EUR…" onChange={(event) => setDrafts((current) => ({ ...current, [voucherId]: { ...draft, currency: event.target.value } }))} /></div>
                    <div className="space-y-1"><Label>Historical rate</Label><Input type="number" min="0.0000000001" step="0.0000000001" value={draft.historicalRate} placeholder="e.g. 600" onChange={(event) => setDrafts((current) => ({ ...current, [voucherId]: { ...draft, historicalRate: event.target.value } }))} /></div>
                    <div className="space-y-1"><Label>Legacy columns contain</Label><Select value={draft.storedAmountMode} onValueChange={(storedAmountMode: StoredAmountMode) => setDrafts((current) => ({ ...current, [voucherId]: { ...draft, storedAmountMode } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="transaction">Original transaction amount</SelectItem><SelectItem value="base">Historical base amount</SelectItem></SelectContent></Select></div>
                    <div className="space-y-1"><Label>Review note</Label><Input value={draft.note} placeholder="Source document checked…" onChange={(event) => setDrafts((current) => ({ ...current, [voucherId]: { ...draft, note: event.target.value } }))} /></div>
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader><TableRow><TableHead>Entry</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Legacy Dr</TableHead><TableHead className="text-right">Legacy Cr</TableHead></TableRow></TableHeader>
                      <TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell>#{row.id}</TableCell><TableCell>{row.label}</TableCell><TableCell className="text-right">{formatAmount(row.debitAmount)}</TableCell><TableCell className="text-right">{formatAmount(row.creditAmount)}</TableCell></TableRow>)}</TableBody>
                    </Table>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => previewVoucher(voucherId, rows)} disabled={manualPlan.isPending || applyPlan.isPending}>
                    {manualPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Preview complete voucher repair
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {manualOpeningCount > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{manualOpeningCount} opening or asset value{manualOpeningCount === 1 ? " needs" : "s need"} review</AlertTitle>
            <AlertDescription>Use the historical opening and asset resolver directly below this panel. The stabilization status refreshes after each resolution.</AlertDescription>
          </Alert>
        )}

        {data.reconciliation.informationalWarnings.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Additional accounting diagnostics</AlertTitle>
            <AlertDescription>{data.reconciliation.informationalWarnings.join(" ")}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
