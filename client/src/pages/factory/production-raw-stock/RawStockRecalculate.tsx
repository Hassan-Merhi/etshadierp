import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, RefreshCw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAdminOverride } from "@/hooks/use-admin-override";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { formatNumber } from "@/lib/formatNumber";

interface RecalcRow {
  containerId: number;
  rawStockId: number;
  containerNumber: string;
  supplierId: number | null;
  supplierName: string;
  currencyCode: string;
  receivedKg: number;
  old: { costPerKg: number; costPerKgUsd: number };
  next: { costPerKg: number; costPerKgUsd: number };
  diffPct: number;
  changed: boolean;
  fxUnresolved: boolean;
}

export default function RawStockRecalculate() {
  const { toast } = useToast();
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [includeCompletedBatches, setIncludeCompletedBatches] = useState(false);

  const { data: rows, isLoading, refetch } = useQuery<RecalcRow[]>({
    queryKey: ["/api/factory/raw-stock/recalc/preview"],
  });

  const changedRows = useMemo(() => (rows || []).filter((r) => r.changed), [rows]);
  const fxUnresolvedRows = useMemo(() => (rows || []).filter((r) => r.fxUnresolved), [rows]);
  const unchangedCount = (rows?.length || 0) - changedRows.length - fxUnresolvedRows.length;

  const allSelected = changedRows.length > 0 && changedRows.every((r) => selected.has(r.containerId));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(changedRows.map((r) => r.containerId)));
    }
  };

  const toggleOne = (containerId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(containerId)) next.delete(containerId);
      else next.add(containerId);
      return next;
    });
  };

  const applyMutation = useMutation({
    mutationFn: async ({ containerIds, includeCompletedBatches }: { containerIds: number[]; includeCompletedBatches: boolean }) => {
      const dryRun = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/apply", {
        containerIds,
        includeCompletedBatches,
      });
      if (!dryRun.ok) throw new Error((await dryRun.json()).message || "Failed to prepare recalculation");
      const dryRunData = await dryRun.json();
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/apply", {
        containerIds,
        includeCompletedBatches,
        confirm: true,
        confirmationToken: dryRunData.confirmationToken,
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to apply recalculation");
      return res.json();
    },
    onSuccess: (data) => {
      const results = data.results || [];
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      setSelected(new Set());
      const totalBatches = results.reduce((s: number, r: any) => s + r.affectedBatches, 0);
      const totalBales = results.reduce((s: number, r: any) => s + r.affectedBales, 0);
      const totalCompletedBatches = results.reduce((s: number, r: any) => s + (r.completedBatchesRewritten || 0), 0);
      toast({
        title: "Recalculation applied",
        description:
          `Fixed ${results.length} container(s). Updated ${totalBatches} mix batch(es) and ${totalBales} bale(s).` +
          (totalCompletedBatches > 0 ? ` (${totalCompletedBatches} were completed/closed batches.)` : ""),
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleApply = () => {
    if (selected.size === 0) return;
    const label = includeCompletedBatches
      ? `Apply cost recalculation to ${selected.size} container(s), including rewriting completed/closed mix batches`
      : `Apply cost recalculation to ${selected.size} container(s)`;
    wrapAdminAction(() => {
      applyMutation.mutate({ containerIds: Array.from(selected), includeCompletedBatches });
    }, label);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/factory/raw-stock">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold leading-tight">Recalculate Raw Material Cost</h1>
            <p className="text-xs text-muted-foreground leading-tight">
              Recomputes each container's true landed cost/kg from its stored charges and shows what would change
              before anything is saved.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox
              checked={includeCompletedBatches}
              onCheckedChange={(v) => setIncludeCompletedBatches(v === true)}
              data-testid="checkbox-include-completed-batches"
            />
            Also rewrite completed/closed mix batches
          </label>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            size="sm"
            disabled={selected.size === 0 || applyMutation.isPending}
            onClick={handleApply}
            className="gap-2 bg-emerald-600 hover:bg-emerald-600 text-white"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {applyMutation.isPending ? "Applying..." : `Apply Selected (${selected.size})`}
          </Button>
        </div>
      </div>

      {includeCompletedBatches && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          This will rewrite the cost of completed/closed mix batches (and any bales pressed from them) sourced from
          the selected containers — normally protected as locked historical record. Only enable this if you want
          past batches corrected too.
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Computing recalculation preview...</div>
      ) : (
        <>
          {fxUnresolvedRows.length > 0 && (
            <div className="border border-amber-500/30 bg-amber-500/10 rounded-md p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
              <div className="font-medium">
                {fxUnresolvedRows.length} container(s) have an unresolved/unconfirmed exchange rate and were
                skipped — their true landed cost can't be safely computed without a confirmed rate.
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                {fxUnresolvedRows.map((r) => (
                  <span key={r.containerId}>
                    {r.containerNumber} ({r.currencyCode})
                  </span>
                ))}
              </div>
              <div>Resolve/confirm these containers' exchange rates first, then refresh this preview.</div>
            </div>
          )}

          {changedRows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center border rounded-md bg-card">
              Nothing to fix — every container's cost/kg already matches its stored charges.
              {unchangedCount > 0 && ` (${unchangedCount} container(s) checked, all correct.)`}
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                {changedRows.length} container(s) have a mismatch
                {unchangedCount > 0 ? ` — ${unchangedCount} other container(s) are already correct and hidden.` : "."}
              </div>
              <div className="border rounded-md overflow-hidden bg-card shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleAll}
                          data-testid="checkbox-select-all"
                        />
                      </TableHead>
                      <TableHead>Container</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Received (kg)</TableHead>
                      <TableHead className="text-right">Current $/kg</TableHead>
                      <TableHead className="text-right">Corrected $/kg</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changedRows.map((row) => (
                      <TableRow key={row.containerId} className="group">
                        <TableCell>
                          <Checkbox
                            checked={selected.has(row.containerId)}
                            onCheckedChange={() => toggleOne(row.containerId)}
                            data-testid={`checkbox-row-${row.containerId}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.containerNumber}</TableCell>
                        <TableCell className="text-sm">{row.supplierName}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {formatNumber(row.receivedKg)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          ${row.old.costPerKgUsd.toFixed(6)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-medium text-foreground">
                          ${row.next.costPerKgUsd.toFixed(6)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="outline"
                            className={
                              row.diffPct > 0
                                ? "text-red-500 border-red-500/30 bg-red-500/10"
                                : "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                            }
                          >
                            {row.diffPct > 0 ? "+" : ""}
                            {row.diffPct.toFixed(2)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </>
      )}

      {AdminDialog}
    </div>
  );
}
