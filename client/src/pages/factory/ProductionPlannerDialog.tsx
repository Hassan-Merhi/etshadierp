import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Copy, Loader2, Save, Target, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PlannerMember {
  workerId: number;
  workerName: string;
}

interface PlannerAllocation extends PlannerMember {
  amount: number;
}

interface PlannerEntry {
  positionId: number;
  positionName: string;
  targetBales: number;
  bonusPerExtraBale: number;
  bonusEnabled: boolean;
  members: PlannerMember[];
  saved: boolean;
  actualBales: number;
  memberCount: number;
  extraBales: number;
  bonusPool: number;
  perWorkerMin: number;
  perWorkerMax: number;
  allocations: PlannerAllocation[];
  distributable: boolean;
  targetMet: boolean;
}

interface PlannerData {
  plan: { id: number | null; planDate: string; notes: string; saved: boolean };
  entries: PlannerEntry[];
  summary: {
    totalTarget: number;
    totalActual: number;
    totalExtra: number;
    totalBonusPool: number;
    unattributedBales: number;
  };
}

interface CopyPreviousResponse {
  fromDate: string | null;
  notes: string;
  entries: Array<{
    positionId: number;
    positionName: string;
    targetBales: number;
    bonusPerExtraBale: number;
    bonusEnabled: boolean;
    members: PlannerMember[];
    saved: boolean;
  }>;
}

function money(value: number): string {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function previewEntry(entry: PlannerEntry): PlannerEntry {
  const targetBales = Math.max(0, Math.trunc(Number(entry.targetBales) || 0));
  const actualBales = Math.max(0, Math.trunc(Number(entry.actualBales) || 0));
  const rate = Math.max(0, Number(entry.bonusPerExtraBale) || 0);
  const extraBales = targetBales > 0 ? Math.max(actualBales - targetBales, 0) : 0;
  const poolCents = entry.bonusEnabled ? Math.max(0, Math.round(extraBales * rate * 100 + Number.EPSILON)) : 0;
  const bonusPool = Number((poolCents / 100).toFixed(2));
  const members = [...(entry.members || [])].sort((a, b) => a.workerId - b.workerId);
  let allocations: PlannerAllocation[] = members.map((member) => ({ ...member, amount: 0 }));

  if (poolCents > 0 && members.length > 0) {
    const baseCents = Math.floor(poolCents / members.length);
    const remainder = poolCents % members.length;
    const remainderStart = members.length - remainder;
    allocations = members.map((member, index) => ({
      ...member,
      amount: Number(((baseCents + (remainder > 0 && index >= remainderStart ? 1 : 0)) / 100).toFixed(2)),
    }));
  }

  const amounts = allocations.map((allocation) => allocation.amount);
  return {
    ...entry,
    targetBales,
    actualBales,
    bonusPerExtraBale: rate,
    memberCount: members.length,
    extraBales,
    bonusPool,
    allocations,
    perWorkerMin: amounts.length ? Math.min(...amounts) : 0,
    perWorkerMax: amounts.length ? Math.max(...amounts) : 0,
    distributable: poolCents === 0 || members.length > 0,
    targetMet: targetBales > 0 && actualBales >= targetBales,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || `Request failed (${response.status})`);
  return body as T;
}

export default function ProductionPlannerDialog() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [entries, setEntries] = useState<PlannerEntry[]>([]);
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: planner,
    isLoading,
    isError,
    error,
  } = useQuery<PlannerData>({
    queryKey: ["/api/factory/production-position-planner", date],
    queryFn: () => fetchJson<PlannerData>(`/api/factory/production-position-planner/${date}`),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (!planner) return;
    setEntries(planner.entries.map((entry) => previewEntry(entry)));
    setNotes(planner.plan?.notes ?? "");
  }, [planner]);

  const previewEntries = useMemo(() => entries.map(previewEntry), [entries]);
  const summary = useMemo(
    () =>
      previewEntries.reduce(
        (acc, entry) => {
          acc.totalTarget += entry.targetBales;
          acc.totalActual += entry.actualBales;
          acc.totalExtra += entry.extraBales;
          acc.totalBonusPool = Number((acc.totalBonusPool + entry.bonusPool).toFixed(2));
          return acc;
        },
        {
          totalTarget: 0,
          totalActual: 0,
          totalExtra: 0,
          totalBonusPool: 0,
          unattributedBales: planner?.summary?.unattributedBales ?? 0,
        }
      ),
    [previewEntries, planner?.summary?.unattributedBales]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/factory/production-position-planner/${date}`, {
        notes,
        entries: previewEntries.map((entry) => ({
          positionId: entry.positionId,
          targetBales: entry.targetBales,
          bonusPerExtraBale: entry.bonusPerExtraBale,
          bonusEnabled: entry.bonusEnabled,
        })),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Failed to save production plan");
      return body as PlannerData;
    },
    onSuccess: async (data) => {
      setEntries(data.entries.map((entry) => previewEntry(entry)));
      setNotes(data.plan?.notes ?? "");
      await queryClient.invalidateQueries({ queryKey: ["/api/factory/production-position-planner", date] });
      toast({ title: "Production plan saved", description: "Team, target and bonus-rule snapshots were frozen for this date." });
    },
    onError: (saveError: Error) =>
      toast({ title: "Could not save production plan", description: saveError.message, variant: "destructive" }),
  });

  const copyPreviousMutation = useMutation({
    mutationFn: () =>
      fetchJson<CopyPreviousResponse>(`/api/factory/production-position-planner/${date}/copy-previous`),
    onSuccess: (data) => {
      if (!data.fromDate) {
        toast({ title: "No previous position plan found" });
        return;
      }
      const actualByPosition = new Map((planner?.entries ?? []).map((entry) => [entry.positionId, entry.actualBales]));
      setEntries(
        data.entries.map((entry) =>
          previewEntry({
            ...entry,
            actualBales: actualByPosition.get(entry.positionId) ?? 0,
            memberCount: entry.members?.length ?? 0,
            extraBales: 0,
            bonusPool: 0,
            perWorkerMin: 0,
            perWorkerMax: 0,
            allocations: [],
            distributable: true,
            targetMet: false,
          })
        )
      );
      setNotes(data.notes ?? "");
      toast({ title: `Copied settings from ${data.fromDate}`, description: "Current-date team membership is kept; target/rate settings were copied." });
    },
    onError: (copyError: Error) =>
      toast({ title: "Could not copy previous plan", description: copyError.message, variant: "destructive" }),
  });

  const updateEntry = (positionId: number, patch: Partial<Pick<PlannerEntry, "targetBales" | "bonusPerExtraBale" | "bonusEnabled">>) => {
    setEntries((current) => current.map((entry) => (entry.positionId === positionId ? { ...entry, ...patch } : entry)));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-production-planner">
          <ClipboardList className="mr-1 h-4 w-4" />
          Production Planner
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[92vh] max-w-[96vw] flex-col p-0 xl:max-w-7xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Position Production Planner
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Date</span>
              <Input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="w-40"
                data-testid="input-plan-date"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyPreviousMutation.mutate()}
              disabled={copyPreviousMutation.isPending || isLoading}
              data-testid="button-copy-previous-position-plan"
            >
              {copyPreviousMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Copy className="mr-1 h-4 w-4" />}
              Copy Previous Plan
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {planner?.plan?.saved ? <Badge variant="secondary">Saved snapshot</Badge> : <Badge variant="outline">Preview / not saved</Badge>}
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || isLoading || isError}
                data-testid="button-save-position-plan"
              >
                {saveMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                Save Plan
              </Button>
            </div>
          </div>

          {!isLoading && !isError && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Target</div>
                <div className="mt-1 text-xl font-bold">{summary.totalTarget}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Actual</div>
                <div className="mt-1 text-xl font-bold">{summary.totalActual}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Extra Bales</div>
                <div className="mt-1 text-xl font-bold">{summary.totalExtra}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Suggested Bonus</div>
                <div className="mt-1 text-xl font-bold">${money(summary.totalBonusPool)}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bonus-Ineligible</div>
                <div className="mt-1 text-xl font-bold">{summary.unattributedBales}</div>
                <div className="text-[10px] text-muted-foreground">worker-assigned bales with no position</div>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading position production…
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Could not load the production planner: {(error as Error)?.message || "Unknown error"}
            </div>
          ) : previewEntries.length === 0 ? (
            <div className="rounded-xl border p-10 text-center text-muted-foreground">
              <Target className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No Production Positions are configured for this date. Create positions and teams in Bale Stock Entry → Production Positions.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-[1050px] w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Position</th>
                    <th className="px-3 py-2 text-left font-semibold">Team Members</th>
                    <th className="w-24 px-3 py-2 text-right font-semibold">Target</th>
                    <th className="w-20 px-3 py-2 text-right font-semibold">Actual</th>
                    <th className="w-20 px-3 py-2 text-right font-semibold">Extra</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">$/Extra Bale</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">Bonus Pool</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">Per Person</th>
                    <th className="w-28 px-3 py-2 text-center font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewEntries.map((entry) => {
                    const shortBy = Math.max(entry.targetBales - entry.actualBales, 0);
                    const splitText =
                      entry.memberCount === 0
                        ? "—"
                        : entry.perWorkerMin === entry.perWorkerMax
                          ? `$${money(entry.perWorkerMin)}`
                          : `$${money(entry.perWorkerMin)}–$${money(entry.perWorkerMax)}`;
                    return (
                      <tr key={entry.positionId} className="border-b last:border-0 align-top hover:bg-muted/20">
                        <td className="px-3 py-3">
                          <div className="font-bold">{entry.positionName}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge variant={entry.bonusEnabled ? "default" : "outline"} className="text-[10px]">
                              Bonus {entry.bonusEnabled ? "On" : "Off"}
                            </Badge>
                            {entry.saved && <Badge variant="secondary" className="text-[10px]">Snapshotted</Badge>}
                          </div>
                        </td>
                        <td className="max-w-sm px-3 py-3">
                          <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="h-3.5 w-3.5" /> {entry.memberCount} worker{entry.memberCount === 1 ? "" : "s"}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {entry.members.length ? (
                              entry.members.map((member) => {
                                const allocation = entry.allocations.find((item) => item.workerId === member.workerId)?.amount ?? 0;
                                return (
                                  <Badge key={member.workerId} variant="outline" className="whitespace-normal text-[10px]" title={`${member.workerName}: $${money(allocation)}`}>
                                    {member.workerName}{entry.bonusPool > 0 ? ` · $${money(allocation)}` : ""}
                                  </Badge>
                                );
                              })
                            ) : (
                              <span className="text-xs italic text-muted-foreground">No qualifying team members</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={entry.targetBales}
                            onChange={(event) => updateEntry(entry.positionId, { targetBales: Math.max(0, parseInt(event.target.value) || 0) })}
                            className="h-8 text-right font-mono"
                            data-testid={`input-position-target-${entry.positionId}`}
                          />
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold">{entry.actualBales}</td>
                        <td className="px-3 py-3 text-right font-mono font-bold">{entry.extraBales}</td>
                        <td className="px-3 py-3">
                          <div className="space-y-1">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={entry.bonusPerExtraBale}
                              onChange={(event) => updateEntry(entry.positionId, { bonusPerExtraBale: Math.max(0, Number(event.target.value) || 0) })}
                              className="h-8 text-right font-mono"
                              disabled={!entry.bonusEnabled}
                              data-testid={`input-position-bonus-rate-${entry.positionId}`}
                            />
                            <label className="flex cursor-pointer items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={entry.bonusEnabled}
                                onChange={(event) => updateEntry(entry.positionId, { bonusEnabled: event.target.checked })}
                              />
                              Enabled
                            </label>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold">${money(entry.bonusPool)}</td>
                        <td className="px-3 py-3 text-right">
                          <div className="font-mono font-bold">{splitText}</div>
                          {!entry.distributable && entry.bonusPool > 0 && (
                            <div className="mt-1 text-[10px] font-medium text-destructive">No workers to divide pool</div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {entry.targetBales <= 0 ? (
                            <Badge variant="outline">No target</Badge>
                          ) : entry.targetMet ? (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-200">Target met</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900 dark:text-red-200">{shortBy} short</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Plan Notes</label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional notes for this production day…"
              rows={3}
              maxLength={5000}
            />
          </div>

          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Preview only:</strong> Phase 3 calculates suggested production bonuses but does not create payroll, accounting entries, cash payments, or payable transactions. Acceptance/rejection and payroll application are Phase 4.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
