import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Trash2, CheckCircle2, XCircle, Copy, Save, Loader2, ChevronDown, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface Worker { id: number; full_name: string; position: string; active: boolean; }
interface WorkerCategory { id: number; name: string; workerIds?: number[]; }
interface PlanEntry { id?: number; workerId: number; workerName: string; role: string; targetBales: number; }
interface PlanData { plan: { id: number; planDate: string; categoryIds: number[]; notes: string } | null; entries: PlanEntry[]; actuals: Record<number, number>; }

const ROLES = [
  { value: "TEAM_LEADER", label: "Team Leader" },
  { value: "HELPER", label: "Helper" },
  { value: "WORKER", label: "Worker" },
];

const ROLE_COLORS: Record<string, string> = {
  TEAM_LEADER: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  HELPER: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  WORKER: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

function WorkerCombobox({
  value,
  onChange,
  workers,
  entryKey,
}: {
  value: number;
  onChange: (workerId: number, workerName: string) => void;
  workers: Worker[];
  entryKey: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = workers.find(w => w.id === value);
  const displayName = selected?.full_name ?? (value ? `Worker #${value}` : "Select worker…");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full justify-between font-normal text-sm"
          data-testid={`select-worker-${entryKey}`}
        >
          <span className="truncate">{displayName}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search worker…" className="h-9" />
          <CommandList>
            <CommandEmpty>No workers found.</CommandEmpty>
            <CommandGroup>
              {workers.map(w => (
                <CommandItem
                  key={w.id}
                  value={w.full_name}
                  onSelect={() => {
                    onChange(w.id, w.full_name);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", w.id === value ? "opacity-100" : "opacity-0")} />
                  <span className={cn("truncate", !w.active && "text-muted-foreground")}>
                    {w.full_name}
                    {!w.active && <span className="ml-1 text-xs">(inactive)</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TeamSelector({ value, onChange, categories }: { value: number[]; onChange: (v: number[]) => void; categories: WorkerCategory[]; }) {
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  const label = value.length === 0 ? "All teams" : value.length === 1 ? (categories.find(c => c.id === value[0])?.name ?? "1 selected") : `${value.length} teams`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1 max-w-[220px] justify-between" data-testid="button-category-filter">
          <span className="truncate text-xs">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2 max-h-64 overflow-y-auto">
        <div className="text-xs font-medium text-muted-foreground mb-2 px-1">Filter by team</div>
        <label className="flex items-center gap-2 px-1 py-1 rounded hover-elevate cursor-pointer text-sm">
          <Checkbox checked={value.length === 0} onCheckedChange={() => onChange([])} />
          <span>All teams</span>
        </label>
        {categories.map(c => (
          <label key={c.id} className="flex items-center gap-2 px-1 py-1 rounded hover-elevate cursor-pointer text-sm">
            <Checkbox checked={value.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
            <span className="truncate">{c.name}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export default function ProductionPlannerDialog() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [entries, setEntries] = useState<(PlanEntry & { _key: string })[]>([]);
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["/api/factory/workers"],
    enabled: open,
  });
  const { data: workerCategories = [] } = useQuery<WorkerCategory[]>({
    queryKey: ["/api/factory/worker-categories"],
    enabled: open,
  });

  const { data: planData, isLoading: planLoading, refetch: refetchPlan } = useQuery<PlanData>({
    queryKey: ["/api/factory/production-planner", date],
    queryFn: () => fetch(`/api/factory/production-planner/${date}`, { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  // Load plan data into local state when fetched
  useEffect(() => {
    if (!planData) return;
    setCategoryIds(planData.plan?.categoryIds ?? []);
    setNotes(planData.plan?.notes ?? "");
    setEntries((planData.entries ?? []).map((e, i) => ({ ...e, _key: `loaded-${i}` })));
  }, [planData]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/factory/production-planner/${date}`, {
      notes,
      categoryIds,
      entries: entries.map(e => ({ workerId: e.workerId, role: e.role, targetBales: e.targetBales })),
    }),
    onSuccess: () => {
      toast({ title: "Plan saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/production-planner", date] });
      refetchPlan();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const copyPreviousMutation = useMutation({
    mutationFn: (): Promise<{ entries: PlanEntry[]; categoryIds: number[]; notes: string; fromDate: string | null }> =>
      fetch(`/api/factory/production-planner/${date}/copy-previous`, { credentials: "include" }).then(r => r.json()),
    onSuccess: (data) => {
      if (!data.fromDate) { toast({ title: "No previous plan found" }); return; }
      setEntries(data.entries.map((e, i) => ({ ...e, _key: `copied-${Date.now()}-${i}` })));
      setCategoryIds(data.categoryIds ?? []);
      setNotes(data.notes ?? "");
      toast({ title: `Copied plan from ${data.fromDate}` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addRow = useCallback(() => {
    if (workers.length === 0) return;
    const usedIds = new Set(entries.map(e => e.workerId));
    const available = workers.filter(w => !usedIds.has(w.id));
    const worker = available[0] ?? workers[0];
    setEntries(prev => [...prev, {
      workerId: worker.id,
      workerName: worker.full_name,
      role: "WORKER",
      targetBales: 0,
      _key: `new-${Date.now()}`,
    }]);
  }, [workers, entries]);

  const removeRow = (key: string) => setEntries(prev => prev.filter(e => e._key !== key));

  const updateWorker = (key: string, workerId: number, workerName: string) =>
    setEntries(prev => prev.map(e => e._key !== key ? e : { ...e, workerId, workerName }));

  const updateEntry = (key: string, field: string, value: any) =>
    setEntries(prev => prev.map(e => {
      if (e._key !== key) return e;
      return { ...e, [field]: field === "targetBales" ? (parseInt(value) || 0) : value };
    }));

  const actuals = planData?.actuals ?? {};

  // When teams are selected, build the set of allowed worker IDs for display filtering
  const allowedWorkerIds: Set<number> | null = categoryIds.length === 0 ? null : (() => {
    const ids = new Set<number>();
    for (const catId of categoryIds) {
      const cat = workerCategories.find(c => c.id === catId);
      const workerIds = cat?.workerIds;
      if (Array.isArray(workerIds)) workerIds.forEach(id => ids.add(Number(id)));
    }
    return ids;
  })();

  const visibleEntries = allowedWorkerIds ? entries.filter(e => allowedWorkerIds.has(e.workerId)) : entries;

  const totalTarget = visibleEntries.reduce((s, e) => s + (e.targetBales || 0), 0);
  const totalActual = visibleEntries.reduce((s, e) => s + (actuals[e.workerId] ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-production-planner">
          <ClipboardList className="h-4 w-4 mr-1" />
          Production Planner
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Production Planner
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Date</span>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-40 text-sm"
                data-testid="input-plan-date"
              />
            </div>
            <TeamSelector value={categoryIds} onChange={setCategoryIds} categories={workerCategories} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyPreviousMutation.mutate()}
              disabled={copyPreviousMutation.isPending}
              data-testid="button-copy-yesterday"
            >
              {copyPreviousMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Copy className="h-4 w-4 mr-1" />}
              Copy Previous Plan
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-plan">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save Plan
              </Button>
            </div>
          </div>

          {/* Summary strip */}
          {visibleEntries.length > 0 && (
            <div className="flex gap-4 p-3 rounded-md bg-muted/50 text-sm">
              <div>
                <span className="text-muted-foreground">Total Target: </span>
                <span className="font-semibold">{totalTarget} bales</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Actual: </span>
                <span className={`font-semibold ${totalActual >= totalTarget && totalTarget > 0 ? "text-green-600 dark:text-green-400" : ""}`}>{totalActual} bales</span>
              </div>
              {totalTarget > 0 && (
                <div className="ml-auto">
                  {totalActual >= totalTarget
                    ? <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Target Met</Badge>
                    : <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">{totalTarget - totalActual} short</Badge>}
                </div>
              )}
            </div>
          )}

          {/* Workers table */}
          {planLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading plan…
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Worker</th>
                    <th className="text-left px-3 py-2 font-semibold w-36">Role</th>
                    <th className="text-right px-3 py-2 font-semibold w-28">Target</th>
                    <th className="text-right px-3 py-2 font-semibold w-24">Actual</th>
                    <th className="text-center px-3 py-2 font-semibold w-24">Status</th>
                    <th className="w-10 px-2" />
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                        {entries.length === 0
                          ? "No workers in plan. Add workers below or copy from a previous plan."
                          : "No workers match the selected team filter."}
                      </td>
                    </tr>
                  ) : visibleEntries.map(entry => {
                    const actual = actuals[entry.workerId] ?? 0;
                    const met = entry.targetBales > 0 && actual >= entry.targetBales;
                    const notMet = entry.targetBales > 0 && actual < entry.targetBales;
                    return (
                      <tr key={entry._key} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 min-w-[180px]">
                          <WorkerCombobox
                            value={entry.workerId}
                            onChange={(id, name) => updateWorker(entry._key, id, name)}
                            workers={workers}
                            entryKey={entry._key}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Select value={entry.role} onValueChange={v => updateEntry(entry._key, "role", v)}>
                            <SelectTrigger className="h-8 text-sm" data-testid={`select-role-${entry._key}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map(r => (
                                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            value={entry.targetBales}
                            onChange={e => updateEntry(entry._key, "targetBales", e.target.value)}
                            className="h-8 text-sm text-right"
                            data-testid={`input-target-${entry._key}`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {actual}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {met && <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto" />}
                          {notMet && <XCircle className="h-5 w-5 text-red-500 mx-auto" />}
                          {!met && !notMet && <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <Button size="icon" variant="ghost" onClick={() => removeRow(entry._key)} data-testid={`button-remove-${entry._key}`}>
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Add worker + role summary */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={workers.length === 0}
              data-testid="button-add-worker-row"
            >
              <Plus className="h-4 w-4 mr-1" /> Add Worker
            </Button>
            {visibleEntries.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {ROLES.map(r => {
                  const count = visibleEntries.filter(e => e.role === r.value).length;
                  if (!count) return null;
                  return <Badge key={r.value} className={ROLE_COLORS[r.value]}>{r.label}: {count}</Badge>;
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes (optional)</label>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. short shift, holiday schedule…"
              className="text-sm"
              data-testid="input-plan-notes"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
